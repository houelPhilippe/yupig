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
projects  (root PRIMARY KEY, opened)
project_settings (root, key, value, PRIMARY KEY (root, key))
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
- `projects` (schéma v4) ne porte que des chemins et une date : le nom d'un
  projet vit dans son dossier, pas ici. Recopier le nom en base le ferait
  mentir le jour où le témoin change. La migration v4 y inscrit le
  `projectRoot` hérité, pour que le dossier ouvert par la version précédente
  ne disparaisse pas de la liste ; son témoin, lui, est posé au démarrage par
  `commands::files::adopt_legacy_root` — écrire sur le disque de
  l'utilisateur n'est pas l'affaire d'une migration de schéma.
- `project_settings` (schéma v3) garde la mise en page de chaque projet, les
  réglages de Pandoc (`pandoc.%`) et le modèle de configuration appliqué
  (`modele`). Elle survit au retrait d'un projet de la liste : la retrouver
  intacte vaut mieux que la ressaisir si le projet revient. Un réglage rendu à
  son défaut — un espacement vidé, un champ Pandoc effacé, un modèle retiré —
  **quitte** la table : une ligne restée là continuerait de couvrir la valeur
  par défaut.

`user_version` porte la version du schéma ; toute évolution ajoute un bloc
dans `Db::migrate`, jamais une modification du bloc existant.

## Projets

Un projet est **un dossier qui porte un témoin** : `.veille/projet.json`, où
vivent son nom, sa date de création et la version du format. Le témoin est dans
le dossier et non en base, pour la même raison que les liens d'images sont
relatifs — un projet copié ou partagé doit rester le même projet ailleurs.

Le partage se lit dans la répartition : ce qui vaut partout va dans le dossier
(le nom), ce qui ne vaut que sur cette machine reste en base (le chemin, la
dernière ouverture, la mise en page).

```
ouverture d'un projet
  ┌─ files::is_project(dir)     le témoin est-il là ? sinon : refus
  ├─ db.remember_project(root)  la liste retient le chemin et l'heure
  ├─ settings.project_root      le projet devient celui qui est ouvert
  ├─ allow_assets(root)         la webview peut lire les images, de ce dossier
  └─ files::tree(root)          l'arborescence part au frontend
```

`create_project` ne diffère que par son premier temps : il **pose** le témoin
au lieu de l'exiger, et refuse un dossier qui en a déjà un — le réécrire
perdrait la date de création sans rien demander. La boîte n'attend pas ce
refus : elle demande d'abord `project_name_at`, dit dès le choix du dossier
qu'il est déjà un projet, et propose alors de l'**ouvrir** — ce qui le remet
dans la liste dont on l'avait retiré. Une interface qui lirait le texte d'une
erreur pour décider de sa conduite se romprait à la première reformulation. Aucune des deux commandes ne
crée de dossier : un projet se pose sur ce qui est déjà là.

`.veille` commence par un point : `files::walk` l'écarte de l'arborescence avec
tous les fichiers cachés, sans avoir à le nommer.

### Modèles de configuration

La compilation lit `conf/` ; un **modèle** est un jeu complet de ces fichiers,
rangé dans `confModele/<nom>/` — dans le projet, donc emporté avec lui.

```
application d'un modèle (modeles::apply)
  ┌─ name_ok(name)            un nom de dossier, jamais un chemin
  ├─ files::resolve(root, …)  confModele/<nom>, et rien qui sorte du projet
  └─ copie récursive → conf/  recouvre ; les liens symboliques ne sont pas suivis
```

Trois règles :

- **Recouvrement, jamais effacement.** Les fichiers du modèle sont copiés au
  même chemin ; ce que `conf/` porte en plus y reste. Un modèle se réapplique
  donc sans perdre ce qu'on y avait ajouté.
- **Copie inconditionnelle**, là où `resources.rs` saute un fichier déjà à
  jour : appliquer un modèle, c'est demander que `conf/` redevienne ce que le
  modèle dit, y compris sur un fichier modifié depuis.
- **Le nom seul est retenu** (`modele`, dans `project_settings`), pas les
  fichiers. La liste, elle, se relit sur le disque à chaque ouverture de la
  boîte des paramètres : c'est le dossier qui décide.

`create_project` fait les deux temps, **avant** `enter` (des dossiers créés
après l'arborescence n'y paraîtraient pas) :

1. `modeles::install` copie le `confModele/` **livré avec l'application**
   (ressource du paquet, `BaseDirectory::Resource`) dans le projet — un modèle
   dont le dossier existe déjà n'est pas recouvert ;
2. `modeles::adopt_default` applique `liseuse` à `conf/`, **sauf** si `conf/`
   porte déjà quelque chose : le dossier adopté peut être un projet réglé de
   longue date.

Ni l'un ni l'autre n'arrête une création : ressources absentes ou `conf/`
garni, le projet se crée.

Les réglages du projet neuf suivent : le modèle appliqué, et les quatre modèles
de commande de Pandoc écrits dans leurs champs vides (`pandoc::fill_commands`)
— ce qui vaudrait par défaut, mais visible et modifiable dans la boîte.

### Renommer, dupliquer, effacer

Les trois gestes passent par `files::resolve` comme la lecture et l'écriture :
le frontend n'envoie qu'un chemin relatif, et rien de ce qui sortirait du
projet ne franchit cette porte. Trois refus s'y ajoutent, chacun pour une
raison qui lui est propre :

| Refus | Pourquoi |
|---|---|
| un dossier | l'effacer emporterait ce qu'il contient sans que la question ait été posée sur chacun |
| un nom qui porte une barre | « Renommer » ne promet pas de déplacer le fichier ailleurs |
| un nom commençant par un point | `walk` écarte les fichiers cachés : le fichier disparaîtrait de l'arbre sans avoir été effacé |

Renommer sur un nom déjà pris est refusé plutôt qu'accepté : `std::fs::rename`
remplacerait le fichier en place sans un mot, et c'est le travail d'un autre
document qui partirait. Dupliquer, à l'inverse, cherche le premier nom libre
lui-même — `note.md`, puis `note (copie).md`, puis `note (copie 2).md` — le
suffixe posé **avant** l'extension, qui dit ce qu'est le fichier.

Les questions posées à l'utilisateur ne passent pas par les boîtes du
navigateur : cette webview ne les montre pas, et `confirm` comme `prompt`
rendent aussitôt `false` ou `null` — la commande est annulée en silence. Une
question fermée passe par `api.ask` (greffon de dialogue, permission
`dialog:allow-ask`), une ligne à saisir par `ui/prompt.js`, boîte de
l'application qui rend une promesse. Chacune des trois commandes qui touchent au
disque pose ensuite son message de compte rendu.

Côté frontend, les quatre commandes du menu — les trois ci-dessus et « Copier
le nom » — vivent dans `ui/fileops.js`, et les deux menus qui les portent, celui
de l'onglet et celui de la ligne de l'arbre, reprennent la même `entries` : un
fichier n'a pas deux jeux de commandes selon l'endroit d'où on le montre. Le
module reste une **feuille** — il ne connaît ni l'éditeur ni l'arbre — et reçoit
de son appelant le `flush` de `ui/editor.js` : renommer change le chemin qui
désigne l'onglet, donc refait l'affichage du document, et ce qui n'est encore
que dans le rendu s'en irait avec l'ancien nom.

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
- Le HTML collé dans le document est du contenu tiers au même titre qu'un flux :
  il ne va jamais tel quel dans le DOM. `ui/clipboard.js` le passe à `turndown`,
  qui n'en garde que ce que le Markdown sait dire, puis à `toFragment`, qui
  assainit la sortie de `marked` comme pour un fichier relu du disque. Ce qui
  entre dans la zone d'édition est donc toujours passé par l'assainisseur.
- Les liens s'ouvrent dans le navigateur du système via `tauri-plugin-opener`,
  jamais dans la webview.
- Deux commandes lancent un programme : la compilation (`pandoc.rs`) et la
  liseuse (`liseuse.rs`). Ni l'une ni l'autre ne reçoit du frontend ce qu'elle
  lance. Pandoc : le modèle est lu en base, son premier mot doit nommer
  `pandoc`, et il est découpé en arguments avant que les variables ne soient
  remplacées. La liseuse : le programme est `cmd` ou `bash`, le script celui du
  projet (`Ouvrir-la-liseuse.bat`, `ouvrir-la-liseuse.sh`) passé par
  `files::resolve`, et le répertoire servi vient des réglages du projet. Aucune
  des deux ne passe par un shell : un nom de fichier ne s'y interprète pas.
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
