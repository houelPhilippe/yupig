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
use crate::models::{Document, Heading, ImageData, Marker, Node};

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

/// La racine du projet, chemin réel — celui auquel `resolve` compare.
fn real_root(root: &Path) -> Result<PathBuf> {
    root.canonicalize()
        .map_err(|_| Error::Other("le dossier du projet est introuvable".into()))
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

    let real_root = real_root(root)?;
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
///
/// `open` porte les chemins des dossiers **dépliés**, et l'on ne descend que
/// dans ceux-là : le volet ne dessine jamais le contenu d'un dossier fermé, le
/// lire serait donc du travail pur perdu. Ce n'est pas une optimisation de
/// confort — sur un dossier partagé par la machine virtuelle, chaque `read_dir`
/// traverse le système de fichiers de l'hôte, et parcourir le projet entier
/// prenait des minutes là où un seul niveau prend une seconde. L'arbre
/// paraissait alors ne pas s'actualiser, faute de revenir avant qu'on ait
/// renoncé.
///
/// Un dossier fermé rend donc `children` vide. Le volet n'en sait rien : c'est
/// `expanded`, et non la présence d'enfants, qui lui dit dans quel sens tourner
/// son chevron — et c'est cette même liste qui arrive ici.
pub fn tree(root: &Path, open: &[String]) -> Result<Vec<Node>> {
    let mut budget = MAX_ENTRIES;
    walk(root, root, 0, &mut budget, open)
}

fn walk(
    dir: &Path,
    root: &Path,
    depth: usize,
    budget: &mut usize,
    open: &[String],
) -> Result<Vec<Node>> {
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
            // Fermé : on s'arrête là. Le déplier redemandera l'arborescence, et
            // ce dossier-ci sera dans `open` au tour suivant.
            let children = if open.iter().any(|p| p == &rel) {
                walk(&path, root, depth + 1, budget, open)?
            } else {
                Vec::new()
            };
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

/// Les documents Markdown d'un dossier du projet, relatifs à la racine, dans
/// l'ordre de l'arbre — alphabétique, sans tenir compte de la casse.
///
/// Le dossier seul, sans ses sous-dossiers : c'est ce qu'on voit sous lui en
/// le dépliant, et ce que « Compiler en HTML » sur un dossier annonce. Les
/// fichiers cachés sont écartés comme dans l'arbre, et les liens ne sont pas
/// suivis. `rel` vide désigne la racine.
pub fn markdown_in(root: &Path, rel: &str) -> Result<Vec<String>> {
    let dir = resolve(root, rel)?;
    if !dir.is_dir() {
        return Err(Error::Other(format!("« {rel} » n'est pas un dossier")));
    }

    let mut names: Vec<String> = std::fs::read_dir(&dir)?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with('.') && is_markdown(name))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());

    let prefix = rel.trim_matches('/');
    Ok(names
        .into_iter()
        .map(|name| if prefix.is_empty() { name } else { format!("{prefix}/{name}") })
        .collect())
}

/// Le chemin de `target` vu depuis le dossier du document `doc`.
///
/// C'est ce qui s'écrit dans le Markdown — le lien d'une image comme le chemin
/// d'un fichier à inclure. Un lien relatif suit le document : le projet peut
/// être déplacé, copié ou partagé sans que la cible se perde. Elle doit se
/// trouver dans le projet, faute de quoi le lien en sortirait — et le document
/// cesserait d'être autonome.
pub fn link_from(root: &Path, doc: &str, target: &Path) -> Result<String> {
    let real_root = real_root(root)?;
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

// ----------------------------------------------------- opérations sur un
//                                                        fichier du projet
//
// Renommer, dupliquer, effacer : trois gestes que l'arbre et l'onglet portent
// tous deux, et qui passent par `resolve` comme tout le reste — le frontend
// n'envoie qu'un chemin relatif, et rien de ce qui sortirait du projet ne
// franchit cette porte.
//
// Aucun des trois ne vaut pour un dossier : le menu ne s'ouvre que sur un
// fichier, et effacer un dossier emporterait ce qu'il contient sans que la
// question ait été posée sur chacun. Le refus est donc ici, et non seulement
// dans l'interface.

/// Le nom qu'un fichier du projet peut porter.
///
/// Un nom est un nom, jamais un chemin : une barre y déplacerait le fichier
/// ailleurs, ce que « Renommer » ne promet pas. Un nom commençant par un point
/// est refusé pour une autre raison — `walk` écarte les fichiers cachés, et le
/// fichier renommé disparaîtrait de l'arbre sans avoir été effacé.
fn check_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Other("le nom ne peut pas être vide".into()));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(Error::Other(
            "un nom de fichier ne porte pas de dossier".into(),
        ));
    }
    if name.starts_with('.') {
        return Err(Error::Other(
            "un nom commençant par un point ne paraîtrait pas dans l'arborescence".into(),
        ));
    }
    Ok(name)
}

/// Le fichier visé, s'il en est bien un.
fn file(root: &Path, rel: &str) -> Result<PathBuf> {
    let path = resolve(root, rel)?;
    if path.is_dir() {
        return Err(Error::Other(
            "cette commande ne vaut que pour un fichier".into(),
        ));
    }
    Ok(path)
}

/// Le dossier visé, s'il en est bien un. `rel` vide désigne la racine.
fn directory(root: &Path, rel: &str) -> Result<PathBuf> {
    let path = resolve(root, rel)?;
    if !path.is_dir() {
        return Err(Error::Other(format!("« {rel} » n'est pas un dossier")));
    }
    Ok(path)
}

/// Crée un document Markdown vide dans `dir`, et rend son chemin relatif.
///
/// L'extension est ajoutée si le nom n'en porte pas : la commande crée un
/// document, et c'est l'extension qui en fait un — l'arbre ne l'ouvrirait pas
/// autrement, et le sommaire n'en dirait rien.
///
/// Un nom déjà pris est refusé plutôt qu'écrasé, comme pour un renommage : le
/// fichier existant porte peut-être tout un chapitre.
pub fn create_file(root: &Path, dir: &str, name: &str) -> Result<String> {
    let parent = directory(root, dir)?;
    let name = check_name(name)?;
    let name = if is_markdown(name) {
        name.to_string()
    } else {
        format!("{name}.md")
    };

    let target = parent.join(&name);
    if target.exists() {
        return Err(Error::Other(format!(
            "« {name} » existe déjà dans ce dossier"
        )));
    }
    // Vide : c'est un document neuf, et rien n'a à y être écrit d'office.
    std::fs::write(&target, "")?;
    Ok(relative(&real_root(root)?, &target))
}

/// Crée un dossier dans `dir`, et rend son chemin relatif.
pub fn create_dir(root: &Path, dir: &str, name: &str) -> Result<String> {
    let parent = directory(root, dir)?;
    let name = check_name(name)?;

    let target = parent.join(name);
    if target.exists() {
        return Err(Error::Other(format!(
            "« {name} » existe déjà dans ce dossier"
        )));
    }
    // `create_dir` et non `create_dir_all` : un nom sans dossier ne peut pas en
    // demander plusieurs, et l'erreur dit alors ce qui manque.
    std::fs::create_dir(&target)?;
    Ok(relative(&real_root(root)?, &target))
}

/// Renomme un fichier sans le déplacer, et rend son nouveau chemin relatif.
///
/// Un nom déjà pris est refusé plutôt qu'écrasé : `rename` remplacerait le
/// fichier en place sans un mot, et c'est le travail d'un autre document qui
/// partirait.
pub fn rename(root: &Path, rel: &str, name: &str) -> Result<String> {
    let path = file(root, rel)?;
    let name = check_name(name)?;
    let target = path.with_file_name(name);

    if target == path {
        return Ok(rel.to_owned());
    }
    if target.exists() {
        return Err(Error::Other(format!(
            "« {name} » existe déjà dans ce dossier"
        )));
    }
    std::fs::rename(&path, &target)?;
    Ok(relative(&real_root(root)?, &target))
}

/// Copie un fichier à côté de lui-même et rend le chemin de la copie.
pub fn duplicate(root: &Path, rel: &str) -> Result<String> {
    let path = file(root, rel)?;
    let target = free_name(&path)?;
    std::fs::copy(&path, &target)?;
    Ok(relative(&real_root(root)?, &target))
}

/// Le premier nom libre à côté de `path` : « note.md » donne « note (copie).md »,
/// puis « note (copie 2).md ».
///
/// Le suffixe se pose avant l'extension et non après : c'est elle qui dit à
/// l'application — et au système — ce qu'est le fichier, et une copie de
/// document doit rester un document.
fn free_name(path: &Path) -> Result<PathBuf> {
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let suffix = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    for n in 1..1_000 {
        let tag = if n == 1 {
            " (copie)".to_owned()
        } else {
            format!(" (copie {n})")
        };
        let candidate = path.with_file_name(format!("{stem}{tag}{suffix}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(Error::Other(
        "trop de copies de ce fichier dans ce dossier".into(),
    ))
}

/// Efface un fichier du projet. Rien n'est mis de côté : l'interface le dit
/// avant de le demander.
pub fn remove(root: &Path, rel: &str) -> Result<()> {
    std::fs::remove_file(file(root, rel)?)?;
    Ok(())
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

// ------------------------------------------------------------------ projet
//
// Un dossier devient un projet le jour où on y pose un témoin. Celui-ci ne
// porte que ce qui garde un sens ailleurs — le nom, la date de création : un
// dossier copié sur une autre machine y est le même projet, sous le même nom.
// Le chemin, la dernière ouverture et la mise en page restent en base, où ils
// ne valent que pour cette machine.

/// Dossier du témoin. Il commence par un point : `walk` l'écarte de l'arbre
/// sans avoir à le nommer, et l'outillage du projet peut s'y ajouter plus tard.
const MARKER_DIR: &str = ".veille";
const MARKER_FILE: &str = "projet.json";

fn marker_path(root: &Path) -> PathBuf {
    root.join(MARKER_DIR).join(MARKER_FILE)
}

/// Le nom que porte un dossier, à défaut de témoin lisible.
///
/// `file_name` est vide pour une racine (`/`) : on retombe alors sur le chemin
/// entier, qui vaut mieux qu'une ligne sans nom dans la liste.
pub fn dir_name(root: &Path) -> String {
    root.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| root.to_string_lossy().into_owned())
}

/// Lit le témoin d'un dossier. `None` : ce dossier n'est pas un projet.
///
/// Un témoin illisible ou mal formé ne lève pas : le dossier est simplement
/// tenu pour un dossier ordinaire, ce qu'une boîte de dialogue sait dire mieux
/// qu'un message d'erreur.
pub fn read_marker(root: &Path) -> Option<Marker> {
    let text = std::fs::read_to_string(marker_path(root)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn is_project(root: &Path) -> bool {
    read_marker(root).is_some()
}

/// Pose le témoin d'un projet neuf sur un dossier existant.
///
/// Le dossier, lui, n'est pas créé : l'application ouvre des projets sur ce qui
/// est déjà là. Un dossier qui porte déjà un témoin est refusé plutôt que
/// réécrit — ce serait perdre sa date de création sans rien demander.
pub fn write_marker(root: &Path, name: &str, created: &str) -> Result<Marker> {
    if !root.is_dir() {
        return Err(Error::Other(format!(
            "« {} » n'est pas un dossier",
            root.display()
        )));
    }
    if let Some(existing) = read_marker(root) {
        return Err(Error::Other(format!(
            "ce dossier est déjà le projet « {} »",
            existing.name
        )));
    }

    let name = name.trim();
    let marker = Marker {
        name: if name.is_empty() {
            dir_name(root)
        } else {
            name.to_owned()
        },
        created: created.to_owned(),
        version: 1,
    };

    let dir = root.join(MARKER_DIR);
    std::fs::create_dir_all(&dir)?;
    // `to_string_pretty` : le témoin se lit et se corrige à la main, c'est un
    // fichier de l'utilisateur comme les autres.
    let text = serde_json::to_string_pretty(&marker)
        .map_err(|e| Error::Other(format!("témoin du projet illisible : {e}")))?;
    std::fs::write(dir.join(MARKER_FILE), text + "\n")?;
    Ok(marker)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un dossier vide, propre à chaque test, effacé par `Temp`.
    struct Temp(PathBuf);

    impl Temp {
        fn new(tag: &str) -> Self {
            // `SystemTime` plutôt qu'un compteur : deux tests lancés en
            // parallèle ne doivent pas se disputer le même dossier.
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("veille-{tag}-{stamp}"));
            std::fs::create_dir_all(&dir).unwrap();
            Temp(dir)
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn documents_markdown_d_un_dossier() {
        let base = std::env::temp_dir().join(format!("veille-md-{}", std::process::id()));
        let root = base.join("projet");
        std::fs::create_dir_all(root.join("lot/sous")).unwrap();
        for name in ["lot/b.md", "lot/A.markdown", "lot/c.txt", "lot/.cache.md", "lot/sous/d.md", "e.md"] {
            std::fs::write(root.join(name), "x").unwrap();
        }

        // Le dossier seul, dans l'ordre de l'arbre, sans ses sous-dossiers.
        assert_eq!(markdown_in(&root, "lot").unwrap(), ["lot/A.markdown", "lot/b.md"]);
        assert_eq!(markdown_in(&root, "").unwrap(), ["e.md"]);
        assert!(markdown_in(&root, "../").is_err());
        assert!(markdown_in(&root, "e.md").is_err());

        std::fs::remove_dir_all(&base).ok();
    }

    /// Création d'un document et d'un dossier : l'extension posée, les noms
    /// déjà pris refusés, et rien hors du projet.
    #[test]
    fn creation_d_un_document_et_d_un_dossier() {
        let dir = Temp::new("creer");
        let root = &dir.0;
        std::fs::create_dir_all(root.join("lot")).unwrap();

        assert_eq!(create_file(root, "", "notes").unwrap(), "notes.md");
        assert_eq!(std::fs::read_to_string(root.join("notes.md")).unwrap(), "");
        assert_eq!(create_file(root, "lot", "Chap 1.markdown").unwrap(), "lot/Chap 1.markdown");
        assert_eq!(create_dir(root, "lot", "img").unwrap(), "lot/img");
        assert!(root.join("lot/img").is_dir());

        // Déjà pris, nom vide, nom caché, dossier dans le nom, hors du projet.
        assert!(create_file(root, "", "notes.md").is_err());
        assert!(create_dir(root, "lot", "img").is_err());
        assert!(create_file(root, "", "  ").is_err());
        assert!(create_file(root, "", ".cache").is_err());
        assert!(create_file(root, "", "sous/notes.md").is_err());
        assert!(create_file(root, "..", "dehors.md").is_err());
        assert!(create_file(root, "notes.md", "x.md").is_err());
    }

    #[test]
    fn temoin_ecrit_puis_relu() {
        let dir = Temp::new("temoin");
        assert!(!is_project(&dir.0));

        write_marker(&dir.0, "Mon mémoire", "2026-09-15T10:00:00+00:00").unwrap();
        assert!(is_project(&dir.0));

        let m = read_marker(&dir.0).unwrap();
        assert_eq!(m.name, "Mon mémoire");
        assert_eq!(m.created, "2026-09-15T10:00:00+00:00");
        assert_eq!(m.version, 1);
    }

    #[test]
    fn temoin_sans_nom_reprend_celui_du_dossier() {
        let dir = Temp::new("sansnom");
        let m = write_marker(&dir.0, "   ", "2026-09-15T10:00:00+00:00").unwrap();
        assert_eq!(m.name, dir_name(&dir.0));
    }

    /// Reposer un témoin perdrait la date de création du projet : on refuse.
    #[test]
    fn temoin_ne_se_recrit_pas() {
        let dir = Temp::new("deuxfois");
        write_marker(&dir.0, "Premier", "2026-09-15T10:00:00+00:00").unwrap();
        assert!(write_marker(&dir.0, "Second", "2026-09-16T10:00:00+00:00").is_err());
        assert_eq!(read_marker(&dir.0).unwrap().name, "Premier");
    }

    /// Le témoin vit dans un dossier caché : l'arbre ne doit pas le montrer.
    #[test]
    fn temoin_absent_de_l_arborescence() {
        let dir = Temp::new("arbre");
        write_marker(&dir.0, "Projet", "2026-09-15T10:00:00+00:00").unwrap();
        std::fs::write(dir.0.join("texte.md"), "# Titre\n").unwrap();

        let nodes = tree(&dir.0, &[]).unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "texte.md");
    }

    /// Un témoin illisible ne lève pas : le dossier n'est simplement pas un
    /// projet, ce qu'une boîte de dialogue dit mieux qu'une erreur.
    #[test]
    fn temoin_illisible_vaut_pas_de_projet() {
        let dir = Temp::new("casse");
        std::fs::create_dir_all(dir.0.join(MARKER_DIR)).unwrap();
        std::fs::write(dir.0.join(MARKER_DIR).join(MARKER_FILE), "{ pas du json").unwrap();
        assert!(read_marker(&dir.0).is_none());
        assert!(!is_project(&dir.0));
    }

    /// On ne descend que dans les dossiers dépliés : le volet ne dessine pas le
    /// contenu d'un dossier fermé, et sur un dossier partagé lent, le lire
    /// quand même coûtait des minutes à chaque actualisation.
    #[test]
    fn l_arborescence_ne_descend_que_dans_ce_qui_est_deplie() {
        let dir = Temp::new("paresseux");
        std::fs::create_dir_all(dir.0.join("un/deux")).unwrap();
        std::fs::write(dir.0.join("un/a.md"), "").unwrap();
        std::fs::write(dir.0.join("un/deux/b.md"), "").unwrap();

        // Rien de déplié : le premier niveau, et rien dessous.
        let ferme = tree(&dir.0, &[]).unwrap();
        assert_eq!(ferme.len(), 1);
        assert_eq!(ferme[0].name, "un");
        assert!(ferme[0].children.is_empty());

        // « un » déplié : son contenu vient, mais pas celui de « un/deux ».
        let un = tree(&dir.0, &["un".to_owned()]).unwrap();
        let noms: Vec<_> = un[0].children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(noms, vec!["deux", "a.md"]);
        assert!(un[0].children[0].children.is_empty());

        // Les deux dépliés : on descend jusqu'au bout.
        let deux = tree(&dir.0, &["un".to_owned(), "un/deux".to_owned()]).unwrap();
        assert_eq!(deux[0].children[0].children[0].path, "un/deux/b.md");
    }

    #[test]
    fn renommer_deplace_le_fichier_et_rend_son_chemin() {
        let dir = Temp::new("renommer");
        std::fs::write(dir.0.join("note.md"), "# Titre\n").unwrap();

        let rel = rename(&dir.0, "note.md", "mémoire.md").unwrap();
        assert_eq!(rel, "mémoire.md");
        assert!(!dir.0.join("note.md").exists());
        assert_eq!(read(&dir.0, &rel).unwrap().content, "# Titre\n");
    }

    /// Renommer ne déplace pas : une barre sortirait le fichier de son dossier,
    /// et un point le ferait disparaître de l'arbre.
    #[test]
    fn renommer_refuse_un_chemin_ou_un_nom_cache() {
        let dir = Temp::new("renommer-refus");
        std::fs::write(dir.0.join("note.md"), "x").unwrap();

        assert!(rename(&dir.0, "note.md", "sous/note.md").is_err());
        assert!(rename(&dir.0, "note.md", ".note.md").is_err());
        assert!(rename(&dir.0, "note.md", "   ").is_err());
        assert!(dir.0.join("note.md").exists());
    }

    /// Un nom déjà pris est refusé : `rename` écraserait l'autre document sans
    /// un mot.
    #[test]
    fn renommer_ne_recouvre_pas_un_fichier() {
        let dir = Temp::new("renommer-collision");
        std::fs::write(dir.0.join("un.md"), "un").unwrap();
        std::fs::write(dir.0.join("deux.md"), "deux").unwrap();

        assert!(rename(&dir.0, "un.md", "deux.md").is_err());
        assert_eq!(std::fs::read_to_string(dir.0.join("deux.md")).unwrap(), "deux");
    }

    #[test]
    fn dupliquer_numerote_les_copies_avant_l_extension() {
        let dir = Temp::new("dupliquer");
        std::fs::write(dir.0.join("note.md"), "# Titre\n").unwrap();

        assert_eq!(duplicate(&dir.0, "note.md").unwrap(), "note (copie).md");
        assert_eq!(duplicate(&dir.0, "note.md").unwrap(), "note (copie 2).md");
        assert_eq!(
            std::fs::read_to_string(dir.0.join("note (copie).md")).unwrap(),
            "# Titre\n"
        );
    }

    #[test]
    fn effacer_retire_le_fichier() {
        let dir = Temp::new("effacer");
        std::fs::write(dir.0.join("note.md"), "x").unwrap();

        remove(&dir.0, "note.md").unwrap();
        assert!(!dir.0.join("note.md").exists());
    }

    /// Les trois gestes ne valent que pour un fichier : un dossier emporterait
    /// ce qu'il contient sans que la question ait été posée.
    #[test]
    fn les_operations_refusent_un_dossier() {
        let dir = Temp::new("dossier");
        std::fs::create_dir(dir.0.join("images")).unwrap();

        assert!(rename(&dir.0, "images", "photos").is_err());
        assert!(duplicate(&dir.0, "images").is_err());
        assert!(remove(&dir.0, "images").is_err());
        assert!(dir.0.join("images").is_dir());
    }

    /// `resolve` garde la porte : ce qui sortirait du projet ne s'efface pas
    /// davantage qu'il ne se lit.
    #[test]
    fn les_operations_restent_dans_le_projet() {
        let dir = Temp::new("hors");
        assert!(remove(&dir.0, "../ailleurs.md").is_err());
        assert!(rename(&dir.0, "../ailleurs.md", "ici.md").is_err());
    }

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

        // « z-dossier » est déplié : c'est la condition pour qu'on y descende.
        let t = tree(&dir, &["z-dossier".to_owned()]).unwrap();
        let noms: Vec<_> = t.iter().map(|n| n.name.as_str()).collect();
        // Dossier d'abord, puis les fichiers ; ni caché ni `node_modules`.
        assert_eq!(noms, vec!["z-dossier", "a.md", "b.png"]);
        assert_eq!(t[0].children[0].path, "z-dossier/c.md");
        assert!(t[1].editable, "un .md s'ouvre");
        assert!(!t[2].editable, "un .png ne s'ouvre pas");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod mesure {
    use super::*;
    #[test]
    #[ignore]
    fn cout_du_parcours() {
        let root = Path::new("/mnt/hgfs/DEV/sds-sfd-v2027");
        if !root.is_dir() {
            eprintln!("dossier absent, mesure ignorée");
            return;
        }
        let t = std::time::Instant::now();
        let n = tree(root, &[]).unwrap();
        eprintln!("fermé   : {} entrées en {:?}", n.len(), t.elapsed());
    }
}
