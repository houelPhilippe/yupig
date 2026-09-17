// Point d'entrée : câblage des vues, écoute des événements du cœur Rust.

import * as api from './api.js';
import * as store from './store.js';
import * as header from './ui/header.js';
import * as rail from './ui/rail.js';
import * as panel from './ui/panel.js';
import * as grid from './ui/grid.js';
import * as reader from './ui/reader.js';
import * as shell from './ui/shell.js';
import * as tree from './ui/tree.js';
import * as editor from './ui/editor.js';
import * as outline from './ui/outline.js';
import * as format from './ui/format.js';
import * as splitter from './ui/splitter.js';
import * as project from './ui/project.js';
import * as projects from './ui/projects.js';
import * as find from './ui/find.js';
import * as image from './ui/image.js';
import * as table from './ui/table.js';
import * as code from './ui/code.js';
import * as theme from './ui/theme.js';
import * as menu from './ui/menu.js';
import * as shortcode from './ui/shortcode.js';
import * as anchor from './ui/anchor.js';
import * as link from './ui/link.js';
import * as aside from './ui/aside.js';
import * as frontmatter from './ui/frontmatter.js';
import * as zoom from './ui/zoom.js';
import * as focus from './ui/focus.js';
import * as status from './ui/status.js';
import * as journal from './ui/journal.js';
import * as prompt from './ui/prompt.js';
import * as keys from './ui/keys.js';
import * as listedit from './ui/listedit.js';
import * as clipboard from './ui/clipboard.js';
import * as appmenu from './ui/appmenu.js';
import { icon, PATH } from './ui/dom.js';

// `shell` en tête : il décide quelle application est à l'écran, les vues qui
// suivent se contentent de rendre la leur.
const views = [
  shell, header, rail, panel, grid, reader, tree, editor, find,
  aside, outline, frontmatter, splitter, project, projects, zoom, focus, theme,
  status, journal,
];

store.subscribe((state) => {
  for (const v of views) v.render(state);
  toast(state.notice);
});

function wire() {
  header.wire();
  reader.wire();
  shell.wire();
  appmenu.wire();
  editor.wire();
  format.wire();
  clipboard.wire();
  status.wire();
  journal.wire();
  prompt.wire();
  splitter.wire();
  project.wire();
  projects.wire();
  find.wire();
  image.wire();
  table.wire();
  code.wire();
  listedit.wire();
  theme.wire();
  menu.wire();
  shortcode.wire();
  anchor.wire();
  link.wire();
  aside.wire();
  frontmatter.wire();
  zoom.wire();
  focus.wire();
  // En dernier des vues : `decorate` y écrit les infobulles, et « Focus » vient
  // d'y poser la sienne.
  keys.wire();
  wireEdition();

  document.getElementById('rail-expand').addEventListener('click', () => store.togglePanel(true));
  document.getElementById('panel-collapse').addEventListener('click', () => store.togglePanel(false));

  for (const chip of document.querySelectorAll('.chip[data-filter]')) {
    chip.addEventListener('click', () => store.setFilter(chip.dataset.filter).catch(store.fail));
  }
  document.getElementById('read-all').addEventListener('click', () => store.readAll().catch(store.fail));
  document.getElementById('keyword-clear').addEventListener('click', () => store.setQuery('').catch(store.fail));

  // Ajout d'un fil : la résolution réseau peut prendre quelques secondes,
  // le bouton dit ce qu'il fait pendant ce temps.
  const form = document.getElementById('add-form');
  const input = document.getElementById('new-feed');
  const submit = document.getElementById('add-submit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    submit.disabled = true;
    submit.textContent = 'Recherche…';
    try {
      await store.addFeed(url);
      input.value = '';
    } catch (err) {
      store.fail(err);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Ajouter';
    }
  });

  // Recollecte forcée : plus longue qu'une synchronisation ordinaire, puisque
  // aucun fil ne peut répondre « rien de neuf ». Le bouton le dit et se bloque.
  const resync = document.getElementById('resync-all');
  resync.addEventListener('click', async () => {
    resync.disabled = true;
    resync.textContent = 'Recollecte…';
    try {
      await store.syncAll(true);
    } catch (err) {
      store.fail(err);
    } finally {
      resync.disabled = false;
      resync.textContent = 'Tout recollecter';
    }
  });

  document.getElementById('thumb-seg').addEventListener('change', (e) => {
    if (e.target.name !== 'thumb') return;
    store.persist({ showThumbnails: e.target.value === '1' }).catch(store.fail);
  });

  document.getElementById('reserved-seg').addEventListener('change', (e) => {
    if (e.target.name !== 'reserved') return;
    store.persist({ showReservedTile: e.target.value === '1' }).catch(store.fail);
  });

  document.getElementById('refresh-seg').addEventListener('change', (e) => {
    if (e.target.name !== 'freq') return;
    store.persist({ refreshMinutes: Number(e.target.value) }).catch(store.fail);
  });

  document.getElementById('opml-import').addEventListener('click', async () => {
    try {
      const path = await api.pickOpmlToOpen();
      if (path) {
        await api.importOpml(path);
        await store.refresh();
      }
    } catch (err) {
      store.fail(err);
    }
  });

  document.getElementById('opml-export').addEventListener('click', async () => {
    try {
      const path = await api.pickOpmlToSave();
      if (path) await api.exportOpml(path);
    } catch (err) {
      store.fail(err);
    }
  });

  // Raccourcis : Échap ferme le volet, `/` va au champ de recherche,
  // `j` / `k` parcourent la liste — les gestes attendus d'un lecteur de flux.
  document.addEventListener('keydown', (e) => {
    // Ces gestes appartiennent au lecteur de flux : dans l'éditeur, `k` est
    // une lettre comme une autre.
    if (store.state.app !== 'veille') return;
    const typing = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    if (e.key === 'Escape') {
      if (typing) e.target.blur();
      else store.close();
      return;
    }
    if (typing) return;
    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('search').focus();
    } else if (e.key === 'j') {
      store.next().catch(store.fail);
    } else if (e.key === 'k') {
      previous();
    }
  });
}

/** Boutons de l'application « Édition » : projet et arborescence. */
function wireEdition() {
  // Le bouton n'ouvre plus un dossier mais la boîte des projets : c'est elle
  // qui sait ce qu'est un projet, et elle seule qui peut en créer un.
  const open = document.getElementById('project-open');
  open.append(icon(PATH.folder, { size: 14 }));
  open.addEventListener('click', () => store.openPicker().catch(store.fail));

  const refresh = document.getElementById('project-refresh');
  refresh.append(icon(PATH.refresh, { size: 14 }));
  refresh.addEventListener('click', () => store.refreshTree().catch(store.fail));
}

function previous() {
  const { articles, openId } = store.state;
  if (articles.length === 0) return;
  const i = articles.findIndex((a) => a.id === openId);
  const prev = articles[i < 0 ? articles.length - 1 : (i - 1 + articles.length) % articles.length];
  store.open(prev.id).catch(store.fail);
}

let toastNode = null;
function toast(notice) {
  if (toastNode) {
    toastNode.remove();
    toastNode = null;
  }
  if (!notice) return;

  toastNode = document.createElement('div');
  // Vert ou rouge : le premier regard doit suffire à savoir lequel des deux on
  // lit, sans avoir à en lire la phrase.
  toastNode.className = notice.kind === 'error' ? 'toast toast--error' : 'toast toast--ok';
  toastNode.setAttribute('role', 'status');
  toastNode.textContent = notice.text;
  document.body.append(toastNode);
}

async function start() {
  wire();
  try {
    await store.boot();
  } catch (err) {
    store.fail(err);
  }

  // La collecte de fond signale ses résultats : on redessine sans recharger.
  api.listen('sync:done', () => store.refresh().catch(() => {}));
  api.listen('sync:progress', () => store.refresh().catch(() => {}));

  // « il y a 4 min » vieillit tout seul si personne ne le rafraîchit.
  setInterval(() => store.emit(), 60_000);
}

start();
