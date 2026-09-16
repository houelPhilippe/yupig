// Volet gauche de l'éditeur : les fichiers et dossiers du projet en cours.
//
// L'arborescence vient entière de Rust ; le volet ne décide que du dépliage.
// Un fichier non éditable (image, binaire) reste visible mais grisé : le
// masquer laisserait croire que le projet ne le contient pas.

import { el, icon, replace, PATH } from './dom.js';
import * as store from '../store.js';
import * as menu from './menu.js';
import * as fileops from './fileops.js';
import { saveTab, flush } from './editor.js';

const list = document.getElementById('files-tree');
const rootLabel = document.getElementById('files-root');
const refreshBtn = document.getElementById('project-refresh');

// Un rendu survient à chaque frappe dans l'éditeur. Rien de ce qui compose
// l'arbre n'en dépend : on saute le travail tant que rien n'a bougé.
let seen = null;
let seenTree = null;

export function render(state) {
  if (state.app !== 'edition') return;
  const { root, tree, expanded, activePath, loading } = state.edition;

  // Avant le raccourci du dessin : le témoin d'activité doit paraître même
  // quand rien de l'arbre n'a encore bougé — c'est justement le moment où l'on
  // attend, et où le bouton semblerait mort sans lui.
  refreshBtn.classList.toggle('is-busy', loading);
  refreshBtn.disabled = loading;

  const sig = `${root}|${expanded.join('\u0000')}|${activePath}`;
  if (sig === seen && tree === seenTree) return;
  seen = sig;
  seenTree = tree;

  if (!root) {
    replace(list, [
      el(
        'div.hint',
        {},
        'Aucun projet ouvert. Le bouton « Projets… » ci-dessus ouvre la liste, ',
        'où l’on choisit un projet ou l’on en crée un sur un dossier existant.',
      ),
    ]);
    rootLabel.textContent = '';
    return;
  }

  const open = new Set(expanded);
  const nodes = tree.flatMap((n) => rows(n, 0, open, activePath));
  replace(
    list,
    nodes.length ? nodes : [el('div.hint', {}, 'Ce dossier ne contient aucun fichier lisible.')],
  );

  // Le chemin complet ne tient pas dans l'en-tête ; il se lit en pied de volet.
  rootLabel.textContent = root;
  rootLabel.title = root;
}

/** Une ligne, suivie de celles de ses enfants si le dossier est déplié. */
function rows(node, depth, open, activePath) {
  const isOpen = open.has(node.path);
  const out = [row(node, depth, isOpen, activePath)];
  if (node.isDir && isOpen) {
    for (const child of node.children) out.push(...rows(child, depth + 1, open, activePath));
  }
  return out;
}

function row(node, depth, isOpen, activePath) {
  const label = el('span.tree__name', {}, node.name);

  const btn = el(
    'button.tree__row',
    {
      title: node.path,
      // L'indentation porte le niveau ; `aria-level` le dit aux lecteurs d'écran.
      style: `padding-left:${6 + depth * 14}px`,
      'aria-level': String(depth + 1),
      'aria-current': node.path === activePath ? 'true' : null,
      onclick: () => {
        if (node.isDir) store.toggleDir(node.path).catch(store.fail);
        else if (node.editable) store.openDocument(node.path).catch(store.fail);
      },
      // Le menu du système n'a rien à proposer ici : on prend la main. Il ne
      // vaut que pour un fichier — un dossier n'a encore rien à offrir.
      oncontextmenu: node.isDir
        ? null
        : (ev) => {
            ev.preventDefault();
            openMenu(node, ev.clientX, ev.clientY);
          },
    },
    el(
      'span.tree__icon',
      {},
      icon(node.isDir ? (isOpen ? PATH.caretDown : PATH.caretRight) : PATH.file, { size: 13 }),
    ),
    label,
  );

  if (node.isDir) {
    btn.classList.add('tree__row--dir');
    btn.setAttribute('aria-expanded', String(isOpen));
  } else if (!node.editable) {
    btn.classList.add('tree__row--inert');
    btn.title = `${node.path} — non éditable`;
  }
  if (node.path === activePath) btn.classList.add('tree__row--active');
  return btn;
}

/**
 * Le menu d'un fichier.
 *
 * « Enregistrer » ne porte que sur un document ouvert et modifié : c'est
 * l'onglet qui tient le texte, l'arbre ne connaît que des noms. Sans onglet
 * correspondant, la commande est montrée éteinte plutôt que retirée — le menu
 * dit ce qu'il sait faire, et pourquoi il ne le fait pas ici.
 */
function openMenu(node, x, y) {
  const tab = store.state.edition.tabs.find((t) => t.path === node.path);

  menu.open(x, y, [
    menu.title(node.name),
    menu.item('Enregistrer', PATH.save, () => saveTab(tab), !tab || !store.isDirty(tab)),
    menu.separator(),
    // Ce qu'on fait du fichier lui-même : les mêmes quatre entrées que dans le
    // menu de l'onglet, et au même endroit — c'est le même fichier.
    ...fileops.entries(node, flush),
  ]);
}
