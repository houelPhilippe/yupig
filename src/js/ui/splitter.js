// Poignées de redimensionnement des volets latéraux de l'éditeur.
//
// La largeur vit dans une variable CSS portée par la racine, pas dans un style
// posé sur le volet : `--files-width` sert aussi à caler la tête de la barre du
// haut, si bien que déplacer la poignée réaligne les onglets sans un mot de
// code de plus.
//
// La poignée est posée en absolu par-dessus la bordure du volet : elle
// n'occupe donc aucune place dans la rangée, et ne fausse pas cet alignement.

import { el } from './dom.js';
import * as store from '../store.js';

const HANDLES = [
  {
    id: 'files',
    host: document.getElementById('files-panel'),
    prop: '--files-width',
    setting: 'filesWidth',
    // Le volet gauche grandit vers la droite.
    sense: 1,
  },
  {
    id: 'outline',
    host: document.getElementById('outline-panel'),
    prop: '--outline-width',
    setting: 'outlineWidth',
    // Le volet droit grandit vers la gauche : tirer vers la droite le réduit.
    sense: -1,
  },
];

const MIN = 150;
/** Au-delà, les deux volets mangeraient la zone d'édition. */
const MAX = 560;

let drag = null;
// Dernières largeurs appliquées, pour ne pas réécrire le style à chaque rendu.
let applied = null;

export function render(state) {
  if (state.app !== 'edition') return;

  const { filesWidth, outlineWidth } = state.settings;
  const sig = `${filesWidth}|${outlineWidth}`;
  if (sig === applied) return;
  applied = sig;

  // `0` veut dire « jamais redimensionné » : on laisse alors la feuille de
  // style garder sa largeur calculée.
  for (const [prop, value] of [['--files-width', filesWidth], ['--outline-width', outlineWidth]]) {
    if (value > 0) document.documentElement.style.setProperty(prop, `${value}px`);
    else document.documentElement.style.removeProperty(prop);
  }
}

export function wire() {
  for (const handle of HANDLES) {
    const grip = el('div.resizer', {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': `Redimensionner le volet ${handle.id === 'files' ? 'des fichiers' : 'du sommaire'}`,
      tabindex: '0',
      onpointerdown: (ev) => start(ev, handle, grip),
      // Le clavier déplace la séparation par pas de 16 px.
      onkeydown: (ev) => nudge(ev, handle),
    });
    grip.classList.add(`resizer--${handle.id}`);
    handle.host.append(grip);
    handle.grip = grip;
  }
}

function start(ev, handle, grip) {
  if (ev.button !== 0 && ev.pointerType === 'mouse') return;
  ev.preventDefault();

  drag = {
    handle,
    grip,
    startX: ev.clientX,
    startWidth: handle.host.getBoundingClientRect().width,
  };
  grip.setPointerCapture(ev.pointerId);
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);

  // Pendant le glissement, le curseur ne doit pas changer au survol des textes,
  // ni la sélection s'étendre sous le pointeur.
  document.body.classList.add('is-resizing');
}

function move(ev) {
  if (!drag) return;
  const { handle, startX, startWidth } = drag;
  const width = clamp(startWidth + (ev.clientX - startX) * handle.sense);
  document.documentElement.style.setProperty(handle.prop, `${width}px`);
}

function end(ev) {
  if (!drag) return;
  const { handle, grip } = drag;

  grip.removeEventListener('pointermove', move);
  grip.removeEventListener('pointerup', end);
  grip.removeEventListener('pointercancel', end);
  if (grip.hasPointerCapture(ev.pointerId)) grip.releasePointerCapture(ev.pointerId);
  document.body.classList.remove('is-resizing');
  drag = null;

  save(handle);
}

/** Flèches gauche/droite : la séparation se déplace aussi sans souris. */
function nudge(ev, handle) {
  const step = ev.key === 'ArrowLeft' ? -16 : ev.key === 'ArrowRight' ? 16 : 0;
  if (step === 0) return;
  ev.preventDefault();

  const width = clamp(handle.host.getBoundingClientRect().width + step * handle.sense);
  document.documentElement.style.setProperty(handle.prop, `${width}px`);
  save(handle);
}

function clamp(width) {
  // Jamais plus de la moitié de la fenêtre : la zone d'édition doit rester
  // la plus large, quelle que soit la taille de l'écran.
  const ceiling = Math.min(MAX, Math.round(window.innerWidth / 2));
  return Math.round(Math.max(MIN, Math.min(width, ceiling)));
}

function save(handle) {
  const width = Math.round(handle.host.getBoundingClientRect().width);
  // `applied` est mis à jour d'avance : la largeur est déjà à l'écran, et
  // `render` n'a pas à la réécrire quand les réglages reviennent de Rust.
  const next = { ...store.state.settings, [handle.setting]: width };
  applied = `${next.filesWidth}|${next.outlineWidth}`;
  store.persist({ [handle.setting]: width }).catch(store.fail);
}
