use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Un fil suivi. `mono` est le monogramme de deux lettres affiché dans le rail
/// latéral et sur la vignette des cartes — il reprend le gabarit du modèle.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub id: i64,
    pub mono: String,
    pub name: String,
    /// Adresse affichée (sans le schéma), telle qu'elle apparaît sous le nom.
    pub url: String,
    /// Adresse réellement interrogée, schéma compris.
    pub feed_url: String,
    /// Page d'accueil du site, si le flux la déclare.
    pub site_url: Option<String>,
    pub cat: String,
    /// `false` dès qu'une collecte a échoué : la pastille « 404 » du modèle.
    pub ok: bool,
    pub last_error: Option<String>,
    pub last_sync: Option<String>,
    pub position: i64,
    pub unread: i64,
    pub total: i64,
}

/// Un article collecté. Les champs `p1`/`p2`/`p3` du modèle sont remplacés par
/// un `content` unique : le volet de lecture découpe lui-même les paragraphes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Article {
    pub id: i64,
    pub feed_id: i64,
    pub feed_name: String,
    pub feed_mono: String,
    pub title: String,
    pub link: String,
    pub excerpt: String,
    pub content: String,
    /// Adresse de l'illustration portée par l'entrée du flux, si elle en a une.
    /// `None` : la carte retombe sur le monogramme du fil.
    pub image: Option<String>,
    pub author: Option<String>,
    /// ISO-8601 UTC ; le frontend produit « il y a 22 min » à partir de là.
    pub published: Option<String>,
    pub fetched: String,
    pub read: bool,
    pub favorite: bool,
}

/// Portée demandée par le tableau : quel fil, quel filtre, quel mot-clé.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleQuery {
    /// `None` = tous les fils.
    #[serde(default)]
    pub feed_id: Option<i64>,
    /// `tous` | `nonlus` | `favoris`
    #[serde(default = "default_filter")]
    pub filter: String,
    #[serde(default)]
    pub q: String,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_filter() -> String {
    "tous".into()
}
fn default_limit() -> i64 {
    200
}

impl Default for ArticleQuery {
    fn default() -> Self {
        Self {
            feed_id: None,
            filter: default_filter(),
            q: String::new(),
            limit: default_limit(),
            offset: 0,
        }
    }
}

/// Compteurs de l'en-tête : « Tous · 8 », « Non lus · 6 », « Favoris · 1 ».
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: i64,
    pub unread: i64,
    pub favorites: i64,
    pub feeds: i64,
    pub last_sync: Option<String>,
}

/// Résultat d'une collecte, par fil.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub feed_id: i64,
    pub feed_name: String,
    pub added: usize,
    pub ok: bool,
    pub error: Option<String>,
}

/// Un noeud de l'arborescence du projet. `path` est relatif à la racine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// Faux pour une image ou un binaire : l'arbre le montre, grisé.
    pub editable: bool,
    pub children: Vec<Node>,
}

/// Un titre du sommaire. `line` compte depuis 1 : le clic y porte le curseur.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub line: usize,
}

/// Un document ouvert dans un onglet de l'éditeur.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub path: String,
    pub name: String,
    pub content: String,
    /// Vide hors Markdown : le volet de droite affiche alors son invite.
    pub outline: Vec<Heading>,
}

/// Une image du projet, prête à partir dans le presse-papiers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub mime: String,
    pub base64: String,
}

/// Réglages de mise en page propres à un projet.
///
/// Ils accompagnent le dossier ouvert, pas l'application : deux projets
/// peuvent demander deux mises en page différentes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    /// Alignement des paragraphes : `gauche` ou `justifie`.
    #[serde(default = "default_align")]
    pub align: String,
    /// Interligne en centièmes — 165 vaut 1,65. Un entier reste lisible dans
    /// une table clé/valeur et évite les aléas de la virgule flottante.
    #[serde(default = "default_line_height")]
    pub line_height: i64,
    /// Liseré rouge autour de la zone d'édition quand elle a le clavier.
    /// Affiché par défaut : c'est lui qui dit où va la frappe.
    #[serde(default = "default_outline")]
    pub show_outline: bool,
    /// Espacements de la mise en page : ce qui s'aère au-dessus et au-dessous
    /// de chaque sorte de bloc — titres, paragraphes, listes, shortcodes,
    /// images, tableaux. En pixels à 100 % de zoom ; le zoom du document les
    /// multiplie comme il multiplie le texte.
    ///
    /// Une table plutôt que trente champs : le vocabulaire — quelles clés
    /// existent, comment elles se nomment à l'écran et quelle variable CSS
    /// elles portent — vit côté frontend, seul endroit qui en fasse quelque
    /// chose. Ici on ne garde que la forme : un nom simple, une valeur bornée.
    /// Ce qu'une version plus ancienne ou plus neuve y aura mis survit donc
    /// intact, sans rien à migrer.
    ///
    /// Vide veut dire « comme la feuille de style le dit » : les valeurs par
    /// défaut ne sont pas recopiées ici.
    #[serde(default)]
    pub spacing: BTreeMap<String, i64>,
}

/// Bornes d'un espacement, en pixels. Au-delà, ce n'est plus une mise en page
/// mais une page blanche ; en deçà de zéro, rien de représentable.
pub const SPACING_MAX: i64 = 200;

/// Un nom d'espacement acceptable : des lettres et des chiffres, pas plus.
///
/// Le frontend en fait un nom de variable CSS. Rien d'autre n'y a sa place —
/// et `setProperty` refuserait de toute façon un nom mal formé, ce qui ferait
/// disparaître un réglage sans le dire plutôt que de l'écrire de travers.
pub fn spacing_key_ok(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 40
        && key.chars().all(|c| c.is_ascii_alphanumeric())
}

fn default_align() -> String {
    "gauche".into()
}
fn default_line_height() -> i64 {
    165
}
fn default_outline() -> bool {
    true
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            align: default_align(),
            line_height: default_line_height(),
            show_outline: default_outline(),
            // Vide : la feuille de style porte les valeurs par défaut, et rien
            // ne s'écrit en base tant qu'on n'y a pas touché.
            spacing: BTreeMap::new(),
        }
    }
}

/// Réglages persistés (table `settings`, clé/valeur).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Minutes entre deux collectes automatiques : 15, 60 ou 1440.
    pub refresh_minutes: i64,
    pub feed_pane_open: bool,
    pub show_thumbnails: bool,
    pub show_reserved_tile: bool,
    /// Application affichée au lancement : `veille` ou `edition`.
    #[serde(default = "default_app")]
    pub app: String,
    /// Racine du projet de l'éditeur, absolue. `None` tant qu'aucun dossier
    /// n'a été ouvert — le volet gauche affiche alors son invite.
    #[serde(default)]
    pub project_root: Option<String>,
    /// Largeurs des volets de l'éditeur, en pixels. `0` signifie « jamais
    /// redimensionné » : la feuille de style garde alors sa largeur calculée.
    #[serde(default)]
    pub files_width: i64,
    #[serde(default)]
    pub outline_width: i64,
    /// Zone d'édition seule : les deux volets latéraux de l'éditeur retirés,
    /// pour n'avoir sous les yeux que le document.
    #[serde(default)]
    pub editor_focus: bool,
    /// Zoom de la zone d'édition, en pour cent — 100 est la taille du modèle.
    /// C'est un confort de lecture, propre à la personne et non au dossier
    /// ouvert : il vit donc ici, et non dans les réglages du projet.
    #[serde(default = "default_zoom")]
    pub editor_zoom: i64,
    /// Thème de l'interface : `clair`, `sombre` ou `gris`. Le frontend pose le
    /// nom tel quel dans `data-theme` et retombe sur `clair` s'il ne le
    /// connaît pas — rien à valider ici.
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_app() -> String {
    "veille".into()
}

fn default_theme() -> String {
    "clair".into()
}

fn default_zoom() -> i64 {
    100
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            refresh_minutes: 15,
            feed_pane_open: false,
            show_thumbnails: true,
            show_reserved_tile: true,
            app: "veille".into(),
            project_root: None,
            files_width: 0,
            outline_width: 0,
            editor_focus: false,
            editor_zoom: default_zoom(),
            theme: default_theme(),
        }
    }
}

/// Un projet : un dossier que l'application tient pour sien.
///
/// Le nom et la date de création viennent du fichier témoin posé dans le
/// dossier ; la date de dernière ouverture, elle, vient de la base — c'est un
/// fait propre à cette machine, il n'a rien à faire dans un dossier partagé.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// Racine absolue, telle que Rust l'a canonicalisée.
    pub root: String,
    /// Nom lu dans le témoin ; à défaut, celui du dossier.
    pub name: String,
    /// ISO-8601 UTC, lue dans le témoin. `None` si le témoin est illisible.
    pub created: Option<String>,
    /// Dernière ouverture sur cette machine, ISO-8601 UTC.
    pub opened: Option<String>,
    /// `false` quand le dossier a disparu ou n'est plus un projet. La liste le
    /// montre quand même, en retrait : on doit pouvoir le retirer.
    pub available: bool,
}

/// Le contenu du fichier témoin `.veille/projet.json`.
///
/// Il ne porte que ce qui a un sens partout où le dossier est copié. Tout ce
/// qui ne vaut que pour cette machine — chemin, dernière ouverture, mise en
/// page — reste en base.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub name: String,
    /// ISO-8601 UTC.
    pub created: String,
    /// Version du format du témoin, pour qu'une évolution puisse se lire.
    #[serde(default = "default_marker_version")]
    pub version: i64,
}

fn default_marker_version() -> i64 {
    1
}
