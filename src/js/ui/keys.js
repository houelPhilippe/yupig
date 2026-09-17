// Raccourcis clavier : l'écoute, et ce que les boutons en annoncent.
//
// Un seul écouteur, posé sur le document, et une seule table — celle de
// `keys.js`. Le reste de l'application n'a donc rien à savoir du clavier : ni
// les vues, ni les boîtes, qui gardent seulement leurs touches propres — Échap
// pour se fermer, Entrée pour valider, Tabulation dans un tableau ou un bloc de
// code, où elle ne veut pas dire la même chose qu'ailleurs.
//
// **Un raccourci de la barre du haut presse son bouton** au lieu d'appeler la
// fonction qu'il déclenche. C'est ce qui garantit que la touche et le clic
// fassent exactement la même chose, y compris quand le bouton est éteint : un
// bouton désactivé ne reçoit pas de clic, donc le raccourci n'agit pas non plus,
// et il n'y a pas deux conditions à tenir d'accord. Les commandes du document,
// elles, n'ont pas de bouton : elles passent par `format.command`, la même porte
// que les entrées du menu contextuel.
//
// Quelques frappes de la table ne sont pas à nous — couper, copier, coller. La
// table les nomme pour que les menus les annoncent ; c'est le moteur d'édition
// qui les traite, et `ui/clipboard.js` qui décide de ce qu'elles emportent.

import * as store from '../store.js';
import { KEYS, comboOf, match, hint, labelOf } from '../keys.js';
import * as format from './format.js';
import * as find from './find.js';
import { cycleTab } from './editor.js';
import * as appmenu from './appmenu.js';

const rich = document.getElementById('editor-rich');
const area = document.getElementById('editor-area');

/**
 * Une boîte de dialogue est-elle à l'écran ?
 *
 * Tant qu'il y en a une, le clavier lui appartient : elle a ses champs, son
 * Échap et son Entrée. Un raccourci qui agirait derrière elle changerait un
 * document qu'on ne regarde pas.
 */
function busy() {
  return document.querySelector('.modal:not([hidden])') !== null;
}

/**
 * La frappe a-t-elle lieu dans une des deux surfaces d'édition ?
 *
 * Le rendu est interrogé par `contains` et non par égalité : le curseur y vit
 * dans les nœuds du document, pas sur le bloc lui-même.
 */
function editing(target) {
  if (!(target instanceof Node)) return false;
  return target === area || target === rich || rich.contains(target);
}

/** Exécute ce que la frappe désigne. */
function run(key) {
  if (key.button) {
    // Un bouton éteint ne répond pas au clic : le raccourci non plus.
    document.getElementById(key.button)?.click();
    return;
  }

  if (key.id === 'tab.next' || key.id === 'tab.prev') {
    cycleTab(key.id === 'tab.next' ? 1 : -1);
    return;
  }

  // La barre de recherche sait laquelle de ses deux zones prend le clavier, et
  // reprend au passage ce qui est sélectionné dans le document.
  if (key.id === 'app.quit') {
    appmenu.quit().catch(store.fail);
    return;
  }

  if (key.id === 'find' || key.id === 'replace') {
    find.open(key.id === 'find' ? 'query' : 'replacement');
    return;
  }

  // `store.mode()` et non le mode demandé : un fichier qui n'est pas du
  // Markdown n'a que sa source, et c'est sur elle que la commande agit.
  format.command(key.id, store.mode() === 'code');
}

/**
 * Chaque bouton de la barre du haut annonce son raccourci dans son infobulle.
 *
 * Posé ici et non dans `index.html` : la table est le seul endroit qui nomme les
 * frappes, et un intitulé recopié dans le balisage finirait par ne plus lui
 * correspondre.
 *
 * Un bouton qui réécrit son infobulle à chaque rendu — « Focus », qui dit ce que
 * le prochain clic fera — l'annonce lui-même, par le même `hint`. On ne repasse
 * donc pas dessus : sans cette vérification, sa frappe s'y écrirait deux fois,
 * et l'ordre de câblage des vues déciderait de l'infobulle.
 */
function decorate() {
  for (const key of KEYS) {
    if (!key.button) continue;
    const node = document.getElementById(key.button);
    if (!node) continue;

    const base = node.getAttribute('title');
    const keys = labelOf(key.id);
    if (base?.includes(keys)) continue;

    node.setAttribute('title', hint(key.id, base || key.label));
  }
}

export function wire() {
  decorate();

  document.addEventListener('keydown', (ev) => {
    // Une frappe déjà traitée — la tabulation d'un tableau, Entrée dans un bloc
    // de code — ne doit pas l'être deux fois.
    if (ev.defaultPrevented) return;
    if (busy()) return;

    const combo = comboOf(ev);
    if (!combo) return;

    const key = match(combo, store.state.app);
    if (!key) return;
    // La frappe est au moteur d'édition — couper, copier, coller : la table ne
    // la nomme que pour que les menus l'annoncent. La reprendre ici ferait moins
    // bien que lui, et le collage ne se déclenche de toute façon pas.
    if (key.native) return;
    // Une commande du document veut le document sous le curseur.
    if (key.editor && !editing(ev.target)) return;

    ev.preventDefault();
    run(key);
  });
}
