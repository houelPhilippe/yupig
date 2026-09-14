# Veille — tableau de bord

Agrégateur de flux RSS/Atom de bureau, en **Rust + Tauri 2**. Reprend le
modèle `modele/Tableau de bord Veille (autonome).html`, jusqu'aux jetons de
son système de design.

Tout est local : la base SQLite, les polices, les articles collectés. Aucune
requête vers un service tiers en dehors des flux que vous ajoutez vous-même.

## Ce que fait la première version

- Ajout d'un fil par simple nom de domaine — le flux est détecté tout seul
  (`<link rel="alternate">`, puis `/feed`, `/rss.xml`, `/atom.xml`…).
- Collecte périodique en tâche de fond (15 min / 1 h / 1 j, au choix), avec
  cache conditionnel HTTP : un flux inchangé ne coûte rien.
- Grille de cartes, filtres **Tous / Non lus / Favoris**, recherche plein
  texte sur l'ensemble des articles collectés.
- Volet de lecture avec passage à l'article suivant, ouverture de la source
  dans le navigateur du système.
- Import / export **OPML**, catégories comprises.
- Raccourcis : `/` recherche, `j` / `k` article suivant / précédent, `Échap`
  ferme le volet.

## Prérequis

| Outil | Version |
|---|---|
| Rust | 1.77 ou plus récent |
| Tauri CLI | `cargo install tauri-cli --version "^2"` |

Dépendances système (Debian / Ubuntu / Pop!\_OS) :

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Aucun Node, aucun `npm install` : le frontend est servi tel quel depuis `src/`.

## Lancer

```bash
cargo tauri dev
```

## Construire un paquet

```bash
cargo tauri build
```

Les icônes macOS (`.icns`) et Windows (`.ico`) ne sont pas versionnées.
Pour les produire avant un paquet destiné à ces plateformes :

```bash
cargo tauri icon src-tauri/icons/icon.png
```

puis rajoutez `icons/icon.icns` et `icons/icon.ico` à `bundle.icon` dans
`src-tauri/tauri.conf.json`.

## Tests

```bash
cargo test   --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Les tests couvrent le noyau non graphique : monogrammes, dédoublonnage des
articles, filtres et recherche (y compris l'échappement des jokers `LIKE`),
portée du « tout marquer comme lu », nettoyage HTML, détection de flux et
aller-retour OPML.

## Organisation

```
modele/     maquette de référence (lecture seule)
src/        frontend — HTML/CSS/JS sans bundler
  index.html
  styles/   tokens.css (extrait du modèle) + app.css (mise en page)
  js/       api.js · store.js · format.js · ui/
src-tauri/  cœur Rust
  src/      lib.rs · db.rs · fetch.rs · models.rs · error.rs · commands/
docs/       ARCHITECTURE.md
```

Le détail des choix techniques est dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
et [`CLAUDE.md`](CLAUDE.md).

## Où vivent les données

| Plateforme | Chemin |
|---|---|
| Linux | `~/.local/share/fr.phl.veille/veille.sqlite3` |
| macOS | `~/Library/Application Support/fr.phl.veille/veille.sqlite3` |
| Windows | `%APPDATA%\fr.phl.veille\veille.sqlite3` |

Supprimer ce fichier remet l'application à neuf ; les quatre fils de départ
sont alors réinstallés au lancement suivant.
