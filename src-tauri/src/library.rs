//! Les documents du projet, tels que la bibliothèque les liste.
//!
//! Un projet ne se réduit pas aux fichiers `.md` de son dossier : il en porte
//! des milliers — brouillons, annexes, copies de travail —, et seuls ceux que
//! publie le site en sont les documents. C'est `conf/bibliotheque.yaml` qui
//! les nomme, la même liste que Pandoc reçoit par `--metadata-file` pour
//! dessiner la colonne de gauche et le portail d'accueil :
//!
//! ```yaml
//! library:
//!   - label: "LOT 01 — Version Nominale"
//!     items:
//!       - title: "UC01 - Réception de l'AER (IE501)"
//!         href: "filesLOT01/SFD-CID-SDS-VN-BS-bLOT01-UC01_ReceptionAER.html"
//! messages-href: "filesANN/SFD-CID-SDS-VN-BS-bANN-messages.html"
//! ```
//!
//! Chaque clé qui finit par `href` désigne une page du site, relative à la
//! racine du projet ; son document est le même chemin en `.md`. Ce que la
//! bibliothèque publie, c'est donc ce que « Compiler le projet » compile, dans
//! l'ordre du fichier — celui des lots.
//!
//! Ce n'est pas un analyseur YAML — une passe sur les lignes, comme
//! `resources.rs` en fait une sur `conf/resources.yaml`.

use std::path::Path;

use crate::error::{Error, Result};
use crate::files;
use crate::resources::unquote;

/// Le fichier de la bibliothèque, relatif à la racine du projet.
pub const LIBRARY_FILE: &str = "conf/bibliotheque.yaml";

/// Les documents de la bibliothèque, et ceux qu'elle nomme sans qu'ils existent.
#[derive(Debug, Default, PartialEq)]
pub struct Documents {
    /// Les documents Markdown, relatifs à la racine, dans l'ordre du fichier et
    /// sans doublon.
    pub found: Vec<String>,
    /// Les documents nommés par une page de la bibliothèque, mais absents du
    /// projet — ou hors de lui.
    pub missing: Vec<String>,
}

/// Les pages que nomme la bibliothèque, en document Markdown : `….html`
/// devient `….md`. Dans l'ordre du fichier, sans doublon.
///
/// Une ligne compte quand sa clé finit par `href` — `href`, `messages-href` —,
/// qu'elle ouvre ou non une entrée de liste. L'ancre et la requête d'une
/// adresse sont retirées ; une adresse externe, ou qui ne désigne pas une page
/// HTML, n'a pas de document.
pub fn pages(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        let entry = trimmed.strip_prefix('-').map_or(trimmed, str::trim_start);
        let Some((key, value)) = entry.split_once(':') else {
            continue;
        };
        if !key.trim().ends_with("href") {
            continue;
        }
        let href = unquote(value.trim());
        let path = href.split(['#', '?']).next().unwrap_or_default().trim();
        if path.contains("://") || path.starts_with('/') {
            continue;
        }
        let lower = path.to_ascii_lowercase();
        let stem = if lower.ends_with(".html") {
            &path[..path.len() - 5]
        } else if lower.ends_with(".htm") {
            &path[..path.len() - 4]
        } else {
            continue;
        };
        let doc = format!("{}.md", stem.trim_start_matches("./"));
        if !out.contains(&doc) {
            out.push(doc);
        }
    }
    out
}

/// Les documents de la bibliothèque du projet, vérifiés sur le disque.
///
/// Chaque chemin passe par `files::resolve` : la bibliothèque est un fichier du
/// projet, mais ce qu'elle nomme doit rester dans le projet.
pub fn documents(root: &Path) -> Result<Documents> {
    let file = root.join(LIBRARY_FILE);
    let text = std::fs::read_to_string(&file).map_err(|_| {
        Error::Other(format!(
            "{LIBRARY_FILE} introuvable : c'est elle qui liste les documents du projet"
        ))
    })?;

    let mut out = Documents::default();
    for doc in pages(&text) {
        match files::resolve(root, &doc) {
            Ok(real) if real.is_file() => out.found.push(doc),
            _ => out.missing.push(doc),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_pages_de_la_bibliotheque_en_documents() {
        let text = r#"
# Pour ajouter un document : href = "filesLOTxx/NOM.html"
version: "4.0.2"
library-basedir: "../"
library:
  - label: "LOT 01"
    photo: "resources/img/lot.jpg"
    items:
      - title: "UC01"
        href: "filesLOT01/UC01.html"
        photo: "resources/img/UC01.jpg"
      - href: 'filesLOT01/UC02.html#section'   # entrée qui ouvre sur href
        title: "UC02"
      # - title: "retiré"
      #   href: "filesLOT01/UC99.html"
      - title: "doublon"
        href: "filesLOT01/UC01.html"
      - title: "externe"
        href: "https://example.org/page.html"
      - title: "pdf"
        href: "resources/pdf/doc.pdf"
messages-href: "filesANN/messages.html"
"#;
        assert_eq!(
            pages(text),
            ["filesLOT01/UC01.md", "filesLOT01/UC02.md", "filesANN/messages.md"]
        );
    }

    #[test]
    fn documents_verifies_sur_le_disque() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("veille-biblio-{stamp}"));
        std::fs::create_dir_all(root.join("conf")).unwrap();
        std::fs::create_dir_all(root.join("lot")).unwrap();
        std::fs::write(root.join("lot/a.md"), "# a\n").unwrap();
        std::fs::write(
            root.join(LIBRARY_FILE),
            "library:\n  - items:\n      - href: \"lot/a.html\"\n      - href: \"lot/b.html\"\n      - href: \"../dehors.html\"\n",
        )
        .unwrap();

        let docs = documents(&root).unwrap();
        assert_eq!(docs.found, ["lot/a.md"]);
        assert_eq!(docs.missing, ["lot/b.md", "../dehors.md"]);

        std::fs::remove_file(root.join(LIBRARY_FILE)).unwrap();
        assert!(documents(&root).unwrap_err().to_string().contains(LIBRARY_FILE));
        std::fs::remove_dir_all(&root).ok();
    }
}
