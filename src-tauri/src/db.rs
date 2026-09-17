use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{Error, Result};
use crate::models::{
    spacing_key_ok, Article, ArticleQuery, Feed, ProjectSettings, Settings, Stats,
    PANDOC_FIELD_MAX, SPACING_MAX,
};

/// Version du schéma. Toute évolution ajoute un bloc dans `migrate`.
const SCHEMA_VERSION: i64 = 4;

/// Sous quoi les espacements de la mise en page se rangent dans
/// `project_settings`. Une ligne par valeur, sous un préfixe commun : la table
/// reste lisible, et un espacement de plus ne demande aucune migration.
///
/// Pas de `_` dans ce préfixe : c'est un joker de `LIKE`, et la suppression des
/// anciennes lignes s'en servirait alors pour effacer plus large.
const SPACING_PREFIX: &str = "space.";
/// Les réglages de la compilation par Pandoc : destination et modèle de
/// commande, pour HTML puis pour PDF.
const PANDOC_HTML_DEST: &str = "pandoc.htmlDest";
const PANDOC_HTML_COMMAND: &str = "pandoc.htmlCommand";
const PANDOC_HTML_INDEX_COMMAND: &str = "pandoc.htmlIndexCommand";
const PANDOC_PDF_DEST: &str = "pandoc.pdfDest";
const PANDOC_PDF_COMMAND: &str = "pandoc.pdfCommand";
const PANDOC_DOCX_DEST: &str = "pandoc.docxDest";
const PANDOC_DOCX_COMMAND: &str = "pandoc.docxCommand";
const PANDOC_BOOK_DEST: &str = "pandoc.bookDest";
const PANDOC_BOOK_FILE: &str = "pandoc.bookFile";
/// Le préfixe commun aux réglages de Pandoc : ils se retirent ensemble avant
/// d'être réécrits. Pas de `_` dedans, joker de `LIKE`.
const PANDOC_PREFIX: &str = "pandoc.";

/// Connexion SQLite partagée. Le `Mutex` est volontairement std et non tokio :
/// aucun verrou n'est conservé au travers d'un `.await`, toutes les méthodes
/// ci-dessous prennent le verrou et rendent des données possédées.
pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Db(Mutex::new(conn));
        db.migrate()?;
        Ok(db)
    }

    /// Base en mémoire, pour les tests.
    #[cfg(test)]
    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Db(Mutex::new(conn));
        db.migrate()?;
        Ok(db)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        // Un thread paniquant en tenant le verrou laisserait la base dans un
        // état incertain ; on préfère repartir de la connexion plutôt que de
        // propager la panique à chaque appel suivant.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.lock();
        let current: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if current >= SCHEMA_VERSION {
            return Ok(());
        }
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS feeds (
                id         INTEGER PRIMARY KEY,
                mono       TEXT    NOT NULL,
                name       TEXT    NOT NULL,
                url        TEXT    NOT NULL,
                feed_url   TEXT    NOT NULL UNIQUE,
                site_url   TEXT,
                cat        TEXT    NOT NULL DEFAULT 'Nouveaux',
                ok         INTEGER NOT NULL DEFAULT 1,
                last_error TEXT,
                last_sync  TEXT,
                position   INTEGER NOT NULL DEFAULT 0,
                etag       TEXT,
                modified   TEXT
            );

            CREATE TABLE IF NOT EXISTS articles (
                id        INTEGER PRIMARY KEY,
                feed_id   INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
                guid      TEXT    NOT NULL,
                title     TEXT    NOT NULL,
                link      TEXT    NOT NULL DEFAULT '',
                excerpt   TEXT    NOT NULL DEFAULT '',
                content   TEXT    NOT NULL DEFAULT '',
                author    TEXT,
                published TEXT,
                fetched   TEXT    NOT NULL,
                is_read   INTEGER NOT NULL DEFAULT 0,
                is_fav    INTEGER NOT NULL DEFAULT 0,
                UNIQUE (feed_id, guid)
            );

            CREATE INDEX IF NOT EXISTS idx_articles_feed ON articles (feed_id);
            CREATE INDEX IF NOT EXISTS idx_articles_date ON articles (published DESC, fetched DESC);
            CREATE INDEX IF NOT EXISTS idx_articles_read ON articles (is_read);

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;

        // v3 : les réglages de mise en page accompagnent le projet, pas
        // l'application — chaque dossier ouvert garde les siens.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS project_settings (
                root  TEXT NOT NULL,
                key   TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (root, key)
            );
            "#,
        )?;

        // v4 : la liste des projets connus. Le dossier reste la seule vérité —
        // c'est son témoin qui le nomme ; la base ne fait que retenir lesquels
        // ont été ouverts sur cette machine, et quand.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS projects (
                root   TEXT PRIMARY KEY,
                opened TEXT
            );
            "#,
        )?;

        // Le dossier ouvert par la version précédente est un projet : le
        // perdre de vue à la mise à jour ferait disparaître le travail en
        // cours de la liste. Son témoin, lui, est posé au démarrage par
        // `adopt_legacy_root` — écrire sur le disque n'est pas l'affaire
        // d'une migration de schéma.
        conn.execute(
            r#"
            INSERT OR IGNORE INTO projects (root, opened)
            SELECT value, NULL FROM settings WHERE key = 'projectRoot' AND value <> ''
            "#,
            [],
        )?;

        // v2 : l'adresse de l'illustration de l'entrée, pour les vignettes.
        // La base fraîche vient d'être créée sans la colonne, la base v1 ne
        // l'a jamais eue : dans les deux cas l'ajout est le même.
        if current < 2 {
            conn.execute_batch("ALTER TABLE articles ADD COLUMN image TEXT;")?;
        }

        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(())
    }

    // ---------------------------------------------------------------- fils

    pub fn feeds(&self) -> Result<Vec<Feed>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            r#"
            SELECT f.id, f.mono, f.name, f.url, f.feed_url, f.site_url, f.cat,
                   f.ok, f.last_error, f.last_sync, f.position,
                   (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_read = 0),
                   (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id)
            FROM feeds f
            ORDER BY f.position, f.id
            "#,
        )?;
        let rows = stmt
            .query_map([], row_to_feed)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn feed(&self, id: i64) -> Result<Feed> {
        self.feeds()?
            .into_iter()
            .find(|f| f.id == id)
            .ok_or(Error::FeedNotFound(id))
    }

    /// Insère un fil. `position` le place en fin de liste.
    pub fn insert_feed(
        &self,
        mono: &str,
        name: &str,
        display_url: &str,
        feed_url: &str,
        site_url: Option<&str>,
        cat: &str,
    ) -> Result<i64> {
        let conn = self.lock();
        let exists: Option<i64> = conn
            .query_row(
                "SELECT id FROM feeds WHERE feed_url = ?1",
                params![feed_url],
                |r| r.get(0),
            )
            .optional()?;
        if exists.is_some() {
            return Err(Error::DuplicateFeed);
        }
        let next: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM feeds",
            [],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT INTO feeds (mono, name, url, feed_url, site_url, cat, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![mono, name, display_url, feed_url, site_url, cat, next],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn delete_feed(&self, id: i64) -> Result<()> {
        let conn = self.lock();
        let n = conn.execute("DELETE FROM feeds WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(Error::FeedNotFound(id));
        }
        Ok(())
    }

    pub fn rename_feed(&self, id: i64, name: &str, cat: &str) -> Result<()> {
        let conn = self.lock();
        let mono = monogram(name);
        let n = conn.execute(
            "UPDATE feeds SET name = ?2, cat = ?3, mono = ?4 WHERE id = ?1",
            params![id, name, cat, mono],
        )?;
        if n == 0 {
            return Err(Error::FeedNotFound(id));
        }
        Ok(())
    }

    /// Réordonne le rail : `ids` dans l'ordre voulu.
    pub fn reorder_feeds(&self, ids: &[i64]) -> Result<()> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        for (pos, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE feeds SET position = ?2 WHERE id = ?1",
                params![id, pos as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// En-têtes de cache conditionnel du dernier appel réussi.
    pub fn feed_cache_headers(&self, id: i64) -> Result<(String, Option<String>, Option<String>)> {
        let conn = self.lock();
        conn.query_row(
            "SELECT feed_url, etag, modified FROM feeds WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(Error::FeedNotFound(id))
    }

    /// Oublie les en-têtes de cache de tous les fils.
    ///
    /// Sans eux, le serveur renvoie le document entier au lieu d'un 304, et
    /// `insert_articles` rattrape au passage ce qui manquait aux articles déjà
    /// en base — les illustrations, notamment.
    pub fn clear_cache_headers(&self) -> Result<()> {
        let conn = self.lock();
        conn.execute("UPDATE feeds SET etag = NULL, modified = NULL", [])?;
        Ok(())
    }

    pub fn mark_feed_ok(&self, id: i64, etag: Option<&str>, modified: Option<&str>) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE feeds SET ok = 1, last_error = NULL, last_sync = ?2, etag = ?3, modified = ?4
             WHERE id = ?1",
            params![id, now(), etag, modified],
        )?;
        Ok(())
    }

    pub fn mark_feed_failed(&self, id: i64, err: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE feeds SET ok = 0, last_error = ?2, last_sync = ?3 WHERE id = ?1",
            params![id, err, now()],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------ articles

    /// Insère les entrées absentes ; renvoie le nombre réellement ajouté.
    pub fn insert_articles(&self, feed_id: i64, items: &[NewArticle]) -> Result<usize> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        let mut added = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO articles
                   (feed_id, guid, title, link, excerpt, content, image, author,
                    published, fetched)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )?;
            // Les articles collectés avant que l'on sache lire les
            // illustrations n'en portent aucune : on complète au passage,
            // sans toucher au reste de la ligne ni au compte des nouveautés.
            let mut illustrate = tx.prepare(
                "UPDATE articles SET image = ?3
                 WHERE feed_id = ?1 AND guid = ?2 AND image IS NULL",
            )?;
            for it in items {
                let inserted = stmt.execute(params![
                    feed_id,
                    it.guid,
                    it.title,
                    it.link,
                    it.excerpt,
                    it.content,
                    it.image,
                    it.author,
                    it.published,
                    now(),
                ])?;
                added += inserted;
                if inserted == 0 && it.image.is_some() {
                    illustrate.execute(params![feed_id, it.guid, it.image])?;
                }
            }
        }
        tx.commit()?;
        Ok(added)
    }

    pub fn articles(&self, q: &ArticleQuery) -> Result<Vec<Article>> {
        let conn = self.lock();
        // Le filtrage reste en SQL pour que la recherche porte sur la totalité
        // des articles collectés, pas seulement sur la page affichée.
        let mut sql = String::from(
            r#"
            SELECT a.id, a.feed_id, f.name, f.mono, a.title, a.link, a.excerpt,
                   a.content, a.image, a.author, a.published, a.fetched,
                   a.is_read, a.is_fav
            FROM articles a
            JOIN feeds f ON f.id = a.feed_id
            WHERE 1 = 1
            "#,
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(fid) = q.feed_id {
            sql.push_str(" AND a.feed_id = ?");
            args.push(Box::new(fid));
        }
        match q.filter.as_str() {
            "nonlus" => sql.push_str(" AND a.is_read = 0"),
            "favoris" => sql.push_str(" AND a.is_fav = 1"),
            _ => {}
        }
        let needle = q.q.trim();
        if !needle.is_empty() {
            sql.push_str(
                " AND (a.title LIKE ? ESCAPE '\\' OR a.excerpt LIKE ? ESCAPE '\\' \
                   OR a.content LIKE ? ESCAPE '\\' OR f.name LIKE ? ESCAPE '\\')",
            );
            let pat = format!("%{}%", escape_like(needle));
            for _ in 0..4 {
                args.push(Box::new(pat.clone()));
            }
        }
        sql.push_str(" ORDER BY COALESCE(a.published, a.fetched) DESC, a.id DESC LIMIT ? OFFSET ?");
        args.push(Box::new(q.limit.clamp(1, 1000)));
        args.push(Box::new(q.offset.max(0)));

        let mut stmt = conn.prepare(&sql)?;
        let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let rows = stmt
            .query_map(refs.as_slice(), row_to_article)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn article(&self, id: i64) -> Result<Article> {
        let conn = self.lock();
        conn.query_row(
            r#"
            SELECT a.id, a.feed_id, f.name, f.mono, a.title, a.link, a.excerpt,
                   a.content, a.image, a.author, a.published, a.fetched,
                   a.is_read, a.is_fav
            FROM articles a JOIN feeds f ON f.id = a.feed_id
            WHERE a.id = ?1
            "#,
            params![id],
            row_to_article,
        )
        .optional()?
        .ok_or(Error::ArticleNotFound(id))
    }

    pub fn set_read(&self, id: i64, read: bool) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE articles SET is_read = ?2 WHERE id = ?1",
            params![id, read as i64],
        )?;
        Ok(())
    }

    pub fn set_favorite(&self, id: i64, fav: bool) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE articles SET is_fav = ?2 WHERE id = ?1",
            params![id, fav as i64],
        )?;
        Ok(())
    }

    /// « Tout marquer comme lu » : porte sur la sélection courante, pas sur
    /// la base entière — même portée que la liste affichée.
    pub fn mark_all_read(&self, q: &ArticleQuery) -> Result<usize> {
        let ids: Vec<i64> = self.articles(q)?.into_iter().map(|a| a.id).collect();
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare("UPDATE articles SET is_read = 1 WHERE id = ?1")?;
            for id in &ids {
                stmt.execute(params![id])?;
            }
        }
        tx.commit()?;
        Ok(ids.len())
    }

    pub fn stats(&self) -> Result<Stats> {
        let conn = self.lock();
        let (total, unread, favorites) = conn.query_row(
            "SELECT COUNT(*), SUM(is_read = 0), SUM(is_fav = 1) FROM articles",
            [],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                ))
            },
        )?;
        let feeds: i64 = conn.query_row("SELECT COUNT(*) FROM feeds", [], |r| r.get(0))?;
        let last_sync: Option<String> =
            conn.query_row("SELECT MAX(last_sync) FROM feeds", [], |r| r.get(0))?;
        Ok(Stats {
            total,
            unread,
            favorites,
            feeds,
            last_sync,
        })
    }

    /// Purge les articles ni lus-favoris au-delà de `keep` par fil.
    pub fn prune(&self, keep: i64) -> Result<usize> {
        let conn = self.lock();
        let n = conn.execute(
            r#"
            DELETE FROM articles WHERE is_fav = 0 AND id NOT IN (
                SELECT id FROM articles a2
                WHERE a2.feed_id = articles.feed_id
                ORDER BY COALESCE(a2.published, a2.fetched) DESC
                LIMIT ?1
            )
            "#,
            params![keep],
        )?;
        Ok(n)
    }

    // ------------------------------------------------------------ réglages

    pub fn settings(&self) -> Result<Settings> {
        let conn = self.lock();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let mut s = Settings::default();
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (k, v) = row?;
            match k.as_str() {
                "refreshMinutes" => s.refresh_minutes = v.parse().unwrap_or(s.refresh_minutes),
                "feedPaneOpen" => s.feed_pane_open = v == "1",
                "showThumbnails" => s.show_thumbnails = v == "1",
                "showReservedTile" => s.show_reserved_tile = v == "1",
                "app" => s.app = v,
                // Une chaîne vide vaut « aucun projet » : c'est ce qu'écrit
                // `save_settings` quand la racine est absente.
                "projectRoot" => s.project_root = Some(v).filter(|p| !p.is_empty()),
                "filesWidth" => s.files_width = v.parse().unwrap_or(0),
                "outlineWidth" => s.outline_width = v.parse().unwrap_or(0),
                "journalHeight" => s.journal_height = v.parse().unwrap_or(0),
                "editorFocus" => s.editor_focus = v == "1",
                "editorZoom" => s.editor_zoom = v.parse().unwrap_or(s.editor_zoom),
                "theme" => s.theme = v,
                _ => {}
            }
        }
        Ok(s)
    }

    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )?;
            let flag = |b: bool| if b { "1" } else { "0" };
            stmt.execute(params!["refreshMinutes", s.refresh_minutes.to_string()])?;
            stmt.execute(params!["feedPaneOpen", flag(s.feed_pane_open)])?;
            stmt.execute(params!["showThumbnails", flag(s.show_thumbnails)])?;
            stmt.execute(params!["showReservedTile", flag(s.show_reserved_tile)])?;
            stmt.execute(params!["app", &s.app])?;
            stmt.execute(params![
                "projectRoot",
                s.project_root.as_deref().unwrap_or("")
            ])?;
            stmt.execute(params!["filesWidth", s.files_width.to_string()])?;
            stmt.execute(params!["outlineWidth", s.outline_width.to_string()])?;
            stmt.execute(params!["journalHeight", s.journal_height.to_string()])?;
            stmt.execute(params!["editorFocus", flag(s.editor_focus)])?;
            stmt.execute(params!["editorZoom", s.editor_zoom.to_string()])?;
            stmt.execute(params!["theme", &s.theme])?;
        }
        tx.commit()?;
        Ok(())
    }

    // ------------------------------------------------------------- projets

    /// Les projets connus, du plus récemment ouvert au plus ancien.
    ///
    /// Rend des couples `(racine, dernière ouverture)` : ce que la base sait.
    /// Le nom et l'existence du dossier se lisent sur le disque, pas ici.
    pub fn projects(&self) -> Result<Vec<(String, Option<String>)>> {
        let conn = self.lock();
        // Un projet jamais ouvert — celui que la migration vient de reprendre —
        // se range après ceux qui l'ont été, non avant.
        let mut stmt = conn.prepare(
            "SELECT root, opened FROM projects ORDER BY opened IS NULL, opened DESC, root",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// Inscrit un projet dans la liste et note qu'il vient d'être ouvert.
    pub fn remember_project(&self, root: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO projects (root, opened) VALUES (?1, ?2)
             ON CONFLICT(root) DO UPDATE SET opened = excluded.opened",
            params![root, now()],
        )?;
        Ok(())
    }

    /// Retire un projet de la liste. Le dossier n'est pas touché : son témoin
    /// reste, et le projet se rouvre en désignant à nouveau le dossier.
    ///
    /// Sa mise en page est gardée elle aussi — la retrouver intacte vaut mieux
    /// que la ressaisir, si le projet revient dans la liste.
    pub fn forget_project(&self, root: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM projects WHERE root = ?1", params![root])?;
        Ok(())
    }

    pub fn project_settings(&self, root: &str) -> Result<ProjectSettings> {
        let conn = self.lock();
        let mut stmt = conn.prepare("SELECT key, value FROM project_settings WHERE root = ?1")?;
        let mut s = ProjectSettings::default();
        let rows = stmt.query_map(params![root], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (k, v) = row?;
            match k.as_str() {
                "align" => s.align = v,
                "lineHeight" => s.line_height = v.parse().unwrap_or(s.line_height),
                "showOutline" => s.show_outline = v == "1",
                "wrapSource" => s.wrap_source = v == "1",
                PANDOC_HTML_DEST => s.pandoc.html_dest = v,
                PANDOC_HTML_COMMAND => s.pandoc.html_command = v,
                PANDOC_HTML_INDEX_COMMAND => s.pandoc.html_index_command = v,
                PANDOC_PDF_DEST => s.pandoc.pdf_dest = v,
                PANDOC_PDF_COMMAND => s.pandoc.pdf_command = v,
                PANDOC_DOCX_DEST => s.pandoc.docx_dest = v,
                PANDOC_DOCX_COMMAND => s.pandoc.docx_command = v,
                PANDOC_BOOK_DEST => s.pandoc.book_dest = v,
                PANDOC_BOOK_FILE => s.pandoc.book_file = v,
                // Les espacements vivent sous un préfixe : une ligne par valeur,
                // lisible à l'œil dans la table, et rien à migrer quand le
                // frontend en nomme un de plus.
                _ => {
                    if let Some(name) = k.strip_prefix(SPACING_PREFIX) {
                        if let Ok(px) = v.parse::<i64>() {
                            s.spacing
                                .insert(name.to_string(), px.clamp(0, SPACING_MAX));
                        }
                    }
                }
            }
        }
        Ok(s)
    }

    pub fn save_project_settings(&self, root: &str, s: &ProjectSettings) -> Result<()> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        {
            // Les espacements se réécrivent en entier, les anciens retirés
            // d'abord : c'est ce qui permet de rendre un réglage à sa valeur par
            // défaut. Un simple ajout ne le pourrait pas — la ligne resterait en
            // base et continuerait de couvrir la feuille de style.
            tx.execute(
                "DELETE FROM project_settings WHERE root = ?1 AND key LIKE ?2",
                params![root, format!("{SPACING_PREFIX}%")],
            )?;
            // Même règle pour Pandoc : un champ vidé quitte la base.
            tx.execute(
                "DELETE FROM project_settings WHERE root = ?1 AND key LIKE ?2",
                params![root, format!("{PANDOC_PREFIX}%")],
            )?;

            let mut stmt = tx.prepare(
                "INSERT INTO project_settings (root, key, value) VALUES (?1, ?2, ?3)
                 ON CONFLICT(root, key) DO UPDATE SET value = excluded.value",
            )?;
            stmt.execute(params![root, "align", &s.align])?;
            stmt.execute(params![root, "lineHeight", s.line_height.to_string()])?;
            stmt.execute(params![
                root,
                "showOutline",
                if s.show_outline { "1" } else { "0" }
            ])?;
            stmt.execute(params![
                root,
                "wrapSource",
                if s.wrap_source { "1" } else { "0" }
            ])?;

            for (name, px) in &s.spacing {
                // Un nom qui ne tiendrait pas dans une variable CSS n'a rien à
                // faire en base : le laisser entrer ferait un réglage qui
                // s'enregistre et ne s'applique jamais.
                if !spacing_key_ok(name) {
                    continue;
                }
                stmt.execute(params![
                    root,
                    format!("{SPACING_PREFIX}{name}"),
                    (*px).clamp(0, SPACING_MAX).to_string()
                ])?;
            }

            for (key, value) in [
                (PANDOC_HTML_DEST, &s.pandoc.html_dest),
                (PANDOC_HTML_COMMAND, &s.pandoc.html_command),
                (PANDOC_HTML_INDEX_COMMAND, &s.pandoc.html_index_command),
                (PANDOC_PDF_DEST, &s.pandoc.pdf_dest),
                (PANDOC_PDF_COMMAND, &s.pandoc.pdf_command),
                (PANDOC_DOCX_DEST, &s.pandoc.docx_dest),
                (PANDOC_DOCX_COMMAND, &s.pandoc.docx_command),
                (PANDOC_BOOK_DEST, &s.pandoc.book_dest),
                (PANDOC_BOOK_FILE, &s.pandoc.book_file),
            ] {
                let value = pandoc_field(value);
                if !value.is_empty() {
                    stmt.execute(params![root, key, value])?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn is_empty(&self) -> Result<bool> {
        let conn = self.lock();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM feeds", [], |r| r.get(0))?;
        Ok(n == 0)
    }
}

/// Un réglage de Pandoc tel qu'il se range en base : sur une seule ligne, sans
/// blancs aux bords, et borné.
///
/// Une commande collée depuis un script peut porter des retours à la ligne ;
/// ce sont des séparateurs d'arguments comme les autres. Les garder ferait une
/// valeur qu'une ligne de saisie ne sait pas montrer.
fn pandoc_field(value: &str) -> String {
    value
        .split(['\r', '\n'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(PANDOC_FIELD_MAX)
        .collect()
}

/// Entrée prête à insérer, produite par `fetch::parse`.
#[derive(Debug, Clone)]
pub struct NewArticle {
    pub guid: String,
    pub title: String,
    pub link: String,
    pub excerpt: String,
    pub content: String,
    pub image: Option<String>,
    pub author: Option<String>,
    pub published: Option<String>,
}

fn row_to_feed(r: &Row<'_>) -> rusqlite::Result<Feed> {
    Ok(Feed {
        id: r.get(0)?,
        mono: r.get(1)?,
        name: r.get(2)?,
        url: r.get(3)?,
        feed_url: r.get(4)?,
        site_url: r.get(5)?,
        cat: r.get(6)?,
        ok: r.get::<_, i64>(7)? != 0,
        last_error: r.get(8)?,
        last_sync: r.get(9)?,
        position: r.get(10)?,
        unread: r.get(11)?,
        total: r.get(12)?,
    })
}

fn row_to_article(r: &Row<'_>) -> rusqlite::Result<Article> {
    Ok(Article {
        id: r.get(0)?,
        feed_id: r.get(1)?,
        feed_name: r.get(2)?,
        feed_mono: r.get(3)?,
        title: r.get(4)?,
        link: r.get(5)?,
        excerpt: r.get(6)?,
        content: r.get(7)?,
        image: r.get(8)?,
        author: r.get(9)?,
        published: r.get(10)?,
        fetched: r.get(11)?,
        read: r.get::<_, i64>(12)? != 0,
        favorite: r.get::<_, i64>(13)? != 0,
    })
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Monogramme de deux lettres : initiales des deux premiers mots, sinon les
/// deux premières lettres. Reprend l'aspect des pastilles du modèle.
pub fn monogram(name: &str) -> String {
    let words: Vec<&str> = name
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let s: String = match words.as_slice() {
        [] => "??".into(),
        [one] => one.chars().take(2).collect(),
        [a, b, ..] => a
            .chars()
            .take(1)
            .chain(b.chars().take(1))
            .collect::<String>(),
    };
    s.to_uppercase()
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::PandocSettings;
    use std::collections::BTreeMap;

    fn seed(db: &Db) -> i64 {
        db.insert_feed(
            "AN",
            "Actu Numérique",
            "actu.fr/rss",
            "https://actu.fr/rss",
            None,
            "Technologie",
        )
        .unwrap()
    }

    #[test]
    fn monogrammes() {
        assert_eq!(monogram("Actu Numérique"), "AN");
        assert_eq!(monogram("Bulletin"), "BU");
        assert_eq!(monogram("Collectivités & Territoires"), "CT");
        assert_eq!(monogram(""), "??");
    }

    #[test]
    fn reglages_propres_a_chaque_projet() {
        let db = Db::open_memory().unwrap();

        // Sans rien d'enregistré, les valeurs par défaut.
        let d = db.project_settings("/a").unwrap();
        assert_eq!(d.align, "gauche");
        assert_eq!(d.line_height, 165);
        assert!(d.show_outline);
        assert!(d.wrap_source);

        assert!(d.spacing.is_empty());

        db.save_project_settings(
            "/a",
            &ProjectSettings {
                align: "justifie".into(),
                line_height: 200,
                show_outline: false,
                wrap_source: false,
                spacing: BTreeMap::from([("h1Before".into(), 40), ("pAfter".into(), 12)]),
                ..Default::default()
            },
        )
        .unwrap();

        let a = db.project_settings("/a").unwrap();
        assert_eq!(a.align, "justifie");
        assert_eq!(a.line_height, 200);
        assert!(!a.show_outline);
        assert!(!a.wrap_source);
        assert_eq!(a.spacing.get("h1Before"), Some(&40));
        assert_eq!(a.spacing.get("pAfter"), Some(&12));

        // Un autre dossier garde les siens : c'est tout l'intérêt de la table.
        let b = db.project_settings("/b").unwrap();
        assert_eq!(b.align, "gauche");
        assert_eq!(b.line_height, 165);
        assert!(b.show_outline);
        assert!(b.wrap_source);
        assert!(b.spacing.is_empty());
    }

    /// Un espacement rendu à sa valeur par défaut doit *disparaître* de la base.
    ///
    /// Sans cela la ligne resterait là et continuerait de couvrir la feuille de
    /// style : le réglage serait revenu dans la boîte, mais pas dans le
    /// document.
    #[test]
    fn un_espacement_retire_ne_reste_pas_en_base() {
        let db = Db::open_memory().unwrap();

        let mut s = ProjectSettings {
            spacing: BTreeMap::from([("h1Before".into(), 40), ("h1After".into(), 20)]),
            ..ProjectSettings::default()
        };
        db.save_project_settings("/a", &s).unwrap();
        assert_eq!(db.project_settings("/a").unwrap().spacing.len(), 2);

        s.spacing.remove("h1Before");
        db.save_project_settings("/a", &s).unwrap();

        let back = db.project_settings("/a").unwrap();
        assert_eq!(back.spacing.get("h1Before"), None);
        assert_eq!(back.spacing.get("h1After"), Some(&20));

        // Et les autres réglages ne partent pas avec : le ménage ne vaut que
        // pour les lignes d'espacement.
        assert_eq!(back.line_height, 165);
    }

    /// Ce qui ne tiendrait pas dans une variable CSS n'entre pas en base, et
    /// une valeur hors bornes y entre ramenée dans ses limites.
    #[test]
    fn les_espacements_sont_filtres_et_bornes() {
        let db = Db::open_memory().unwrap();

        db.save_project_settings(
            "/a",
            &ProjectSettings {
                spacing: BTreeMap::from([
                    ("h1Before".into(), 10_000),
                    ("pAfter".into(), -40),
                    // Ni le point-virgule ni l'espace n'ont leur place dans un
                    // nom de variable : la ligne est écartée, pas écrite de
                    // travers.
                    ("p; color: red".into(), 10),
                    ("accolade}".into(), 10),
                ]),
                ..ProjectSettings::default()
            },
        )
        .unwrap();

        let back = db.project_settings("/a").unwrap();
        assert_eq!(back.spacing.get("h1Before"), Some(&SPACING_MAX));
        assert_eq!(back.spacing.get("pAfter"), Some(&0));
        assert_eq!(back.spacing.len(), 2);
    }

    /// Les réglages de Pandoc : propres au projet, rangés sur une ligne, et
    /// retirés de la base quand on les vide.
    #[test]
    fn reglages_pandoc_du_projet() {
        let db = Db::open_memory().unwrap();
        assert_eq!(db.project_settings("/a").unwrap().pandoc, PandocSettings::default());

        let mut s = ProjectSettings {
            pandoc: PandocSettings {
                html_dest: "  /mnt/hgfs/DEV/htdocs  ".into(),
                // Une commande collée sur deux lignes n'en fait plus qu'une.
                html_command: "pandoc {fichier}\n  -t html5 -o {sortie}\r\n".into(),
                pdf_dest: "/mnt/hgfs/DEV/sds-sfd-v2027/resources/pdf".into(),
                pdf_command: "pandoc {fichier} --defaults=conf/defaults-single.yaml -o {sortie}"
                    .into(),
                docx_dest: "/mnt/hgfs/DEV/sds-sfd-v2027/resources/docx".into(),
                docx_command: "pandoc {fichier} --defaults=conf/defaults-docx.yaml -o {sortie}"
                    .into(),
                ..PandocSettings::default()
            },
            ..ProjectSettings::default()
        };
        db.save_project_settings("/a", &s).unwrap();

        let back = db.project_settings("/a").unwrap().pandoc;
        assert_eq!(back.html_dest, "/mnt/hgfs/DEV/htdocs");
        assert_eq!(back.html_command, "pandoc {fichier} -t html5 -o {sortie}");
        assert_eq!(back.pdf_dest, "/mnt/hgfs/DEV/sds-sfd-v2027/resources/pdf");
        assert_eq!(
            back.pdf_command,
            "pandoc {fichier} --defaults=conf/defaults-single.yaml -o {sortie}"
        );
        assert_eq!(back.docx_dest, "/mnt/hgfs/DEV/sds-sfd-v2027/resources/docx");
        assert_eq!(
            back.docx_command,
            "pandoc {fichier} --defaults=conf/defaults-docx.yaml -o {sortie}"
        );
        // Un autre projet n'en sait rien.
        assert_eq!(db.project_settings("/b").unwrap().pandoc, PandocSettings::default());

        // Vidé, le champ quitte la base ; l'autre reste.
        s.pandoc.html_dest = "   ".into();
        db.save_project_settings("/a", &s).unwrap();
        let back = db.project_settings("/a").unwrap().pandoc;
        assert_eq!(back.html_dest, "");
        assert_eq!(back.html_command, "pandoc {fichier} -t html5 -o {sortie}");
        let rows: i64 = db
            .lock()
            .query_row(
                "SELECT COUNT(*) FROM project_settings WHERE root = '/a' AND key LIKE 'pandoc.%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 5);
    }

    #[test]
    fn la_liste_des_projets_met_le_dernier_ouvert_en_tete() {
        let db = Db::open_memory().unwrap();
        db.remember_project("/un").unwrap();
        db.remember_project("/deux").unwrap();
        // Rouvrir le premier doit le ramener en tête : c'est l'ordre attendu
        // d'une liste de projets récents.
        db.remember_project("/un").unwrap();

        let roots: Vec<String> = db.projects().unwrap().into_iter().map(|(r, _)| r).collect();
        assert_eq!(roots, ["/un", "/deux"]);
    }

    #[test]
    fn un_projet_oublie_quitte_la_liste_mais_garde_sa_mise_en_page() {
        let db = Db::open_memory().unwrap();
        db.remember_project("/un").unwrap();
        db.save_project_settings(
            "/un",
            &ProjectSettings {
                align: "justifie".into(),
                line_height: 200,
                show_outline: false,
                spacing: BTreeMap::from([("h2Before".into(), 30)]),
                ..Default::default()
            },
        )
        .unwrap();

        db.forget_project("/un").unwrap();
        assert!(db.projects().unwrap().is_empty());

        // La mise en page survit : le projet remis dans la liste la retrouve
        // plutôt que de la faire ressaisir.
        let back = db.project_settings("/un").unwrap();
        assert_eq!(back.align, "justifie");
        assert_eq!(back.spacing.get("h2Before"), Some(&30));
    }

    /// Le dossier ouvert par la version d'avant les projets doit se retrouver
    /// dans la liste : la migration l'y inscrit.
    #[test]
    fn le_dossier_herite_entre_dans_la_liste() {
        let db = Db::open_memory().unwrap();
        let s = Settings {
            project_root: Some("/ancien".into()),
            ..Settings::default()
        };
        db.save_settings(&s).unwrap();

        // Une base fraîche vient d'être migrée : on rejoue la reprise comme le
        // ferait une base v3 rouverte par cette version.
        {
            let conn = db.lock();
            conn.pragma_update(None, "user_version", 3).unwrap();
        }
        db.migrate().unwrap();

        let roots: Vec<String> = db.projects().unwrap().into_iter().map(|(r, _)| r).collect();
        assert_eq!(roots, ["/ancien"]);
    }

    #[test]
    fn le_theme_survit_a_l_enregistrement() {
        let db = Db::open_memory().unwrap();

        // Rien d'enregistré : le thème du modèle.
        assert_eq!(db.settings().unwrap().theme, "clair");

        let mut s = db.settings().unwrap();
        s.theme = "sombre".into();
        db.save_settings(&s).unwrap();

        assert_eq!(db.settings().unwrap().theme, "sombre");
    }

    #[test]
    fn les_reglages_de_l_editeur_survivent_a_l_enregistrement() {
        let db = Db::open_memory().unwrap();

        // Rien d'enregistré : la taille du modèle, et les volets en place.
        let d = db.settings().unwrap();
        assert_eq!(d.editor_zoom, 100);
        assert!(!d.editor_focus);

        let mut s = db.settings().unwrap();
        s.editor_zoom = 140;
        s.editor_focus = true;
        db.save_settings(&s).unwrap();

        let a = db.settings().unwrap();
        assert_eq!(a.editor_zoom, 140);
        assert!(a.editor_focus);
    }

    #[test]
    fn oubli_des_entetes_de_cache() {
        let db = Db::open_memory().unwrap();
        let id = seed(&db);
        db.mark_feed_ok(id, Some("\"abc\""), Some("Mon, 01 Jan 2024 00:00:00 GMT"))
            .unwrap();

        let (_, etag, modified) = db.feed_cache_headers(id).unwrap();
        assert_eq!(etag.as_deref(), Some("\"abc\""));
        assert!(modified.is_some());

        // Sans en-têtes, le serveur ne peut plus répondre 304 : le flux est
        // relu en entier, ce qui rattrape les articles déjà en base.
        db.clear_cache_headers().unwrap();
        let (_, etag, modified) = db.feed_cache_headers(id).unwrap();
        assert!(etag.is_none() && modified.is_none());
    }

    #[test]
    fn reordonnancement() {
        let db = Db::open_memory().unwrap();
        let a = db
            .insert_feed("AA", "A", "a.fr", "https://a.fr", None, "X")
            .unwrap();
        let b = db
            .insert_feed("BB", "B", "b.fr", "https://b.fr", None, "Y")
            .unwrap();
        let c = db
            .insert_feed("CC", "C", "c.fr", "https://c.fr", None, "X")
            .unwrap();

        // Le rail suit `position` : remonter C devant A ne touche pas B.
        db.reorder_feeds(&[c, b, a]).unwrap();
        let ordre: Vec<i64> = db.feeds().unwrap().iter().map(|f| f.id).collect();
        assert_eq!(ordre, vec![c, b, a]);
    }

    #[test]
    fn renommage_refait_le_monogramme() {
        let db = Db::open_memory().unwrap();
        let id = seed(&db);
        db.rename_feed(id, "Veille Territoriale", "Secteur")
            .unwrap();

        let f = db.feed(id).unwrap();
        assert_eq!(f.name, "Veille Territoriale");
        assert_eq!(f.cat, "Secteur");
        // Le monogramme du rail suit le nom, sans quoi il resterait « AN ».
        assert_eq!(f.mono, "VT");

        assert!(matches!(
            db.rename_feed(999, "X", "Y"),
            Err(Error::FeedNotFound(999))
        ));
    }

    #[test]
    fn insertion_et_doublons() {
        let db = Db::open_memory().unwrap();
        let id = seed(&db);
        assert!(matches!(
            db.insert_feed("AN", "Bis", "actu.fr/rss", "https://actu.fr/rss", None, "X"),
            Err(Error::DuplicateFeed)
        ));
        let items = vec![NewArticle {
            guid: "g1".into(),
            title: "Titre".into(),
            link: "https://actu.fr/1".into(),
            excerpt: "chapeau".into(),
            content: "corps".into(),
            image: Some("https://actu.fr/1.jpg".into()),
            author: None,
            published: None,
        }];
        assert_eq!(db.insert_articles(id, &items).unwrap(), 1);
        assert_eq!(
            db.insert_articles(id, &items).unwrap(),
            0,
            "guid déjà connu"
        );
        assert_eq!(db.stats().unwrap().unread, 1);
        assert_eq!(
            db.articles(&ArticleQuery::default()).unwrap()[0]
                .image
                .as_deref(),
            Some("https://actu.fr/1.jpg")
        );
    }

    /// Les articles collectés avant que l'on sache lire les illustrations
    /// reçoivent la leur à la collecte suivante, sans compter comme nouveaux.
    #[test]
    fn illustration_rattrapee() {
        let db = Db::open_memory().unwrap();
        let id = seed(&db);
        let mut it = NewArticle {
            guid: "g1".into(),
            title: "Titre".into(),
            link: String::new(),
            excerpt: String::new(),
            content: String::new(),
            image: None,
            author: None,
            published: None,
        };
        assert_eq!(
            db.insert_articles(id, std::slice::from_ref(&it)).unwrap(),
            1
        );
        assert!(db.articles(&ArticleQuery::default()).unwrap()[0]
            .image
            .is_none());

        it.image = Some("https://actu.fr/photo.jpg".into());
        assert_eq!(
            db.insert_articles(id, &[it]).unwrap(),
            0,
            "pas un nouvel article"
        );
        assert_eq!(
            db.articles(&ArticleQuery::default()).unwrap()[0]
                .image
                .as_deref(),
            Some("https://actu.fr/photo.jpg")
        );
    }

    #[test]
    fn filtres_et_recherche() {
        let db = Db::open_memory().unwrap();
        let id = seed(&db);
        let mk = |g: &str, t: &str| NewArticle {
            guid: g.into(),
            title: t.into(),
            link: String::new(),
            excerpt: String::new(),
            content: String::new(),
            image: None,
            author: None,
            published: None,
        };
        db.insert_articles(id, &[mk("1", "Réseau de chaleur"), mk("2", "Compteurs")])
            .unwrap();
        let all = db.articles(&ArticleQuery::default()).unwrap();
        assert_eq!(all.len(), 2);

        db.set_read(all[0].id, true).unwrap();
        let q = ArticleQuery {
            filter: "nonlus".into(),
            ..Default::default()
        };
        assert_eq!(db.articles(&q).unwrap().len(), 1);

        let q = ArticleQuery {
            q: "chaleur".into(),
            ..Default::default()
        };
        assert_eq!(db.articles(&q).unwrap().len(), 1);

        // Le caractère joker ne doit pas fuir dans le LIKE.
        let q = ArticleQuery {
            q: "%".into(),
            ..Default::default()
        };
        assert_eq!(db.articles(&q).unwrap().len(), 0);
    }

    #[test]
    fn tout_marquer_lu_respecte_la_portee() {
        let db = Db::open_memory().unwrap();
        let a = seed(&db);
        let b = db
            .insert_feed(
                "BE",
                "Bulletin Énergie",
                "be.fr/feed",
                "https://be.fr/feed",
                None,
                "Secteur",
            )
            .unwrap();
        let mk = |g: &str| NewArticle {
            guid: g.into(),
            title: g.into(),
            link: String::new(),
            excerpt: String::new(),
            content: String::new(),
            image: None,
            author: None,
            published: None,
        };
        db.insert_articles(a, &[mk("a1")]).unwrap();
        db.insert_articles(b, &[mk("b1")]).unwrap();
        let q = ArticleQuery {
            feed_id: Some(a),
            ..Default::default()
        };
        assert_eq!(db.mark_all_read(&q).unwrap(), 1);
        assert_eq!(db.stats().unwrap().unread, 1, "l'autre fil reste non lu");
    }
}
