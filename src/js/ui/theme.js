// Thème de l'application : clair, sombre, gris foncé.
//
// Un thème n'est qu'un autre jeu de jetons : `data-theme` posé sur la racine, et
// `tokens.css` redéfinit `--color-bg`, `--color-surface`, `--color-text`, les
// rampes et les ombres. Aucune vue n'a donc à connaître le thème, et rien dans
// la feuille de style de l'application ne porte de couleur en dur.
//
// Le choix vit dans les réglages, donc dans SQLite, comme le reste. Il est en
// outre noté dans le stockage local : la fenêtre s'ouvre alors déjà dans le bon
// thème, au lieu de paraître en clair le temps du premier aller-retour avec
// Rust. La base reste la référence — le stockage local n'est écrit qu'avec elle.

import { el, icon, PATH } from './dom.js';
import * as store from '../store.js';

const THEMES = [
  { id: 'clair', name: 'Clair', desc: 'Le thème du modèle', path: PATH.sun },
  { id: 'sombre', name: 'Sombre', desc: 'Fond presque noir', path: PATH.moon },
  { id: 'gris', name: 'Gris foncé', desc: 'Ardoise, moins tranché', path: PATH.contrast },
];

const KEY = 'theme';

const button = document.getElementById('theme-open');
const menu = document.getElementById('theme-menu');

let open = false;
// Le thème posé sur la racine. Comparer évite de réécrire l'attribut — et donc
// de refaire tout le calcul de style — à chaque rendu.
let applied = null;

/** Le thème demandé, ou celui du modèle si le nom ne dit rien. */
function known(id) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

function apply(id) {
  const theme = known(id);
  if (theme.id === applied) return;
  applied = theme.id;

  document.documentElement.setAttribute('data-theme', theme.id);
  // Le bouton porte le thème en vigueur : on sait d'un coup d'œil où l'on est.
  button.replaceChildren(icon(theme.path, { size: 15 }));

  try {
    localStorage.setItem(KEY, theme.id);
  } catch {
    // Stockage refusé : le thème reste en base, seule l'ouverture clignotera.
  }
}

// Avant tout rendu : la fenêtre s'ouvre dans le thème de la dernière fois.
try {
  apply(localStorage.getItem(KEY));
} catch {
  apply(null);
}

export function render(state) {
  // Tant que les réglages ne sont pas revenus de Rust, on garde ce que le
  // stockage local a dit : les écraser ferait justement le clignotement qu'il
  // sert à éviter.
  if (state.settings.theme) apply(state.settings.theme);
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
    ...THEMES.map((theme) => {
      const current = theme.id === applied;
      return el(
        'button.themer__item',
        {
          role: 'menuitem',
          'aria-current': current ? 'true' : null,
          onclick: () => {
            toggle(false);
            // Le thème est posé sans attendre la base : l'écran ne doit pas
            // dépendre d'un aller-retour pour changer de couleur.
            apply(theme.id);
            store.persist({ theme: theme.id }).catch(store.fail);
          },
        },
        el('span.themer__mark', {}, icon(theme.path, { size: 16 })),
        el(
          'span.themer__text',
          {},
          el('span.themer__name', {}, theme.name),
          el('span.themer__desc', {}, theme.desc),
        ),
      );
    }),
  );
}
