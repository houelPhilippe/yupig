// Volet droit de l'éditeur : le sommaire du document affiché.
//
// Les titres viennent de `files::outline` côté Rust — le même code qu'à
// l'enregistrement, pour que le sommaire ne diverge jamais du fichier.

import { el, replace } from './dom.js';
import * as store from '../store.js';
import { goToLine } from './editor.js';

const list = document.getElementById('outline-list');

// Le sommaire ne change qu'au changement d'onglet ou au recalcul, jamais à la
// touche : inutile de le redessiner à chaque rendu.
let seenPath = null;
let seenOutline = null;

export function render(state) {
  if (state.app !== 'edition') return;

  // Le volet droit porte deux contenus : le sommaire se retire quand c'est
  // l'autre qui est demandé. Avant le raccourci ci-dessous, qui ne juge que
  // du contenu de la liste.
  const showing = state.edition.aside === 'outline';
  list.hidden = !showing;
  if (!showing) return;

  const tab = store.activeTab();
  if (tab && tab.path === seenPath && tab.outline === seenOutline) return;
  seenPath = tab?.path ?? null;
  seenOutline = tab?.outline ?? null;

  if (!tab) {
    replace(list, [el('div.hint', {}, 'Aucun document ouvert.')]);
    return;
  }
  if (tab.outline.length === 0) {
    const markdown = /\.(md|markdown|mdown)$/i.test(tab.name);
    replace(list, [
      el(
        'div.hint',
        {},
        markdown
          ? 'Ce document n’a pas encore de titre. Commencez une ligne par « # ».'
          : 'Le sommaire ne se construit que pour les documents Markdown.',
      ),
    ]);
    return;
  }

  replace(
    list,
    tab.outline.map((h) =>
      el(
        'button.outline__item',
        {
          // Le retrait rend la hiérarchie lisible sans numéroter les titres.
          style: `padding-left:${8 + (h.level - 1) * 12}px`,
          'data-level': String(h.level),
          title: `Ligne ${h.line}`,
          onclick: () => goToLine(h.line),
        },
        h.text,
      ),
    ),
  );
}
