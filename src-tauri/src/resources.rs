//! Ressources d'une compilation HTML : ce qu'une page emporte avec elle.
//!
//! Une page compilée pointe vers des images, des schémas, des PDF — en chemins
//! relatifs, comme le document. Pour qu'ils se résolvent dans le répertoire de
//! destination, ces fichiers doivent y être aussi, au même chemin. Le projet
//! les liste dans `conf/resources.yaml` :
//!
//! ```yaml
//! resources:
//!   - "resources/pdf/*.*"   # les fichiers de ce dossier, sans ses sous-dossiers
//!   - "filesLOT04/img"      # le dossier entier, sous-dossiers compris
//! ```
//!
//! Seule la liste est copiée : rien n'est ajouté d'office, et un dossier de
//! configuration ne part pas dans la destination sans qu'on l'ait écrit.
//!
//! Ce n'est pas un analyseur YAML — une passe sur les lignes de la clé
//! `resources`, comme `frontmatter.js` en fait une sur le bloc d'un document.
//! Un fichier déjà à jour dans la destination n'est pas recopié : une
//! compilation ne doit pas renvoyer des centaines de PDF à chaque fois.
//!
//! Une ressource qui manque ou ne se copie pas n'arrête rien : elle est
//! signalée, et la compilation a lieu — la page existe, il lui manque une
//! image, ce que le message dit.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::Result;
use crate::files;
use crate::models::LogLevel;

/// Le fichier de la liste, relatif à la racine du projet.
pub const RESOURCES_FILE: &str = "conf/resources.yaml";

/// Ce que la copie a fait.
#[derive(Debug, Default, PartialEq)]
pub struct Copied {
    pub copied: usize,
    pub up_to_date: usize,
    /// Une ligne par ressource manquante ou refusée, par copie en échec.
    pub warnings: Vec<String>,
}

/// Les entrées de la clé `resources`, dans l'ordre du fichier.
///
/// Une entrée est une ligne en retrait qui commence par `- ` ; guillemets et
/// commentaire de fin de ligne sont retirés. La liste s'arrête à la première
/// ligne non vide revenue en marge — une autre clé.
pub fn entries(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut inside = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indented = line.starts_with([' ', '\t', '-']);
        if !indented {
            inside = trimmed.trim_end_matches(char::is_whitespace) == "resources:";
            continue;
        }
        if !inside {
            continue;
        }
        let Some(item) = trimmed.strip_prefix('-') else {
            continue;
        };
        let value = unquote(item.trim());
        if !value.is_empty() {
            out.push(value);
        }
    }
    out
}

/// `"a b"` ou `'a b'` donnent `a b` ; sans guillemets, un ` #` ouvre un
/// commentaire.
pub(crate) fn unquote(value: &str) -> String {
    for q in ['"', '\''] {
        if let Some(rest) = value.strip_prefix(q) {
            if let Some(end) = rest.find(q) {
                return rest[..end].to_string();
            }
        }
    }
    value
        .split(" #")
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// Un nom correspond-il au motif ? `*` vaut une suite quelconque, `?` un
/// caractère ; le reste se compare tel quel.
fn matches(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    // Programmation dynamique ordinaire : `ok[j]` dit si les `j` premiers
    // caractères du nom correspondent au motif lu jusqu'ici.
    let mut ok = vec![false; n.len() + 1];
    ok[0] = true;
    for &c in &p {
        let mut next = vec![false; n.len() + 1];
        if c == '*' {
            let mut seen = false;
            for j in 0..=n.len() {
                seen |= ok[j];
                next[j] = seen;
            }
        } else {
            for j in 1..=n.len() {
                next[j] = ok[j - 1] && (c == '?' || c == n[j - 1]);
            }
        }
        ok = next;
    }
    ok[n.len()]
}

/// Copie les ressources listées du projet vers `dest`.
///
/// Rend `None` quand le projet n'a pas de liste : il n'y a alors rien à dire.
/// `dest` relatif se lit depuis la racine du projet, comme Pandoc le lirait.
///
/// `log` reçoit une ligne par entrée de la liste — ce qu'elle a copié, ce qui
/// était déjà à jour — et une par avertissement, à mesure : une première copie
/// peut prendre un moment, et le journal montre qu'elle avance.
pub fn copy(
    root: &Path,
    dest: &Path,
    log: &mut dyn FnMut(LogLevel, String),
) -> Result<Option<Copied>> {
    let list = root.join(RESOURCES_FILE);
    if !list.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&list)?;
    let dest = root.join(dest);
    fs::create_dir_all(&dest)?;
    // La destination peut vivre dans le projet : un dossier listé qui la
    // contiendrait ne doit pas se recopier en lui-même sans fin.
    let dest_real = dest.canonicalize().ok();

    let mut out = Copied::default();
    for entry in entries(&text) {
        let (copied, fresh, warned) = (out.copied, out.up_to_date, out.warnings.len());
        copy_entry(root, &dest, dest_real.as_deref(), &entry, &mut out);

        for warning in &out.warnings[warned..] {
            log(LogLevel::Warn, warning.clone());
        }
        let (copied, fresh) = (out.copied - copied, out.up_to_date - fresh);
        if copied + fresh > 0 {
            log(LogLevel::Info, format!("{entry} : {copied} copié(s), {fresh} à jour"));
        } else if out.warnings.len() == warned {
            log(LogLevel::Info, format!("{entry} : aucun fichier"));
        }
    }
    Ok(Some(out))
}

fn copy_entry(root: &Path, dest: &Path, dest_real: Option<&Path>, entry: &str, out: &mut Copied) {
    let entry = entry.replace('\\', "/");
    let entry = entry.trim_end_matches('/');

    if entry.contains(['*', '?']) {
        let (dir, pattern) = entry.rsplit_once('/').unwrap_or(("", entry));
        if dir.contains(['*', '?']) {
            out.warnings.push(format!(
                "« {entry} » : un motif ne vaut que pour le nom de fichier, pas pour un dossier"
            ));
            return;
        }
        // `files::resolve` : un motif ne sort pas plus du projet qu'un chemin.
        let source = match files::resolve(root, dir) {
            Ok(path) if path.is_dir() => path,
            _ => {
                out.warnings.push(format!("« {entry} » : dossier introuvable"));
                return;
            }
        };
        let listing = match fs::read_dir(&source) {
            Ok(listing) => listing,
            Err(e) => {
                out.warnings.push(format!("« {entry} » : {e}"));
                return;
            }
        };
        for item in listing.flatten() {
            let name = item.file_name().to_string_lossy().into_owned();
            // Les fichiers seuls, sans suivre un lien : le motif ne descend
            // pas dans les sous-dossiers, et un lien pourrait mener hors du
            // projet.
            let plain = item.file_type().is_ok_and(|t| t.is_file());
            if plain && matches(pattern, &name) {
                copy_file(&item.path(), &dest.join(dir).join(&name), out);
            }
        }
        return;
    }

    match files::resolve(root, entry) {
        Ok(source) if source.is_dir() => copy_tree(&source, &dest.join(entry), dest_real, out),
        Ok(source) if source.is_file() => copy_file(&source, &dest.join(entry), out),
        _ => out.warnings.push(format!("« {entry} » : introuvable dans le projet")),
    }
}

/// Un dossier entier, sous-dossiers compris. Les liens symboliques ne sont pas
/// suivis : ils pourraient mener hors du projet, ou tourner en rond.
fn copy_tree(source: &Path, target: &Path, dest_real: Option<&Path>, out: &mut Copied) {
    if dest_real.is_some_and(|d| source.canonicalize().is_ok_and(|s| s == d)) {
        return;
    }
    let listing = match fs::read_dir(source) {
        Ok(listing) => listing,
        Err(e) => {
            out.warnings.push(format!("« {} » : {e}", source.display()));
            return;
        }
    };
    for item in listing.flatten() {
        let Ok(kind) = item.file_type() else { continue };
        let to = target.join(item.file_name());
        if kind.is_dir() {
            copy_tree(&item.path(), &to, dest_real, out);
        } else if kind.is_file() {
            copy_file(&item.path(), &to, out);
        }
    }
}

/// Copie un fichier, sauf s'il est déjà à jour : même taille, et la copie n'est
/// pas plus ancienne que l'original. `fs::copy` date la copie de l'instant où
/// elle est faite, si bien qu'un fichier copié une fois ne l'est plus tant que
/// l'original ne change pas.
fn copy_file(source: &Path, target: &PathBuf, out: &mut Copied) {
    if up_to_date(source, target) {
        out.up_to_date += 1;
        return;
    }
    let done = target
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::copy(source, target));
    match done {
        Ok(_) => out.copied += 1,
        Err(e) => out.warnings.push(format!("« {} » : {e}", target.display())),
    }
}

fn up_to_date(source: &Path, target: &Path) -> bool {
    let (Ok(from), Ok(to)) = (fs::metadata(source), fs::metadata(target)) else {
        return false;
    };
    if from.len() != to.len() {
        return false;
    }
    match (from.modified(), to.modified()) {
        (Ok(a), Ok(b)) => b >= a,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_la_liste_du_projet() {
        let text = "# Ressources\n\nresources:\n  - \"resources/img/*.*\"\n  - 'a b/c'\n  - filesLOT04/img  # images\n\n  # commentaire\n  - \"\"\nautre:\n  - pas/ceci\n";
        assert_eq!(entries(text), ["resources/img/*.*", "a b/c", "filesLOT04/img"]);
        assert!(entries("rien: 1\n").is_empty());
    }

    #[test]
    fn motifs() {
        assert!(matches("*.*", "photo.jpg"));
        assert!(!matches("*.*", "LISEZMOI"));
        assert!(matches("*.pdf", "a.b.pdf"));
        assert!(!matches("*.pdf", "a.pdf.txt"));
        assert!(matches("img-??.png", "img-01.png"));
        assert!(matches("*", ""));
    }

    #[test]
    fn copie_la_liste_et_rien_d_autre() {
        let base = std::env::temp_dir().join(format!("veille-ressources-{}", std::process::id()));
        let root = base.join("projet");
        let dest = base.join("htdocs");
        let write = |rel: &str| {
            let path = root.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, rel).unwrap();
        };
        write("resources/pdf/a.pdf");
        write("resources/pdf/LISEZMOI");
        write("resources/pdf/filesLOT04/b.pdf");
        write("filesLOT04/img/x.png");
        write("filesLOT04/img/sous/y.png");
        write("filesLOT04/doc.md");
        write("conf/filtre.lua");
        fs::write(
            root.join(RESOURCES_FILE),
            "resources:\n  - \"resources/pdf/*.*\"\n  - \"filesLOT04/img\"\n  - \"manque\"\n  - \"../dehors\"\n",
        )
        .unwrap();

        let mut journal = Vec::new();
        let first = copy(&root, &dest, &mut |level, line| journal.push((level, line))).unwrap().unwrap();
        assert_eq!(first.copied, 3);
        assert_eq!(first.up_to_date, 0);
        assert_eq!(first.warnings.len(), 2, "{:?}", first.warnings);
        // Une ligne par entrée copiée, une par avertissement.
        assert_eq!(journal.iter().filter(|(l, _)| *l == LogLevel::Warn).count(), 2);
        assert!(journal.iter().any(|(_, t)| t == "filesLOT04/img : 2 copié(s), 0 à jour"));

        // Le motif ne prend que les fichiers du dossier, pas ses sous-dossiers.
        assert!(dest.join("resources/pdf/a.pdf").is_file());
        assert!(!dest.join("resources/pdf/LISEZMOI").exists());
        assert!(!dest.join("resources/pdf/filesLOT04/b.pdf").exists());
        // Le dossier part entier.
        assert!(dest.join("filesLOT04/img/sous/y.png").is_file());
        // Ce qui n'est pas listé reste où il est.
        assert!(!dest.join("filesLOT04/doc.md").exists());
        assert!(!dest.join("conf").exists());

        // Rien n'a bougé : rien n'est recopié.
        let second = copy(&root, &dest, &mut |_, _| {}).unwrap().unwrap();
        assert_eq!((second.copied, second.up_to_date), (0, 3));

        // Sans liste, rien à dire.
        fs::remove_file(root.join(RESOURCES_FILE)).unwrap();
        assert_eq!(copy(&root, &dest, &mut |_, _| {}).unwrap(), None);

        fs::remove_dir_all(&base).ok();
    }
}
