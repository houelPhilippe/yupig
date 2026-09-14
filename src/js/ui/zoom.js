// Zoom de la zone d'édition : les deux crans de la barre du haut, et
// Ctrl + molette sur le document lui-même.
//
// Le zoom n'est qu'un multiplicateur, `--doc-zoom`, posé sur la racine : la
// feuille de style en tire la taille de base du rendu comme de la source, et
// tout ce qu'ils portent à l'intérieur se dit en `em` pour la suivre. C'est
// donc la *taille du texte* qui change, non l'échelle de la page — les volets,
// la barre du haut et le mobilier de l'éditeur gardent la leur, et une image
// donnée à 90 % de la colonne reste à 90 % de la colonne.
//
// La valeur vit dans les réglages de l'application, non dans ceux du projet :
// c'est un confort de lecture, le même quel que soit le dossier ouvert.

import { icon, PATH } from './dom.js';
import * as store from '../store.js';

const MIN = 50;
const MAX = 250;
const STEP = 10;
/** La taille du modèle : celle où le clic sur la valeur ramène. */
const BASE = 100;

/**
 * Ce qu'il faut accumuler de molette pour valoir un cran.
 *
 * Un cran de molette et un glissement de pavé tactile n'envoient pas du tout
 * les mêmes quantités : on accumule donc, et l'on ne bouge que d'un cran à la
 * fois, quelle que soit l'ampleur de l'événement.
 */
const NOTCH = 40;

const surface = document.getElementById('editor');
const out = document.getElementById('zoom-out');
const level = document.getElementById('zoom-level');
const into = document.getElementById('zoom-in');

// Dernière valeur posée : comparer évite de réécrire la variable — et donc de
// refaire tout le calcul de style — à chaque rendu.
let applied = null;
let wheel = 0;

/** La valeur demandée, ramenée dans les bornes — et à la taille du modèle
 *  si le réglage relu n'est pas un nombre. */
function clamp(zoom) {
  const n = Math.round(Number(zoom) || BASE);
  return Math.max(MIN, Math.min(MAX, n));
}

export function render(state) {
  if (state.app !== 'edition') return;

  const zoom = clamp(state.settings.editorZoom);
  if (zoom === applied) return;
  applied = zoom;

  document.documentElement.style.setProperty('--doc-zoom', String(zoom / 100));
  // Espace fine insécable avant le signe, comme le veut l'usage français.
  level.textContent = `${zoom}\u202f%`;
  level.classList.toggle('zoom__level--off', zoom !== BASE);
  out.disabled = zoom <= MIN;
  into.disabled = zoom >= MAX;
}

export function wire() {
  out.append(icon(PATH.minus, { size: 13 }));
  into.append(icon(PATH.plus, { size: 13 }));

  out.addEventListener('click', () => step(-1));
  into.addEventListener('click', () => step(1));
  level.addEventListener('click', () => set(BASE));

  // Ctrl + molette sur la zone d'édition. `passive: false` puis
  // `preventDefault` : sans cela le document défilerait sous le pointeur en
  // même temps qu'il grandit — et la webview pourrait y ajouter son propre
  // zoom, celui de toute la fenêtre.
  surface.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey || ev.deltaY === 0) return;
      ev.preventDefault();

      // Un changement de sens repart de zéro : remonter juste après être
      // descendu ne doit pas être plus lent que le premier cran.
      if (Math.sign(ev.deltaY) !== Math.sign(wheel)) wheel = 0;
      wheel += ev.deltaY;
      if (Math.abs(wheel) < NOTCH) return;

      // Vers soi — `deltaY` positif — réduit, comme partout ailleurs.
      step(wheel < 0 ? 1 : -1);
      wheel = 0;
    },
    { passive: false },
  );
}

function step(sense) {
  set(clamp(store.state.settings.editorZoom) + sense * STEP);
}

function set(zoom) {
  store.setEditorZoom(clamp(zoom));
}
