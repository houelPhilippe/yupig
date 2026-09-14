use std::sync::Arc;

use tauri::State;

use crate::db::{monogram, Db};
use crate::error::{Error, Result};
use crate::fetch;
use crate::models::{Feed, Settings};

/// Les fils du rail et du volet « Gérer les fils », avec leurs compteurs.
#[tauri::command]
pub async fn list_feeds(db: State<'_, Arc<Db>>) -> Result<Vec<Feed>> {
    db.feeds()
}

/// Ajoute un fil depuis le champ « URL du site ou du flux ».
///
/// L'adresse est résolue par `fetch::discover`, donc `exemple.fr` suffit :
/// c'est la « détection automatique du flux » annoncée sous le champ.
#[tauri::command]
pub async fn add_feed(db: State<'_, Arc<Db>>, url: String, cat: Option<String>) -> Result<Feed> {
    let (feed_url, parsed) = fetch::discover(&url).await?;

    let name = parsed
        .title
        .as_ref()
        .map(|t| fetch::clean(&t.content))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fetch::display_url(&feed_url));

    let site = parsed
        .links
        .iter()
        .find(|l| l.rel.as_deref() == Some("alternate"))
        .map(|l| l.href.clone());

    let id = db.insert_feed(
        &monogram(&name),
        &name,
        &fetch::display_url(&feed_url),
        &feed_url,
        site.as_deref(),
        cat.as_deref().unwrap_or("Nouveaux"),
    )?;

    // Le fil arrive peuplé : le tableau n'affiche jamais une carte vide.
    let items = fetch::to_articles(&parsed, site.as_deref());
    db.insert_articles(id, &items)?;
    db.mark_feed_ok(id, None, None)?;

    db.feed(id)
}

#[tauri::command]
pub async fn remove_feed(db: State<'_, Arc<Db>>, id: i64) -> Result<()> {
    db.delete_feed(id)
}

/// Renomme un fil et le range dans une catégorie.
///
/// Un nom vide priverait le rail de son monogramme ; une catégorie vide
/// créerait un groupe sans titre dans le volet. On refuse les deux plutôt que
/// d'inventer une valeur derrière le dos de l'utilisateur.
#[tauri::command]
pub async fn rename_feed(
    db: State<'_, Arc<Db>>,
    id: i64,
    name: String,
    cat: String,
) -> Result<Feed> {
    let name = name.trim();
    let cat = cat.trim();
    if name.is_empty() {
        return Err(Error::Other("le nom du fil ne peut pas être vide".into()));
    }
    if cat.is_empty() {
        return Err(Error::Other("la catégorie ne peut pas être vide".into()));
    }
    db.rename_feed(id, name, cat)?;
    db.feed(id)
}

/// Nouvel ordre du rail après un glisser-déposer.
#[tauri::command]
pub async fn reorder_feeds(db: State<'_, Arc<Db>>, ids: Vec<i64>) -> Result<Vec<Feed>> {
    db.reorder_feeds(&ids)?;
    db.feeds()
}

#[tauri::command]
pub async fn get_settings(db: State<'_, Arc<Db>>) -> Result<Settings> {
    db.settings()
}

#[tauri::command]
pub async fn save_settings(db: State<'_, Arc<Db>>, settings: Settings) -> Result<Settings> {
    db.save_settings(&settings)?;
    db.settings()
}
