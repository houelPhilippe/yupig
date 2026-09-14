// Zone d'édition seule : le bouton de la barre du haut qui retire les deux
// volets latéraux de l'éditeur.
//
// Comme le thème, ce n'est qu'un attribut posé sur la racine — `data-focus` —
// dont la feuille de style tire tout le reste : les volets se retirent, et la
// tête de la barre du haut cesse de réserver la largeur du volet gauche, sans
// quoi les onglets resteraient calés sur un volet absent.
//
// Le choix vit dans les réglages, donc dans SQLite : on retrouve l'écran qu'on
// a quitté, comme le volet des fils de « Veille ».

import { icon, PATH } from './dom.js';
import * as store from '../store.js';

const button = document.getElementById('focus-toggle');

// Dernier état posé : comparer évite de refaire l'attribut et l'icône à chaque
// rendu — donc à chaque frappe dans le document.
let applied = null;

export function render(state) {
  if (state.app !== 'edition') return;

  const on = Boolean(state.settings.editorFocus);
  if (on === applied) return;

  // `toggleAttribute` et non `delete …dataset.focus` : un module est en mode
  // strict, et un `delete` que l'objet refuse y lève une exception au lieu de
  // rendre `false`. Elle emportait le reste du rendu — l'attribut restait posé,
  // les volets avec lui, et le bouton paraissait mort.
  document.documentElement.toggleAttribute('data-focus', on);
  draw(on);

  // Après coup : si l'écran n'a pas suivi, l'état noté ne doit pas prétendre
  // le contraire au rendu suivant.
  applied = on;
}

/** Le bouton dans l'état demandé : même pictogramme, l'accent en plus. */
function draw(on) {
  button.setAttribute('aria-pressed', String(on));
  // Le bouton ne porte que son pictogramme : dans une barre déjà chargée, le
  // mot n'apprenait rien que l'infobulle ne dise mieux — elle, elle dit ce que
  // le prochain clic fera. Le nom, lui, reste dans l'`aria-label` de la page :
  // ce n'est pas parce qu'il ne se voit plus qu'il doit cesser de se dire.
  button.title = on ? 'Afficher les volets' : "Masquer les volets — le document seul";
  button.replaceChildren(icon(on ? PATH.contract : PATH.expand, { size: 15 }));
}

export function wire() {
  // L'état de repos est posé d'emblée : le bouton ne doit pas paraître vide le
  // temps que les réglages reviennent de Rust.
  draw(false);
  button.addEventListener('click', () => store.toggleEditorFocus());
}
