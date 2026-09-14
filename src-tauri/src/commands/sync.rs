use std::sync::Arc;

use tauri::{Emitter, State};

use crate::db::Db;
use crate::error::Result;
use crate::fetch;
use crate::models::SyncReport;

/// Collecte un fil. Une erreur réseau n'échoue pas la commande : elle est
/// consignée sur le fil, qui affiche alors la pastille d'erreur du modèle.
#[tauri::command]
pub async fn sync_feed(db: State<'_, Arc<Db>>, id: i64) -> Result<SyncReport> {
    let name = db.feed(id)?.name;
    Ok(sync_one(&db, id, name).await)
}

/// « Tout synchroniser ». Les fils sont traités en série : un agrégateur de
/// bureau n'a aucune raison d'ouvrir vingt connexions d'un coup, et l'ordre
/// séquentiel rend la progression lisible dans l'en-tête.
///
/// `force` jette les en-têtes de cache avant de partir : les flux sont relus
/// en entier plutôt que d'être écartés par un 304. C'est le seul moyen de
/// rattraper les articles déjà en base sans attendre que le fil bouge.
#[tauri::command]
pub async fn sync_all(
    app: tauri::AppHandle,
    db: State<'_, Arc<Db>>,
    force: Option<bool>,
) -> Result<Vec<SyncReport>> {
    if force.unwrap_or(false) {
        db.clear_cache_headers()?;
    }
    let feeds = db.feeds()?;
    let total = feeds.len();
    let mut reports = Vec::with_capacity(total);

    for (i, f) in feeds.into_iter().enumerate() {
        let report = sync_one(&db, f.id, f.name).await;
        // Le frontend écoute `sync:progress` pour animer le bouton.
        let _ = app.emit(
            "sync:progress",
            serde_json::json!({ "done": i + 1, "total": total, "report": &report }),
        );
        reports.push(report);
    }
    let _ = app.emit("sync:done", &reports);
    Ok(reports)
}

/// Cœur partagé par les deux commandes. Ne rend jamais d'erreur : le rapport
/// porte l'échec, ce qui laisse `sync_all` poursuivre avec les fils suivants.
pub(crate) async fn sync_one(db: &Db, id: i64, name: String) -> SyncReport {
    let fail = |e: String| SyncReport {
        feed_id: id,
        feed_name: name.clone(),
        added: 0,
        ok: false,
        error: Some(e),
    };

    let (url, etag, modified) = match db.feed_cache_headers(id) {
        Ok(v) => v,
        Err(e) => return fail(e.to_string()),
    };

    let fetched = match fetch::get(&url, etag.as_deref(), modified.as_deref()).await {
        Ok(f) => f,
        Err(e) => {
            let _ = db.mark_feed_failed(id, &e.to_string());
            return fail(e.to_string());
        }
    };

    // 304 : rien n'a changé depuis la dernière collecte.
    let Some(body) = fetched.body else {
        let _ = db.mark_feed_ok(id, fetched.etag.as_deref(), fetched.modified.as_deref());
        return SyncReport {
            feed_id: id,
            feed_name: name,
            added: 0,
            ok: true,
            error: None,
        };
    };

    let parsed = match feed_rs::parser::parse(body.as_slice()) {
        Ok(p) => p,
        Err(e) => {
            let msg = e.to_string();
            let _ = db.mark_feed_failed(id, &msg);
            return fail(msg);
        }
    };

    let site = parsed
        .links
        .iter()
        .find(|l| l.rel.as_deref() == Some("alternate"))
        .map(|l| l.href.clone());
    let items = fetch::to_articles(&parsed, site.as_deref());

    match db.insert_articles(id, &items) {
        Ok(added) => {
            let _ = db.mark_feed_ok(id, fetched.etag.as_deref(), fetched.modified.as_deref());
            SyncReport {
                feed_id: id,
                feed_name: name,
                added,
                ok: true,
                error: None,
            }
        }
        Err(e) => fail(e.to_string()),
    }
}

/// Purge manuelle : ne garde que les `keep` articles les plus récents par fil,
/// favoris exclus.
#[tauri::command]
pub async fn prune_articles(db: State<'_, Arc<Db>>, keep: i64) -> Result<usize> {
    db.prune(keep.clamp(20, 5000))
}
