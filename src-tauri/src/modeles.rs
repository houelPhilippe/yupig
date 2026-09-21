//! Modèles de configuration : ce que `conf/` reçoit de `confModele/`.
//!
//! Un projet compile par Pandoc d'après les fichiers de `conf/` — filtre,
//! gabarits, préambules, bibliothèque, configurations. Un **modèle** est un jeu
//! complet de ces fichiers, rangé dans `confModele/<nom>/` :
//!
//! ```text
//! projet/
//!   conf/                    ce dont la compilation se sert
//!   confModele/
//!     liseuse/               le modèle par défaut
//!     DSFR-Douanes/          un autre, pour une autre charte
//! ```
//!
//! Les modèles vivent **dans le projet** et non dans l'application : ce sont
//! des fichiers du projet, comme ceux de `conf/`, et un projet copié sur une
//! autre machine emporte donc les siens — la même raison qui fait vivre le nom
//! d'un projet dans son témoin plutôt qu'en base.
//!
//! Appliquer un modèle **recouvre** `conf/` : les fichiers du modèle y sont
//! copiés, au même chemin, par-dessus ceux de même nom. Rien n'est effacé — ce
//! que `conf/` porte en plus reste où il est. Un modèle se réapplique donc sans
//! perdre les fichiers qu'on y a ajoutés, et sans que l'application ait à
//! décider ce qui est à elle et ce qui est à nous.
//!
//! À la différence des ressources d'une compilation, un fichier déjà à jour est
//! **recopié quand même** : appliquer un modèle, c'est demander que `conf/`
//! redevienne ce que le modèle dit, y compris sur un fichier qu'on a modifié
//! depuis.

use std::fs;
use std::path::Path;

use crate::error::{Error, Result};
use crate::files;

/// Le dossier des modèles, à la racine du projet.
pub const MODELES_DIR: &str = "confModele";
/// Le dossier que la compilation lit, et que le modèle garnit.
pub const CONF_DIR: &str = "conf";
/// Le modèle d'un projet neuf, quand le dossier adopté le porte.
pub const DEFAULT_MODELE: &str = "liseuse";

/// Ce que l'application d'un modèle a fait.
#[derive(Debug, Default, PartialEq)]
pub struct Applied {
    pub copied: usize,
    /// Une ligne par fichier qui n'a pas pu être copié. Un fichier de moins
    /// n'arrête pas les autres : le modèle est posé, et le message dit ce qui
    /// lui manque.
    pub warnings: Vec<String>,
}

/// Un nom de modèle acceptable : un nom de dossier, non un chemin.
///
/// Le nom vient du frontend, qui l'a lu dans la liste — mais rien n'oblige
/// l'appelant à s'en tenir là. `files::resolve` refuserait déjà un `..` ; on
/// refuse ici plus tôt et plus net, pour que le message parle du modèle et non
/// du chemin.
pub fn name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name != "."
        && name != ".."
        && !name.starts_with('.')
        && !name.contains(['/', '\\'])
        && !name.chars().any(char::is_control)
}

/// Les modèles du projet : les dossiers de `confModele/`, par ordre
/// alphabétique — celui du volet des fichiers.
///
/// Un projet sans `confModele/` n'en porte aucun : ce n'est pas une anomalie,
/// c'est un projet qui règle sa compilation à la main. La liste est alors vide
/// et la boîte le dit.
pub fn list(root: &Path) -> Vec<String> {
    let Ok(listing) = fs::read_dir(root.join(MODELES_DIR)) else {
        return Vec::new();
    };
    let mut names: Vec<String> = listing
        .flatten()
        .filter(|item| item.file_type().is_ok_and(|t| t.is_dir()))
        .map(|item| item.file_name().to_string_lossy().into_owned())
        .filter(|name| name_ok(name))
        .collect();
    names.sort_by_key(|name| name.to_lowercase());
    names
}

/// Copie les fichiers du modèle `name` dans `conf/`.
///
/// Le dossier `conf/` est créé s'il manque — c'est la destination du modèle,
/// non un dossier du travail de l'utilisateur.
pub fn apply(root: &Path, name: &str) -> Result<Applied> {
    if !name_ok(name) {
        return Err(Error::Other(format!(
            "« {name} » n'est pas un nom de modèle"
        )));
    }
    let source = files::resolve(root, &format!("{MODELES_DIR}/{name}"))
        .map_err(|_| Error::Other(format!("modèle introuvable : {MODELES_DIR}/{name}")))?;
    if !source.is_dir() {
        return Err(Error::Other(format!(
            "« {name} » n'est pas un modèle : {MODELES_DIR}/{name} n'est pas un dossier"
        )));
    }

    let dest = root.join(CONF_DIR);
    fs::create_dir_all(&dest)?;

    let mut out = Applied::default();
    copy_tree(&source, &dest, &mut out);
    Ok(out)
}

/// Pose dans le projet les modèles **livrés avec l'application**.
///
/// `source` est le `confModele/` du paquet ; il est copié dans celui du projet,
/// un dossier par modèle. Un projet neuf a ainsi de quoi compiler et de quoi
/// changer d'habillage sans rien aller chercher — c'est ce qui fait que le
/// premier projet d'une machine n'est pas moins pourvu que les suivants.
///
/// Un modèle dont le dossier **existe déjà** dans le projet n'est pas touché :
/// le dossier adopté peut venir d'ailleurs et porter ses propres modèles, et
/// une création ne doit pas écraser ce qu'on y a mis. Ce qui manque est posé,
/// le reste est laissé en place.
///
/// Rend ce qui a été copié. Une source absente — l'application lancée sans ses
/// ressources — n'est pas une anomalie : rien n'est copié, et la création du
/// projet aboutit de toute façon.
pub fn install(source: &Path, root: &Path) -> Applied {
    let mut out = Applied::default();
    let Ok(listing) = fs::read_dir(source) else {
        return out;
    };
    let dest = root.join(MODELES_DIR);

    for item in listing.flatten() {
        if !item.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if !name_ok(&name) {
            continue;
        }
        let to = dest.join(&name);
        if to.exists() {
            continue;
        }
        if let Err(e) = fs::create_dir_all(&to) {
            out.warnings.push(format!("« {} » : {e}", to.display()));
            continue;
        }
        copy_tree(&item.path(), &to, &mut out);
    }
    out
}

/// Garnit `conf/` du modèle par défaut, à la création d'un projet.
///
/// Rend le nom du modèle retenu, ou `None` quand le dossier adopté ne porte
/// pas `confModele/liseuse` — un projet posé sur un dossier venu d'ailleurs n'a
/// aucune raison de l'avoir, et sa création aboutit de toute façon.
pub fn adopt_default(root: &Path) -> Option<String> {
    if !root.join(MODELES_DIR).join(DEFAULT_MODELE).is_dir() {
        return None;
    }
    // Un `conf/` qui porte déjà quelque chose est laissé intact : le dossier
    // adopté peut être un projet réglé de longue date, et poser le modèle par
    // défaut dessus remplacerait son filtre et ses gabarits sans rien demander.
    // Le modèle s'applique alors à la main, depuis la boîte, qui prévient.
    if has_files(&root.join(CONF_DIR)) {
        return None;
    }
    apply(root, DEFAULT_MODELE)
        .ok()
        .map(|_| DEFAULT_MODELE.to_string())
}

/// Le dossier porte-t-il quoi que ce soit ? Absent ou vide, il n'y a rien à
/// perdre à le garnir.
fn has_files(dir: &Path) -> bool {
    fs::read_dir(dir).is_ok_and(|mut d| d.next().is_some())
}

/// Un dossier entier, sous-dossiers compris.
///
/// Les liens symboliques ne sont pas suivis, comme pour les ressources : ils
/// pourraient mener hors du projet, ou tourner en rond.
fn copy_tree(source: &Path, target: &Path, out: &mut Applied) {
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
            if let Err(e) = fs::create_dir_all(&to) {
                out.warnings.push(format!("« {} » : {e}", to.display()));
                continue;
            }
            copy_tree(&item.path(), &to, out);
        } else if kind.is_file() {
            match fs::copy(item.path(), &to) {
                Ok(_) => out.copied += 1,
                Err(e) => out.warnings.push(format!("« {} » : {e}", to.display())),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, text: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    /// Les modèles livrés avec l'application garnissent un projet neuf, sans
    /// toucher à ceux que le dossier portait déjà.
    #[test]
    fn installe_les_modeles_livres() {
        let base = std::env::temp_dir().join(format!("veille-livres-{}", std::process::id()));
        fs::remove_dir_all(&base).ok();
        let (livre, root) = (base.join("paquet/confModele"), base.join("projet"));

        write(&livre, "liseuse/filtre.lua", "livré");
        write(&livre, "liseuse/modele/page.html", "page");
        write(&livre, "DSFR-Douanes/filtre.lua", "livré DSFR");
        // Le projet porte déjà un modèle de ce nom : il est à lui.
        write(&root, "confModele/liseuse/filtre.lua", "le mien");

        let done = install(&livre, &root);
        assert_eq!((done.copied, done.warnings.len()), (1, 0));
        assert_eq!(
            fs::read_to_string(root.join("confModele/liseuse/filtre.lua")).unwrap(),
            "le mien"
        );
        assert_eq!(
            fs::read_to_string(root.join("confModele/DSFR-Douanes/filtre.lua")).unwrap(),
            "livré DSFR"
        );

        // Un projet vierge les reçoit tous, sous-dossiers compris.
        let neuf = base.join("neuf");
        fs::create_dir_all(&neuf).unwrap();
        assert_eq!(install(&livre, &neuf).copied, 3);
        assert!(neuf.join("confModele/liseuse/modele/page.html").is_file());
        assert_eq!(list(&neuf), ["DSFR-Douanes", "liseuse"]);

        // Sans ressources, rien n'est copié et rien ne casse.
        assert_eq!(install(&base.join("nulle-part"), &neuf), Applied::default());

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn noms_de_modele() {
        assert!(name_ok("liseuse"));
        assert!(name_ok("DSFR-Douanes"));
        assert!(!name_ok(""));
        assert!(!name_ok(".."));
        assert!(!name_ok(".cache"));
        assert!(!name_ok("a/b"));
        assert!(!name_ok("a\\b"));
    }

    #[test]
    fn liste_applique_et_recouvre() {
        let base = std::env::temp_dir().join(format!("veille-modeles-{}", std::process::id()));
        fs::remove_dir_all(&base).ok();
        let root = base.join("projet");

        write(&root, "confModele/liseuse/filtre.lua", "modèle liseuse");
        write(&root, "confModele/liseuse/modele/liseuse.html", "page");
        write(&root, "confModele/DSFR-Douanes/filtre.lua", "modèle DSFR");
        write(&root, "confModele/.cache/x", "");
        write(&root, "conf/filtre.lua", "à moi");
        write(&root, "conf/bibliotheque.yaml", "à garder");

        // Les dossiers de `confModele`, les cachés écartés, par ordre
        // alphabétique sans égard à la casse.
        assert_eq!(list(&root), ["DSFR-Douanes", "liseuse"]);

        let done = apply(&root, "liseuse").unwrap();
        assert_eq!((done.copied, done.warnings.len()), (2, 0));
        // Ce que le modèle porte recouvre ce qui était là…
        assert_eq!(
            fs::read_to_string(root.join("conf/filtre.lua")).unwrap(),
            "modèle liseuse"
        );
        assert!(root.join("conf/modele/liseuse.html").is_file());
        // …et ce que `conf/` portait en plus y reste.
        assert_eq!(
            fs::read_to_string(root.join("conf/bibliotheque.yaml")).unwrap(),
            "à garder"
        );

        // Un modèle déjà appliqué se réapplique : un fichier modifié depuis
        // redevient celui du modèle.
        write(&root, "conf/filtre.lua", "modifié à la main");
        assert_eq!(apply(&root, "liseuse").unwrap().copied, 2);
        assert_eq!(
            fs::read_to_string(root.join("conf/filtre.lua")).unwrap(),
            "modèle liseuse"
        );

        // Rien ne sort du projet, et un modèle inconnu se dit tel quel.
        assert!(apply(&root, "../ailleurs").is_err());
        assert!(apply(&root, "inconnu").is_err());

        // Le modèle par défaut à la création : celui du dossier, s'il est là.
        fs::remove_dir_all(root.join("conf")).unwrap();
        assert_eq!(adopt_default(&root).as_deref(), Some("liseuse"));
        assert!(root.join("conf/filtre.lua").is_file());

        let nu = base.join("nu");
        fs::create_dir_all(&nu).unwrap();
        assert_eq!(adopt_default(&nu), None);
        assert!(list(&nu).is_empty());

        // Un `conf/` déjà garni n'est pas recouvert à la création : le dossier
        // adopté peut être un projet réglé de longue date.
        write(&nu, "confModele/liseuse/filtre.lua", "modèle");
        write(&nu, "conf/filtre.lua", "le mien");
        assert_eq!(adopt_default(&nu), None);
        assert_eq!(
            fs::read_to_string(nu.join("conf/filtre.lua")).unwrap(),
            "le mien"
        );

        fs::remove_dir_all(&base).ok();
    }
}
