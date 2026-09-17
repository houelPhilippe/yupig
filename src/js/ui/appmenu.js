// Menu de l'application : le bouton « hamburger » en tête de la barre du haut.
//
// Un menu traditionnel, commun aux deux coques, pour ce qui porte sur le projet
// ou l'application entière plutôt que sur un document : compiler les documents
// de la bibliothèque du projet en HTML, en PDF ou en Word, régler le projet,
// quitter.
//
// Il reprend le cadre de `ui/menu.js` — celui des menus contextuels — posé sous
// le bouton plutôt qu'au pointeur : mêmes entrées, même fermeture au clic à
// côté ou sur Échap, et les frappes écrites à droite d'après `keys.js`.
//
// « Paramètres du projet » presse le bouton du volet des fichiers au lieu
// d'ouvrir la boîte lui-même : c'est la règle des raccourcis de la barre du
// haut, et le menu fait ainsi exactement ce que fait le bouton.

import { icon, PATH } from './dom.js';
import * as store from '../store.js';
import * as api from '../api.js';
import * as menu from './menu.js';
import * as fileops from './fileops.js';
import * as journal from './journal.js';
import { flush } from './editor.js';
import { labelOf } from '../keys.js';

const button = document.getElementById('app-menu');

/** Ouvre le menu sous le bouton, calé sur son bord gauche. */
function openMenu() {
  const noProject = !store.state.edition.root;
  // Une compilation à la fois : les entrées s'éteignent tant qu'une autre tourne.
  const off = noProject || journal.busy();
  const box = button.getBoundingClientRect();
  button.setAttribute('aria-expanded', 'true');

  menu.open(box.left, box.bottom + 4, [
    menu.title('Projet'),
    // Les documents que nomme conf/bibliotheque.yaml, dans les trois formats.
    menu.item('Compiler le projet en HTML', PATH.compile, () => fileops.compileProject('html', flush), off),
    menu.item('Compiler le projet en PDF', PATH.compile, () => fileops.compileProject('pdf', flush), off),
    menu.item('Compiler le projet en Word', PATH.compile, () => fileops.compileProject('docx', flush), off),
    // Le book : un seul PDF, assemblé par le script du projet.
    menu.item('Compiler un book (PDF)', PATH.book, () => fileops.compileBook(flush), off),
    menu.separator(),
    menu.item(
      'Paramètres du projet',
      PATH.sliders,
      () => document.getElementById('project-settings')?.click(),
      noProject,
      labelOf('project.settings'),
    ),
    menu.separator(),
    menu.title('Application'),
    menu.item('Quitter', PATH.power, () => quit().catch(store.fail), false, labelOf('app.quit')),
  ]);
}

/**
 * Quitte l'application.
 *
 * Les documents modifiés font l'objet d'une seule question : quitter sans
 * enregistrer, ou rester. La saisie en cours rejoint d'abord le Markdown, sans
 * quoi les derniers mots tapés ne compteraient pas dans ce qui est modifié.
 */
export async function quit() {
  flush();
  const dirty = store.state.edition.tabs.filter((t) => store.isDirty(t));
  if (dirty.length) {
    const names = dirty.map((t) => `« ${t.name} »`).join(', ');
    const ok = await api.ask(
      `Modifications non enregistrées : ${names}.\n\nQuitter sans les enregistrer ?`,
      { title: 'Quitter', okLabel: 'Quitter sans enregistrer' },
    );
    if (!ok) return;
  }
  await store.quit();
}

/** Le menu est-il à l'écran, et ouvert par ce bouton ? */
function shown() {
  return button.getAttribute('aria-expanded') === 'true' && document.querySelector('.ctx') !== null;
}

export function wire() {
  button.append(icon(PATH.menu, { size: 15 }));

  // Un second clic sur le bouton referme le menu. Il faut le savoir au
  // `mousedown` : `menu.js` referme tout menu sur un `mousedown` à côté de lui
  // — le bouton en est un —, si bien qu'au `click` le menu serait déjà parti
  // et se rouvrirait aussitôt.
  let wasOpen = false;
  button.addEventListener('mousedown', () => {
    wasOpen = shown();
  });
  button.addEventListener('click', () => {
    if (wasOpen) {
      wasOpen = false;
      menu.close();
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    openMenu();
  });

  // Refermé par ailleurs — un clic à côté, Échap, une entrée choisie : le
  // bouton cesse de se dire ouvert.
  const settle = () => {
    if (!document.querySelector('.ctx')) button.setAttribute('aria-expanded', 'false');
  };
  document.addEventListener('click', settle);
  document.addEventListener('keyup', settle);
}
