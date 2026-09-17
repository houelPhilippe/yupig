// Journal de compilation, en bas de l'écran.
//
// Une compilation copie des ressources puis lance Pandoc : cela prend un
// moment, et ce que Pandoc écrit — un avertissement, une erreur à telle ligne
// — veut être lu en entier, ce qu'un message passager ne permet pas. Le journal
// s'ouvre donc quand la compilation part, reçoit ses lignes à mesure qu'elles
// arrivent de Rust (`compile:log`), et reste ouvert à la fin : on le referme
// quand on l'a lu. Le toast, lui, ne dit que l'issue.
//
// Ses lignes ne passent pas par l'état : elles arrivent par dizaines pendant
// une copie, et les faire transiter par `store.emit` redessinerait tout le
// document à chacune — la même raison qui fait écrire la barre d'état par
// elle-même. Seule sa présence dépend de l'application à l'écran.
//
// Le module est une feuille : il ne connaît ni l'éditeur ni les menus.
// `ui/fileops.js` l'ouvre (`start`), en dit l'avancement (`progress`) et le
// clôt (`finish`).
//
// Une compilation se voit **pendant** qu'elle tourne, par trois repères :
// l'état de la tête, qui compte les secondes et les documents ; une barre
// d'avancement sur le bord haut du journal — la part faite d'une série, un
// trait qui va et vient pour un document seul, dont on ne sait pas la durée ;
// et une pastille dans la barre du haut, qui reste à l'écran quand on a fermé
// le journal ou qu'on est passé à « Veille » — un clic dessus le rouvre.

import { el, icon, PATH } from './dom.js';
import * as api from '../api.js';
import * as store from '../store.js';

const panel = document.getElementById('journal');
const body = document.getElementById('journal-body');
const state = document.getElementById('journal-state');
const closeBtn = document.getElementById('journal-close');
const clearBtn = document.getElementById('journal-clear');
const progressBar = document.getElementById('journal-progress');
const badge = document.getElementById('compile-badge');

/** Les natures de ligne connues : une autre ne doit pas fabriquer de classe. */
const LEVELS = new Set(['step', 'info', 'command', 'output', 'warn', 'error', 'done']);

/** Bornes de la hauteur : de quoi lire trois lignes, sans manger le document. */
const MIN_HEIGHT = 90;
const MAX_SHARE = 0.7;

let open = false;
// Dernière hauteur posée depuis les réglages : `render` ne la réécrit pas à
// chaque passage.
let appliedHeight = null;
let drag = null;
let running = false;
let startedAt = 0;
let edition = true;
// Avancement d'une série : `null` pour un document seul.
let step = null;
let ticker = null;
let badgeText = null;
let spinner = null;

/** Le libellé de l'état, et la classe qui le colore. */
function setState(text, kind) {
  state.textContent = text;
  state.className = `journal__state journal__state--${kind}`;
}

function show() {
  panel.hidden = !(open && edition);
}

/**
 * Ajoute une ligne. Le journal ne suit le bas que si l'on y était déjà : qui
 * remonte lire une ligne ne doit pas s'en voir arraché à la suivante.
 */
function append(level, text) {
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
  const kind = LEVELS.has(level) ? level : 'info';
  body.append(el(`div.journal__line.journal__line--${kind}`, {}, text));
  if (atBottom) body.scrollTop = body.scrollHeight;
}

/**
 * Une compilation part : le journal s'ouvre, vidé de la précédente. `title` est
 * sa première ligne — un document, ou la série d'un dossier.
 */
export function start(title) {
  running = true;
  startedAt = performance.now();
  step = null;
  body.replaceChildren();
  open = true;
  show();
  append('step', title);

  progressBar.hidden = false;
  badge.hidden = false;
  spinner.hidden = false;
  tick();
  clearInterval(ticker);
  ticker = setInterval(tick, 1000);
}

/**
 * Avancement d'une série : `done` documents faits sur `total`. La barre passe
 * d'un trait qui va et vient à une part remplie.
 */
export function progress(done, total) {
  step = { done, total };
  tick();
}

/** Les secondes écoulées depuis le départ. */
function elapsed() {
  return Math.floor((performance.now() - startedAt) / 1000);
}

/** Récrit l'état, la barre et la pastille d'après l'avancement et le temps. */
function tick() {
  const count = step ? ` · ${Math.min(step.done + 1, step.total)}/${step.total}` : '';
  setState(`Compilation en cours${count} · ${elapsed()} s`, 'running');

  const determinate = step !== null && step.total > 0;
  progressBar.classList.toggle('journal__progress--indeterminate', !determinate);
  progressBar.style.setProperty(
    '--progress',
    determinate ? `${Math.round((step.done / step.total) * 100)}%` : '0%',
  );

  // La tête de barre a la largeur du volet des fichiers : la pastille n'y dit
  // que le compte, l'infobulle dit le reste.
  const current = step ? `${Math.min(step.done + 1, step.total)}/${step.total}` : '';
  badgeText.textContent = current;
  badgeText.hidden = !current;
  badge.title = `Compilation en cours${current ? ` — document ${current}` : ''} · ${elapsed()} s — ouvrir le journal`;
}

/** Une ligne écrite par l'interface elle-même — le document suivant d'une série. */
export function note(level, text) {
  append(level, text);
}

/** Est-ce qu'une compilation tourne encore ? */
export function busy() {
  return running;
}

/** La compilation est finie : l'état le dit, et le journal reste ouvert. */
export function finish(ok, text) {
  running = false;
  clearInterval(ticker);
  ticker = null;
  progressBar.hidden = true;
  badge.hidden = true;
  spinner.hidden = true;
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1).replace('.', ',');
  if (text) append(ok ? 'done' : 'error', text);
  append('info', `Durée : ${seconds} s`);
  setState(ok ? 'Terminée' : 'Échec', ok ? 'ok' : 'error');
}

export function render(appState) {
  edition = appState.app === 'edition';
  show();

  // `0` : jamais redimensionné, la feuille de style garde sa hauteur.
  const height = appState.settings.journalHeight ?? 0;
  if (height === appliedHeight) return;
  appliedHeight = height;
  if (height > 0) document.documentElement.style.setProperty('--journal-height', `${clamp(height)}px`);
  else document.documentElement.style.removeProperty('--journal-height');
}

// ------------------------------------------------------------ hauteur
//
// Une poignée couchée sur le bord haut, comme celles des volets latéraux sur
// leur bord : la hauteur vit dans `--journal-height`, sur la racine, et part
// dans les réglages de l'application au lâcher — c'est un confort de lecture,
// le même quel que soit le projet.

function clamp(height) {
  const ceiling = Math.round(window.innerHeight * MAX_SHARE);
  return Math.round(Math.max(MIN_HEIGHT, Math.min(height, ceiling)));
}

function setHeight(height) {
  document.documentElement.style.setProperty('--journal-height', `${clamp(height)}px`);
}

function saveHeight() {
  const height = Math.round(panel.getBoundingClientRect().height);
  // Posée d'avance : la hauteur est déjà à l'écran, `render` n'a pas à la
  // réécrire quand les réglages reviennent de Rust.
  appliedHeight = height;
  store.persist({ journalHeight: height }).catch(store.fail);
}

function startDrag(ev, grip) {
  if (ev.button !== 0 && ev.pointerType === 'mouse') return;
  ev.preventDefault();
  drag = { grip, startY: ev.clientY, startHeight: panel.getBoundingClientRect().height };
  grip.setPointerCapture(ev.pointerId);
  document.body.classList.add('is-resizing-row');
}

function moveDrag(ev) {
  if (!drag) return;
  // Le journal grandit vers le haut : tirer vers le bas le réduit.
  setHeight(drag.startHeight - (ev.clientY - drag.startY));
}

function endDrag(ev) {
  if (!drag) return;
  if (drag.grip.hasPointerCapture(ev.pointerId)) drag.grip.releasePointerCapture(ev.pointerId);
  document.body.classList.remove('is-resizing-row');
  drag = null;
  saveHeight();
}

export function wire() {
  const grip = el('div.resizer.resizer--journal', {
    role: 'separator',
    'aria-orientation': 'horizontal',
    'aria-label': 'Redimensionner le journal de compilation',
    tabindex: '0',
    onpointerdown: (ev) => startDrag(ev, grip),
    onpointermove: moveDrag,
    onpointerup: endDrag,
    onpointercancel: endDrag,
    // Le clavier déplace la séparation par pas de 16 px, comme pour les volets.
    onkeydown: (ev) => {
      const step = ev.key === 'ArrowUp' ? 16 : ev.key === 'ArrowDown' ? -16 : 0;
      if (!step) return;
      ev.preventDefault();
      setHeight(panel.getBoundingClientRect().height + step);
      saveHeight();
    },
  });
  panel.append(grip);

  // La pastille : l'icône de la synchronisation, qui tourne de même, et un
  // compte. Un clic rouvre le journal — et ramène à « Édition », seule
  // application où il se montre.
  badgeText = el('span.compiling__text');
  badge.append(icon(PATH.refresh, { size: 12 }), badgeText);
  badge.addEventListener('click', () => {
    open = true;
    show();
    if (!edition) store.switchApp('edition').catch(store.fail);
  });
  // L'état de la tête porte le même témoin que la pastille.
  spinner = el('span.journal__spinner', { 'aria-hidden': 'true', hidden: true }, icon(PATH.refresh, { size: 11 }));
  state.before(spinner);

  closeBtn.append(icon(PATH.close, { size: 12 }));
  closeBtn.addEventListener('click', () => {
    open = false;
    show();
  });
  clearBtn.addEventListener('click', () => body.replaceChildren());

  // Les lignes arrivent de Rust. Hors compilation il n'y en a pas ; une ligne
  // tardive d'une compilation finie s'ajoute quand même, plutôt que de se
  // perdre.
  api.listen('compile:log', (ev) => {
    const { level, text } = ev.payload ?? {};
    if (typeof text !== 'string') return;
    append(level ?? 'info', text);
  });
}
