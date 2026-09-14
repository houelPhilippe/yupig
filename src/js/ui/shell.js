// Coque commune aux deux applications : le lanceur, et le basculement entre
// « Veille » et « Édition ».
//
// Les deux corps vivent dans la même page ; on masque celui qui n'est pas à
// l'écran plutôt que de reconstruire le DOM à chaque changement.

import { el, icon, PATH } from './dom.js';
import * as store from '../store.js';

const APPS = [
  {
    id: 'veille',
    name: 'Veille',
    desc: 'Agrégateur de flux RSS/Atom',
    path: PATH.book,
  },
  {
    id: 'edition',
    name: 'Édition',
    desc: 'Rédaction des documents du projet',
    path: PATH.pencil,
  },
];

const button = document.getElementById('launcher-open');
const menu = document.getElementById('launcher-menu');
const brand = document.getElementById('brand');

const bodies = {
  veille: document.getElementById('body-veille'),
  edition: document.getElementById('body-edition'),
};
const tools = {
  veille: document.getElementById('veille-tools'),
  edition: document.getElementById('edition-tools'),
};
const search = document.getElementById('veille-search');

let open = false;

export function render(state) {
  for (const id of Object.keys(bodies)) {
    bodies[id].hidden = state.app !== id;
    tools[id].hidden = state.app !== id;
  }
  search.hidden = state.app !== 'veille';

  const app = APPS.find((a) => a.id === state.app) ?? APPS[0];
  // Porté sur la racine : la feuille de style s'en sert pour caler la tête de
  // la barre sur la largeur du volet propre à chaque application.
  document.documentElement.dataset.app = app.id;
  brand.textContent = app.name.toUpperCase();
  document.title = `${app.name} — Tableau de bord`;
}

export function wire() {
  button.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggle(!open);
  });

  // Un menu qui ne se referme pas au clic à côté est un menu qui gêne.
  document.addEventListener('click', (ev) => {
    if (open && !menu.contains(ev.target)) toggle(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && open) {
      toggle(false);
      button.focus();
    }
  });
}

function toggle(next) {
  open = next;
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open) draw();
}

function draw() {
  menu.replaceChildren(
    ...APPS.map((a) => {
      const current = store.state.app === a.id;
      const item = el(
        'button.launcher__item',
        {
          role: 'menuitem',
          'aria-current': current ? 'true' : null,
          onclick: () => {
            toggle(false);
            store.switchApp(a.id).catch(store.fail);
          },
        },
        el('span.launcher__mark', {}, icon(a.path, { size: 16 })),
        el(
          'span.launcher__text',
          {},
          el('span.launcher__name', {}, a.name),
          el('span.launcher__desc', {}, a.desc),
        ),
      );
      return item;
    }),
  );
}
