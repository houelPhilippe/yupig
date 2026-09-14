//! Lecture et écriture du projet ouvert dans l'application « Édition ».
//!
//! Tout passe par un chemin **relatif** à la racine du projet : le frontend ne
//! manipule jamais de chemin absolu, et `resolve` refuse ce qui sortirait du
//! dossier ouvert. C'est le seul endroit du programme qui touche au disque de
//! l'utilisateur, la vérification tient donc ici et nulle part ailleurs.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;

use crate::error::{Error, Result};
use crate::models::{Document, Heading, ImageData, Node};

/// Dossiers jamais parcourus : volumineux et sans intérêt pour la rédaction.
const SKIP: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    "__pycache__",
    ".cache",
];

/// Extensions ouvertes dans l'éditeur. Le reste s'affiche dans l'arbre mais ne
/// s'ouvre pas : mieux vaut un fichier grisé qu'un binaire déversé à l'écran.
const TEXT: &[&str] = &[
    "md", "markdown", "mdown", "txt", "text", "rst", "adoc", "asciidoc", "org", "tex", "html",
    "htm", "css", "js", "mjs", "json", "toml", "yaml", "yml", "xml", "csv", "rs", "py", "sh",
    "sql", "ini", "conf", "log",
];

/// Extensions dont le sommaire se déduit des titres Markdown.
const MARKDOWN: &[&str] = &["md", "markdown", "mdown"];

const MAX_DEPTH: usize = 10;
/// Garde-fou : un dossier personnel entier ne doit pas figer l'interface.
const MAX_ENTRIES: usize = 5_000;
const MAX_BYTES: u64 = 4 * 1024 * 1024;

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn is_text(name: &str) -> bool {
    TEXT.contains(&extension(name).as_str())
}

pub fn is_markdown(name: &str) -> bool {
    MARKDOWN.contains(&extension(name).as_str())
}

/// Résout un chemin relatif contre la racine, ou refuse.
///
/// Deux barrières : les composants `..` sont rejetés d'emblée, puis les
/// chemins réels sont comparés — un lien symbolique pointant hors du projet ne
/// passe donc pas davantage.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let mut out = root.to_path_buf();
    for part in rel.split(['/', '\\']) {
        match part {
            "" | "." => continue,
            ".." => return Err(Error::Other("chemin hors du projet".into())),
            _ => out.push(part),
        }
    }

    let real_root = root
        .canonicalize()
        .map_err(|_| Error::Other("le dossier du projet est introuvable".into()))?;
    let real = out
        .canonicalize()
        .map_err(|_| Error::Other(format!("fichier introuvable : {rel}")))?;

    if !real.starts_with(&real_root) {
        return Err(Error::Other("chemin hors du projet".into()));
    }
    Ok(real)
}

/// Chemin d'un fichier relativement à la racine, en composants `/`.
fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// L'arborescence du projet, dossiers d'abord puis fichiers, par ordre
/// alphabétique — l'ordre attendu d'un explorateur. `read_dir` n'en garantit
/// aucun, le tri est donc à notre charge.
pub fn tree(root: &Path) -> Result<Vec<Node>> {
    let mut budget = MAX_ENTRIES;
    walk(root, root, 0, &mut budget)
}

fn walk(dir: &Path, root: &Path, depth: usize, budget: &mut usize) -> Result<Vec<Node>> {
    if depth >= MAX_DEPTH {
        return Ok(Vec::new());
    }

    let mut dirs: Vec<Node> = Vec::new();
    let mut files: Vec<Node> = Vec::new();

    for entry in std::fs::read_dir(dir)? {
        if *budget == 0 {
            break;
        }
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // Les fichiers cachés et les dossiers d'outillage encombrent l'arbre
        // sans jamais être le document qu'on vient rédiger.
        if name.starts_with('.') || SKIP.contains(&name.as_str()) {
            continue;
        }
        *budget -= 1;

        let path = entry.path();
        let rel = relative(root, &path);
        // `file_type` ne suit pas les liens : un lien vers un dossier n'est
        // donc pas parcouru, ce qui écarte au passage les cycles.
        if entry.file_type()?.is_dir() {
            let children = walk(&path, root, depth + 1, budget)?;
            dirs.push(Node {
                name,
                path: rel,
                is_dir: true,
                editable: false,
                children,
            });
        } else {
            let editable = is_text(&name);
            files.push(Node {
                name,
                path: rel,
                is_dir: false,
                editable,
                children: Vec::new(),
            });
        }
    }

    let by_name = |a: &Node, b: &Node| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(by_name);
    files.sort_by(by_name);
    dirs.append(&mut files);
    Ok(dirs)
}

/// Le chemin de `target` vu depuis le dossier du document `doc`.
///
/// C'est ce qui s'écrit dans le Markdown — le lien d'une image comme le chemin
/// d'un fichier à inclure. Un lien relatif suit le document : le projet peut
/// être déplacé, copié ou partagé sans que la cible se perde. Elle doit se
/// trouver dans le projet, faute de quoi le lien en sortirait — et le document
/// cesserait d'être autonome.
pub fn link_from(root: &Path, doc: &str, target: &Path) -> Result<String> {
    let real_root = root
        .canonicalize()
        .map_err(|_| Error::Other("le dossier du projet est introuvable".into()))?;
    let target = target
        .canonicalize()
        .map_err(|_| Error::Other("fichier introuvable".into()))?;
    if !target.starts_with(&real_root) {
        return Err(Error::Other(
            "le fichier doit se trouver dans le dossier du projet".into(),
        ));
    }

    let doc_dir = resolve(root, doc)?
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| real_root.clone());

    let from: Vec<_> = doc_dir
        .strip_prefix(&real_root)
        .unwrap_or(Path::new(""))
        .components()
        .collect();
    let to: Vec<_> = target
        .strip_prefix(&real_root)
        .unwrap_or(&target)
        .components()
        .collect();

    // On remonte de ce que les deux chemins ne partagent pas, puis on redescend.
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<String> = vec!["..".into(); from.len() - common];
    parts.extend(
        to[common..]
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().into_owned()),
    );
    Ok(parts.join("/"))
}

pub fn read(root: &Path, rel: &str) -> Result<Document> {
    let path = resolve(root, rel)?;
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    if !is_text(&name) {
        return Err(Error::Other(format!(
            "« {name} » n'est pas un fichier texte"
        )));
    }
    let size = std::fs::metadata(&path)?.len();
    if size > MAX_BYTES {
        return Err(Error::Other(format!(
            "fichier trop volumineux ({} Mo) pour l'éditeur",
            size / (1024 * 1024)
        )));
    }

    let content = std::fs::read_to_string(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::InvalidData {
            Error::Other(format!("« {name} » n'est pas lisible en UTF-8"))
        } else {
            Error::Io(e)
        }
    })?;

    Ok(Document {
        outline: if is_markdown(&name) {
            outline(&content)
        } else {
            Vec::new()
        },
        path: rel.to_string(),
        name,
        content,
    })
}

/// Type MIME déduit de l'extension — assez pour le presse-papiers.
fn mime_of(name: &str) -> Option<&'static str> {
    match extension(name).as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Encodage base64 standard.
///
/// Vingt lignes plutôt qu'une dépendance de plus : c'est le seul endroit du
/// programme qui en a besoin.
fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b1 = *chunk.first().unwrap_or(&0) as u32;
        let b2 = *chunk.get(1).unwrap_or(&0) as u32;
        let b3 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b1 << 16) | (b2 << 8) | b3;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        // Le remplissage marque les octets absents du dernier groupe.
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Les octets d'une image du projet, encodés pour traverser l'IPC.
pub fn read_image(root: &Path, rel: &str) -> Result<ImageData> {
    let path = resolve(root, rel)?;
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    let mime = mime_of(&name)
        .ok_or_else(|| Error::Other(format!("« {name} » n'est pas une image reconnue")))?;
    let bytes = std::fs::read(&path)?;
    if bytes.len() > MAX_BYTES as usize {
        return Err(Error::Other("image trop volumineuse à copier".into()));
    }

    Ok(ImageData {
        mime: mime.into(),
        base64: base64(&bytes),
    })
}

pub fn write(root: &Path, rel: &str, content: &str) -> Result<Document> {
    let path = resolve(root, rel)?;
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    if !is_text(&name) {
        return Err(Error::Other(format!(
            "« {name} » n'est pas un fichier texte"
        )));
    }
    std::fs::write(&path, content)?;
    read(root, rel)
}

/// Le libellé d'un titre, débarrassé de sa syntaxe Markdown.
///
/// Le sommaire affiche des intitulés, pas de la source : `## Le **grand** soir`
/// s'y lit « Le grand soir ». Les liens gardent leur texte, les images leur
/// texte de remplacement.
fn plain(text: &str) -> String {
    static RULES: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let rules = RULES.get_or_init(|| {
        let re = |p: &str| Regex::new(p).expect("motif de nettoyage de titre");
        vec![
            // Les images avant les liens, sinon `![alt](u)` laisserait son « ! ».
            (re(r"!\[([^\]]*)\]\([^)]*\)"), "$1"),
            (re(r"\[([^\]]*)\]\([^)]*\)"), "$1"),
            (re(r"\[([^\]]*)\]\[[^\]]*\]"), "$1"),
            // Le span à attributs de Pandoc — `[texte]{.smallcaps}` — garde son
            // texte, comme un lien garde le sien.
            (re(r"\[([^\]]*)\]\{[^}]*\}"), "$1"),
            // Un shortcode est une consigne, pas un intitulé : il s'en va tout
            // entier plutôt que de s'afficher en toutes lettres.
            (re(r"\{\{<[^>]*>\}\}"), ""),
            // Le code avant l'emphase : les `*` d'un extrait s'en vont avec lui
            // au lieu d'être pris pour de la mise en forme.
            (re(r"`+([^`]*)`+"), "$1"),
            (re(r"\*\*\*([^*]+)\*\*\*"), "$1"),
            (re(r"\*\*([^*]+)\*\*"), "$1"),
            // L'emphase ne s'ouvre pas sur une espace : « 3 * 4 * 5 » reste
            // une multiplication.
            (re(r"\*([^\s*][^*]*)\*"), "$1"),
            (re(r"___([^_]+)___"), "$1"),
            (re(r"__([^_]+)__"), "$1"),
            // Bornes de mot : le souligné d'un `feed_id` n'est pas de l'italique.
            (re(r"\b_([^_]+)_\b"), "$1"),
            (re(r"~~([^~]+)~~"), "$1"),
            // Un titre peut porter du balisage HTML.
            (re(r"<[^>]+>"), ""),
            // Les attributs que Pandoc pose en fin de titre — `{#sec-intro}`,
            // `{.unnumbered}` — le désignent, ils ne le nomment pas.
            (re(r"\s*\{[^}]*\}\s*$"), ""),
            // Les échappements en dernier : `\*` redevient `*`.
            (re(r"\\([\\`*_{}\[\]()#+\-.!])"), "$1"),
        ]
    });

    let mut out = text.to_string();
    for (re, replacement) in rules {
        out = re.replace_all(&out, *replacement).into_owned();
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// La ligne débarrassée des marqueurs qui l'ouvrent — les chevrons d'une
/// citation, la puce ou le numéro d'une entrée de liste.
///
/// Une barrière de bloc de code ne se ferme pas comme elle s'ouvre : dans une
/// liste, l'ouverture suit la puce sur la même ligne, la clôture se pose seule
/// dans la marge de l'entrée. Sans cette levée, seule la clôture se verrait :
/// elle passerait pour une ouverture, et tout ce qui suit dans le fichier serait
/// lu comme du code — le sommaire s'arrêtant au dernier titre d'avant la liste.
fn unmarked(line: &str) -> &str {
    let mut t = line.trim_start();
    while let Some(rest) = marker(t) {
        t = rest.trim_start();
    }
    t
}

/// Ce qui suit un marqueur de conteneur en tête de `t`, s'il y en a un.
fn marker(t: &str) -> Option<&str> {
    if let Some(rest) = t.strip_prefix('>') {
        return Some(rest);
    }

    let rest = match t.strip_prefix(['-', '*', '+']) {
        Some(rest) => rest,
        None => {
            // Un numéro d'entrée, et rien qu'un numéro : CommonMark n'en admet
            // pas plus de neuf chiffres.
            let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
            if digits == 0 || digits > 9 {
                return None;
            }
            t[digits..].strip_prefix(['.', ')'])?
        }
    };

    // Le marqueur veut une espace derrière lui : sans elle, « *** » serait une
    // entrée de liste au lieu d'une ligne horizontale.
    if rest.starts_with(' ') || rest.starts_with('\t') {
        Some(rest)
    } else {
        None
    }
}

/// Sommaire d'un document Markdown.
///
/// Les titres ATX (`## Titre`) et Setext (soulignés de `===` ou `---`). Les
/// blocs de code sont sautés — un `# commentaire` shell n'est pas un titre — et
/// l'en-tête YAML aussi, dont le `---` de fermeture passerait sinon pour un
/// soulignement de niveau 2.
pub fn outline(content: &str) -> Vec<Heading> {
    let lines: Vec<&str> = content.lines().collect();
    let mut out = Vec::new();
    let mut fence: Option<char> = None;
    let mut i = 0;

    // En-tête YAML : `---` en première ligne, jusqu'au `---` suivant.
    if lines.first().map(|l| l.trim_end()) == Some("---") {
        i = 1;
        while i < lines.len() && lines[i].trim_end() != "---" {
            i += 1;
        }
        i = (i + 1).min(lines.len());
    }

    while i < lines.len() {
        let line = lines[i].trim_end();
        let t = line.trim_start();

        // La barrière se lit sous les marqueurs de conteneur : elle s'ouvre
        // derrière la puce de l'entrée qui la porte et se ferme dans la marge.
        let f = unmarked(t);
        if let Some(c) = f.chars().next().filter(|c| *c == '`' || *c == '~') {
            if f.starts_with(&c.to_string().repeat(3)) {
                fence = match fence {
                    Some(open) if open == c => None,
                    other @ Some(_) => other,
                    None => Some(c),
                };
                i += 1;
                continue;
            }
        }
        if fence.is_some() {
            i += 1;
            continue;
        }

        let hashes = t.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) {
            let rest = &t[hashes..];
            // CommonMark exige l'espace : `#titre` n'est pas un titre.
            if rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t') {
                let text = plain(rest.trim().trim_end_matches('#').trim());
                if !text.is_empty() {
                    out.push(Heading {
                        level: hashes as u8,
                        text,
                        line: i + 1,
                    });
                }
                i += 1;
                continue;
            }
        }

        // Soulignement : il qualifie la ligne précédente, pas la sienne.
        if !t.is_empty() && i + 1 < lines.len() {
            let under = lines[i + 1].trim();
            let level = match under.chars().next() {
                Some('=') if under.chars().all(|c| c == '=') => Some(1),
                Some('-') if under.chars().all(|c| c == '-') => Some(2),
                _ => None,
            };
            if let Some(level) = level {
                let text = plain(t);
                if !text.is_empty() {
                    out.push(Heading {
                        level,
                        text,
                        line: i + 1,
                    });
                }
                i += 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sommaire_des_titres() {
        let md = "---\ntitre: essai\n---\n# Un\ntexte\n## Deux ##\n### Trois\n#pas-un-titre\n";
        let h = outline(md);
        let vu: Vec<_> = h.iter().map(|x| (x.level, x.text.as_str())).collect();
        assert_eq!(vu, vec![(1, "Un"), (2, "Deux"), (3, "Trois")]);
        // La ligne sert à porter le curseur : elle compte depuis 1.
        assert_eq!(h[0].line, 4);
    }

    #[test]
    fn sommaire_sans_syntaxe_markdown() {
        let md = concat!(
            "# Le **grand** soir\n",
            "## La fonction `clean`\n",
            "### Voir [la doc](https://ex.fr)\n",
            "#### *Enfin* du ~~vieux~~ neuf\n",
            "##### Garder feed_id intact\n",
            "###### Une ![vignette](a.png) et 3 * 4 * 5\n",
        );
        let vu: Vec<_> = outline(md).iter().map(|h| h.text.clone()).collect();
        assert_eq!(
            vu,
            vec![
                "Le grand soir",
                "La fonction clean",
                "Voir la doc",
                // Le barré perd ses marques et garde son mot, comme le gras :
                // c'est la syntaxe qu'on retire, pas le texte.
                "Enfin du vieux neuf",
                // Un souligné isolé appartient à l'identifiant, pas à l'emphase.
                "Garder feed_id intact",
                // Et une multiplication n'est pas de l'italique.
                "Une vignette et 3 * 4 * 5",
            ]
        );
    }

    #[test]
    fn sommaire_sans_syntaxe_de_pandoc() {
        let md = concat!(
            "# Le [Comité]{.smallcaps} a parlé\n",
            "## Un mot [en rouge]{style=\"color: #ec3013\"} ici\n",
            "### Introduction {#sec-intro}\n",
            "#### Publié le {{< meta date >}}\n",
        );
        let vu: Vec<_> = outline(md).iter().map(|h| h.text.clone()).collect();
        assert_eq!(
            vu,
            vec![
                "Le Comité a parlé",
                "Un mot en rouge ici",
                // L'identifiant désigne le titre, il ne le nomme pas.
                "Introduction",
                // Le shortcode s'en va tout entier : sa valeur n'est pas ici.
                "Publié le",
            ]
        );
    }

    #[test]
    fn sommaire_souligne_aussi_nettoye() {
        let md = "Titre **gras**\n=====\n";
        assert_eq!(outline(md)[0].text, "Titre gras");
    }

    #[test]
    fn sommaire_ignore_un_bloc_de_code_dans_une_liste() {
        // L'ouverture suit la puce, la clôture se pose seule dans la marge de
        // l'entrée : prise pour une ouverture, elle emportait la fin du
        // document — les titres d'après ne paraissaient plus au sommaire.
        let md = concat!(
            "# Vrai\n\n",
            "-   ```\n",
            "    # faux\n",
            "    ```\n\n",
            "### Vrai aussi\n",
        );
        let vu: Vec<_> = outline(md)
            .iter()
            .map(|x| (x.level, x.text.clone()))
            .collect();
        assert_eq!(
            vu,
            vec![(1, "Vrai".to_string()), (3, "Vrai aussi".to_string())]
        );
    }

    #[test]
    fn sommaire_garde_la_ligne_horizontale_hors_des_listes() {
        // « *** » n'est pas une puce : la levée des marqueurs ne doit pas en
        // faire une ouverture de bloc de code.
        let md = "# Un\n\n***\n\n## Deux\n";
        let vu: Vec<_> = outline(md).iter().map(|x| x.text.clone()).collect();
        assert_eq!(vu, vec!["Un", "Deux"]);
    }

    #[test]
    fn sommaire_ignore_les_blocs_de_code() {
        let md = "# Vrai\n\n```sh\n# faux\n```\n\n## Vrai aussi\n";
        let vu: Vec<_> = outline(md).iter().map(|x| x.text.clone()).collect();
        assert_eq!(vu, vec!["Vrai", "Vrai aussi"]);
    }

    #[test]
    fn sommaire_des_soulignements() {
        let md = "Titre\n=====\n\nSous-titre\n----------\n";
        let vu: Vec<_> = outline(md)
            .iter()
            .map(|x| (x.level, x.text.clone()))
            .collect();
        assert_eq!(
            vu,
            vec![(1, "Titre".to_string()), (2, "Sous-titre".to_string())]
        );
    }

    #[test]
    fn encodage_base64() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        // Octets hors ASCII : c'est le cas courant pour une image.
        assert_eq!(base64(&[0xff, 0xd8, 0xff]), "/9j/");
    }

    #[test]
    fn lien_relatif_vers_une_image() {
        let dir = std::env::temp_dir().join("veille-test-lien");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("docs/partie")).unwrap();
        std::fs::create_dir_all(dir.join("images")).unwrap();
        std::fs::write(dir.join("docs/a.md"), "").unwrap();
        std::fs::write(dir.join("docs/partie/b.md"), "").unwrap();
        std::fs::write(dir.join("racine.md"), "").unwrap();
        std::fs::write(dir.join("images/photo.png"), "").unwrap();
        std::fs::write(dir.join("docs/voisine.png"), "").unwrap();

        let img = dir.join("images/photo.png");
        assert_eq!(
            link_from(&dir, "racine.md", &img).unwrap(),
            "images/photo.png"
        );
        assert_eq!(
            link_from(&dir, "docs/a.md", &img).unwrap(),
            "../images/photo.png"
        );
        assert_eq!(
            link_from(&dir, "docs/partie/b.md", &img).unwrap(),
            "../../images/photo.png"
        );
        // Voisine du document : aucun « ../ » à remonter.
        assert_eq!(
            link_from(&dir, "docs/a.md", &dir.join("docs/voisine.png")).unwrap(),
            "voisine.png"
        );
        // Hors du projet : refusé, le document cesserait d'être autonome.
        assert!(link_from(&dir, "docs/a.md", Path::new("/etc/hostname")).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn chemins_hors_du_projet_refuses() {
        let dir = std::env::temp_dir().join("veille-test-resolve");
        let _ = std::fs::create_dir_all(dir.join("sous"));
        std::fs::write(dir.join("sous/a.md"), "# a").unwrap();

        assert!(resolve(&dir, "sous/a.md").is_ok());
        assert!(resolve(&dir, "../../etc/passwd").is_err());
        assert!(resolve(&dir, "sous/../../..").is_err());
        // Un chemin « absolu » venu du frontend reste borné à la racine.
        assert!(resolve(&dir, "/sous/a.md").is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn arborescence_triee_et_filtree() {
        let dir = std::env::temp_dir().join("veille-test-tree");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("z-dossier")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("a.md"), "").unwrap();
        std::fs::write(dir.join("b.png"), "").unwrap();
        std::fs::write(dir.join(".cache-perso"), "").unwrap();
        std::fs::write(dir.join("z-dossier/c.md"), "").unwrap();

        let t = tree(&dir).unwrap();
        let noms: Vec<_> = t.iter().map(|n| n.name.as_str()).collect();
        // Dossier d'abord, puis les fichiers ; ni caché ni `node_modules`.
        assert_eq!(noms, vec!["z-dossier", "a.md", "b.png"]);
        assert_eq!(t[0].children[0].path, "z-dossier/c.md");
        assert!(t[1].editable, "un .md s'ouvre");
        assert!(!t[2].editable, "un .png ne s'ouvre pas");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
