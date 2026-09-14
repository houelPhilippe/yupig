use std::sync::Arc;

use tauri::State;

use crate::db::Db;
use crate::error::Result;
use crate::models::{Article, ArticleQuery, Stats};

/// La grille de cartes, dans la portée courante (fil, filtre, mot-clé).
#[tauri::command]
pub async fn list_articles(db: State<'_, Arc<Db>>, query: ArticleQuery) -> Result<Vec<Article>> {
    db.articles(&query)
}

/// L'article ouvert dans le volet de lecture.
#[tauri::command]
pub async fn get_article(db: State<'_, Arc<Db>>, id: i64) -> Result<Article> {
    db.article(id)
}

#[tauri::command]
pub async fn set_read(db: State<'_, Arc<Db>>, id: i64, read: bool) -> Result<Article> {
    db.set_read(id, read)?;
    db.article(id)
}

#[tauri::command]
pub async fn set_favorite(db: State<'_, Arc<Db>>, id: i64, favorite: bool) -> Result<Article> {
    db.set_favorite(id, favorite)?;
    db.article(id)
}

/// « Tout marquer comme lu » — limité à ce que la portée courante affiche.
#[tauri::command]
pub async fn mark_all_read(db: State<'_, Arc<Db>>, query: ArticleQuery) -> Result<usize> {
    db.mark_all_read(&query)
}

/// Compteurs des puces de filtre et de la ligne de pied de page.
#[tauri::command]
pub async fn get_stats(db: State<'_, Arc<Db>>) -> Result<Stats> {
    db.stats()
}
