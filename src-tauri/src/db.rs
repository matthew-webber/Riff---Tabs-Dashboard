//! SQLite-backed tab library.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::{tuning, urls};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub artist: String,
    pub tuning: Option<String>,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: Option<i64>,
    pub open_count: i64,
}

/// Create-or-update payload. On update, `None` fields are left unchanged.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabInput {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub tuning: Option<String>,
    pub tags: Option<Vec<String>>,
    pub favorite: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaveResult {
    pub tab: Tab,
    /// False when an existing tab (same URL) was updated instead.
    pub created: bool,
}

pub struct Library {
    conn: Connection,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn clean_text(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t = clean_text(t.trim_start_matches('#'));
        if !t.is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(&t)) {
            out.push(t);
        }
    }
    out
}

const TAB_COLUMNS: &str = "t.id, t.url, t.title, t.artist, t.tuning, t.favorite, t.created_at, t.updated_at, t.last_opened_at, t.open_count,
    (SELECT group_concat(name, char(31)) FROM (SELECT g.name FROM tab_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.tab_id = t.id ORDER BY g.name COLLATE NOCASE))";

fn row_to_tab(row: &Row) -> rusqlite::Result<Tab> {
    let tags: Option<String> = row.get(10)?;
    Ok(Tab {
        id: row.get(0)?,
        url: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        tuning: row.get(4)?,
        favorite: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        last_opened_at: row.get(8)?,
        open_count: row.get(9)?,
        tags: tags.map(|s| s.split('\u{1f}').map(String::from).collect()).unwrap_or_default(),
    })
}

type Result<T> = std::result::Result<T, String>;

fn db_err(e: rusqlite::Error) -> String {
    format!("Database error: {e}")
}

impl Library {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).map_err(db_err)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory().map_err(db_err)?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;").map_err(db_err)?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(db_err)?;
        if version < 1 {
            conn.execute_batch(
                "CREATE TABLE tabs (
                    id INTEGER PRIMARY KEY,
                    url TEXT NOT NULL,
                    url_key TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL DEFAULT '',
                    artist TEXT NOT NULL DEFAULT '',
                    tuning TEXT,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_opened_at INTEGER,
                    open_count INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE tags (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE
                );
                CREATE TABLE tab_tags (
                    tab_id INTEGER NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (tab_id, tag_id)
                );
                CREATE INDEX tab_tags_tag ON tab_tags(tag_id);
                PRAGMA user_version = 1;",
            )
            .map_err(db_err)?;
        }
        if version < 2 {
            conn.execute_batch(
                "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                PRAGMA user_version = 2;",
            )
            .map_err(db_err)?;
        }
        Ok(Self { conn })
    }

    /// The tuning the player's guitar is in right now, if they've set one.
    /// Tab Transposer shifts tabs opened in the browser to match it.
    pub fn play_tuning(&self) -> Result<Option<String>> {
        self.conn
            .query_row("SELECT value FROM settings WHERE key = 'play_tuning'", [], |r| r.get(0))
            .optional()
            .map_err(db_err)
    }

    /// Set (normalized) or clear the player's tuning. Returns what was stored.
    pub fn set_play_tuning(&self, tuning: Option<&str>) -> Result<Option<String>> {
        let tuning = tuning.and_then(tuning::normalize);
        match &tuning {
            Some(t) => self.conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('play_tuning', ?1)", [t]),
            None => self.conn.execute("DELETE FROM settings WHERE key = 'play_tuning'", []),
        }
        .map_err(db_err)?;
        Ok(tuning)
    }

    pub fn list(&self) -> Result<Vec<Tab>> {
        let mut stmt = self
            .conn
            .prepare_cached(&format!("SELECT {TAB_COLUMNS} FROM tabs t ORDER BY t.created_at DESC"))
            .map_err(db_err)?;
        let rows = stmt.query_map([], row_to_tab).map_err(db_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
    }

    pub fn get(&self, id: i64) -> Result<Option<Tab>> {
        self.conn
            .query_row(&format!("SELECT {TAB_COLUMNS} FROM tabs t WHERE t.id = ?1"), [id], row_to_tab)
            .optional()
            .map_err(db_err)
    }

    pub fn find_by_url(&self, raw_url: &str) -> Result<Option<Tab>> {
        let Ok(url) = urls::clean(raw_url) else { return Ok(None) };
        self.conn
            .query_row(&format!("SELECT {TAB_COLUMNS} FROM tabs t WHERE t.url_key = ?1"), [urls::key(&url)], row_to_tab)
            .optional()
            .map_err(db_err)
    }

    pub fn tags(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare_cached("SELECT name FROM tags ORDER BY name COLLATE NOCASE").map_err(db_err)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(db_err)?;
        rows.collect::<rusqlite::Result<Vec<String>>>().map_err(db_err)
    }

    /// Distinct tunings currently in use, presets first in preset order.
    pub fn tunings_in_use(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare_cached("SELECT DISTINCT tuning FROM tabs WHERE tuning IS NOT NULL").map_err(db_err)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(db_err)?;
        let mut list = rows.collect::<rusqlite::Result<Vec<String>>>().map_err(db_err)?;
        list.sort_by_key(|t| (tuning::preset_rank(t).unwrap_or(usize::MAX), t.to_lowercase()));
        Ok(list)
    }

    /// Insert a new tab, or update an existing one. Without an `id`, a tab
    /// whose URL matches an existing entry updates that entry instead of
    /// creating a duplicate.
    pub fn save(&mut self, input: TabInput) -> Result<SaveResult> {
        let url = match input.url.as_deref() {
            Some(u) => Some(urls::clean(u)?),
            None => None,
        };
        let tx = self.conn.transaction().map_err(db_err)?;
        let now = now_ms();

        let existing_id: Option<i64> = match (input.id, &url) {
            (Some(id), _) => {
                let exists: bool = tx.query_row("SELECT 1 FROM tabs WHERE id = ?1", [id], |_| Ok(true)).optional().map_err(db_err)?.unwrap_or(false);
                if !exists {
                    return Err("That tab no longer exists".into());
                }
                Some(id)
            }
            (None, Some(u)) => tx
                .query_row("SELECT id FROM tabs WHERE url_key = ?1", [urls::key(u)], |r| r.get(0))
                .optional()
                .map_err(db_err)?,
            (None, None) => return Err("A URL is required".into()),
        };

        let created = existing_id.is_none();
        let id = match existing_id {
            None => {
                let u = url.as_ref().expect("url checked above");
                tx.execute(
                    "INSERT INTO tabs (url, url_key, title, artist, tuning, favorite, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                    params![
                        u.as_str(),
                        urls::key(u),
                        clean_text(input.title.as_deref().unwrap_or("")),
                        clean_text(input.artist.as_deref().unwrap_or("")),
                        input.tuning.as_deref().and_then(tuning::normalize),
                        input.favorite.unwrap_or(false),
                        now,
                    ],
                )
                .map_err(db_err)?;
                tx.last_insert_rowid()
            }
            Some(id) => {
                if let Some(u) = &url {
                    let clash: Option<i64> = tx
                        .query_row("SELECT id FROM tabs WHERE url_key = ?1 AND id != ?2", params![urls::key(u), id], |r| r.get(0))
                        .optional()
                        .map_err(db_err)?;
                    if clash.is_some() {
                        return Err("Another tab in your library already uses that URL".into());
                    }
                    tx.execute("UPDATE tabs SET url = ?1, url_key = ?2 WHERE id = ?3", params![u.as_str(), urls::key(u), id]).map_err(db_err)?;
                }
                if let Some(t) = &input.title {
                    tx.execute("UPDATE tabs SET title = ?1 WHERE id = ?2", params![clean_text(t), id]).map_err(db_err)?;
                }
                if let Some(a) = &input.artist {
                    tx.execute("UPDATE tabs SET artist = ?1 WHERE id = ?2", params![clean_text(a), id]).map_err(db_err)?;
                }
                if let Some(t) = &input.tuning {
                    tx.execute("UPDATE tabs SET tuning = ?1 WHERE id = ?2", params![tuning::normalize(t), id]).map_err(db_err)?;
                }
                if let Some(f) = input.favorite {
                    tx.execute("UPDATE tabs SET favorite = ?1 WHERE id = ?2", params![f, id]).map_err(db_err)?;
                }
                tx.execute("UPDATE tabs SET updated_at = ?1 WHERE id = ?2", params![now, id]).map_err(db_err)?;
                id
            }
        };

        if let Some(tags) = &input.tags {
            set_tags(&tx, id, &clean_tags(tags))?;
        }
        tx.commit().map_err(db_err)?;
        let tab = self.get(id)?.ok_or("Tab vanished after saving")?;
        Ok(SaveResult { tab, created })
    }

    /// Re-insert a previously deleted tab exactly as it was (used for undo).
    pub fn restore(&mut self, tab: Tab) -> Result<Tab> {
        let url = urls::clean(&tab.url)?;
        let tx = self.conn.transaction().map_err(db_err)?;
        tx.execute(
            "INSERT INTO tabs (id, url, url_key, title, artist, tuning, favorite, created_at, updated_at, last_opened_at, open_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                tab.id, url.as_str(), urls::key(&url), tab.title, tab.artist, tab.tuning, tab.favorite,
                tab.created_at, tab.updated_at, tab.last_opened_at, tab.open_count
            ],
        )
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
                "That tab has already been saved again".to_string()
            }
            e => db_err(e),
        })?;
        set_tags(&tx, tab.id, &clean_tags(&tab.tags))?;
        tx.commit().map_err(db_err)?;
        self.get(tab.id)?.ok_or_else(|| "Tab vanished after restoring".into())
    }

    pub fn delete(&mut self, id: i64) -> Result<()> {
        let tx = self.conn.transaction().map_err(db_err)?;
        tx.execute("DELETE FROM tabs WHERE id = ?1", [id]).map_err(db_err)?;
        prune_tags(&tx)?;
        tx.commit().map_err(db_err)
    }

    pub fn mark_opened(&self, id: i64) -> Result<Tab> {
        self.conn
            .execute("UPDATE tabs SET last_opened_at = ?1, open_count = open_count + 1 WHERE id = ?2", params![now_ms(), id])
            .map_err(db_err)?;
        self.get(id)?.ok_or_else(|| "That tab no longer exists".into())
    }

    /// Rename a tag everywhere. Renaming onto an existing tag merges them.
    pub fn rename_tag(&mut self, from: &str, to: &str) -> Result<()> {
        let to = clean_text(to.trim_start_matches('#'));
        if to.is_empty() {
            return Err("Tag name can't be empty".into());
        }
        let tx = self.conn.transaction().map_err(db_err)?;
        let from_id: Option<i64> = tx.query_row("SELECT id FROM tags WHERE name = ?1", [from], |r| r.get(0)).optional().map_err(db_err)?;
        let Some(from_id) = from_id else { return Ok(()) };
        let to_id: Option<i64> = tx.query_row("SELECT id FROM tags WHERE name = ?1", [&to], |r| r.get(0)).optional().map_err(db_err)?;
        match to_id {
            Some(to_id) if to_id != from_id => {
                tx.execute("INSERT OR IGNORE INTO tab_tags (tab_id, tag_id) SELECT tab_id, ?1 FROM tab_tags WHERE tag_id = ?2", params![to_id, from_id])
                    .map_err(db_err)?;
                tx.execute("DELETE FROM tags WHERE id = ?1", [from_id]).map_err(db_err)?;
            }
            _ => {
                tx.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![to, from_id]).map_err(db_err)?;
            }
        }
        tx.commit().map_err(db_err)
    }

    pub fn delete_tag(&mut self, name: &str) -> Result<()> {
        self.conn.execute("DELETE FROM tags WHERE name = ?1", [name]).map_err(db_err)?;
        Ok(())
    }
}

fn set_tags(tx: &rusqlite::Transaction, tab_id: i64, tags: &[String]) -> Result<()> {
    tx.execute("DELETE FROM tab_tags WHERE tab_id = ?1", [tab_id]).map_err(db_err)?;
    for tag in tags {
        tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag]).map_err(db_err)?;
        tx.execute(
            "INSERT OR IGNORE INTO tab_tags (tab_id, tag_id) SELECT ?1, id FROM tags WHERE name = ?2",
            params![tab_id, tag],
        )
        .map_err(db_err)?;
    }
    prune_tags(tx)
}

/// Tags only exist through the tabs that use them.
fn prune_tags(tx: &rusqlite::Transaction) -> Result<()> {
    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM tab_tags)", []).map_err(db_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(url: &str) -> TabInput {
        TabInput { url: Some(url.into()), ..Default::default() }
    }

    #[test]
    fn save_dedupes_by_url_and_merges_fields() {
        let mut lib = Library::open_in_memory().unwrap();
        let first = lib
            .save(TabInput {
                title: Some("Wonderwall".into()),
                artist: Some("Oasis".into()),
                tuning: Some("eadgbe".into()),
                tags: Some(vec!["To Learn".into(), "to learn".into(), " ".into()]),
                ..input("https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-39144")
            })
            .unwrap();
        assert!(first.created);
        assert_eq!(first.tab.tuning.as_deref(), Some("Standard"));
        assert_eq!(first.tab.tags, vec!["To Learn"]);

        let second = lib
            .save(TabInput { favorite: Some(true), ..input("tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-39144/?utm_source=x") })
            .unwrap();
        assert!(!second.created);
        assert_eq!(second.tab.id, first.tab.id);
        assert_eq!(second.tab.title, "Wonderwall");
        assert!(second.tab.favorite);
        assert_eq!(lib.list().unwrap().len(), 1);
    }

    #[test]
    fn editing_url_onto_another_tab_is_rejected() {
        let mut lib = Library::open_in_memory().unwrap();
        let a = lib.save(input("https://a.com/1")).unwrap().tab;
        lib.save(input("https://a.com/2")).unwrap();
        let err = lib.save(TabInput { id: Some(a.id), url: Some("https://a.com/2".into()), ..Default::default() }).unwrap_err();
        assert!(err.contains("already uses"));
    }

    #[test]
    fn tags_rename_merge_and_prune() {
        let mut lib = Library::open_in_memory().unwrap();
        let a = lib.save(TabInput { tags: Some(vec!["Fun".into()]), ..input("https://a.com/1") }).unwrap().tab;
        lib.save(TabInput { tags: Some(vec!["Riffs".into()]), ..input("https://a.com/2") }).unwrap();
        lib.rename_tag("Fun", "riffs").unwrap();
        assert_eq!(lib.tags().unwrap(), vec!["Riffs"]);
        assert_eq!(lib.get(a.id).unwrap().unwrap().tags, vec!["Riffs"]);
        lib.save(TabInput { id: Some(a.id), tags: Some(vec![]), ..Default::default() }).unwrap();
        lib.delete(lib.find_by_url("https://a.com/2").unwrap().unwrap().id).unwrap();
        assert!(lib.tags().unwrap().is_empty());
    }

    #[test]
    fn play_tuning_is_normalized_and_clearable() {
        let lib = Library::open_in_memory().unwrap();
        assert_eq!(lib.play_tuning().unwrap(), None);
        assert_eq!(lib.set_play_tuning(Some("whole step down")).unwrap().as_deref(), Some("D Standard"));
        assert_eq!(lib.play_tuning().unwrap().as_deref(), Some("D Standard"));
        assert_eq!(lib.set_play_tuning(Some("  ")).unwrap(), None);
        assert_eq!(lib.play_tuning().unwrap(), None);
    }

    #[test]
    fn delete_and_restore() {
        let mut lib = Library::open_in_memory().unwrap();
        let tab = lib.save(TabInput { tags: Some(vec!["x".into()]), ..input("https://a.com/1") }).unwrap().tab;
        let opened = lib.mark_opened(tab.id).unwrap();
        lib.delete(tab.id).unwrap();
        assert!(lib.list().unwrap().is_empty());
        let restored = lib.restore(opened.clone()).unwrap();
        assert_eq!(restored.id, tab.id);
        assert_eq!(restored.open_count, 1);
        assert_eq!(restored.tags, vec!["x"]);
    }
}
