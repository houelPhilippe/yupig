use std::io::Cursor;
use std::sync::Arc;

use quick_xml::events::Event;
use quick_xml::Reader;
use tauri::State;

use crate::db::{monogram, Db};
use crate::error::{Error, Result};
use crate::fetch;
use crate::models::Feed;

/// Un `<outline>` retenu à l'import : ce que le fichier OPML déclare.
#[derive(Debug, Clone)]
struct Outline {
    title: String,
    xml_url: String,
    cat: String,
}

/// Importe un fichier OPML. Les fils déjà suivis sont ignorés en silence,
/// pour qu'un ré-import ne crée pas de doublons.
///
/// Les articles ne sont pas collectés ici : l'import reste instantané, et
/// « Tout synchroniser » remplit ensuite les fils.
#[tauri::command]
pub async fn import_opml(db: State<'_, Arc<Db>>, path: String) -> Result<Vec<Feed>> {
    let xml = std::fs::read_to_string(&path)?;
    let outlines = parse_opml(&xml)?;
    if outlines.is_empty() {
        return Err(Error::Other("aucun fil trouvé dans ce fichier OPML".into()));
    }
    for o in &outlines {
        let display = fetch::display_url(&o.xml_url);
        // `DuplicateFeed` est le cas courant d'un ré-import : on continue.
        match db.insert_feed(
            &monogram(&o.title),
            &o.title,
            &display,
            &o.xml_url,
            None,
            &o.cat,
        ) {
            Ok(_) | Err(Error::DuplicateFeed) => {}
            Err(e) => return Err(e),
        }
    }
    db.feeds()
}

/// Exporte les fils suivis, catégories comprises, au format OPML 2.0.
#[tauri::command]
pub async fn export_opml(db: State<'_, Arc<Db>>, path: String) -> Result<String> {
    let feeds = db.feeds()?;
    std::fs::write(&path, build_opml(&feeds))?;
    Ok(path)
}

fn parse_opml(xml: &str) -> Result<Vec<Outline>> {
    // Seuls les attributs nous intéressent : aucun nœud texte n'est lu.
    let mut reader = Reader::from_reader(Cursor::new(xml.as_bytes()));

    let mut out = Vec::new();
    // Les OPML imbriquent les fils sous un `<outline text="Catégorie">` sans
    // `xmlUrl` ; on suit cette pile pour retrouver la catégorie d'un fil.
    let mut groups: Vec<String> = Vec::new();
    let mut buf = Vec::new();

    loop {
        let ev = reader
            .read_event_into(&mut buf)
            .map_err(|e| Error::Other(format!("OPML illisible : {e}")))?;
        match ev {
            Event::Eof => break,
            Event::Start(ref e) | Event::Empty(ref e) if e.local_name().as_ref() == b"outline" => {
                let attr = |name: &str| {
                    e.attributes().flatten().find_map(|a| {
                        if a.key.local_name().as_ref() != name.as_bytes() {
                            return None;
                        }
                        // Un titre contenant « & » arrive échappé dans le
                        // fichier ; il doit revenir tel qu'il s'affiche.
                        Some(match a.unescape_value() {
                            Ok(v) => v.into_owned(),
                            Err(_) => String::from_utf8_lossy(&a.value).into_owned(),
                        })
                    })
                };
                let xml_url = attr("xmlUrl").unwrap_or_default();
                let title = attr("title").or_else(|| attr("text")).unwrap_or_default();

                if xml_url.is_empty() {
                    // Nœud de regroupement : n'empile que sur une balise ouvrante.
                    if matches!(ev, Event::Start(_)) {
                        groups.push(if title.is_empty() {
                            "Nouveaux".into()
                        } else {
                            title
                        });
                    }
                } else {
                    out.push(Outline {
                        title: if title.is_empty() {
                            fetch::display_url(&xml_url)
                        } else {
                            title
                        },
                        xml_url,
                        cat: groups.last().cloned().unwrap_or_else(|| "Nouveaux".into()),
                    });
                }
            }
            Event::End(ref e) if e.local_name().as_ref() == b"outline" => {
                groups.pop();
            }
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
}

fn build_opml(feeds: &[Feed]) -> String {
    let mut cats: Vec<&str> = feeds.iter().map(|f| f.cat.as_str()).collect();
    cats.sort_unstable();
    cats.dedup();

    let mut s = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <opml version=\"2.0\">\n  <head>\n    <title>Veille — fils suivis</title>\n",
    );
    s.push_str(&format!(
        "    <dateCreated>{}</dateCreated>\n  </head>\n  <body>\n",
        chrono::Utc::now().to_rfc2822()
    ));

    for cat in cats {
        s.push_str(&format!("    <outline text=\"{}\">\n", esc(cat)));
        for f in feeds.iter().filter(|f| f.cat == cat) {
            s.push_str(&format!(
                "      <outline type=\"rss\" text=\"{}\" title=\"{}\" xmlUrl=\"{}\"{} />\n",
                esc(&f.name),
                esc(&f.name),
                esc(&f.feed_url),
                f.site_url
                    .as_deref()
                    .map(|u| format!(" htmlUrl=\"{}\"", esc(u)))
                    .unwrap_or_default(),
            ));
        }
        s.push_str("    </outline>\n");
    }
    s.push_str("  </body>\n</opml>\n");
    s
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0"?>
    <opml version="2.0"><body>
      <outline text="Technologie">
        <outline type="rss" text="Actu Numérique" xmlUrl="https://actunumerique.fr/rss"/>
        <outline type="rss" title="Carnet Ingénierie" xmlUrl="https://carnet-ingenierie.eu/atom"/>
        <outline type="rss" text="Collectivités &amp; Territoires" xmlUrl="https://collterritoires.fr/rss.xml"/>
      </outline>
      <outline type="rss" text="Hors groupe" xmlUrl="https://exemple.fr/feed"/>
    </body></opml>"#;

    #[test]
    fn import_respecte_les_categories() {
        let o = parse_opml(SAMPLE).unwrap();
        assert_eq!(o.len(), 4);
        assert_eq!(o[0].cat, "Technologie");
        assert_eq!(o[1].title, "Carnet Ingénierie");
        assert_eq!(
            o[2].title, "Collectivités & Territoires",
            "l'attribut est déséchappé"
        );
        assert_eq!(
            o[3].cat, "Nouveaux",
            "un fil hors groupe retombe par défaut"
        );
    }

    #[test]
    fn aller_retour_opml() {
        let feeds: Vec<Feed> = parse_opml(SAMPLE)
            .unwrap()
            .into_iter()
            .enumerate()
            .map(|(i, o)| Feed {
                id: i as i64,
                mono: monogram(&o.title),
                name: o.title,
                url: fetch::display_url(&o.xml_url),
                feed_url: o.xml_url,
                site_url: None,
                cat: o.cat,
                ok: true,
                last_error: None,
                last_sync: None,
                position: i as i64,
                unread: 0,
                total: 0,
            })
            .collect();
        let xml = build_opml(&feeds);
        let back = parse_opml(&xml).unwrap();
        assert_eq!(back.len(), 4);
        assert!(back
            .iter()
            .any(|o| o.title == "Actu Numérique" && o.cat == "Technologie"));
        // Le « & » traverse l'export puis le ré-import sans se dédoubler.
        assert!(back
            .iter()
            .any(|o| o.title == "Collectivités & Territoires"));
    }

    #[test]
    fn echappement_xml() {
        assert_eq!(esc(r#"A & B <"c">"#), "A &amp; B &lt;&quot;c&quot;&gt;");
    }
}
