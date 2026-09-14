//! Commandes de l'application « Édition » : projet, arborescence, documents.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{Manager, State};

use crate::db::Db;
use crate::error::{Error, Result};
use crate::files;
use crate::models::{Document, Heading, ImageData, Node, ProjectSettings};

/// Racine du projet enregistrée dans les réglages.
///
/// L'absence de racine n'est pas une anomalie — c'est l'état au premier
/// lancement — mais toute commande qui touche au disque a besoin d'une réponse
/// nette, d'où l'erreur plutôt qu'un `Option` propagé partout.
fn root(db: &Db) -> Result<PathBuf> {
    db.settings()?
        .project_root
        .map(PathBuf::from)
        .ok_or_else(|| Error::Other("aucun projet ouvert".into()))
}

/// Ouvre un dossier comme projet et rend son arborescence.
///
/// Le chemin vient du sélecteur système, pas d'une saisie : on vérifie tout de
/// même qu'il désigne un dossier existant avant de l'enregistrer.
#[tauri::command]
pub async fn open_project(
    app: tauri::AppHandle,
    db: State<'_, Arc<Db>>,
    path: String,
) -> Result<Vec<Node>> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(Error::Other(format!("« {path} » n'est pas un dossier")));
    }
    let canonical = dir
        .canonicalize()
        .map_err(|e| Error::Other(format!("dossier illisible : {e}")))?;

    let mut settings = db.settings()?;
    settings.project_root = Some(canonical.to_string_lossy().into_owned());
    db.save_settings(&settings)?;

    allow_assets(&app, &canonical);
    files::tree(&canonical)
}

/// Autorise la webview à lire les images du projet, et rien d'autre.
///
/// Un `src` relatif se résout contre l'origine de la webview, pas contre le
/// dossier du projet : sans le protocole `asset`, une image insérée dans un
/// document ne s'afficherait jamais à l'aperçu. La portée est ouverte au
/// dossier choisi seul, au moment où il est choisi.
pub fn allow_assets(app: &tauri::AppHandle, root: &Path) {
    // Un échec ici ne doit pas empêcher d'ouvrir le projet : on perdrait
    // l'affichage des images, pas l'édition des textes.
    let _ = app.asset_protocol_scope().allow_directory(root, true);
}

/// Les octets d'une image du projet, pour le presse-papiers.
#[tauri::command]
pub async fn read_image(db: State<'_, Arc<Db>>, path: String) -> Result<ImageData> {
    files::read_image(&root(&db)?, &path)
}

/// Le lien à écrire dans le document pour désigner `file` — une image, un
/// fichier à inclure : tout ce qu'un document désigne relativement à lui.
#[tauri::command]
pub async fn file_link(db: State<'_, Arc<Db>>, doc: String, file: String) -> Result<String> {
    files::link_from(&root(&db)?, &doc, Path::new(&file))
}

/// Relit l'arborescence — après une modification faite hors de l'application.
#[tauri::command]
pub async fn project_tree(db: State<'_, Arc<Db>>) -> Result<Vec<Node>> {
    files::tree(&root(&db)?)
}

#[tauri::command]
pub async fn read_document(db: State<'_, Arc<Db>>, path: String) -> Result<Document> {
    files::read(&root(&db)?, &path)
}

#[tauri::command]
pub async fn write_document(
    db: State<'_, Arc<Db>>,
    path: String,
    content: String,
) -> Result<Document> {
    files::write(&root(&db)?, &path, &content)
}

/// Réglages de mise en page du projet ouvert.
///
/// Sans projet, on rend les valeurs par défaut plutôt qu'une erreur : le
/// démarrage interroge ces réglages avant qu'un dossier ne soit choisi.
#[tauri::command]
pub async fn get_project_settings(db: State<'_, Arc<Db>>) -> Result<ProjectSettings> {
    match db.settings()?.project_root {
        Some(root) => db.project_settings(&root),
        None => Ok(ProjectSettings::default()),
    }
}

#[tauri::command]
pub async fn save_project_settings(
    db: State<'_, Arc<Db>>,
    settings: ProjectSettings,
) -> Result<ProjectSettings> {
    let root = root(&db)?;
    let root = root.to_string_lossy();
    db.save_project_settings(&root, &settings)?;
    db.project_settings(&root)
}

/// Sommaire d'un texte en cours de frappe, sans toucher au disque.
#[tauri::command]
pub async fn document_outline(content: String) -> Result<Vec<Heading>> {
    Ok(files::outline(&content))
}
