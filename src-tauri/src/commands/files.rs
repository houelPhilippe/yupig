//! Commandes de l'application « Édition » : projet, arborescence, documents.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{Emitter, Manager, State};

use crate::db::Db;
use crate::error::{Error, Result};
use crate::files;
use crate::models::{
    Compiled, Document, Heading, ImageData, LogLevel, LogLine, Node, PandocSettings, Project,
    ProjectDocuments, ProjectSettings, ResourcesReport,
};
use crate::pandoc::{self, Format};
use crate::{library, resources};

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

/// Crée un document Markdown vide dans un dossier du projet — `path` vide
/// désigne la racine — et rend son chemin.
#[tauri::command]
pub async fn create_file(db: State<'_, Arc<Db>>, path: String, name: String) -> Result<String> {
    files::create_file(&root(&db)?, &path, &name)
}

/// Crée un dossier dans un dossier du projet, et rend son chemin.
#[tauri::command]
pub async fn create_dir(db: State<'_, Arc<Db>>, path: String, name: String) -> Result<String> {
    files::create_dir(&root(&db)?, &path, &name)
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

/// La commande de compilation qui partirait pour `path`, dans le format
/// `format`, d'après les champs tels qu'ils sont à l'écran — enregistrés ou non.
/// Le choix du modèle — celui de l'accueil pour `index.md` — est celui même de
/// la compilation (`pandoc::template_for`).
///
/// L'aperçu des paramètres passe par ici plutôt que de refaire le calcul en
/// JavaScript : c'est la lecture même de la compilation, il ne peut donc pas
/// montrer autre chose que ce qui partira. Rien n'est lancé ni écrit.
#[tauri::command]
pub async fn pandoc_preview(
    format: Format,
    path: String,
    settings: PandocSettings,
) -> Result<String> {
    let (template, dest) = pandoc::template_for(&settings, format, &path);
    Ok(pandoc::display(&pandoc::plan_for(format, template, &path, dest)?))
}

/// Compile un document du projet en HTML ou en PDF, d'après les réglages du
/// projet.
///
/// Avant une compilation HTML, les ressources que liste `conf/resources.yaml`
/// sont copiées vers le répertoire de destination, pour que les liens relatifs
/// de la page s'y résolvent. Sans destination réglée, il n'y a nulle part où
/// les copier : on le dit, et la compilation a lieu quand même. Un PDF, lui,
/// n'en a pas besoin : Pandoc y embarque les images, qu'il lit dans le projet.
///
/// Le modèle est lu **en base**, non reçu du frontend : l'interface ne désigne
/// que le document et le format, et ne peut donc pas faire lancer autre chose
/// que la commande réglée. Le document doit exister dans le projet et être du
/// Markdown ; Pandoc tourne à part, pour ne pas tenir le fil des commandes le
/// temps de la compilation.
///
/// `resources` à `false` saute la copie des ressources : une compilation en
/// série ne les copie qu'au premier document, les suivants pointant vers la
/// même destination.
#[tauri::command]
pub async fn compile_document(
    app: tauri::AppHandle,
    db: State<'_, Arc<Db>>,
    path: String,
    format: Format,
    resources: Option<bool>,
) -> Result<Compiled> {
    let result = compile(app.clone(), &db, &path, format, resources.unwrap_or(true)).await;
    // L'échec aussi va au journal, d'où qu'il vienne — un modèle refusé avant
    // même que Pandoc ne parte, comme Pandoc lui-même : c'est là qu'on le lit.
    if let Err(e) = &result {
        journal(&app, LogLevel::Error, e.to_string());
    }
    result
}

/// Une ligne du journal de compilation, vers le frontend.
fn journal(app: &tauri::AppHandle, level: LogLevel, text: String) {
    let _ = app.emit("compile:log", LogLine { level, text });
}

async fn compile(
    app: tauri::AppHandle,
    db: &Db,
    path: &str,
    format: Format,
    with_resources: bool,
) -> Result<Compiled> {
    let root = root(db)?;
    let real = files::resolve(&root, path)?;
    let markdown = real
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ["md", "markdown", "mdown"].contains(&e.to_ascii_lowercase().as_str()));
    if !real.is_file() || !markdown {
        return Err(Error::Other(format!("« {path} » n'est pas un document Markdown")));
    }

    let settings = db.project_settings(&root.to_string_lossy())?.pandoc;
    let (template, dest) = pandoc::template_for(&settings, format, path);
    let plan = pandoc::plan_for(format, template, path, dest)?;
    let command = pandoc::display(&plan);
    let dest = dest.trim().to_string();
    let with_resources = with_resources && format == Format::Html;
    // Un modèle vide se remplace en silence par la commande par défaut, qui
    // ignore tout du projet — ni `--defaults`, ni filtre, ni chemin des
    // images. Le journal le dit, sans quoi les erreurs de Pandoc qui en
    // découlent ne se comprendraient pas.
    let default_used = template.trim().is_empty();

    let (copied, outcome) = tauri::async_runtime::spawn_blocking(move || {
        let mut log = |level: LogLevel, text: String| journal(&app, level, text);

        let copied = if !with_resources || !root.join(resources::RESOURCES_FILE).is_file() {
            None
        } else if dest.is_empty() {
            let warning = format!(
                "{} : aucun répertoire de destination réglé, ressources non copiées",
                resources::RESOURCES_FILE
            );
            log(LogLevel::Warn, warning.clone());
            Some(resources::Copied {
                warnings: vec![warning],
                ..Default::default()
            })
        } else {
            log(
                LogLevel::Step,
                format!("Copie des ressources ({}) vers {dest}", resources::RESOURCES_FILE),
            );
            resources::copy(&root, Path::new(&dest), &mut log)?
        };

        log(
            LogLevel::Step,
            format!("Compilation {} par Pandoc", format.label()),
        );
        if default_used {
            log(
                LogLevel::Warn,
                format!(
                    "aucun modèle de commande {} réglé dans les paramètres du projet : \
                     commande par défaut de Pandoc",
                    format.label()
                ),
            );
        }
        log(LogLevel::Command, pandoc::display(&plan));
        pandoc::run(&root, &plan, &mut log).map(|outcome| (copied, outcome))
    })
    .await
    .map_err(|e| Error::Other(format!("compilation interrompue : {e}")))??;

    Ok(Compiled {
        command,
        output: outcome.output.map(|o| o.to_string_lossy().into_owned()),
        log: outcome.log,
        resources: copied.map(|c| ResourcesReport {
            copied: c.copied,
            up_to_date: c.up_to_date,
            warnings: c.warnings,
        }),
    })
}

/// Les documents Markdown d'un dossier du projet, sans ses sous-dossiers.
#[tauri::command]
pub async fn markdown_in_dir(db: State<'_, Arc<Db>>, path: String) -> Result<Vec<String>> {
    files::markdown_in(&root(&db)?, &path)
}

/// Compile le **book** : un seul PDF pour tout le projet.
///
/// C'est le script du projet qui assemble les documents — `conf/generate_book.py`
/// sur `conf/book_structure.yaml` — puis appelle Pandoc. L'interface ne donne
/// rien à lancer : les trois chemins sont fixes, et seuls le répertoire de
/// destination et le nom du PDF viennent des réglages du projet.
///
/// Le script et la structure passent par `files::resolve` : ils doivent être
/// dans le projet, liens symboliques écartés.
#[tauri::command]
pub async fn compile_book(app: tauri::AppHandle, db: State<'_, Arc<Db>>) -> Result<Compiled> {
    let result = book(app.clone(), &db).await;
    if let Err(e) = &result {
        journal(&app, LogLevel::Error, e.to_string());
    }
    result
}

async fn book(app: tauri::AppHandle, db: &Db) -> Result<Compiled> {
    let root = root(db)?;
    for needed in [pandoc::BOOK_SCRIPT, pandoc::BOOK_STRUCTURE, pandoc::BOOK_DEFAULTS] {
        if !files::resolve(&root, needed)?.is_file() {
            return Err(Error::Other(format!("{needed} introuvable dans le projet")));
        }
    }

    let settings = db.project_settings(&root.to_string_lossy())?.pandoc;
    let plan = pandoc::plan_book(&settings.book_dest, &settings.book_file)?;
    let command = pandoc::display(&plan);

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let mut log = |level: LogLevel, text: String| journal(&app, level, text);
        log(LogLevel::Step, "Assemblage du book puis compilation par Pandoc".into());
        log(LogLevel::Command, pandoc::display(&plan));
        pandoc::run(&root, &plan, &mut log)
    })
    .await
    .map_err(|e| Error::Other(format!("compilation interrompue : {e}")))??;

    Ok(Compiled {
        command,
        output: outcome.output.map(|o| o.to_string_lossy().into_owned()),
        log: outcome.log,
        resources: None,
    })
}

/// Les documents du projet : ceux dont `conf/bibliotheque.yaml` nomme la page,
/// dans l'ordre du fichier, et ceux qu'elle nomme sans qu'ils existent.
#[tauri::command]
pub async fn markdown_in_project(db: State<'_, Arc<Db>>) -> Result<ProjectDocuments> {
    let docs = library::documents(&root(&db)?)?;
    Ok(ProjectDocuments {
        found: docs.found,
        missing: docs.missing,
    })
}

/// Quitte l'application.
///
/// Par Rust et non par la fermeture de la fenêtre : c'est l'application qu'on
/// quitte, et la question des documents non enregistrés a déjà été posée par
/// le frontend.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Sommaire d'un texte en cours de frappe, sans toucher au disque.
#[tauri::command]
pub async fn document_outline(content: String) -> Result<Vec<Heading>> {
    Ok(files::outline(&content))
}
