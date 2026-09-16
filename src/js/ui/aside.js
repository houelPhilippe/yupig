// Tête du volet droit : le sélecteur qui dit lequel de ses deux contenus est
// à l'écran — le sommaire, ou les champs du bloc YAML.
//
// Il ne vit ni dans l'un ni dans l'autre : chacun de ces deux-là ne connaît
// que son propre contenu, et se retire quand `state.edition.aside` ne le
// désigne pas. Le sélecteur, lui, n'appartient qu'au volet.

import * as store from '../store.js';
import { icon, PATH } from './dom.js';

const seg = document.getElementById('aside-seg');

const title = document.getElementById('aside-title');

/** Le pictogramme de chaque moitié, par la valeur qu'elle porte. */
const ICONS = {
  outline: PATH.outline,
  front: PATH.sliders,
};

/** L'intitulé écrit à gauche de la tête, par la même valeur. */
const TITLES = {
  outline: 'Sommaire',
  front: 'Propriétés',
};

export function render(state) {
  if (state.app !== 'edition') return;

  title.textContent = TITLES[state.edition.aside] ?? '';

  for (const input of seg.querySelectorAll('input[name="aside"]')) {
    input.checked = input.value === state.edition.aside;
  }
}

export function wire() {
  // Les deux moitiés ne portent que leur pictogramme. Il est posé ici et non
  // dans `index.html` : le balisage ne dessine pas, et `PATH` est le seul
  // endroit qui tienne les tracés. Le nom, lui, reste dans l'`aria-label` de
  // chaque bouton et dans l'infobulle de son étiquette.
  //
  // « Propriétés » reprend le pictogramme des réglages, le même que l'entrée
  // « Propriétés du document » du menu contextuel : c'est la même chose, et
  // elle doit se reconnaître d'un endroit à l'autre.
  for (const input of seg.querySelectorAll('input[name="aside"]')) {
    input.parentElement.append(icon(ICONS[input.value], { size: 14 }));
  }

  seg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'aside') return;
    store.setAside(ev.target.value);
  });
}
