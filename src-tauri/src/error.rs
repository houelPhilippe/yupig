use serde::{Serialize, Serializer};

/// Erreur applicative unique, sérialisable vers le frontend.
///
/// Les commandes Tauri renvoient `Result<T, Error>` ; côté JS l'appel `invoke`
/// rejette alors avec la chaîne produite par `Display`, en français.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("base de données : {0}")]
    Db(#[from] rusqlite::Error),

    #[error("réseau : {0}")]
    Http(#[from] reqwest::Error),

    #[error("flux illisible : {0}")]
    Parse(#[from] feed_rs::parser::ParseFeedError),

    #[error("adresse invalide : {0}")]
    Url(#[from] url::ParseError),

    #[error("entrée/sortie : {0}")]
    Io(#[from] std::io::Error),

    #[error("aucun flux détecté à cette adresse")]
    NoFeedFound,

    #[error("ce fil est déjà suivi")]
    DuplicateFeed,

    #[error("fil introuvable (#{0})")]
    FeedNotFound(i64),

    #[error("article introuvable (#{0})")]
    ArticleNotFound(i64),

    #[error("{0}")]
    Other(String),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<String> for Error {
    fn from(s: String) -> Self {
        Error::Other(s)
    }
}

pub type Result<T> = std::result::Result<T, Error>;
