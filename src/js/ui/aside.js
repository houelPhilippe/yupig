// Tête du volet droit : le sélecteur qui dit lequel de ses deux contenus est
// à l'écran — le sommaire, ou les champs du bloc YAML.
//
// Il ne vit ni dans l'un ni dans l'autre : chacun de ces deux-là ne connaît
// que son propre contenu, et se retire quand `state.edition.aside` ne le
// désigne pas. Le sélecteur, lui, n'appartient qu'au volet.

import * as store from '../store.js';

const seg = document.getElementById('aside-seg');

export function render(state) {
  if (state.app !== 'edition') return;

  for (const input of seg.querySelectorAll('input[name="aside"]')) {
    input.checked = input.value === state.edition.aside;
  }
}

export function wire() {
  seg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'aside') return;
    store.setAside(ev.target.value);
  });
}
