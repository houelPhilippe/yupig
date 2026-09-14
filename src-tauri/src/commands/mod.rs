//! Frontière entre le frontend et le cœur Rust.
//!
//! Chaque commande est mince : elle valide, délègue à `db`/`fetch`, et rend un
//! type de `models`. Aucune règle métier ne vit ici.

pub mod articles;
pub mod feeds;
pub mod files;
pub mod opml;
pub mod sync;

pub use articles::*;
pub use feeds::*;
pub use files::*;
pub use opml::*;
pub use sync::*;
