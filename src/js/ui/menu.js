// Menu contextuel : un cadre posé au pointeur, refermé au premier clic à côté.
//
// Il sert les menus faits d'une liste de commandes — l'onglet d'un document,
// une ligne de l'arbre des fichiers, un shortcode du rendu, un lien. Ceux de la mise en
// forme et de l'image gardent le leur : ils portent des rangées de pastilles et
// des entrées à poussoir que ce cadre-ci ne connaît pas.
//
// Un seul menu à la fois, d'où l'unique `menu` de module : en ouvrir un ferme
// celui qui traînait.

import { el, icon, replace } from './dom.js';

let menu = null;

/** Ouvre le menu au pointeur. `items` : ce que fabriquent `item` et compagnie. */
export function open(x, y, items) {
  close();

  menu = el('div.ctx', {
    role: 'menu',
    // Décisif : sans cela, le `mousedown` sur une entrée retirerait le focus à
    // la zone d'édition — et ce qui vient d'y être saisi ne serait pas encore
    // revenu au Markdown au moment où la commande s'exécute.
    onmousedown: (ev) => ev.preventDefault(),
  });
  replace(menu, items.filter(Boolean));

  place(menu, x, y);
}

/**
 * Pose un cadre au pointeur, sans le laisser sortir de la fenêtre.
 *
 * Il est d'abord posé au coin haut-gauche, et non au pointeur : la largeur
 * d'un élément en `position: fixed` se calcule sur la place qui lui reste à
 * droite de son bord gauche. Posé près du bord droit, il replie donc ses
 * colonnes et coupe ses intitulés — et la mesure prise sur ce repli est
 * justement assez étroite pour l'y maintenir au recalage : le menu reste
 * désorganisé, et ce qui déborde par le bas devient hors d'atteinte. Mesuré
 * au large, il garde sa taille pleine et se recale une bonne fois.
 *
 * Le décalage est posé avant l'insertion : sans lui, le cadre s'afficherait un
 * instant en bas de page.
 */
export function place(node, x, y) {
  node.style.left = '0px';
  node.style.top = '0px';
  document.body.append(node);

  // La taille n'est connue qu'une fois dans le document.
  const box = node.getBoundingClientRect();
  node.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
  node.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
}

export function close() {
  menu?.remove();
  menu = null;
}

/** L'intitulé de tête : ce sur quoi porte le menu. */
export function title(text) {
  return el('div.ctx__title', {}, text);
}

export function separator() {
  return el('div.ctx__sep');
}

/**
 * Une commande.
 *
 * Une commande sans objet — enregistrer un document qui ne l'attend pas — est
 * montrée éteinte plutôt que retirée : le menu garde ses places, et l'on y
 * apprend ce qu'il sait faire.
 *
 * `keys` est l'intitulé de sa frappe, tel que `keys.js` l'écrit. Les appelants
 * le tirent de `labelOf` et ne l'écrivent jamais eux-mêmes : la table est le
 * seul endroit qui nomme les raccourcis.
 */
export function item(label, path, run, off = false, keys = '') {
  const mark = el('span.ctx__mark');
  if (path) mark.append(icon(path, { size: 13 }));

  return el(
    'button.ctx__item',
    {
      role: 'menuitem',
      disabled: off || null,
      onclick: () => {
        close();
        run();
      },
    },
    mark,
    el('span', {}, label),
    // La frappe, à droite de l'intitulé : c'est là qu'on l'apprend, et le menu
    // est le seul endroit où elle se lise avec ce qu'elle fait.
    keys ? el('span.ctx__keys', {}, keys) : null,
  );
}

export function wire() {
  // Un clic ailleurs, une touche d'échappement, un redimensionnement : le menu
  // s'en va. Le défilement aussi — posé au niveau du document, il ne suivrait
  // pas la ligne qui l'a ouvert.
  document.addEventListener('mousedown', (ev) => {
    if (menu && !menu.contains(ev.target)) close();
  });
  document.addEventListener('keydown', (ev) => {
    if (menu && ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);
}
