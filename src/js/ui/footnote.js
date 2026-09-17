// Notes de bas de page dans le rendu : lire une note sans quitter l'appel, et
// passer de l'appel à la note et retour.
//
// Une note s'écrit à la façon de Pandoc — l'appel `[^1]` au fil du texte, la
// définition `[^1]: …` en fin de document —, et `markdown.js` rend les deux par
// la même balise, `<sup class="fn">`. Ce qui les distingue est leur place : une
// définition est un bloc qui **commence** par son numéro suivi de « : ».
//
// Trois gestes :
//
// - le pointeur sur un appel montre la note dans une bulle flottante ;
// - un clic sur un appel porte le curseur au début du texte de la note ;
// - un clic sur le numéro d'une note le ramène juste après son appel — le
//   premier, s'il y en a plusieurs.
//
// La bulle vit dans `document.body`, hors de la zone d'édition : rien de ce
// qu'elle porte ne peut donc partir dans le fichier. Son contenu est une copie
// des nœuds de la note, déjà assainis par `markdown.js` au rendu — jamais du
// HTML reconstruit. La cible d'un saut se signale un instant par
// `CSS.highlights`, qui n'ajoute aucun nœud au document, pour la même raison
// que la recherche.
//
// Dans « Code Markdown », il n'y a ni balise à survoler ni nœud à viser : ces
// gestes appartiennent au rendu.

import { el } from './dom.js';
import * as store from '../store.js';

const rich = document.getElementById('editor-rich');

/** Délai avant la bulle : un pointeur qui ne fait que passer ne l'ouvre pas. */
const HOVER_DELAY = 250;
/** Durée du signal posé sur la cible d'un saut. */
const FLASH = 1200;

let tip = null;
let hoverTimer = null;
let flashTimer = null;

/** Le numéro — l'étiquette — d'une note ou d'un appel. */
function labelOf(sup) {
  return sup.textContent.trim();
}

/** Le bloc qui porte le nœud : le paragraphe, l'élément de liste… */
function blockOf(node) {
  return node.closest('p, li, dd, td, th, blockquote, h1, h2, h3, h4, h5, h6') ?? node.parentElement;
}

/**
 * Ce `<sup>` est-il le numéro d'une définition ? Il ouvre alors son bloc —
 * seuls des blancs le précèdent — et « : » le suit.
 */
function isDefinition(sup) {
  const block = blockOf(sup);
  if (!block) return false;
  for (let n = sup.previousSibling; n; n = n.previousSibling) {
    if (n.nodeType !== Node.TEXT_NODE || n.nodeValue.trim()) return false;
  }
  if (sup.parentElement !== block) return false;
  const next = sup.nextSibling;
  return next?.nodeType === Node.TEXT_NODE && next.nodeValue.startsWith(':');
}

/** Tous les numéros de note du rendu, dans l'ordre du document. */
function marks() {
  return [...rich.querySelectorAll('sup.fn')];
}

/** Le numéro de la définition d'une étiquette, ou `null`. */
function definitionOf(label) {
  return marks().find((s) => labelOf(s) === label && isDefinition(s)) ?? null;
}

/** Le premier appel d'une étiquette, ou `null`. */
function firstCallOf(label) {
  return marks().find((s) => labelOf(s) === label && !isDefinition(s)) ?? null;
}

// ---------------------------------------------------------------- la bulle

/**
 * Le contenu d'une note, copié : son bloc sans le numéro ni le « : » qui le
 * suit. Le mobilier d'éditeur, s'il s'en trouvait, n'est pas repris.
 */
function contentOf(definition) {
  const frag = document.createDocumentFragment();
  let first = true;
  for (let n = definition.nextSibling; n; n = n.nextSibling) {
    const copy = n.cloneNode(true);
    if (first && copy.nodeType === Node.TEXT_NODE) {
      copy.nodeValue = copy.nodeValue.replace(/^:\s*/, '');
    }
    first = false;
    if (copy.nodeType === Node.ELEMENT_NODE) {
      if (copy.classList.contains('chrome')) continue;
      for (const chrome of copy.querySelectorAll('.chrome')) chrome.remove();
    }
    frag.append(copy);
  }
  return frag;
}

function showTip(sup) {
  hideTip();
  const label = labelOf(sup);
  const definition = definitionOf(label);

  tip = el(
    'div.fn-tip',
    { role: 'tooltip' },
    el('div.fn-tip__head', {}, `Note ${label}`),
    definition
      ? el('div.fn-tip__body', {}, contentOf(definition))
      : el('div.fn-tip__body.fn-tip__body--missing', {}, `Aucune définition [^${label}]: dans ce document.`),
  );
  document.body.append(tip);

  // Sous l'appel, calée sur lui ; au-dessus s'il n'y a pas la place en bas, et
  // jamais hors de la fenêtre.
  const at = sup.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(at.left - 12, window.innerWidth - box.width - 8));
  let top = at.bottom + 6;
  if (top + box.height > window.innerHeight - 8) top = Math.max(8, at.top - box.height - 6);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTip() {
  clearTimeout(hoverTimer);
  hoverTimer = null;
  tip?.remove();
  tip = null;
}

// ------------------------------------------------------------------ le saut

/** Signale la cible d'un saut un instant, sans toucher au document. */
function flash(range) {
  if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
  clearTimeout(flashTimer);
  CSS.highlights.set('fn-target', new Highlight(range));
  flashTimer = setTimeout(() => CSS.highlights.delete('fn-target'), FLASH);
}

/**
 * Porte le regard — et le curseur, quand le rendu se modifie — sur `range`.
 * Le défilement reste dans la zone d'édition : `scrollIntoView` sur le bloc
 * ne fait défiler que ses ancêtres qui défilent.
 */
function jump(range, block, signal) {
  block.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (rich.isContentEditable) {
    rich.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  flash(signal);
}

/** D'un appel au texte de sa note. */
function toDefinition(call) {
  const label = labelOf(call);
  const definition = definitionOf(label);
  if (!definition) {
    store.notify(`Aucune définition pour la note ${label} dans ce document.`, 'error');
    return;
  }

  // Le curseur se pose après « : » et son espace, au début du texte de la note.
  const range = document.createRange();
  const next = definition.nextSibling;
  const skip = next?.nodeValue?.match(/^:\s?/)?.[0].length ?? 0;
  range.setStart(next, Math.min(skip, next.nodeValue.length));
  range.collapse(true);

  const block = blockOf(definition);
  const signal = document.createRange();
  signal.selectNodeContents(block);
  jump(range, block, signal);
}

/** Du numéro d'une note à son appel. */
function toCall(definition) {
  const label = labelOf(definition);
  const call = firstCallOf(label);
  if (!call) {
    store.notify(`La note ${label} n’est appelée nulle part dans ce document.`, 'error');
    return;
  }

  // Juste après l'appel : on reprend la lecture là où la note s'insère.
  const range = document.createRange();
  range.setStartAfter(call);
  range.collapse(true);

  const signal = document.createRange();
  signal.selectNode(call);
  jump(range, blockOf(call), signal);
}

export function wire() {
  rich.addEventListener('pointerover', (ev) => {
    const sup = ev.target.closest?.('sup.fn');
    if (!sup || !rich.contains(sup) || isDefinition(sup)) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showTip(sup), HOVER_DELAY);
  });
  rich.addEventListener('pointerout', (ev) => {
    const sup = ev.target.closest?.('sup.fn');
    if (!sup) return;
    // Passer d'un nœud à l'autre au sein du même appel ne ferme rien.
    if (ev.relatedTarget && sup.contains(ev.relatedTarget)) return;
    hideTip();
  });

  rich.addEventListener('click', (ev) => {
    const sup = ev.target.closest?.('sup.fn');
    if (!sup || !rich.contains(sup)) return;
    // Un clic qui étend une sélection reste une sélection.
    if (ev.shiftKey) return;
    ev.preventDefault();
    hideTip();
    if (isDefinition(sup)) toCall(sup);
    else toDefinition(sup);
  });

  // Tout ce qui déplace ou change la page emporte la bulle.
  rich.addEventListener('keydown', hideTip);
  document.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
  window.addEventListener('blur', hideTip);
}
