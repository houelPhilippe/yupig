//! Compilation d'un document par Pandoc.
//!
//! Le projet règle un **modèle de commande**, écrit une fois avec des variables
//! à la place de ce qui change d'un document à l'autre :
//! `pandoc {fichier} … -o {sortie}`. Ce module en fait une commande prête à
//! lancer, et la lance.
//!
//! Trois choix :
//!
//! - **Le modèle est découpé en arguments avant que les variables ne soient
//!   remplacées.** Un chemin qui porte une espace reste ainsi un seul argument,
//!   sans rien avoir à échapper.
//! - **Aucun shell.** Le programme est lancé directement, depuis la racine du
//!   projet : ni `|`, ni `>`, ni `$VAR` n'ont de sens, et rien de ce qu'un nom
//!   de fichier contient ne peut s'y interpréter.
//! - **Le programme est Pandoc, et rien d'autre.** Le modèle est lu en base par
//!   Rust, non reçu du frontend ; et son premier mot doit nommer `pandoc` —
//!   seul ou par son chemin. La commande de compilation ne devient donc pas une
//!   porte ouverte sur n'importe quel exécutable.
//!
//! C'est aussi la seule lecture du modèle : l'aperçu des paramètres passe par
//! `plan_for` comme la compilation, et ne peut donc pas montrer autre chose que ce
//! qui partira.
//!
//! Deux formats, deux modèles — HTML et PDF —, lus de la même façon : seuls
//! changent le modèle par défaut et l'extension que `{sortie}` donne au
//! document (`Format`).
//!
//! La page d'accueil du site — `index.md`, à la racine du projet — a son
//! propre modèle HTML, qui prend le pas sur celui des autres documents
//! (`template_for`) : elle ne se bâtit pas sur le même gabarit. Son champ
//! laissé vide vaut son propre défaut, et non le modèle des chapitres.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{Error, Result};
use crate::models::{LogLevel, PandocSettings};

/// Les commandes proposées tant que le projet n'en a pas réglé une.
///
/// Elles nomment les fichiers de `conf/` — filtre, modèles, bibliothèque,
/// configurations : c'est la disposition qu'un projet de cette application
/// porte, celle de `projetExemple`. Un champ laissé vide donne donc déjà une
/// compilation complète, et non un Pandoc nu dont la page sortirait sans
/// gabarit ni table des matières. Un projet bâti autrement écrit les siennes.
pub const DEFAULT_HTML_COMMAND: &str = concat!(
    "pandoc {fichier} -f markdown -t html5 --standalone --toc --toc-depth=6",
    " --lua-filter=conf/filtre.lua --template=conf/modele.template.html",
    " --metadata-file=conf/bibliotheque.yaml -o {sortie}",
);

/// La commande de la page d'accueil : son propre gabarit, et pas de table des
/// matières — elle n'est pas un chapitre.
pub const DEFAULT_HTML_INDEX_COMMAND: &str = concat!(
    "pandoc {fichier} -f markdown -t html5 --standalone",
    " --template=conf/modele-accueil.template.html",
    " --metadata-file=conf/bibliotheque.yaml -o {sortie}",
);

/// La commande PDF par défaut : tout est dans le fichier de configuration —
/// moteur LaTeX, préambule, chemins des images, filtre.
pub const DEFAULT_PDF_COMMAND: &str =
    "pandoc {fichier} --defaults=conf/defaults-single.yaml -o {sortie}";

/// La commande Word par défaut. `--resource-path` : les images d'un document
/// sont écrites en relatif à son dossier, et Pandoc, lancé depuis la racine,
/// doit les y trouver pour les embarquer dans le `.docx`. `--reference-doc`
/// donne au document ses styles.
pub const DEFAULT_DOCX_COMMAND: &str = concat!(
    "pandoc {fichier} --defaults=conf/defaults-docx.yaml",
    " --resource-path={dossier} --reference-doc=conf/reference.docx -o {sortie}",
);

/// Le « book » : un seul PDF pour tout le projet, parties et chapitres compris.
///
/// Pandoc ne connaît ni `\part` ni `\chapter` : c'est un script du projet qui
/// assemble les documents dans l'ordre d'une structure, chaque partie devenant
/// un fichier temporaire, puis appelle Pandoc une fois sur la liste entière.
/// Les trois chemins sont **fixes**, dans `conf/` : le modèle de commande d'un
/// format ordinaire n'a pas d'équivalent ici, et le programme lancé n'est donc
/// pas plus ouvert qu'ailleurs — `python3`, ce script-là, et rien d'autre.
pub const BOOK_SCRIPT: &str = "conf/generate_book.py";
pub const BOOK_STRUCTURE: &str = "conf/book_structure.yaml";
pub const BOOK_DEFAULTS: &str = "conf/defaults-book.yaml";

/// De quoi lancer le script du book : `python3 conf/generate_book.py
/// conf/book_structure.yaml <sortie> conf/defaults-book.yaml`.
///
/// `dest` est le répertoire de destination — vide, la sortie reste relative à
/// la racine du projet, comme pour `{sortie}` — et `file` le nom du PDF.
pub fn plan_book(dest: &str, file: &str) -> Result<Plan> {
    let name = file.trim();
    if name.is_empty() {
        return Err(Error::Other("aucun nom de fichier PDF réglé pour le book".into()));
    }
    // Un nom, non un chemin : la destination dit où le PDF se pose.
    if name.contains('/') || name.contains('\\') {
        return Err(Error::Other(format!(
            "« {name} » n'est pas un nom de fichier : le dossier se règle à part"
        )));
    }
    let name = if name.to_ascii_lowercase().ends_with(".pdf") {
        name.to_string()
    } else {
        format!("{name}.pdf")
    };

    let output = join(dest, &name);
    Ok(Plan {
        program: "python3".into(),
        args: vec![
            BOOK_SCRIPT.to_string(),
            BOOK_STRUCTURE.to_string(),
            output.clone(),
            BOOK_DEFAULTS.to_string(),
        ],
        output: Some(output),
    })
}

/// Le format que produit une compilation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Html,
    Pdf,
    Docx,
}

impl Format {
    /// L'extension du document produit — celle que `{sortie}` lui donne.
    pub fn extension(self) -> &'static str {
        match self {
            Format::Html => "html",
            Format::Pdf => "pdf",
            Format::Docx => "docx",
        }
    }

    /// Le nom du format, tel que les messages le disent.
    pub fn label(self) -> &'static str {
        match self {
            Format::Html => "HTML",
            Format::Pdf => "PDF",
            Format::Docx => "Word",
        }
    }

}

/// Le modèle qui vaut pour `file` quand le projet n'en a réglé aucun.
///
/// La page d'accueil a le sien, comme elle a le sien dans les réglages : un
/// champ vide vaut le défaut de ce champ, et non celui du voisin.
fn default_command(format: Format, file: &str) -> &'static str {
    match format {
        Format::Html if is_home(file) => DEFAULT_HTML_INDEX_COMMAND,
        Format::Html => DEFAULT_HTML_COMMAND,
        Format::Pdf => DEFAULT_PDF_COMMAND,
        Format::Docx => DEFAULT_DOCX_COMMAND,
    }
}

/// Le document est-il la page d'accueil — `index.md` à la racine du projet ?
///
/// La racine seule : un `index.md` rangé dans un dossier est un chapitre comme
/// un autre, et se compile sur le modèle commun.
pub fn is_home(file: &str) -> bool {
    !file.contains('/') && with_extension(file, "").eq_ignore_ascii_case("index")
}

/// Le modèle et la destination qui valent pour `file` dans le format `format`.
///
/// C'est ici, et nulle part ailleurs, que se décide quel modèle part : la
/// compilation et l'aperçu des paramètres passent tous deux par là. Le champ
/// est rendu tel qu'il est, vide compris : c'est `plan_for` qui lui donne alors
/// son défaut, et celui de l'accueil n'est pas celui d'un chapitre.
pub fn template_for<'a>(
    settings: &'a PandocSettings,
    format: Format,
    file: &str,
) -> (&'a str, &'a str) {
    match format {
        Format::Html if is_home(file) => (&settings.html_index_command, &settings.html_dest),
        Format::Html => (&settings.html_command, &settings.html_dest),
        Format::Pdf => (&settings.pdf_command, &settings.pdf_dest),
        Format::Docx => (&settings.docx_command, &settings.docx_dest),
    }
}

/// Ce qu'un modèle devient pour un document : de quoi lancer Pandoc.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub program: String,
    pub args: Vec<String>,
    /// La page produite, telle que `{sortie}` l'a écrite — `None` quand le
    /// modèle ne s'en sert pas : la destination est alors l'affaire de la
    /// commande elle-même.
    pub output: Option<String>,
}

/// Découpe un modèle en arguments.
///
/// Les blancs séparent ; des guillemets, simples ou doubles, regroupent — ce
/// qu'on écrirait dans un terminal pour une valeur à espaces. Il n'y a pas
/// d'échappement : un modèle de commande n'en a pas besoin, et chaque règle de
/// plus serait une façon de plus de se tromper sur ce qui part.
pub fn split(template: &str) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    // Distingue un argument vide écrit `""` d'une absence d'argument.
    let mut started = false;

    for c in template.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => current.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                started = true;
            }
            None if c.is_whitespace() => {
                if started {
                    out.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            None => {
                current.push(c);
                started = true;
            }
        }
    }
    if quote.is_some() {
        return Err(Error::Other(
            "modèle de commande : un guillemet n'est pas refermé".into(),
        ));
    }
    if started {
        out.push(current);
    }
    Ok(out)
}

/// Les valeurs des variables, pour un document, une destination et un format.
struct Vars<'a> {
    file: &'a str,
    dest: &'a str,
    format: Format,
}

impl Vars<'_> {
    fn value(&self, name: &str) -> Option<String> {
        Some(match name {
            "fichier" => self.file.to_string(),
            "sortie" => join(self.dest, &with_extension(self.file, self.format.extension())),
            "destination" => trim_slash(self.dest.trim()).to_string(),
            "dossier" => self
                .file
                .rsplit_once('/')
                .map(|(dir, _)| dir.to_string())
                .unwrap_or_default(),
            "nom" => with_extension(self.file.rsplit('/').next().unwrap_or(""), ""),
            _ => return None,
        })
    }

    /// Remplace les variables d'un argument. Une accolade qui ne nomme aucune
    /// variable connue reste telle qu'elle est écrite.
    fn expand(&self, arg: &str) -> String {
        let mut out = String::new();
        let mut rest = arg;
        while let Some(open) = rest.find('{') {
            out.push_str(&rest[..open]);
            let after = &rest[open + 1..];
            match after.find('}') {
                Some(close)
                    if after[..close].chars().all(|c| c.is_ascii_lowercase())
                        && self.value(&after[..close]).is_some() =>
                {
                    out.push_str(&self.value(&after[..close]).unwrap_or_default());
                    rest = &after[close + 1..];
                }
                _ => {
                    out.push('{');
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        out
    }
}

/// `a/b.md` et `html` donnent `a/b.html` ; une extension vide la retire.
fn with_extension(path: &str, ext: &str) -> String {
    let slash = path.rfind('/').map_or(0, |i| i + 1);
    let bare = match path[slash..].rfind('.') {
        Some(dot) if dot > 0 => &path[..slash + dot],
        _ => path,
    };
    if ext.is_empty() {
        bare.to_string()
    } else {
        format!("{bare}.{ext}")
    }
}

fn trim_slash(dir: &str) -> &str {
    let trimmed = dir.trim_end_matches('/');
    if trimmed.is_empty() && dir.starts_with('/') {
        "/"
    } else {
        trimmed
    }
}

/// Sans destination, la sortie reste relative au projet.
fn join(dest: &str, path: &str) -> String {
    match trim_slash(dest.trim()) {
        "" => path.to_string(),
        "/" => format!("/{path}"),
        base => format!("{base}/{path}"),
    }
}

/// Le premier mot nomme-t-il Pandoc — seul, ou par son chemin ?
fn is_pandoc(program: &str) -> bool {
    Path::new(program)
        .file_stem()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("pandoc"))
}

/// Le modèle, prêt à lancer pour le document `file` — relatif à la racine du
/// projet. Un modèle vide vaut la commande par défaut du format.
pub fn plan_for(format: Format, template: &str, file: &str, dest: &str) -> Result<Plan> {
    let template = if template.trim().is_empty() {
        default_command(format, file)
    } else {
        template
    };
    let words = split(template)?;
    let vars = Vars { file, dest, format };

    let (program, rest) = words
        .split_first()
        .ok_or_else(|| Error::Other("modèle de commande vide".into()))?;
    if !is_pandoc(program) {
        return Err(Error::Other(format!(
            "modèle de commande : « {program} » n'est pas Pandoc — la commande doit commencer par pandoc"
        )));
    }

    Ok(Plan {
        program: program.clone(),
        args: rest.iter().map(|a| vars.expand(a)).collect(),
        output: template.contains("{sortie}").then(|| vars.value("sortie").unwrap_or_default()),
    })
}

/// La commande telle qu'on l'écrirait dans un terminal : ce que l'aperçu montre.
/// Un argument vide ou qui porte un blanc est mis entre guillemets.
pub fn display(plan: &Plan) -> String {
    std::iter::once(&plan.program)
        .chain(&plan.args)
        .map(|a| {
            if a.is_empty() || a.chars().any(char::is_whitespace) {
                format!("\"{a}\"")
            } else {
                a.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Ce que la compilation a donné.
#[derive(Debug)]
pub struct Outcome {
    /// Le chemin de la page produite, si le modèle le nomme.
    pub output: Option<PathBuf>,
    /// Ce que Pandoc a écrit — ses avertissements, le plus souvent.
    pub log: String,
}

/// Lance la compilation depuis la racine du projet.
///
/// Le dossier de la page produite est créé s'il manque : la destination reprend
/// l'arborescence du projet, et Pandoc refuserait d'écrire dans un dossier qui
/// n'existe pas encore. C'est la seule écriture de ce module ; la page elle-même
/// est l'œuvre de Pandoc.
///
/// Ce que Pandoc écrit est rendu **au fil de l'eau**, ligne à ligne, par `log` :
/// le journal de l'interface le montre pendant que la compilation tourne, et
/// non une fois qu'elle est finie. Sa sortie d'erreur est lue ici, sa sortie
/// ordinaire dans un fil à part — lire l'une puis l'autre bloquerait Pandoc dès
/// que la seconde remplirait son tampon.
pub fn run(root: &Path, plan: &Plan, log: &mut dyn FnMut(LogLevel, String)) -> Result<Outcome> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    let output = plan.output.as_ref().map(|o| root.join(o));
    if let Some(parent) = output.as_ref().and_then(|o| o.parent()) {
        std::fs::create_dir_all(parent)?;
    }

    let mut child = Command::new(&plan.program)
        .args(&plan.args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Error::Other(format!(
                "« {} » introuvable : vérifiez qu'il est installé et accessible",
                plan.program
            )),
            _ => Error::Io(e),
        })?;

    let stdout = child.stdout.take();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let reader = std::thread::spawn(move || {
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(std::result::Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        }
    });

    let mut lines = Vec::new();
    if let Some(err) = child.stderr.take() {
        for line in BufReader::new(err).lines().map_while(std::result::Result::ok) {
            // Ce que la sortie ordinaire a produit entre-temps passe d'abord :
            // le journal garde à peu près l'ordre où Pandoc a écrit.
            for pending in rx.try_iter() {
                log(LogLevel::Output, pending.clone());
                lines.push(pending);
            }
            log(LogLevel::Output, line.clone());
            lines.push(line);
        }
    }
    let status = child.wait()?;
    let _ = reader.join();
    for pending in rx.try_iter() {
        log(LogLevel::Output, pending.clone());
        lines.push(pending);
    }

    let text = lines
        .iter()
        .map(|l| l.trim_end())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if !status.success() {
        return Err(Error::Other(if text.is_empty() {
            format!("Pandoc a échoué ({status})")
        } else {
            format!("Pandoc a échoué : {text}")
        }));
    }
    Ok(Outcome { output, log: text })
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXEMPLE: &str = "pandoc {fichier} -f markdown -t html5 --standalone --toc --toc-depth=6 \
        --lua-filter=conf/filtre.lua --template=conf/modele.template.html \
        --metadata-file=conf/bibliotheque.yaml -o {sortie}";

    #[test]
    fn le_modele_du_projet_donne_la_commande_attendue() {
        let plan = plan_for(
            Format::Html,
            EXEMPLE,
            "filesLOT04/SFD-CID-SDS-STOCK-BS-bLOT04-Chap01Introduction.md",
            "/mnt/hgfs/DEV/htdocs/",
        )
        .unwrap();
        assert_eq!(
            display(&plan),
            "pandoc filesLOT04/SFD-CID-SDS-STOCK-BS-bLOT04-Chap01Introduction.md -f markdown \
             -t html5 --standalone --toc --toc-depth=6 --lua-filter=conf/filtre.lua \
             --template=conf/modele.template.html --metadata-file=conf/bibliotheque.yaml \
             -o /mnt/hgfs/DEV/htdocs/filesLOT04/SFD-CID-SDS-STOCK-BS-bLOT04-Chap01Introduction.html"
        );
        assert_eq!(
            plan.output.as_deref(),
            Some("/mnt/hgfs/DEV/htdocs/filesLOT04/SFD-CID-SDS-STOCK-BS-bLOT04-Chap01Introduction.html")
        );
    }

    #[test]
    fn un_chemin_a_espaces_reste_un_seul_argument() {
        let plan = plan_for(Format::Html, "pandoc {fichier} -o {sortie}", "mes docs/a b.md", "/d").unwrap();
        assert_eq!(plan.args, ["mes docs/a b.md", "-o", "/d/mes docs/a b.html"]);
        assert_eq!(display(&plan), "pandoc \"mes docs/a b.md\" -o \"/d/mes docs/a b.html\"");
    }

    #[test]
    fn guillemets_et_variables_inconnues() {
        assert_eq!(
            split("pandoc 'a b' \"c d\" e\"f g\"").unwrap(),
            ["pandoc", "a b", "c d", "ef g"]
        );
        assert!(split("pandoc \"ouvert").is_err());

        let plan = plan_for(Format::Html, "pandoc {dossier}|{nom}|{destination}|{inconnu}", "x/y/z.v2.md", "/d//")
            .unwrap();
        assert_eq!(plan.args, ["x/y|z.v2|/d|{inconnu}"]);
        assert_eq!(plan.output, None);
    }

    /// Une vraie compilation, dans un dossier temporaire. Sautée là où Pandoc
    /// n'est pas installé : le test dit alors pourquoi il ne vérifie rien.
    #[test]
    fn compile_et_cree_le_dossier_de_destination() {
        if Command::new("pandoc").arg("--version").output().is_err() {
            eprintln!("pandoc absent : compilation réelle non vérifiée");
            return;
        }
        let base = std::env::temp_dir().join(format!("veille-pandoc-{}", std::process::id()));
        let root = base.join("projet");
        let dest = base.join("htdocs");
        std::fs::create_dir_all(root.join("lot 1")).unwrap();
        std::fs::write(root.join("lot 1/doc.md"), "# Titre\n\n&nbsp;\n\nTexte.\n").unwrap();

        let plan = plan_for(
            Format::Html,
            "pandoc {fichier} -t html5 --standalone --metadata title=T -o {sortie}",
            "lot 1/doc.md",
            &dest.to_string_lossy(),
        )
        .unwrap();
        let mut seen = Vec::new();
        let outcome = run(&root, &plan, &mut |_, line| seen.push(line)).unwrap();

        let page = outcome.output.unwrap();
        assert_eq!(page, dest.join("lot 1/doc.html"));
        let html = std::fs::read_to_string(&page).unwrap();
        assert!(html.contains("Titre"));

        let bad = plan_for(Format::Html, "pandoc {fichier} --option-inconnue", "lot 1/doc.md", "").unwrap();
        // Une erreur de Pandoc remonte avec son message, et passe par le journal.
        let mut journal = Vec::new();
        let err = run(&root, &bad, &mut |_, line| journal.push(line)).unwrap_err();
        assert!(err.to_string().contains("option-inconnue"), "{err}");
        assert!(!journal.is_empty());

        std::fs::remove_dir_all(&base).ok();
    }

    /// La commande PDF du projet : `{sortie}` y prend l'extension `.pdf`.
    #[test]
    fn le_modele_pdf_donne_la_commande_attendue() {
        let plan = plan_for(
            Format::Pdf,
            "pandoc {fichier} --defaults=conf/defaults-single.yaml -o {sortie}",
            "filesLOT04/SFD-CID-SDS-STOCK-BS-bLOT04-Chap01Introduction.md",
            "/mnt/hgfs/DEV/sds-sfd-v2027/resources/pdf",
        )
        .unwrap();
        assert_eq!(
            display(&plan),
            "pandoc filesLOT04/SFD-CID-SDS-STOCK-BS-bLOT04-Chap01Introduction.md \
             --defaults=conf/defaults-single.yaml -o /mnt/hgfs/DEV/sds-sfd-v2027/resources/pdf/\
             filesLOT04/SFD-CID-SDS-STOCK-BS-bLOT04-Chap01Introduction.pdf"
        );

        // Champ vide : le défaut du format, qui est ce même fichier de
        // configuration — la commande ci-dessus à la destination près.
        let plan = plan_for(Format::Pdf, "", "a/b.md", "").unwrap();
        assert_eq!(
            display(&plan),
            "pandoc a/b.md --defaults=conf/defaults-single.yaml -o a/b.pdf"
        );
    }

    /// La commande Word du projet : `{sortie}` en `.docx`, `{dossier}` pour
    /// les images relatives au document.
    #[test]
    fn le_modele_word_donne_la_commande_attendue() {
        let settings = PandocSettings {
            docx_dest: "/mnt/hgfs/DEV/sds-sfd-v2027/resources/docx".into(),
            docx_command: "pandoc {fichier} --defaults=conf/defaults-docx.yaml \
                --resource-path={dossier} -o {sortie}"
                .into(),
            ..PandocSettings::default()
        };
        let doc = "filesLOT01/SFD-CID-SDS-VN-BS-bLOT01-UC01_ReceptionAER.md";
        let (template, dest) = template_for(&settings, Format::Docx, doc);
        let plan = plan_for(Format::Docx, template, doc, dest).unwrap();
        assert_eq!(
            display(&plan),
            "pandoc filesLOT01/SFD-CID-SDS-VN-BS-bLOT01-UC01_ReceptionAER.md \
             --defaults=conf/defaults-docx.yaml --resource-path=filesLOT01 \
             -o /mnt/hgfs/DEV/sds-sfd-v2027/resources/docx/filesLOT01/\
             SFD-CID-SDS-VN-BS-bLOT01-UC01_ReceptionAER.docx"
        );

        // Pas de modèle d'accueil en Word : index.md prend le modèle commun.
        assert_eq!(template_for(&settings, Format::Docx, "index.md").0, settings.docx_command);

        // Champ vide : le défaut du format, qui ajoute le document de styles.
        let plan = plan_for(Format::Docx, "", "a/b.md", "").unwrap();
        assert_eq!(
            display(&plan),
            "pandoc a/b.md --defaults=conf/defaults-docx.yaml --resource-path=a \
             --reference-doc=conf/reference.docx -o a/b.docx"
        );
    }

    /// `index.md`, à la racine, prend le modèle d'accueil quand il est réglé.
    #[test]
    fn la_page_d_accueil_a_son_modele() {
        let settings = PandocSettings {
            html_dest: "/mnt/hgfs/DEV/htdocs".into(),
            html_command: EXEMPLE.into(),
            html_index_command: "pandoc {fichier} -f markdown -t html5 --standalone \
                --template=conf/modele-accueil.template.html \
                --metadata-file=conf/bibliotheque.yaml -o {sortie}"
                .into(),
            ..PandocSettings::default()
        };

        let (template, dest) = template_for(&settings, Format::Html, "index.md");
        let plan = plan_for(Format::Html, template, "index.md", dest).unwrap();
        assert_eq!(
            display(&plan),
            "pandoc index.md -f markdown -t html5 --standalone \
             --template=conf/modele-accueil.template.html \
             --metadata-file=conf/bibliotheque.yaml -o /mnt/hgfs/DEV/htdocs/index.html"
        );

        // Ailleurs qu'à la racine, ou pour un autre document : le modèle commun.
        assert_eq!(template_for(&settings, Format::Html, "lot/index.md").0, EXEMPLE);
        assert_eq!(template_for(&settings, Format::Html, "indexation.md").0, EXEMPLE);
        // En PDF, l'accueil n'a rien de particulier.
        assert_eq!(template_for(&settings, Format::Pdf, "index.md").0, "");
        // Vide, le champ de l'accueil vaut son propre défaut — le gabarit
        // d'accueil —, et non le modèle commun réglé juste au-dessus.
        let vide = PandocSettings { html_index_command: " ".into(), ..settings.clone() };
        let (template, dest) = template_for(&vide, Format::Html, "index.md");
        let plan = plan_for(Format::Html, template, "index.md", dest).unwrap();
        assert_eq!(
            display(&plan),
            "pandoc index.md -f markdown -t html5 --standalone \
             --template=conf/modele-accueil.template.html \
             --metadata-file=conf/bibliotheque.yaml -o /mnt/hgfs/DEV/htdocs/index.html"
        );
        assert!(is_home("INDEX.markdown"));
    }

    /// Le book : trois chemins fixes de `conf/`, et le PDF à la destination.
    #[test]
    fn le_book_se_lance_par_son_script() {
        let plan = plan_book("/mnt/hgfs/DEV/pdf/", "SDS-Book").unwrap();
        assert_eq!(
            display(&plan),
            "python3 conf/generate_book.py conf/book_structure.yaml \
             /mnt/hgfs/DEV/pdf/SDS-Book.pdf conf/defaults-book.yaml"
        );
        assert_eq!(plan.output.as_deref(), Some("/mnt/hgfs/DEV/pdf/SDS-Book.pdf"));

        // Sans destination, le PDF se pose dans le projet.
        assert_eq!(plan_book("", "livre.pdf").unwrap().output.as_deref(), Some("livre.pdf"));
        // Un nom, non un chemin ; et un nom est obligatoire.
        assert!(plan_book("/d", "sous/livre.pdf").is_err());
        assert!(plan_book("/d", "  ").is_err());
    }

    #[test]
    fn modele_vide_et_programme_refuse() {
        let plan = plan_for(Format::Html, "  ", "a.md", "").unwrap();
        assert_eq!(
            display(&plan),
            "pandoc a.md -f markdown -t html5 --standalone --toc --toc-depth=6 \
             --lua-filter=conf/filtre.lua --template=conf/modele.template.html \
             --metadata-file=conf/bibliotheque.yaml -o a.html"
        );
        // Et pour la page d'accueil, le défaut de l'accueil : son gabarit, sans
        // table des matières ni filtre.
        let plan = plan_for(Format::Html, "", "index.md", "").unwrap();
        assert_eq!(
            display(&plan),
            "pandoc index.md -f markdown -t html5 --standalone \
             --template=conf/modele-accueil.template.html \
             --metadata-file=conf/bibliotheque.yaml -o index.html"
        );

        assert!(plan_for(Format::Html, "/usr/local/bin/pandoc {fichier}", "a.md", "").is_ok());
        assert!(plan_for(Format::Html, "rm -rf {destination}", "a.md", "/").is_err());
        assert!(plan_for(Format::Html, "sh -c pandoc", "a.md", "").is_err());
    }
}

