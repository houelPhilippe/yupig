// Pont vers le cœur Rust. Un seul endroit connaît les noms de commandes ;
// le reste du frontend n'appelle que les fonctions exportées ici.

const tauri = globalThis.__TAURI__;

if (!tauri) {
  // Ouvrir index.html dans un navigateur ne peut pas marcher : toute la
  // collecte vit côté Rust. Mieux vaut le dire franchement que d'afficher
  // une page vide.
  document.body.innerHTML =
    '<p style="padding:2rem;font:14px system-ui">Cette page doit être ouverte ' +
    'depuis l’application Veille (<code>cargo tauri dev</code>).</p>';
  throw new Error('API Tauri absente');
}

const invoke = tauri.core.invoke;

export const listen = tauri.event.listen;

// ------------------------------------------------------------------- fils

export const listFeeds = () => invoke('list_feeds');
export const addFeed = (url, cat) => invoke('add_feed', { url, cat: cat ?? null });
export const removeFeed = (id) => invoke('remove_feed', { id });
export const renameFeed = (id, name, cat) => invoke('rename_feed', { id, name, cat });
export const reorderFeeds = (ids) => invoke('reorder_feeds', { ids });

// --------------------------------------------------------------- articles

export const listArticles = (query) => invoke('list_articles', { query });
export const getArticle = (id) => invoke('get_article', { id });
export const setRead = (id, read) => invoke('set_read', { id, read });
export const setFavorite = (id, favorite) => invoke('set_favorite', { id, favorite });
export const markAllRead = (query) => invoke('mark_all_read', { query });
export const getStats = () => invoke('get_stats');

// -------------------------------------------------------------- collecte

export const syncFeed = (id) => invoke('sync_feed', { id });
export const syncAll = (force) => invoke('sync_all', { force: force ?? null });
export const pruneArticles = (keep) => invoke('prune_articles', { keep });

// -------------------------------------------------------------- réglages

export const getSettings = () => invoke('get_settings');
export const saveSettings = (settings) => invoke('save_settings', { settings });

// ----------------------------------------------------------------- projet

export const listProjects = () => invoke('list_projects');
export const createProject = (path, name) => invoke('create_project', { path, name });
export const openProject = (path) => invoke('open_project', { path });
export const forgetProject = (path) => invoke('forget_project', { path });
export const closeProject = () => invoke('close_project');
// `open` : les chemins des dossiers dépliés. On ne descend que dans ceux-là —
// le volet ne dessine pas le contenu d'un dossier fermé, et sur un dossier
// partagé lent, le parcourir quand même coûtait des minutes par actualisation.
export const projectTree = (open) => invoke('project_tree', { open });
export const readDocument = (path) => invoke('read_document', { path });
export const writeDocument = (path, content) => invoke('write_document', { path, content });
// Renommer, dupliquer, effacer : les trois rendent un chemin — le nouveau —
// ou rien. C'est au `store` de recaler ce qui désignait l'ancien.
// Créer : `path` est le dossier — vide pour la racine —, `name` le nom voulu.
export const createFile = (path, name) => invoke('create_file', { path, name });
export const createDir = (path, name) => invoke('create_dir', { path, name });
export const renameFile = (path, name) => invoke('rename_file', { path, name });
export const duplicateFile = (path) => invoke('duplicate_file', { path });
/**
 * Compile un document par Pandoc, d'après les réglages du projet.
 * `format` : `'html'` ou `'pdf'`.
 */
export const compileDocument = (path, format, resources = true) =>
  invoke('compile_document', { path, format, resources });
/** Les documents Markdown d'un dossier du projet, sans ses sous-dossiers. */
export const markdownInDir = (path) => invoke('markdown_in_dir', { path });
/** Les documents du projet selon conf/bibliotheque.yaml : `{ found, missing }`. */
export const markdownInProject = () => invoke('markdown_in_project');
/** Compile le book : un seul PDF pour tout le projet, par son script. */
export const compileBook = () => invoke('compile_book');
/** Quitte l'application ; la question des documents modifiés est déjà posée. */
export const quitApp = () => invoke('quit_app');
/** La commande qui partirait, d'après les champs à l'écran ; rien n'est lancé. */
// `settings` : les champs de Pandoc tels qu'ils sont à l'écran — Rust y choisit
// le modèle, celui de l'accueil compris.
export const pandocPreview = (format, path, settings) =>
  invoke('pandoc_preview', { format, path, settings });
export const deleteFile = (path) => invoke('delete_file', { path });
export const documentOutline = (content) => invoke('document_outline', { content });
export const getProjectSettings = () => invoke('get_project_settings');
export const saveProjectSettings = (settings) => invoke('save_project_settings', { settings });
export const fileLink = (doc, file) => invoke('file_link', { doc, file });
export const readImage = (path) => invoke('read_image', { path });

/**
 * Question fermée — « Supprimer ce fichier ? » —, par la boîte du système.
 *
 * Et non `window.confirm` : la webview de cette application ne montre pas les
 * boîtes du navigateur. L'appel rendait `false` sans que rien ne paraisse à
 * l'écran, si bien que la commande était simplement annulée en silence — on
 * croyait l'application sourde. Le greffon de dialogue, lui, est celui qui
 * ouvre déjà les sélecteurs de fichiers.
 *
 * Rend `true` si l'on a confirmé. `kind` vaut « warning » : ce qui se demande
 * ainsi ne se défait pas.
 */
export async function ask(message, { title, okLabel = 'Supprimer', cancelLabel = 'Annuler' } = {}) {
  return tauri.dialog.ask(message, { title, okLabel, cancelLabel, kind: 'warning' });
}

const IMAGE_FILTER = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'] }];

/** Sélecteur d'image ; `null` si l'utilisateur annule. */
export async function pickImage() {
  return tauri.dialog.open({ multiple: false, filters: IMAGE_FILTER });
}

const DOCUMENT_FILTER = [
  { name: 'Documents', extensions: ['qmd', 'md', 'markdown', 'mdown', 'txt'] },
  { name: 'Tous les fichiers', extensions: ['*'] },
];

/**
 * Sélecteur de fichier à inclure ; `null` si l'utilisateur annule.
 *
 * `from` ouvre le sélecteur là où le fichier a des chances de se trouver — la
 * racine du projet : c'est le seul endroit d'où un lien relatif garde un sens.
 */
export async function pickDocument(from) {
  return tauri.dialog.open({ multiple: false, filters: DOCUMENT_FILTER, defaultPath: from ?? undefined });
}

/**
 * Sélecteur de fichier quelconque, pour la cible d'un lien ; `null` si l'on
 * annule.
 *
 * Sans filtre : un lien peut mener à n'importe quoi — une feuille de calcul, une
 * archive, un PDF —, et une liste d'extensions ne ferait qu'en cacher.
 * `from` ouvre le sélecteur sur le projet, seul endroit d'où un lien relatif
 * garde un sens.
 */
export async function pickAnyFile(from) {
  return tauri.dialog.open({ multiple: false, defaultPath: from ?? undefined });
}

/**
 * Adresse lisible par la webview pour un fichier du disque.
 *
 * Un chemin relatif écrit dans le Markdown se résoudrait contre l'origine de
 * la webview : il faut passer par le protocole `asset`, dont la portée a été
 * ouverte au dossier du projet côté Rust.
 */
export const assetUrl = (path) => tauri.core.convertFileSrc(path);

/**
 * Sélecteur de dossier de projet ; `null` si l'utilisateur annule.
 *
 * Il ne crée pas de dossier : un projet se pose sur un dossier existant, celui
 * où les documents sont déjà — ou celui qu'on vient de créer dans le
 * gestionnaire de fichiers, qui sait le faire mieux que nous.
 */
export async function pickProjectDir() {
  return tauri.dialog.open({ directory: true, multiple: false });
}

/**
 * Sélecteur d'un dossier quelconque — la destination d'une compilation, par
 * exemple ; `null` si l'utilisateur annule. Il s'ouvre sur `from` quand on le
 * connaît.
 */
export async function pickDirectory(from) {
  return tauri.dialog.open({ directory: true, multiple: false, defaultPath: from || undefined });
}

// ------------------------------------------------------------------ OPML

export const importOpml = (path) => invoke('import_opml', { path });
export const exportOpml = (path) => invoke('export_opml', { path });

const OPML_FILTER = [{ name: 'OPML', extensions: ['opml', 'xml'] }];

/** Sélecteur de fichier OPML ; `null` si l'utilisateur annule. */
export async function pickOpmlToOpen() {
  return tauri.dialog.open({ multiple: false, filters: OPML_FILTER });
}

export async function pickOpmlToSave() {
  return tauri.dialog.save({ defaultPath: 'veille.opml', filters: OPML_FILTER });
}

/** Ouvre un lien dans le navigateur du système, jamais dans la webview. */
export async function openExternal(url) {
  if (!url) return;
  return tauri.opener.openUrl(url);
}
