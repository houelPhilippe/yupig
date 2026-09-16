//! Tableau de bord Veille — cœur applicatif.
//!
//! Découpage : `db` possède l'état (SQLite), `fetch` parle au réseau,
//! `commands` expose la surface appelée par le frontend. Le frontend est du
//! HTML/CSS/JS servi tel quel — aucune étape de build côté interface.

mod commands;
mod db;
mod error;
mod fetch;
mod files;
mod models;

use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager};

use db::{monogram, Db};
use error::Result;

/// Fils proposés au premier lancement, pour que le tableau ne s'ouvre pas
/// vide. Ils se retirent d'un clic depuis le volet « Gérer les fils ».
const STARTER_FEEDS: &[(&str, &str, &str)] = &[
    (
        "Le Monde — À la une",
        "https://www.lemonde.fr/rss/une.xml",
        "Généraliste",
    ),
    ("LinuxFr", "https://linuxfr.org/news.atom", "Technologie"),
    ("Next", "https://next.ink/feed/", "Technologie"),
    (
        "Actu-Environnement",
        "https://www.actu-environnement.com/ae/rss/news.php4",
        "Secteur",
    ),
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("dossier de données introuvable : {e}"))?
                .join("veille.sqlite3");

            let database = Arc::new(Db::open(&path)?);
            seed_if_empty(&database)?;

            // Un dossier ouvert par une version antérieure n'a pas encore de
            // témoin : on le lui pose avant toute chose, pour qu'il paraisse
            // dans la liste des projets comme les autres.
            commands::files::adopt_legacy_root(&database);

            // Le projet rouvert au lancement doit pouvoir montrer ses images
            // dès la première seconde, sans attendre qu'on le rechoisisse.
            if let Ok(settings) = database.settings() {
                if let Some(root) = settings.project_root {
                    commands::files::allow_assets(app.handle(), std::path::Path::new(&root));
                }
            }
            app.manage(database.clone());

            spawn_auto_refresh(app.handle().clone(), database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_feeds,
            commands::add_feed,
            commands::remove_feed,
            commands::rename_feed,
            commands::reorder_feeds,
            commands::get_settings,
            commands::save_settings,
            commands::list_articles,
            commands::get_article,
            commands::set_read,
            commands::set_favorite,
            commands::mark_all_read,
            commands::get_stats,
            commands::sync_feed,
            commands::sync_all,
            commands::prune_articles,
            commands::list_projects,
            commands::create_project,
            commands::open_project,
            commands::forget_project,
            commands::close_project,
            commands::project_tree,
            commands::read_document,
            commands::write_document,
            commands::rename_file,
            commands::duplicate_file,
            commands::delete_file,
            commands::document_outline,
            commands::get_project_settings,
            commands::save_project_settings,
            commands::file_link,
            commands::read_image,
            commands::import_opml,
            commands::export_opml,
        ])
        .run(tauri::generate_context!())
        .expect("démarrage de l'application");
}

/// Ne s'applique qu'à une base neuve : un utilisateur ayant tout supprimé ne
/// verra pas les fils revenir au lancement suivant — la table n'est vide
/// qu'avant le tout premier ajout.
fn seed_if_empty(db: &Db) -> Result<()> {
    if !db.is_empty()? {
        return Ok(());
    }
    for (name, url, cat) in STARTER_FEEDS {
        // Un fil de départ injoignable ne doit pas empêcher le démarrage.
        let _ = db.insert_feed(
            &monogram(name),
            name,
            &fetch::display_url(url),
            url,
            None,
            cat,
        );
    }
    Ok(())
}

/// Collecte périodique en tâche de fond, à la cadence choisie dans le volet
/// « Rafraîchissement » (15 min / 1 h / 1 j).
fn spawn_auto_refresh(app: tauri::AppHandle, db: Arc<Db>) {
    tauri::async_runtime::spawn(async move {
        // Première collecte peu après le démarrage : la fenêtre a le temps de
        // s'afficher et de dessiner ce que la base contient déjà.
        tokio::time::sleep(Duration::from_secs(3)).await;
        loop {
            let feeds = db.feeds().unwrap_or_default();
            for f in feeds {
                let report = commands::sync::sync_one(&db, f.id, f.name).await;
                if report.added > 0 || !report.ok {
                    let _ = app.emit("sync:progress", &report);
                }
            }
            let _ = app.emit("sync:done", ());

            let minutes = db.settings().map(|s| s.refresh_minutes).unwrap_or(15);
            tokio::time::sleep(Duration::from_secs(minutes.clamp(5, 1440) as u64 * 60)).await;
        }
    });
}
