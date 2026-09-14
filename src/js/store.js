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
    app: 'veille', projectRoot: null, filesWidth: 0, outlineWidth: 0,
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
  // état : « Veille » lit des flux, « Édition » écrit des fichiers.
  app: 'veille',

  edition: {
    root: null,        // racine du projet, absolue ; null = aucun projet
    tree: [],          // noeuds rendus par `project_tree`
    expanded: [],      // chemins des dossiers dépliés
    tabs: [],          // { path, name, content, saved, outline }
    activePath: null,
    // Regard porté sur le document : `edit` le texte mis en forme, `view` le
    // rendu en lecture seule, `code` la source Markdown. Un document s'ouvre
    // dans le premier — on vient y écrire, pas lire du Markdown ; un fichier
    // qui n'en est pas retombe de toute façon sur la source.
    mode: 'edit',
    // Ce que montre le volet droit : `outline` le sommaire, `front` les champs
    // du bloc YAML. Les deux vivent dans le même volet et se relaient.
    aside: 'outline',

    // Mise en page, propre au projet ouvert.
    project: { align: 'gauche', lineHeight: 165 },
    dialogOpen: false,
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
  state.app = state.settings.app === 'edition' ? 'edition' : 'veille';
  state.edition.root = state.settings.projectRoot ?? null;

  // Le projet retrouvé au lancement peut avoir été déplacé entre-temps ; son
  // absence ne doit pas empêcher l'application de s'ouvrir.
  if (state.edition.root) {
    try {
      state.edition.tree = await api.projectTree();
    } catch (err) {
      state.edition.root = null;
      fail(err);
    }
  }
  state.edition.project = await api.getProjectSettings();
  await refresh();
}

// -------------------------------------------------------------- application

export async function switchApp(app) {
  if (state.app === app) return;
  state.app = app;
  emit();
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

export async function openProject() {
  const path = await api.pickProjectDir();
  if (!path) return;
  state.edition.tree = await api.openProject(path);
  // Les onglets appartenaient au projet précédent : ils n'ont plus de sens.
  state.edition.tabs = [];
  state.edition.activePath = null;
  state.edition.expanded = [];
  // Rust a canonicalisé le chemin : on affiche celui qu'il a retenu, pas
  // celui qu'a rendu le sélecteur.
  state.settings = await api.getSettings();
  state.edition.root = state.settings.projectRoot ?? path;
  // Chaque projet a sa mise en page : celle du précédent ne le suit pas.
  state.edition.project = await api.getProjectSettings();
  emit();
}

export async function refreshTree() {
  if (!state.edition.root) return;
  state.edition.tree = await api.projectTree();
  emit();
}

export function toggleDir(path) {
  const open = state.edition.expanded;
  const i = open.indexOf(path);
  if (i < 0) open.push(path);
  else open.splice(i, 1);
  emit();
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
  });
  state.edition.activePath = doc.path;
  emit();
}

export function toggleProjectDialog(open) {
  state.edition.dialogOpen = open ?? !state.edition.dialogOpen;
  emit();
}

export async function saveProjectSettings(patch) {
  state.edition.project = await api.saveProjectSettings({ ...state.edition.project, ...patch });
  emit();
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
  tab.content = content;
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
 * demande à être lue, le second se contente d'être vu.
 */
export function notify(text, kind = 'ok') {
  state.notice = { text: String(text), kind };
  emit();

  const mine = ++noticeTick;
  setTimeout(
    () => {
      if (mine !== noticeTick) return;
      state.notice = null;
      emit();
    },
    kind === 'error' ? 6000 : 2500,
  );
}

/** Affiche un message d'erreur transitoire. */
export function fail(err) {
  notify(err?.message ?? err, 'error');
}
