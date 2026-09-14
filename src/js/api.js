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

export const openProject = (path) => invoke('open_project', { path });
export const projectTree = () => invoke('project_tree');
export const readDocument = (path) => invoke('read_document', { path });
export const writeDocument = (path, content) => invoke('write_document', { path, content });
export const documentOutline = (content) => invoke('document_outline', { content });
export const getProjectSettings = () => invoke('get_project_settings');
export const saveProjectSettings = (settings) => invoke('save_project_settings', { settings });
export const fileLink = (doc, file) => invoke('file_link', { doc, file });
export const readImage = (path) => invoke('read_image', { path });

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
 * Adresse lisible par la webview pour un fichier du disque.
 *
 * Un chemin relatif écrit dans le Markdown se résoudrait contre l'origine de
 * la webview : il faut passer par le protocole `asset`, dont la portée a été
 * ouverte au dossier du projet côté Rust.
 */
export const assetUrl = (path) => tauri.core.convertFileSrc(path);

/** Sélecteur de dossier de projet ; `null` si l'utilisateur annule. */
export async function pickProjectDir() {
  return tauri.dialog.open({ directory: true, multiple: false });
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
