// État de l'interface et accès aux données.
//
// Un seul objet `state`, un seul point de rendu : les vues s'abonnent, et
// toute mutation passe par une action qui recharge ce qui a changé côté Rust.
// C'est le pendant du `renderVals()` du modèle React.

import * as api from './api.js';

const listeners = new Set();

export const state = {
  feeds: [],
  articles: [],
  stats: { total: 0, unread: 0, favorites: 0, feeds: 0, lastSync: null },
  settings: {
    refreshMinutes: 15, feedPaneOpen: false, showThumbnails: true, showReservedTile: true,
    app: 'edition', projectRoot: null, filesWidth: 0, outlineWidth: 0, journalHeight: 0,
    editorFocus: false, editorZoom: 100,
  },

  // Portée courante — reprend les trois axes du modèle.
  feedId: null,          // null = tous les fils
  filter: 'tous',        // tous | nonlus | favoris
  q: '',

  openId: null,          // article affiché dans le volet de lecture
  openArticle: null,     // sa copie, quand un filtre l'a sorti de la liste
  panelOpen: false,
  syncing: false,
  // Message transitoire, en haut à droite : `{ text, kind }`, où `kind` vaut
  // `ok` — vert, ce qui a abouti — ou `error` — rouge.
  notice: null,

  // Application affichée. Les deux coques vivent dans la même page et le même
  // état : « Édition » écrit des fichiers, « Veille » lit des flux.
  app: 'edition',

  edition: {
    root: null,        // racine du projet, absolue ; null = aucun projet
    tree: [],          // noeuds rendus par `project_tree`
    expanded: [],      // chemins des dossiers dépliés — et les seuls où l'on descend
    // L'arborescence est-elle en cours de lecture ? Sur un dossier partagé
    // lent, elle prend des secondes : le volet doit le dire.
    loading: false,
    tabs: [],          // { path, name, content, saved, outline, past, future, touched, typing }
    activePath: null,
    // Regard porté sur le document : `edit` le texte mis en forme, `view` le
    // rendu en lecture seule, `code` la source Markdown. Un document s'ouvre
    // dans le premier — on vient y écrire, pas lire du Markdown ; un fichier
    // qui n'en est pas retombe de toute façon sur la source.
    mode: 'edit',
    // Ce que montre le volet droit : `outline` le sommaire, `front` les champs
    // du bloc YAML. Les deux vivent dans le même volet et se relaient.
    aside: 'outline',
    // Combien de fois l'on a demandé que l'affichage du document se refasse
    // d'après le Markdown. Un compteur, non un drapeau : les vues comparent la
    // valeur qu'elles ont vue à celle-ci, et n'ont donc rien à remettre à zéro
    // — deux vues qui regardent le même compteur ne se le volent pas.
    redraw: 0,

    // Mise en page, propre au projet ouvert. `spacing` ne porte que ce à quoi
    // l'on a touché : une clé absente veut dire « comme la feuille de style le
    // dit », et c'est `ui/project.js` qui connaît ces valeurs par défaut.
    project: {
      align: 'gauche', lineHeight: 165, spacing: {}, modele: '',
      pandoc: { htmlDest: '', htmlCommand: '', htmlIndexCommand: '', pdfDest: '', pdfCommand: '', docxDest: '', docxCommand: '', bookDest: '', bookFile: '' },
    },
    dialogOpen: false,
    // Les modèles de configuration du projet — les dossiers de `confModele/`.
    // Lus sur le disque quand la boîte des paramètres s'ouvre, comme la liste
    // des projets : un dossier ajouté à la main y paraît sans rien de plus.
    modeles: [],

    // Barre de recherche : ouverte ou non, ce qu'on y cherche, et les trois
    // façons de chercher. Ce qu'elle trouve — le rang de l'occurrence visée et
    // leur nombre — n'est pas ici : cela se recalcule sur le document à chaque
    // rendu, et n'a donc rien d'un état.
    find: {
      open: false,
      query: '',
      replacement: '',
      matchCase: false,
      wholeWord: false,
      regex: false,
    },

    // Les projets connus, tels que Rust les rend : `{ root, name, created,
    // opened, available }`. Ils ne sont chargés que lorsque la boîte s'ouvre —
    // chaque ligne coûte une lecture de disque.
    projects: [],
    // La boîte de choix du projet est-elle à l'écran ?
    picker: false,
  },
};

/** L'onglet affiché, ou `null`. */
export function activeTab() {
  const { tabs, activePath } = state.edition;
  return tabs.find((t) => t.path === activePath) ?? null;
}

/** Un onglet dont le texte s'écarte du dernier enregistrement. */
export function isDirty(tab) {
  return tab.content !== tab.saved;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of listeners) fn(state);
}

/** La portée courante, dans la forme attendue par les commandes Rust. */
export function query() {
  return { feedId: state.feedId, filter: state.filter, q: state.q, limit: 300, offset: 0 };
}

/** Recharge liste, compteurs et fils — l'appel qui suit toute mutation. */
export async function refresh() {
  const [feeds, articles, stats] = await Promise.all([
    api.listFeeds(),
    api.listArticles(query()),
    api.getStats(),
  ]);
  state.feeds = feeds;
  state.articles = articles;
  state.stats = stats;

  // Ouvrir un article le marque comme lu, ce qui le sort aussitôt du filtre
  // « Non lus ». On le garde donc à part pour que le volet ne se referme pas
  // sous les doigts du lecteur ; il disparaît au prochain changement de portée.
  if (state.openId === null) {
    state.openArticle = null;
  } else {
    const inList = articles.find((a) => a.id === state.openId);
    if (inList) {
      state.openArticle = inList;
    } else {
      try {
        state.openArticle = await api.getArticle(state.openId);
      } catch {
        state.openId = null;
        state.openArticle = null;
      }
    }
  }
  emit();
}

export async function boot() {
  state.settings = await api.getSettings();
  state.panelOpen = state.settings.feedPaneOpen;
  // On retrouve la coque qu'on a quittée ; tout ce qui n'est pas « Veille »
  // — une base neuve, une valeur d'une version plus ancienne — ramène à
  // « Édition », qui est l'application.
  state.app = state.settings.app === 'veille' ? 'veille' : 'edition';
  state.edition.root = state.settings.projectRoot ?? null;

  // Le projet retrouvé au lancement peut avoir été déplacé entre-temps ; son
  // absence ne doit pas empêcher l'application de s'ouvrir.
  if (state.edition.root) {
    try {
      state.edition.tree = await api.projectTree(state.edition.expanded);
    } catch (err) {
      state.edition.root = null;
      fail(err);
    }
  }
  state.edition.project = await api.getProjectSettings();

  // La boîte de choix s'ouvre au démarrage qui rend la main à « Édition » :
  // c'est le moment où l'on décide sur quoi l'on travaille. Le lecteur de flux
  // n'a pas à être retardé par une question qui ne le concerne pas.
  if (state.app === 'edition') await openPicker();

  await refresh();
}

// -------------------------------------------------------------- application

export async function switchApp(app) {
  if (state.app === app) return;
  state.app = app;
  // La boîte des projets n'a rien à dire devant « Veille » : elle part avec
  // la coque qu'elle sert.
  if (app !== 'edition') state.edition.picker = false;
  emit();
  // Venir à « Édition » sans projet ouvert, c'est venir en choisir un.
  if (app === 'edition' && !state.edition.root) await openPicker();
  await persist({ app });
}

// ------------------------------------------------------------------ portée

export async function selectFeed(id) {
  state.feedId = state.feedId === id ? null : id;
  state.openId = null;
  await refresh();
}

export async function setFilter(filter) {
  state.filter = filter;
  state.openId = null;
  await refresh();
}

export async function setQuery(q) {
  state.q = q;
  await refresh();
}

export function togglePanel(force) {
  state.panelOpen = force ?? !state.panelOpen;
  emit();
  // Le choix d'affichage se retrouve au prochain lancement.
  persist({ feedPaneOpen: state.panelOpen });
}

// --------------------------------------------------------------- articles

export async function open(id) {
  state.openId = id;
  await api.setRead(id, true);
  await refresh();
}

export function close() {
  state.openId = null;
  state.openArticle = null;
  emit();
}

export function current() {
  return state.openArticle;
}

/** Article suivant dans la liste affichée, en boucle — bouton ↓ du volet. */
export async function next() {
  const list = state.articles;
  if (list.length === 0) return;
  // L'article courant a pu quitter la liste (filtre « Non lus ») : on
  // repart alors du haut plutôt que de ne rien faire.
  const i = list.findIndex((a) => a.id === state.openId);
  await open(list[i < 0 ? 0 : (i + 1) % list.length].id);
}

/** Retrouve un article dans la liste, ou dans le volet de lecture. */
function find(id) {
  return state.articles.find((x) => x.id === id)
    ?? (state.openArticle?.id === id ? state.openArticle : null);
}

export async function toggleRead(id) {
  const a = find(id);
  if (!a) return;
  await api.setRead(id, !a.read);
  await refresh();
}

export async function toggleFavorite(id) {
  const a = find(id);
  if (!a) return;
  await api.setFavorite(id, !a.favorite);
  await refresh();
}

export async function readAll() {
  await api.markAllRead(query());
  await refresh();
}

// ------------------------------------------------------------------- fils

export async function addFeed(url) {
  await api.addFeed(url.trim(), null);
  await refresh();
}

export async function removeFeed(id) {
  await api.removeFeed(id);
  if (state.feedId === id) state.feedId = null;
  await refresh();
}

/** Renomme un fil et, au passage, le range dans une autre catégorie. */
export async function renameFeed(id, name, cat) {
  await api.renameFeed(id, name, cat);
  await refresh();
}

/** `ids` porte l'ordre voulu pour la totalité des fils. */
export async function reorderFeeds(ids) {
  await api.reorderFeeds(ids);
  await refresh();
}

// --------------------------------------------------------------- collecte

/** `force` ignore le cache conditionnel et relit chaque flux en entier. */
export async function syncAll(force = false) {
  if (state.syncing) return;
  state.syncing = true;
  emit();
  try {
    await api.syncAll(force);
  } finally {
    state.syncing = false;
    await refresh();
  }
}

// -------------------------------------------------------------- Édition

// ---------------------------------------------------------------- projets
//
// Un projet est un dossier qui porte un témoin. La base n'en retient que le
// chemin ; le nom se lit sur le disque, si bien qu'un projet déplacé ou
// partagé se présente sous le sien sans que la base ait à le savoir.

/** Ouvre la boîte de choix, après avoir relu la liste. */
export async function openPicker() {
  // La liste se relit à chaque ouverture : un dossier peut avoir disparu ou
  // avoir été renommé depuis la dernière fois.
  try {
    state.edition.projects = await api.listProjects();
  } catch (err) {
    state.edition.projects = [];
    fail(err);
  }
  state.edition.picker = true;
  emit();
}

export function closePicker() {
  state.edition.picker = false;
  emit();
}

/** Y a-t-il un document dont les modifications ne sont pas enregistrées ? */
export function hasUnsaved() {
  return state.edition.tabs.some(isDirty);
}

/** Ouvre un projet déjà constitué, désigné par sa racine. */
export async function chooseProject(root) {
  await adopt(await api.openProject(root));
}

/** Pose un projet neuf sur un dossier existant, et l'ouvre. */
export async function createProject(path, name) {
  await adopt(await api.createProject(path, name));
}

/** Retire un projet de la liste, sans toucher à son dossier. */
export async function forgetProject(root) {
  state.edition.projects = await api.forgetProject(root);
  // Rust a pu retirer le projet ouvert : l'interface doit suivre.
  if (state.edition.root === root) reset();
  emit();
}

/** Referme le projet ouvert et revient au choix. */
export async function closeProject() {
  await api.closeProject();
  reset();
  await openPicker();
}

/**
 * Fait du projet que Rust vient d'ouvrir celui qui est à l'écran.
 *
 * L'arborescence arrive en argument : c'est ce que rendent `open_project` et
 * `create_project`, et la demander une seconde fois relirait le disque pour
 * rien.
 */
async function adopt(tree) {
  reset();
  state.edition.tree = tree;
  // Rust a canonicalisé le chemin : on affiche celui qu'il a retenu, pas
  // celui qu'a rendu le sélecteur.
  state.settings = await api.getSettings();
  state.edition.root = state.settings.projectRoot ?? null;
  // Chaque projet a sa mise en page : celle du précédent ne le suit pas.
  state.edition.project = await api.getProjectSettings();
  state.edition.picker = false;
  emit();
}

/** Ramène l'éditeur à l'état « aucun projet ». */
function reset() {
  // Les onglets appartenaient au projet précédent : ils n'ont plus de sens.
  state.edition.root = null;
  // Rust vient d'oublier la racine : la copie des réglages doit suivre, sans
  // quoi le prochain `persist` la remettrait en base.
  state.settings = { ...state.settings, projectRoot: null };
  state.edition.tree = [];
  state.edition.tabs = [];
  state.edition.activePath = null;
  state.edition.expanded = [];
}

/**
 * Relit l'arborescence, et le dit pendant qu'elle se lit.
 *
 * Un `read_dir` sur un dossier partagé par la machine virtuelle traverse le
 * système de fichiers de l'hôte : même réduite aux dossiers dépliés, la lecture
 * se compte en secondes. Sans le témoin, le bouton « Actualiser » paraissait
 * mort — on cliquait, et rien ne bougeait jusqu'à ce qu'on ait renoncé.
 */
export async function refreshTree() {
  if (!state.edition.root) return;
  state.edition.loading = true;
  emit();
  try {
    state.edition.tree = await api.projectTree(state.edition.expanded);
  } finally {
    state.edition.loading = false;
    emit();
  }
}

/**
 * Déplie ou replie un dossier.
 *
 * Déplier demande son contenu : l'arborescence ne descend que dans ce qui est
 * ouvert, ce dossier-ci n'a donc pas encore d'enfants. Le chevron tourne avant
 * l'aller-retour — c'est le geste qui doit répondre, pas le disque. Replier ne
 * demande rien : ce qui a été lu reste là, et cesse simplement d'être dessiné.
 */
export async function toggleDir(path) {
  const open = state.edition.expanded;
  const i = open.indexOf(path);
  if (i < 0) open.push(path);
  else open.splice(i, 1);
  emit();

  if (i < 0) await refreshTree();
}

/** Ouvre un fichier dans un onglet, ou revient à l'onglet déjà ouvert. */
export async function openDocument(path) {
  const existing = state.edition.tabs.find((t) => t.path === path);
  if (existing) {
    state.edition.activePath = path;
    emit();
    return;
  }
  const doc = await api.readDocument(path);
  state.edition.tabs.push({
    path: doc.path,
    name: doc.name,
    content: doc.content,
    // Ce que contient le disque : la comparaison dit si l'onglet est modifié.
    saved: doc.content,
    outline: doc.outline,
    // L'histoire du document, en Markdown : ce qu'on a défait d'un côté, ce
    // qu'on peut refaire de l'autre, et la date du dernier pas — de quoi
    // savoir si le suivant se joint à lui.
    past: [],
    future: [],
    touched: 0,
    // Le dernier pas était-il une frappe ? Seules deux frappes se regroupent.
    typing: false,
  });
  state.edition.activePath = doc.path;
  emit();
}

export function toggleProjectDialog(open) {
  state.edition.dialogOpen = open ?? !state.edition.dialogOpen;
  emit();
  // La liste des modèles se relit à chaque ouverture, et par où que la boîte
  // s'ouvre — son bouton, le menu de l'application : le dossier a pu changer
  // depuis la dernière fois. Elle ne retarde pas l'ouverture : la boîte est
  // déjà à l'écran, le groupe se garnit quand la réponse arrive.
  if (state.edition.dialogOpen && state.edition.root) loadModeles().catch(fail);
}

/** Les modèles du projet, relus sur le disque. */
export async function loadModeles() {
  state.edition.modeles = await api.listModeles();
  emit();
}

/**
 * Applique un modèle de configuration : ses fichiers recouvrent ceux de
 * `conf/`, et son nom devient celui du projet.
 *
 * Les réglages sont relus plutôt que rapiécés : c'est Rust qui a écrit le nom
 * retenu, et la boîte doit montrer ce que la base porte — non ce qu'on croit y
 * avoir mis.
 */
export async function applyModele(name) {
  const report = await api.applyModele(name);
  state.edition.project = await api.getProjectSettings();
  // `conf/` vient de changer sur le disque, et a pu naître : l'arbre le montre
  // — sans quoi un dossier déplié garderait l'état d'avant.
  state.edition.tree = await api.projectTree(state.edition.expanded);
  emit();
  return report;
}

export async function saveProjectSettings(patch) {
  state.edition.project = await api.saveProjectSettings({ ...state.edition.project, ...patch });
  emit();
}

/**
 * Change un ou plusieurs espacements de la mise en page.
 *
 * Une action à part de `saveProjectSettings` parce que le lot est une table
 * dans la table : la fusion doit se faire sur `spacing` lui-même, sans quoi
 * régler un espacement effacerait tous les autres.
 *
 * Une valeur `null` retire sa clé plutôt que d'écrire un zéro : c'est ainsi
 * qu'un réglage revient à ce que dit la feuille de style, et la base n'en garde
 * alors pas la trace. `patch` à `null` les retire tous — le « Rétablir » de la
 * boîte.
 */
export async function saveProjectSpacing(patch) {
  const spacing = patch === null ? {} : { ...state.edition.project.spacing, ...patch };
  for (const [key, value] of Object.entries(spacing)) {
    if (value === null || value === undefined) delete spacing[key];
  }
  await saveProjectSettings({ spacing });
}

/** Les deux volets de l'éditeur, retirés ou remis. */
export function toggleEditorFocus(force) {
  const editorFocus = force ?? !state.settings.editorFocus;
  state.settings = { ...state.settings, editorFocus };
  emit();
  // Le choix se retrouve au prochain lancement, comme celui du volet des fils.
  persist({ editorFocus }).catch(fail);
}

/**
 * Le zoom de la zone d'édition : posé tout de suite, écrit un peu après.
 *
 * Un cran de molette ne doit pas coûter une écriture en base : l'état change
 * sans attendre — c'est lui que la vue lit — et l'enregistrement suit une fois
 * la molette au repos. Écrire dans `state.settings` plutôt qu'à part est ce
 * qui garde le zoom en place quand un autre réglage part vers Rust, `persist`
 * envoyant toujours l'objet entier.
 */
let zoomWrite;
export function setEditorZoom(editorZoom) {
  if (state.settings.editorZoom === editorZoom) return;
  state.settings = { ...state.settings, editorZoom };
  emit();

  clearTimeout(zoomWrite);
  zoomWrite = setTimeout(() => persist({ editorZoom }).catch(fail), 500);
}

export function setMode(mode) {
  if (state.edition.mode === mode) return;
  state.edition.mode = mode;
  emit();
}

/** Lequel des deux contenus du volet droit est à l'écran. */
export function setAside(aside) {
  if (state.edition.aside === aside) return;
  state.edition.aside = aside;
  emit();
}

/**
 * Demande que l'affichage du document se refasse d'après le Markdown.
 *
 * Le rendu n'est rebâti que lorsqu'il le faut — changer d'onglet ou de mode,
 * ou un Markdown qui bouge ailleurs qu'ici : sans cela, chaque frappe
 * replacerait le curseur au début. Il peut donc s'écarter de la source, le
 * moteur d'édition n'écrivant pas toujours ce que `turndown` en relira ; c'est
 * ce compteur qui permet de le refaire sur demande, sans rien changer à la
 * règle qui l'économise le reste du temps.
 *
 * Ce qui vient d'être saisi doit être rendu au Markdown *avant* d'appeler
 * ceci : le rendu se refait d'après lui, il ne l'inventera pas.
 */
export function redrawDocument() {
  state.edition.redraw += 1;
  emit();
}

// ------------------------------------------------------- rechercher
//
// La barre cherche dans ce que le mode montre : la source en « Code
// Markdown », le texte rendu en « Modifier ». Elle ne sert donc à rien en
// « Voir », qui ne se modifie pas — et l'ouvrir depuis ce mode n'aurait rien à
// remplacer.

/**
 * Le regard réellement porté sur le document actif.
 *
 * `state.edition.mode` est ce qu'on a demandé ; un fichier qui n'est pas du
 * Markdown n'a pourtant que sa source à montrer. Les deux peuvent donc
 * diverger, et c'est celui-ci qui dit ce qui est à l'écran.
 */
export function mode() {
  return isMarkdown(activeTab()) ? state.edition.mode : 'code';
}

/** La recherche a-t-elle une surface où s'exercer ? */
export function canFind() {
  // « Voir » est en lecture seule : il n'y aurait rien à y remplacer.
  return Boolean(activeTab()) && mode() !== 'view';
}

export function toggleFind(open) {
  const next = open ?? !state.edition.find.open;
  if (state.edition.find.open === next) return;
  state.edition.find = { ...state.edition.find, open: next };
  emit();
}

/** Met à jour un ou plusieurs champs de la barre. */
export function setFind(patch) {
  state.edition.find = { ...state.edition.find, ...patch };
  emit();
}

/** Un document dont on sait rendre le Markdown. */
export function isMarkdown(tab) {
  return Boolean(tab) && /\.(md|markdown|mdown)$/i.test(tab.name);
}

export function selectTab(path) {
  state.edition.activePath = path;
  emit();
}

/**
 * Referme un onglet. `force` passe outre les modifications non enregistrées —
 * l'appelant a alors déjà posé la question.
 */
export function closeTab(path, force = false) {
  const tab = state.edition.tabs.find((t) => t.path === path);
  if (!tab) return true;
  if (!force && isDirty(tab)) return false;

  const i = state.edition.tabs.indexOf(tab);
  state.edition.tabs.splice(i, 1);
  if (state.edition.activePath === path) {
    const next = state.edition.tabs[i] ?? state.edition.tabs[i - 1] ?? null;
    state.edition.activePath = next?.path ?? null;
  }
  emit();
  return true;
}

/** Frappe dans la zone d'édition : le texte vit dans l'onglet, pas dans le DOM. */
export function edit(path, content) {
  const tab = state.edition.tabs.find((t) => t.path === path);
  if (!tab || tab.content === content) return;
  remember(tab, content);
  tab.content = content;
  emit();
}

// ------------------------------------------------------------- annuler
//
// L'histoire d'un document est une pile de **Markdown**, et non de gestes :
// c'est la seule vérité du document, et la seule chose que toutes les
// mutations ont en commun. Une frappe, une commande du menu, un collage, un
// champ du bloc YAML, un remplacement — tout passe par `edit`, donc tout
// s'annule, sans qu'aucune commande ait à savoir qu'elle est annulable.
//
// Revenir en arrière, c'est donc réactualiser l'affichage sur un Markdown
// antérieur : le compteur de redessin s'en charge, comme pour le bouton
// « Réactualiser ». Dans la source, le curseur reste où il était ; dans le
// rendu, qui se rebâtit entier, il est perdu comme il l'est à chaque redessin.

/** Au-delà, les plus vieux pas s'effacent : une pile n'est pas une archive. */
const DEPTH = 100;

/** Deux changements plus rapprochés que cela peuvent ne faire qu'un pas. */
const COALESCE = 600;

/**
 * Retient l'état d'avant, sauf si le pas précédent est encore chaud et de la
 * même eau.
 *
 * Trois conditions pour se joindre au pas précédent plutôt que d'en ouvrir un :
 * qu'il existe, que lui aussi soit une frappe, et qu'il soit tout frais. Un
 * changement se dit frappe à sa taille — une lettre, deux au plus ; au-delà,
 * c'est une commande. Sans cette mesure, un tableau inséré dans la foulée d'un
 * mot s'annulerait avec lui, et le premier mot tapé après le tableau ramènerait
 * le tableau avec lui.
 */
function remember(tab, content) {
  // Un pas en arrière puis une frappe : ce qu'on avait défait ne se refait
  // plus, l'histoire vient de repartir ailleurs.
  tab.future.length = 0;

  const now = Date.now();
  const typing = Math.abs(content.length - tab.content.length) <= 2;
  const join = typing && tab.typing && tab.past.length > 0 && now - tab.touched < COALESCE;
  tab.typing = typing;
  if (join) return;

  tab.past.push(tab.content);
  if (tab.past.length > DEPTH) tab.past.shift();
  tab.touched = now;
}

/** Y a-t-il un pas à défaire, à refaire ? Le menu en éteint ses entrées. */
export function canUndo(tab = activeTab()) {
  return Boolean(tab?.past.length);
}

export function canRedo(tab = activeTab()) {
  return Boolean(tab?.future.length);
}

/** Défait le dernier pas. Rend vrai s'il y avait quelque chose à défaire. */
export function undo(path) {
  return step(path, 'past', 'future');
}

export function redo(path) {
  return step(path, 'future', 'past');
}

function step(path, from, to) {
  const tab = state.edition.tabs.find((t) => t.path === path);
  if (!tab?.[from].length) return false;

  tab[to].push(tab.content);
  tab.content = tab[from].pop();
  // La frappe qui suivra ouvre son propre pas : elle n'a rien à voir avec
  // celle qui précédait l'annulation, et les regrouper mêlerait les deux.
  tab.touched = 0;
  tab.typing = false;
  state.edition.redraw += 1;
  emit();
  return true;
}

// ------------------------------------------- opérations sur un fichier
//
// Renommer, dupliquer, effacer : trois gestes qui changent le disque, donc
// l'arborescence, qu'on relit à chaque fois. L'onglet ouvert, lui, ne se relit
// pas — il porte peut-être du texte non enregistré : il suit son fichier
// (`renameFile`) ou s'en va avec lui (`deleteFile`).

/** Renomme un fichier, et l'onglet qui le montrait suit son nouveau nom. */
/**
 * Crée un document Markdown vide dans un dossier — `dir` vide pour la racine —
 * et l'ouvre dans un onglet : on vient d'y écrire, pas de le regarder dans
 * l'arbre.
 *
 * Le dossier se déplie : sans cela le document neuf n'y paraîtrait pas, et
 * l'arbre semblerait n'avoir rien fait.
 */
export async function createFile(dir, name) {
  const path = await api.createFile(dir, name);
  expand(dir);
  await refreshTree();
  await openDocument(path);
  return path;
}

/** Crée un dossier, et le déplie : ce qu'on y met vient juste après. */
export async function createDir(dir, name) {
  const path = await api.createDir(dir, name);
  expand(dir);
  expand(path);
  await refreshTree();
  return path;
}

/** Déplie un dossier de l'arbre, s'il ne l'était pas déjà. */
function expand(dir) {
  if (dir && !state.edition.expanded.includes(dir)) state.edition.expanded.push(dir);
}

export async function renameFile(path, name) {
  const next = await api.renameFile(path, name);
  if (next !== path) {
    const tab = state.edition.tabs.find((t) => t.path === path);
    if (tab) {
      tab.path = next;
      tab.name = next.split('/').pop();
      if (state.edition.activePath === path) state.edition.activePath = next;
    }
  }
  state.edition.tree = await api.projectTree(state.edition.expanded);
  emit();
  return next;
}

/** Copie un fichier à côté de lui-même et rend le chemin de la copie. */
/**
 * Compile un document par Pandoc, en HTML ou en PDF (`format`).
 *
 * Rien ne change dans l'état : la page part hors du projet, le plus souvent,
 * et l'arbre n'a rien à relire. L'action passe quand même par ici, comme toute
 * commande qui touche au disque.
 */
export async function compileDocument(path, format, resources = true) {
  return api.compileDocument(path, format, resources);
}

/** Les documents Markdown d'un dossier, pour une compilation en série. */
export async function markdownInDir(path) {
  return api.markdownInDir(path);
}

/** Les documents de la bibliothèque du projet, pour « Compiler le projet ». */
export async function markdownInProject() {
  return api.markdownInProject();
}

/** Compile le book du projet : un seul PDF, assemblé par le script du projet. */
export async function compileBook() {
  return api.compileBook();
}

/** Quitte l'application. */
export async function quit() {
  return api.quitApp();
}

export async function duplicateFile(path) {
  const next = await api.duplicateFile(path);
  state.edition.tree = await api.projectTree(state.edition.expanded);
  emit();
  return next;
}

/**
 * Efface un fichier, et referme l'onglet qui le montrait.
 *
 * `closeTab` est appelé de force : la question a déjà été posée, et retenir un
 * onglet sur un fichier qui n'existe plus ne mènerait qu'à un enregistrement
 * qui le recréerait.
 */
export async function deleteFile(path) {
  await api.deleteFile(path);
  // L'arborescence **avant** l'onglet : `closeTab` notifie lui-même, et
  // refermer d'abord dessinerait une fois la liste sans le document mais
  // toujours avec son fichier. Relire le disque en premier fait des deux
  // changements un seul — et si cette lecture échouait, on n'aurait pas déjà
  // annoncé une suppression que la liste continuerait de démentir.
  state.edition.tree = await api.projectTree(state.edition.expanded);
  closeTab(path, true);
  emit();
}

/** Sommaire recalculé côté Rust, sur un texte non encore enregistré. */
export async function reoutline(path) {
  const tab = state.edition.tabs.find((t) => t.path === path);
  if (!isMarkdown(tab)) return;
  const outline = await api.documentOutline(tab.content);
  // La frappe a pu continuer pendant l'aller-retour : l'onglet peut avoir
  // disparu, mais son sommaire reste celui du texte qu'on vient d'envoyer.
  if (state.edition.tabs.includes(tab)) {
    tab.outline = outline;
    emit();
  }
}

/**
 * Écrit le document sur le disque, et vérifie qu'il y est bien.
 *
 * `files::write` relit le fichier après l'avoir écrit : comparer ce qui revient
 * à ce qui a été envoyé dit si le disque porte réellement le document. Ce n'est
 * pas la même chose que « l'écriture n'a pas levé d'erreur » — un disque plein,
 * un fichier repris par un autre programme se voient là.
 *
 * La comparaison porte sur ce qui a été envoyé, non sur le contenu courant de
 * l'onglet : on a pu continuer d'écrire pendant l'aller-retour, et ce serait
 * alors une fausse alerte.
 */
export async function saveDocument(path) {
  const tab = state.edition.tabs.find((t) => t.path === path);
  if (!tab) return;

  const sent = tab.content;
  const doc = await api.writeDocument(tab.path, sent);
  tab.saved = doc.content;
  tab.outline = doc.outline;
  emit();

  if (doc.content !== sent) {
    throw new Error(`« ${tab.name} » : le fichier relu ne correspond pas à ce qui a été écrit.`);
  }
}

// --------------------------------------------------------------- réglages

export async function persist(patch) {
  state.settings = await api.saveSettings({ ...state.settings, ...patch });
  emit();
}

// Numéro du dernier message affiché : un minuteur n'efface que le sien. Sans
// cela, celui d'un message déjà chassé par un autre effacerait ce dernier avant
// l'heure.
let noticeTick = 0;

/**
 * Affiche un message transitoire.
 *
 * Une erreur y reste plus longtemps qu'un accusé de réception : la première
 * demande à être lue, le second se contente d'être vu. `ms` prolonge un message
 * qui a plus à dire — le chemin d'une page compilée, ses avertissements.
 */
export function notify(text, kind = 'ok', ms = null) {
  state.notice = { text: String(text), kind };
  emit();

  const mine = ++noticeTick;
  setTimeout(
    () => {
      if (mine !== noticeTick) return;
      state.notice = null;
      emit();
    },
    ms ?? (kind === 'error' ? 6000 : 2500),
  );
}

/** Affiche un message d'erreur transitoire. */
export function fail(err) {
  notify(err?.message ?? err, 'error');
}
