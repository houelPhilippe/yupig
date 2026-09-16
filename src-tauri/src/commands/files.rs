//! Commandes de l'application « Édition » : projet, arborescence, documents.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{Manager, State};

use crate::db::Db;
use crate::error::{Error, Result};
use crate::files;
use crate::models::{Document, Heading, ImageData, Node, Project, ProjectSettings};

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

/// Les projets connus, du plus récemment ouvert au plus ancien.
///
/// La base ne retient que des chemins : le nom se lit dans le témoin du
/// dossier, ce qui fait qu'un projet renommé ou déplacé se présente sous son
/// vrai nom sans que la base ait à être tenue à jour.
#[tauri::command]
pub async fn list_projects(db: State<'_, Arc<Db>>) -> Result<Vec<Project>> {
    Ok(db
        .projects()?
        .into_iter()
        .map(|(root, opened)| {
            let dir = PathBuf::from(&root);
            let marker = files::read_marker(&dir);
            Project {
                name: marker
                    .as_ref()
                    .map(|m| m.name.clone())
                    .unwrap_or_else(|| files::dir_name(&dir)),
                created: marker.map(|m| m.created),
                // Un dossier effacé, débranché ou vidé de son témoin reste dans
                // la liste, en retrait : on doit pouvoir le retirer, et le voir
                // manquant vaut mieux que le voir disparaître sans un mot.
                available: dir.is_dir() && files::is_project(&dir),
                root,
                opened,
            }
        })
        .collect())
}

/// Crée un projet sur un dossier existant et l'ouvre.
///
/// Le dossier n'est pas créé : l'application pose un projet sur ce qui est
/// déjà là. `files::write_marker` refuse un dossier qui est déjà un projet —
/// la boîte propose alors de l'ouvrir plutôt que de l'écraser.
#[tauri::command]
pub async fn create_project(
    app: tauri::AppHandle,
    db: State<'_, Arc<Db>>,
    path: String,
    name: String,
) -> Result<Vec<Node>> {
    let canonical = canonical_dir(&path)?;
    files::write_marker(&canonical, &name, &crate::db::now())?;
    enter(&app, &db, canonical)
}

/// Ouvre un projet déjà constitué et rend son arborescence.
///
/// Un dossier sans témoin est refusé : c'est un dossier, pas un projet. Le
/// dire franchement vaut mieux que d'y poser un témoin sans rien demander —
/// l'utilisateur a peut-être simplement désigné le mauvais dossier.
#[tauri::command]
pub async fn open_project(
    app: tauri::AppHandle,
    db: State<'_, Arc<Db>>,
    path: String,
) -> Result<Vec<Node>> {
    let canonical = canonical_dir(&path)?;
    if !files::is_project(&canonical) {
        return Err(Error::Other(format!(
            "« {} » n'est pas un projet : créez-en un sur ce dossier.",
            files::dir_name(&canonical)
        )));
    }
    enter(&app, &db, canonical)
}

/// Retire un projet de la liste et rend la liste mise à jour.
///
/// Rien n'est effacé sur le disque : le dossier garde son témoin, et le projet
/// revient en désignant à nouveau son dossier.
#[tauri::command]
pub async fn forget_project(db: State<'_, Arc<Db>>, path: String) -> Result<Vec<Project>> {
    db.forget_project(&path)?;
    // Le projet retiré ne peut pas rester celui qui est ouvert.
    let mut settings = db.settings()?;
    if settings.project_root.as_deref() == Some(path.as_str()) {
        settings.project_root = None;
        db.save_settings(&settings)?;
    }
    list_projects(db).await
}

/// Referme le projet ouvert, sans rien retirer de la liste.
#[tauri::command]
pub async fn close_project(db: State<'_, Arc<Db>>) -> Result<()> {
    let mut settings = db.settings()?;
    settings.project_root = None;
    db.save_settings(&settings)?;
    Ok(())
}

/// Le chemin d'un dossier existant, canonicalisé.
///
/// La canonicalisation est ce qui fait qu'un même dossier atteint par deux
/// chemins différents — un lien symbolique, un `..` — ne devient pas deux
/// projets dans la liste.
fn canonical_dir(path: &str) -> Result<PathBuf> {
    let dir = PathBuf::from(path);
    if !dir.is_dir() {
        return Err(Error::Other(format!("« {path} » n'est pas un dossier")));
    }
    dir.canonicalize()
        .map_err(|e| Error::Other(format!("dossier illisible : {e}")))
}

/// Fait d'un dossier le projet ouvert : liste, réglages, portée des images.
fn enter(app: &tauri::AppHandle, db: &Db, root: PathBuf) -> Result<Vec<Node>> {
    let root_str = root.to_string_lossy().into_owned();

    db.remember_project(&root_str)?;
    let mut settings = db.settings()?;
    settings.project_root = Some(root_str);
    db.save_settings(&settings)?;

    allow_assets(app, &root);
    // Rien n'est encore déplié : le premier niveau suffit, et c'est ce qui rend
    // l'ouverture immédiate même sur un dossier partagé lent.
    files::tree(&root, &[])
}

/// Donne son témoin au dossier ouvert par une version antérieure.
///
/// Avant les projets, l'application retenait un dossier et rien d'autre. La
/// migration de schéma l'a inscrit dans la liste ; il lui manque le fichier qui
/// le nomme. On le lui pose au démarrage, une fois — sans quoi le travail en
/// cours se présenterait comme « indisponible » au premier lancement suivant.
pub fn adopt_legacy_root(db: &Db) {
    let Ok(settings) = db.settings() else { return };
    let Some(root) = settings.project_root else {
        return;
    };
    let dir = Path::new(&root);
    if !dir.is_dir() || files::is_project(dir) {
        return;
    }
    // Un échec — dossier en lecture seule, disque plein — ne doit pas empêcher
    // le démarrage : le projet se présentera comme à reconstituer.
    let _ = files::write_marker(dir, &files::dir_name(dir), &crate::db::now());
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
///
/// `open` porte les dossiers dépliés du volet : on ne descend que dans ceux-là.
/// Le frontend est le seul à savoir ce qui est ouvert, c'est donc lui qui le
/// dit ; la base n'a pas à retenir un état d'affichage.
#[tauri::command]
pub async fn project_tree(db: State<'_, Arc<Db>>, open: Vec<String>) -> Result<Vec<Node>> {
    files::tree(&root(&db)?, &open)
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

/// Renomme un fichier du projet et rend son nouveau chemin relatif.
///
/// C'est l'appelant qui recale ce qui désignait l'ancien chemin — l'onglet
/// ouvert, l'arborescence : Rust ne connaît que le disque.
#[tauri::command]
pub async fn rename_file(db: State<'_, Arc<Db>>, path: String, name: String) -> Result<String> {
    files::rename(&root(&db)?, &path, &name)
}

/// Copie un fichier à côté de lui-même et rend le chemin de la copie.
#[tauri::command]
pub async fn duplicate_file(db: State<'_, Arc<Db>>, path: String) -> Result<String> {
    files::duplicate(&root(&db)?, &path)
}

/// Efface un fichier du projet. L'interface a posé la question avant.
#[tauri::command]
pub async fn delete_file(db: State<'_, Arc<Db>>, path: String) -> Result<()> {
    files::remove(&root(&db)?, &path)
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
