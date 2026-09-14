use std::sync::OnceLock;
use std::time::Duration;

use feed_rs::model::{Entry, Feed as ParsedFeed};
use regex::Regex;
use url::Url;

use crate::db::NewArticle;
use crate::error::{Error, Result};

const UA: &str = concat!(
    "Veille/",
    env!("CARGO_PKG_VERSION"),
    " (agrégateur de bureau)"
);

/// Client HTTP unique : le pool de connexions est réutilisé d'une collecte à
/// l'autre, ce qui compte quand on synchronise vingt fils d'affilée.
pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .expect("client HTTP")
    })
}

/// Réponse d'une collecte : `None` en corps signifie 304 Not Modified.
pub struct Fetched {
    pub body: Option<Vec<u8>>,
    pub etag: Option<String>,
    pub modified: Option<String>,
    pub final_url: String,
}

/// Télécharge un flux en cache conditionnel (ETag / Last-Modified).
pub async fn get(url: &str, etag: Option<&str>, modified: Option<&str>) -> Result<Fetched> {
    let mut req = client().get(url).header("Accept", FEED_ACCEPT);
    if let Some(v) = etag {
        req = req.header("If-None-Match", v);
    }
    if let Some(v) = modified {
        req = req.header("If-Modified-Since", v);
    }
    let res = req.send().await?;
    let final_url = res.url().to_string();
    let status = res.status();

    if status == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(Fetched {
            body: None,
            etag: etag.map(str::to_owned),
            modified: modified.map(str::to_owned),
            final_url,
        });
    }
    if !status.is_success() {
        return Err(Error::Other(format!(
            "HTTP {} — {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("réponse inattendue")
        )));
    }

    let header = |name: &str| {
        res.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let etag = header("etag");
    let modified = header("last-modified");
    let body = res.bytes().await?.to_vec();
    Ok(Fetched {
        body: Some(body),
        etag,
        modified,
        final_url,
    })
}

const FEED_ACCEPT: &str =
    "application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5";

/// Résout une adresse saisie par l'utilisateur en URL de flux.
///
/// Le champ du volet « Gérer les fils » accepte aussi bien `exemple.fr` que
/// l'adresse directe du flux : on essaie de parser tel quel, puis on cherche
/// les `<link rel="alternate">` de la page, puis les chemins usuels.
pub async fn discover(input: &str) -> Result<(String, ParsedFeed)> {
    let base = normalize(input)?;

    let direct = get(base.as_str(), None, None).await;
    if let Ok(f) = &direct {
        if let Some(body) = &f.body {
            if let Ok(parsed) = feed_rs::parser::parse(body.as_slice()) {
                return Ok((f.final_url.clone(), parsed));
            }
            // Pas un flux : c'est probablement la page d'accueil du site.
            for cand in links_in_html(&String::from_utf8_lossy(body), &base) {
                if let Ok(parsed) = try_parse(&cand).await {
                    return Ok((cand, parsed));
                }
            }
        }
    }

    for suffix in [
        "/feed",
        "/rss",
        "/rss.xml",
        "/atom.xml",
        "/index.xml",
        "/feed.xml",
    ] {
        if let Ok(cand) = base.join(suffix) {
            if let Ok(parsed) = try_parse(cand.as_str()).await {
                return Ok((cand.to_string(), parsed));
            }
        }
    }

    match direct {
        Err(e) => Err(e),
        Ok(_) => Err(Error::NoFeedFound),
    }
}

async fn try_parse(url: &str) -> Result<ParsedFeed> {
    let f = get(url, None, None).await?;
    let body = f.body.ok_or(Error::NoFeedFound)?;
    Ok(feed_rs::parser::parse(body.as_slice())?)
}

/// Extrait les `<link rel="alternate" type="application/rss+xml" href="…">`.
fn links_in_html(html: &str, base: &Url) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"(?is)<link\b[^>]*>"#).expect("motif <link>"));
    static HREF: OnceLock<Regex> = OnceLock::new();
    let href =
        HREF.get_or_init(|| Regex::new(r#"(?is)href\s*=\s*["']([^"']+)["']"#).expect("motif href"));

    let mut out = Vec::new();
    for m in re.find_iter(html).take(64) {
        let tag = m.as_str();
        let low = tag.to_ascii_lowercase();
        if !low.contains("alternate") {
            continue;
        }
        if !(low.contains("rss+xml") || low.contains("atom+xml")) {
            continue;
        }
        if let Some(c) = href.captures(tag) {
            if let Ok(u) = base.join(&c[1]) {
                out.push(u.to_string());
            }
        }
    }
    out
}

/// Ajoute `https://` si l'utilisateur a saisi un simple nom de domaine.
pub fn normalize(input: &str) -> Result<Url> {
    let s = input.trim();
    if s.is_empty() {
        return Err(Error::Other("adresse vide".into()));
    }
    let with_scheme = if s.contains("://") {
        s.to_string()
    } else {
        format!("https://{s}")
    };
    Ok(Url::parse(&with_scheme)?)
}

/// Adresse telle qu'affichée sous le nom du fil, sans le schéma ni le `/` final.
pub fn display_url(url: &str) -> String {
    url.trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string()
}

/// Convertit les entrées d'un flux parsé en lignes prêtes pour la base.
pub fn to_articles(feed: &ParsedFeed, site: Option<&str>) -> Vec<NewArticle> {
    feed.entries
        .iter()
        .map(|e| entry_to_article(e, site))
        .collect()
}

fn entry_to_article(e: &Entry, site: Option<&str>) -> NewArticle {
    let title = e
        .title
        .as_ref()
        .map(|t| clean(&t.content))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Sans titre".to_string());

    let link = e
        .links
        .iter()
        .find(|l| l.rel.as_deref() != Some("enclosure"))
        .map(|l| l.href.clone())
        .or_else(|| site.map(str::to_owned))
        .unwrap_or_default();

    let content = e
        .content
        .as_ref()
        .and_then(|c| c.body.clone())
        .or_else(|| e.summary.as_ref().map(|s| s.content.clone()))
        .map(|s| clean(&s))
        .unwrap_or_default();

    let excerpt = e
        .summary
        .as_ref()
        .map(|s| clean(&s.content))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| content.clone());

    // Les adresses relatives d'un corps HTML se résolvent contre la page de
    // l'article, à défaut contre le site du fil. Calculée ici, avant que le
    // littéral ci-dessous ne consomme `link`.
    let image = image_of(
        e,
        if link.is_empty() {
            site
        } else {
            Some(link.as_str())
        },
    );

    NewArticle {
        // L'identifiant du flux prime ; à défaut le lien, à défaut le titre —
        // sans quoi chaque collecte rejouerait les mêmes articles.
        guid: if e.id.is_empty() {
            if link.is_empty() {
                title.clone()
            } else {
                link.clone()
            }
        } else {
            e.id.clone()
        },
        title,
        link,
        excerpt: truncate(&excerpt, 320),
        image,
        content,
        author: e.authors.first().map(|a| a.name.clone()),
        published: e.published.or(e.updated).map(|d| d.to_rfc3339()),
    }
}

/// Adresse de l'illustration d'une entrée, s'il y en a une d'exploitable.
///
/// Les flux la déclarent de quatre façons ; on les essaie de la plus explicite
/// à la plus incertaine : `media:thumbnail`, `media:content` de type image,
/// une pièce jointe `enclosure`, puis le premier `<img>` exploitable du corps
/// HTML *ou* du chapeau. `base` sert à résoudre les adresses relatives.
fn image_of(e: &Entry, base: Option<&str>) -> Option<String> {
    let base = base.and_then(|b| Url::parse(b).ok());
    let absolute = |raw: &str| absolutize(raw, base.as_ref());

    for m in &e.media {
        if let Some(u) = m.thumbnails.iter().find_map(|t| absolute(&t.image.uri)) {
            return Some(u);
        }
        for c in &m.content {
            let url = match &c.url {
                Some(u) => u.as_str(),
                None => continue,
            };
            let is_image = match &c.content_type {
                Some(t) => t.to_string().starts_with("image/"),
                None => looks_like_image(url),
            };
            // Une dimension déclarée minuscule trahit un pixel de mesure.
            let too_small = c.width.is_some_and(|w| w < 64) || c.height.is_some_and(|h| h < 64);
            if is_image && !too_small {
                if let Some(u) = absolute(url) {
                    return Some(u);
                }
            }
        }
    }

    let enclosure = e.links.iter().find(|l| {
        l.rel.as_deref() == Some("enclosure")
            && l.media_type
                .as_deref()
                .is_some_and(|t| t.starts_with("image/"))
    });
    if let Some(u) = enclosure.and_then(|l| absolute(&l.href)) {
        return Some(u);
    }

    // Corps et chapeau sont deux sources distinctes, et rien n'oblige un flux à
    // illustrer les deux : d'une entrée à l'autre l'image peut n'être que dans
    // l'un ou que dans l'autre. S'arrêter au corps sous prétexte qu'il existe
    // laissait des cartes au monogramme alors que le flux portait une image.
    [
        e.content.as_ref().and_then(|c| c.body.as_deref()),
        e.summary.as_ref().map(|s| s.content.as_str()),
    ]
    .into_iter()
    .flatten()
    .flat_map(first_img)
    .find_map(|raw| absolute(&raw))
}

/// Les `src` du premier `<img>` rencontré, dans l'ordre du document.
///
/// On en rend plusieurs : le premier peut être un pixel de mesure en `data:`
/// ou une adresse que `absolutize` refuse.
fn first_img(html: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r#"(?is)<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']"#).expect("motif <img>")
    });
    re.captures_iter(html)
        .take(8)
        .map(|c| decode_entities(&c[1]))
        .collect()
}

/// Rend une adresse absolue en `http(s)`, ou rien.
///
/// Écarte au passage les `data:` — inutiles comme vignette — et tout ce qui
/// ne se parse pas : la carte retombe alors sur le monogramme.
fn absolutize(raw: &str, base: Option<&Url>) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let url = match Url::parse(raw) {
        Ok(u) => u,
        Err(url::ParseError::RelativeUrlWithoutBase) => base?.join(raw).ok()?,
        Err(_) => return None,
    };
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}

/// Faute de type MIME déclaré, on juge sur l'extension du chemin.
fn looks_like_image(url: &str) -> bool {
    let path = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .to_ascii_lowercase();
    [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]
        .iter()
        .any(|ext| path.ends_with(ext))
}

/// Retire le balisage et normalise les espaces : les cartes et le volet de
/// lecture affichent du texte, jamais du HTML brut venu d'un flux tiers.
pub fn clean(html: &str) -> String {
    static TAG: OnceLock<Regex> = OnceLock::new();
    let tag = TAG.get_or_init(|| Regex::new(r"(?s)<[^>]*>").expect("motif balise"));
    let text = tag.replace_all(html, " ");
    let text = decode_entities(&text);
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&hellip;", "…")
        .replace("&laquo;", "«")
        .replace("&raquo;", "»")
        .replace("&rsquo;", "’")
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    // On coupe au dernier espace pour ne pas trancher un mot en deux.
    match cut.rfind(' ') {
        Some(i) if i > max / 2 => format!("{}…", &cut[..i]),
        _ => format!("{cut}…"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nettoyage_html() {
        assert_eq!(
            clean("<p>Bonjour <b>le</b>\n monde</p>"),
            "Bonjour le monde"
        );
        assert_eq!(
            clean("caf&eacute;s &amp; th&eacute;s"),
            "caf&eacute;s & th&eacute;s"
        );
        assert_eq!(
            clean("&laquo;&nbsp;sobri&#233;t&#233;&nbsp;&raquo;"),
            "« sobri&#233;t&#233; »"
        );
    }

    #[test]
    fn troncature_sur_mot() {
        let s = "un texte assez long pour etre coupe proprement quelque part";
        let t = truncate(s, 20);
        assert!(t.ends_with('…'));
        assert!(t.len() <= 24);
        assert_eq!(truncate("court", 20), "court");
    }

    #[test]
    fn normalisation_adresse() {
        assert_eq!(
            normalize("exemple.fr").unwrap().as_str(),
            "https://exemple.fr/"
        );
        assert_eq!(
            normalize("http://exemple.fr/rss").unwrap().as_str(),
            "http://exemple.fr/rss"
        );
        assert!(normalize("   ").is_err());
    }

    #[test]
    fn adresse_affichee() {
        assert_eq!(
            display_url("https://actunumerique.fr/rss/"),
            "actunumerique.fr/rss"
        );
    }

    #[test]
    fn illustration_des_entrees() {
        let xml = r#"<?xml version="1.0"?>
            <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
              <channel><title>Actu</title><link>https://ex.fr</link>
                <item><title>A</title><link>https://ex.fr/a</link>
                  <media:thumbnail url="https://img.ex.fr/a.jpg"/></item>
                <item><title>B</title><link>https://ex.fr/b</link>
                  <enclosure url="https://img.ex.fr/b.png" type="image/png" length="9"/></item>
                <item><title>C</title><link>https://ex.fr/sous/c</link>
                  <description>&lt;p&gt;&lt;img src="/vign/c.webp?w=2&amp;amp;h=1"&gt;texte&lt;/p&gt;</description></item>
                <item><title>D</title><link>https://ex.fr/d</link>
                  <description>sans la moindre image</description></item>
              </channel>
            </rss>"#;
        let feed = feed_rs::parser::parse(xml.as_bytes()).unwrap();
        let arts = to_articles(&feed, Some("https://ex.fr"));
        let image = |i: usize| arts[i].image.as_deref();

        assert_eq!(image(0), Some("https://img.ex.fr/a.jpg"), "media:thumbnail");
        assert_eq!(image(1), Some("https://img.ex.fr/b.png"), "enclosure image");
        assert_eq!(
            image(2),
            Some("https://ex.fr/vign/c.webp?w=2&h=1"),
            "premier <img>, adresse relative résolue contre le lien de l'article"
        );
        assert_eq!(
            image(3),
            None,
            "aucune image : la carte gardera le monogramme"
        );
    }

    /// Deux entrées du *même* fil, illustrées de deux façons différentes :
    /// c'est le cas courant qui laissait des vignettes au monogramme alors que
    /// le flux portait bien une image.
    #[test]
    fn illustration_cherchee_dans_les_deux_corps() {
        let xml = r#"<?xml version="1.0"?>
            <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
              <channel><title>Actu</title><link>https://ex.fr</link>
                <item><title>A</title><link>https://ex.fr/a</link>
                  <description>chapeau sans image</description>
                  <content:encoded>&lt;p&gt;&lt;img src="https://img.ex.fr/a.jpg"&gt;corps&lt;/p&gt;</content:encoded></item>
                <item><title>B</title><link>https://ex.fr/b</link>
                  <description>&lt;p&gt;&lt;img src="https://img.ex.fr/b.jpg"&gt;chapeau&lt;/p&gt;</description>
                  <content:encoded>&lt;p&gt;corps sans image&lt;/p&gt;</content:encoded></item>
              </channel>
            </rss>"#;
        let feed = feed_rs::parser::parse(xml.as_bytes()).unwrap();
        let arts = to_articles(&feed, Some("https://ex.fr"));

        assert_eq!(
            arts[0].image.as_deref(),
            Some("https://img.ex.fr/a.jpg"),
            "image dans le corps"
        );
        assert_eq!(
            arts[1].image.as_deref(),
            Some("https://img.ex.fr/b.jpg"),
            "image dans le seul chapeau, alors que le corps existe et n'en a pas"
        );
    }

    #[test]
    fn adresses_dillustration_refusees() {
        let base = Url::parse("https://ex.fr/a/b").unwrap();
        // Un pixel de mesure en `data:` ne fait pas une vignette ; on prend le suivant.
        let srcs = first_img(r#"<img src="data:image/gif;base64,R0lGOD"><img src="../p.jpg">"#);
        assert_eq!(srcs.len(), 2);
        assert_eq!(
            srcs.iter()
                .find_map(|r| absolutize(r, Some(&base)))
                .unwrap(),
            "https://ex.fr/p.jpg"
        );

        assert_eq!(absolutize("  ", Some(&base)), None);
        assert_eq!(absolutize("/x.png", None), None, "relative sans base");
        assert_eq!(absolutize("javascript:alert(1)", Some(&base)), None);
        assert!(looks_like_image("https://ex.fr/photo.JPG?v=2"));
        assert!(!looks_like_image("https://ex.fr/page.html"));
    }

    #[test]
    fn detection_des_liens_alternate() {
        let base = Url::parse("https://exemple.fr/").unwrap();
        let html = r#"
            <link rel="stylesheet" href="/a.css">
            <link rel="alternate" type="application/rss+xml" href="/rss.xml">
            <link rel="alternate" type="application/atom+xml" href="https://autre.fr/atom">
        "#;
        let found = links_in_html(html, &base);
        assert_eq!(
            found,
            vec!["https://exemple.fr/rss.xml", "https://autre.fr/atom"]
        );
    }
}
