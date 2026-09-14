# Architecture

## Vue d'ensemble

```
┌──────────────────────── Fenêtre Tauri ────────────────────────┐
│                                                               │
│  WebView (src/)                     Cœur Rust (src-tauri/)    │
│  ─────────────────                  ──────────────────────    │
│  index.html                         commands/   surface IPC   │
│  js/store.js  ── invoke ──────────▶  db.rs      SQLite        │
│  js/ui/*.js   ◀── event ───────────  fetch.rs   HTTP + parse  │
│                                      models.rs  types partagés│
└───────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
                          ~/.local/share/fr.phl.veille/veille.sqlite3
```

Un seul sens de dépendance : le frontend appelle le cœur, jamais l'inverse.
Le cœur ne pousse que des **événements** (`sync:progress`, `sync:done`) que le
frontend traite comme des invitations à recharger.

## Flux de données

Toute interaction suit le même chemin :

1. une vue déclenche une action de `store.js` ;
2. l'action `invoke` une commande Rust ;
3. la commande écrit dans SQLite et renvoie l'état à jour ;
4. `store.refresh()` recharge fils + articles + compteurs en trois appels
   parallèles, puis notifie ;
5. chaque vue se redessine à partir du seul objet `state`.

Aucune vue ne conserve d'état propre. Le rendu est donc idempotent : appeler
`emit()` deux fois de suite produit exactement le même DOM.

## Modèle de données

```sql
feeds     (id, mono, name, url, feed_url UNIQUE, site_url, cat,
           ok, last_error, last_sync, position, etag, modified)
articles  (id, feed_id →feeds, guid, title, link, excerpt, content, image,
           author, published, fetched, is_read, is_fav,
           UNIQUE (feed_id, guid))
settings  (key, value)
```

- `UNIQUE (feed_id, guid)` porte l'idempotence de la collecte : un
  `INSERT OR IGNORE` rejoue un flux entier sans créer de doublon.
- `guid` retombe sur le lien, puis sur le titre, quand le flux n'en fournit
  pas — sans quoi chaque collecte rejouerait les mêmes articles.
- `mono` est le monogramme de deux lettres du modèle, calculé une fois à
  l'insertion (`db::monogram`) plutôt qu'à chaque rendu.
- `etag` / `modified` portent le cache conditionnel HTTP : un flux inchangé
  répond `304` et ne coûte rien.
- `image` (schéma v2) est l'adresse de l'illustration de l'entrée, telle que
  le flux la déclare — rien n'est téléchargé à la collecte, la webview
  charge la photo au rendu de la carte. `NULL` : la vignette garde le
  monogramme. Un article déjà connu se voit compléter son `image` à la
  collecte suivante, sans compter comme nouveau.

`user_version` porte la version du schéma ; toute évolution ajoute un bloc
dans `Db::migrate`, jamais une modification du bloc existant.

## Collecte

`fetch::discover` résout ce que l'utilisateur saisit :

1. l'adresse telle quelle, si elle parse comme un flux ;
2. sinon les `<link rel="alternate" type="application/rss+xml">` de la page ;
3. sinon les chemins usuels (`/feed`, `/rss.xml`, `/atom.xml`…).

`sync_one` ne renvoie **jamais** d'erreur : l'échec est consigné sur le fil
(`ok = 0`, `last_error`) et porté par le `SyncReport`. C'est ce qui permet à
« Tout synchroniser » de traverser vingt fils dont un est mort.

`fetch::image_of` cherche l'illustration d'une entrée dans cet ordre, du plus
explicite au plus incertain : `media:thumbnail`, `media:content` de type
image, une pièce jointe `enclosure`, puis le premier `<img>` du corps HTML.
Les adresses relatives sont résolues contre le lien de l'article ; seules les
adresses `http(s)` sont retenues (un `data:` ne fait pas une vignette).

Les fils sont synchronisés **en série**. Un agrégateur de bureau n'a pas de
raison d'ouvrir vingt connexions simultanées, et l'ordre séquentiel rend la
progression lisible dans l'en-tête.

## Sécurité

- Le contenu des flux est du HTML tiers : `fetch::clean` retire le balisage
  côté Rust, et le frontend n'écrit que par `textContent`. Aucun `innerHTML`
  ne touche de donnée de flux.
- Une adresse d'image venue d'un flux est la seule donnée tierce qui atteigne
  le DOM autrement que par `textContent`. Elle ne part que dans un `src`
  d'`<img>`, filtrée en `http(s)` côté Rust, avec `referrerpolicy="no-referrer"`
  et un repli sur le monogramme si le chargement échoue.
- La CSP (`tauri.conf.json`) n'ouvre les origines externes que pour `img-src`,
  au strict nécessaire des vignettes : scripts, styles, polices et connexions
  restent locaux. Charger une image révèle l'adresse IP au serveur qui
  l'héberge : le réglage « Vignettes » du volet des fils (`show_thumbnails`)
  supprime le bloc — pas de bloc, pas de requête. C'est pourquoi le volet de
  lecture s'y plie aussi : masquer d'un côté et charger de l'autre viderait
  le levier de son sens.
- Les liens s'ouvrent dans le navigateur du système via `tauri-plugin-opener`,
  jamais dans la webview.
- Les capacités déclarées se limitent à `core:default`, `opener:allow-open-url`
  et les deux permissions de dialogue nécessaires à l'OPML.

## Correspondance avec le modèle

| Modèle (maquette React) | Application |
|---|---|
| `feeds` / `articles` en dur | tables SQLite peuplées par collecte réelle |
| `renderVals()` | `store.js` + `ui/*.js` |
| `state.read` / `state.fav` | colonnes `is_read` / `is_fav` |
| `props.feedPaneOpen`, `showThumbnails`, `showReservedTile` | table `settings` |
| `time: 'il y a 22 min'` (littéral) | `format.relative()` sur la date réelle |
| `p1` / `p2` / `p3` | `content` unique, découpé par `format.paragraphs()` |
