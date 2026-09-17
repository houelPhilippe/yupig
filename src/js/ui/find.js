// Barre « Rechercher / Remplacer », pour les deux modes où l'on écrit.
//
// Elle cherche dans ce que le mode montre : la source en « Code Markdown », le
// texte rendu en « Modifier ». C'est la seule règle à retenir — on cherche ce
// qu'on a sous les yeux, et « le **mot** juste » se trouve donc en tapant « le
// mot juste » d'un côté, « **mot** » de l'autre.
//
// Les occurrences du rendu sont peintes par l'API `CSS.highlights`, qui
// **ne touche pas au DOM**. C'est essentiel ici : `turndown` est réglé pour
// supprimer le mobilier d'éditeur *avec son contenu*, si bien qu'une
// surbrillance posée en `<mark class="chrome">` et oubliée mangerait le texte
// du fichier. Aucun nœud ajouté, rien à nettoyer, rien à perdre.

import { el, icon, PATH } from './dom.js';
import * as store from '../store.js';
import * as engine from '../find.js';
import { richEdited } from './editor.js';

const bar = document.getElementById('find-bar');
const queryField = document.getElementById('find-query');
const replField = document.getElementById('find-replacement');
const countLabel = document.getElementById('find-count');

const caseBtn = document.getElementById('find-case');
const wordBtn = document.getElementById('find-word');
const regexBtn = document.getElementById('find-regex');

const prevBtn = document.getElementById('find-prev');
const nextBtn = document.getElementById('find-next');
const closeBtn = document.getElementById('find-close');
const replaceBtn = document.getElementById('find-replace');
const replaceAllBtn = document.getElementById('find-replace-all');

const area = document.getElementById('editor-area');
const backdrop = document.getElementById('editor-backdrop');
const rich = document.getElementById('editor-rich');

/** Les surbrillances hors DOM ne sont pas partout ; la sélection, si. */
const PAINTS = typeof CSS !== 'undefined' && Boolean(CSS.highlights);

/** Ce que la dernière recherche a trouvé, et où l'on en est. */
let matches = [];
let index = 0;
/** La carte du texte rendu : le texte à plat, et les nœuds qui le portent. */
let map = null;
/** Ce qui, changeant, oblige à tout recalculer. */
let seen = null;
/** La barre était-elle à l'écran au rendu précédent ? */
let wasOn = false;
/** Le champ à mettre en avant à la prochaine ouverture. */
let wanted = null;

// --------------------------------------------------------------- le texte

/**
 * Éléments qui séparent deux textes.
 *
 * Sans eux, la fin d'un paragraphe et le début du suivant se toucheraient dans
 * le texte à plat, et « finDébut » deviendrait une occurrence possible. On
 * intercale un saut de ligne, qui n'appartient à aucun nœud : le chercher
 * revient alors à chercher un saut de ligne, ce qui est exact.
 */
const BLOCK = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'FIGURE', 'FIGCAPTION', 'HR',
]);

function blockOf(node) {
  let e = node.parentElement;
  while (e && e !== rich && !BLOCK.has(e.tagName)) e = e.parentElement;
  return e ?? rich;
}

/**
 * Le texte du rendu, à plat, et de quoi retrouver les nœuds qui le portent.
 *
 * Le mobilier d'éditeur en est écarté : la liste des langages posée sur un
 * bloc de code n'est pas du texte du document, et l'y chercher ferait trouver
 * des mots que le fichier ne contient pas.
 */
function flatten() {
  const walker = document.createTreeWalker(rich, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('.chrome')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });

  const nodes = [];
  let text = '';
  let last = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const block = blockOf(n);
    if (last !== null && block !== last) text += '\n';
    last = block;
    nodes.push({ node: n, start: text.length });
    text += n.nodeValue;
  }
  return { text, nodes };
}

/** Le nœud et le décalage qui portent la position `pos` du texte à plat. */
function locate(nodes, pos) {
  let lo = 0;
  let hi = nodes.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].start <= pos) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const entry = nodes[best];
  if (!entry) return null;
  return { node: entry.node, offset: Math.min(pos - entry.start, entry.node.nodeValue.length) };
}

/** La plage du document qui porte une occurrence du texte à plat. */
function rangeOf(nodes, m) {
  const a = locate(nodes, m.start);
  const b = locate(nodes, m.end);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

// ------------------------------------------------------------ la recherche

/** L'expression courante, ou `null` ; lève si elle est mal formée. */
function expression() {
  const { query, matchCase, wholeWord, regex } = store.state.edition.find;
  return engine.pattern(query, { matchCase, wholeWord, regex });
}

function isCode() {
  return store.mode() === 'code';
}

export function render(state) {
  if (state.app !== 'edition') return;
  const { find } = state.edition;
  const on = find.open && store.canFind();

  bar.hidden = !on;
  if (!on) {
    clear();
    seen = null;
    wasOn = false;
    return;
  }

  // La barre vient de paraître : elle prend le clavier. C'est vrai quel que
  // soit le geste qui l'a ouverte — le raccourci, ou le menu de l'onglet, qui
  // ne connaît que `store.toggleFind`.
  if (!wasOn) {
    wasOn = true;
    const field = wanted === 'replacement' ? replField : queryField;
    wanted = null;
    field.focus();
    field.select();
  }

  // Les champs ne sont réécrits que s'ils divergent : les réassigner à chaque
  // rendu replacerait le curseur au début à chaque frappe.
  if (queryField.value !== find.query) queryField.value = find.query;
  if (replField.value !== find.replacement) replField.value = find.replacement;
  press(caseBtn, find.matchCase);
  press(wordBtn, find.wholeWord);
  press(regexBtn, find.regex);

  const tab = store.activeTab();
  // Le rendu ne se résume pas au Markdown, mais c'est `editor.render` — appelé
  // juste avant celui-ci — qui l'a reconstruit à partir de lui : se raccrocher
  // à la source revient donc à se raccrocher au rendu.
  // Le compteur de redessin en fait partie : un rendu refait à Markdown égal
  // laisse les intervalles de la dernière recherche sur des nœuds qui ne sont
  // plus dans la page — plus rien ne se peindrait, et la navigation entre
  // occurrences viserait le vide.
  // Le repli de la source aussi : il déplace chaque caractère, et le calque
  // doit être repeint sur la nouvelle disposition.
  const sig = JSON.stringify([
    tab?.path, store.mode(), tab?.content, state.edition.redraw, state.edition.project.wrapSource,
    find.query, find.matchCase, find.wholeWord, find.regex,
  ]);
  if (sig === seen) return;
  seen = sig;

  recompute();
}

function press(btn, on) {
  btn.setAttribute('aria-pressed', String(Boolean(on)));
}

/** Refait la liste des occurrences et la porte à l'écran. */
function recompute() {
  const before = index;
  let re;
  try {
    re = expression();
  } catch (err) {
    matches = [];
    map = null;
    clear();
    fail(err.message);
    return;
  }

  bar.classList.remove('find--error');

  if (!re) {
    matches = [];
    map = null;
    index = 0;
    clear();
    countLabel.textContent = '';
    enable();
    return;
  }

  if (isCode()) {
    map = null;
    matches = engine.search(area.value, re);
  } else {
    map = flatten();
    matches = engine.search(map.text, re);
  }

  // Le rang survit au recalcul tant qu'il désigne encore quelque chose : c'est
  // ce qui fait qu'un remplacement enchaîne sur l'occurrence suivante plutôt
  // que de renvoyer à la première.
  index = matches.length === 0 ? 0 : Math.min(before, matches.length - 1);
  show();
}

function fail(message) {
  bar.classList.add('find--error');
  countLabel.textContent = 'expression invalide';
  countLabel.title = message;
  enable();
}

/** Met à jour le compteur, les boutons, et la mise en évidence. */
function show() {
  countLabel.title = '';
  countLabel.textContent = matches.length === 0
    ? (store.state.edition.find.query ? 'aucune' : '')
    : `${index + 1} / ${matches.length}`;
  enable();
  paint();
}

function enable() {
  const none = matches.length === 0;
  prevBtn.disabled = none;
  nextBtn.disabled = none;
  replaceBtn.disabled = none;
  replaceAllBtn.disabled = none;
}

/** Retire toute mise en évidence — à la fermeture, ou faute d'occurrence. */
function clear() {
  backdrop.replaceChildren();
  if (!PAINTS) return;
  CSS.highlights.delete('find');
  CSS.highlights.delete('find-current');
}

/** Porte les occurrences à l'écran, et amène la courante en vue. */
function paint() {
  // On repart d'une page nette : sans cela, un changement de mode laisserait
  // les marques de l'autre couche derrière lui.
  clear();
  if (matches.length === 0) return;

  if (isCode()) {
    paintSource();
    const m = matches[index];
    // Sélectionner sans prendre le clavier : la frappe doit rester dans le
    // champ de recherche, sans quoi on ne pourrait pas enchaîner les Entrée.
    // C'est le calque qui montre l'occurrence ; la sélection, elle, sert à qui
    // clique ensuite dans la source — le curseur y est déjà.
    area.setSelectionRange(m.start, m.end);
    scrollTextarea(m.start);
    return;
  }

  if (!PAINTS || !map) return;
  const ranges = [];
  for (const m of matches) {
    const r = rangeOf(map.nodes, m);
    if (r) ranges.push(r);
  }
  CSS.highlights.set('find', new Highlight(...ranges));
  const current = ranges[index];
  CSS.highlights.set('find-current', current ? new Highlight(current) : new Highlight());
  bring(current);
}

/**
 * Peint les occurrences derrière la source.
 *
 * Le calque rejoue le texte entier, glyphe pour glyphe, en transparent : seuls
 * ses aplats se voient, sous le texte réel de la zone de saisie. C'est le prix
 * à payer pour marquer quoi que ce soit dans un `<textarea>`, dont l'intérieur
 * n'est atteignable ni par `CSS.highlights` ni par aucun sélecteur.
 */
function paintSource() {
  // La zone de saisie perd de la largeur quand sa barre de défilement paraît ;
  // sans ce report, le repli des lignes diffère d'une couche à l'autre et tous
  // les aplats glissent à partir de la première ligne trop longue.
  backdrop.style.width = `${area.clientWidth}px`;
  // De même en hauteur quand le repli est retiré : la barre horizontale qui
  // paraît alors réduit la zone, et un calque plus haut qu'elle n'atteindrait
  // plus le même défilement en pied de document.
  backdrop.style.height = `${area.clientHeight}px`;

  const text = area.value;
  const parts = [];
  let at = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.start > at) parts.push(document.createTextNode(text.slice(at, m.start)));
    const mark = i === index ? 'mark.find__hit.find__hit--on' : 'mark.find__hit';
    parts.push(el(mark, {}, text.slice(m.start, m.end)));
    at = m.end;
  }
  // Un `<textarea>` réserve une ligne après un dernier retour chariot ; le
  // calque doit la réserver aussi, sinon les deux défilements divergent en pied
  // de document.
  parts.push(document.createTextNode(`${text.slice(at)}\n`));

  backdrop.replaceChildren(...parts);
  syncScroll();
}

/** Le calque suit la source : il n'a pas de barre, on le fait défiler. */
function syncScroll() {
  backdrop.scrollTop = area.scrollTop;
  backdrop.scrollLeft = area.scrollLeft;
}

/** Amène une plage du rendu en vue, sans secousse inutile. */
function bring(range) {
  if (!range) return;
  const box = range.getBoundingClientRect();
  const view = rich.getBoundingClientRect();
  if (box.top >= view.top && box.bottom <= view.bottom) return;
  rich.scrollTop += box.top - view.top - rich.clientHeight / 3;
}

/** Amène la ligne d'un décalage en vue dans la source. */
function scrollTextarea(pos) {
  const line = area.value.slice(0, pos).split('\n').length - 1;
  const lh = parseFloat(getComputedStyle(area).lineHeight) || 20;
  const top = line * lh;
  if (top < area.scrollTop || top > area.scrollTop + area.clientHeight - lh) {
    area.scrollTop = Math.max(0, top - area.clientHeight / 3);
  }
  syncScroll();
}

// ----------------------------------------------------------- les commandes

function go(delta) {
  if (matches.length === 0) return;
  index = engine.step(index, matches.length, delta);
  show();
}

/** Remplace l'occurrence visée ; la suivante prend sa place sous le rang. */
function replaceOne() {
  if (matches.length === 0) return;
  const { replacement, regex } = store.state.edition.find;
  const m = matches[index];
  const out = engine.expand(m, replacement, regex);

  if (isCode()) {
    const tab = store.activeTab();
    if (!tab) return;
    const text = tab.content;
    store.edit(tab.path, text.slice(0, m.start) + out + text.slice(m.end));
    return;
  }

  const r = rangeOf(map.nodes, m);
  if (!r) return;
  r.deleteContents();
  if (out) r.insertNode(document.createTextNode(out));
  // Les nœuds de texte voisins doivent se rejoindre, sans quoi la prochaine
  // carte du rendu verrait un mot coupé en deux et ne le trouverait plus.
  rich.normalize();
  richEdited();
}

/**
 * Remplace tout.
 *
 * Dans le rendu, chaque remplacement invalide la carte des nœuds : on la refait
 * à chaque tour et l'on repart après ce qui vient d'être écrit. C'est ce qui
 * rend l'opération sûre quand le remplacement contient ce qu'on cherche —
 * « a » par « aa » s'arrête, là où une boucle naïve tournerait sans fin.
 */
function replaceEvery() {
  if (matches.length === 0) return;
  const { replacement, regex } = store.state.edition.find;

  if (isCode()) {
    const tab = store.activeTab();
    if (!tab) return;
    const n = matches.length;
    store.edit(tab.path, engine.replaceAll(tab.content, matches, replacement, regex));
    store.notify(done(n));
    return;
  }

  let re;
  try {
    re = expression();
  } catch {
    return;
  }

  const limit = matches.length;
  let count = 0;
  let from = 0;
  while (count < limit) {
    const fresh = flatten();
    const m = engine.search(fresh.text, re).find((x) => x.start >= from);
    if (!m) break;

    const out = engine.expand(m, replacement, regex);
    const r = rangeOf(fresh.nodes, m);
    if (!r) break;
    r.deleteContents();
    if (out) r.insertNode(document.createTextNode(out));
    rich.normalize();

    from = m.start + out.length;
    count += 1;
  }

  richEdited();
  store.notify(done(count));
}

function done(n) {
  return n > 1 ? `${n} occurrences remplacées.` : `${n} occurrence remplacée.`;
}

/** Referme la barre et rend le clavier au document. */
function close() {
  store.toggleFind(false);
  (isCode() ? area : rich).focus({ preventScroll: true });
}

/** Ce qui est sélectionné dans le document, pour amorcer la recherche. */
function selected() {
  if (isCode()) return area.value.slice(area.selectionStart, area.selectionEnd);
  const sel = globalThis.getSelection?.();
  if (!sel || sel.isCollapsed || !rich.contains(sel.anchorNode)) return '';
  return sel.toString();
}

/**
 * Ouvre la barre, le champ voulu en avant.
 *
 * Le clavier n'est pas donné ici mais au rendu : la barre est encore masquée à
 * cet instant, et un champ masqué ne prend pas le focus. C'est aussi ce qui
 * fait que l'ouverture par le menu de l'onglet — qui n'appelle que
 * `store.toggleFind` — se comporte de la même façon.
 */
export function open(focus = 'query') {
  if (!store.canFind()) return;
  wanted = focus;
  // Une sélection dans le document est presque toujours ce qu'on veut
  // chercher : elle prend la place de ce que portait le champ.
  const picked = selected().split('\n')[0].trim();
  if (picked) {
    index = 0;
    store.setFind({ query: picked });
  }
  store.toggleFind(true);
}

export function wire() {
  // Le calque n'a pas de barre de défilement : il suit celle de la source.
  area.addEventListener('scroll', syncScroll);

  // Une fenêtre redimensionnée replie les lignes autrement : le calque doit
  // être refait, largeur comprise. Le zoom, lui, se règle tout seul — les deux
  // couches tirent leur taille de la même variable CSS.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (!bar.hidden && isCode() && matches.length > 0) paintSource();
    }).observe(area);
  }

  prevBtn.append(icon(PATH.caretUp, { size: 14 }));
  nextBtn.append(icon(PATH.caretDown, { size: 14 }));
  closeBtn.append(icon(PATH.close, { size: 13 }));

  queryField.addEventListener('input', () => {
    // Le rang repart du début : ce qu'on cherche n'est plus le même.
    index = 0;
    store.setFind({ query: queryField.value });
  });
  replField.addEventListener('input', () => store.setFind({ replacement: replField.value }));

  caseBtn.addEventListener('click', () => toggle('matchCase'));
  wordBtn.addEventListener('click', () => toggle('wholeWord'));
  regexBtn.addEventListener('click', () => toggle('regex'));

  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  closeBtn.addEventListener('click', close);
  replaceBtn.addEventListener('click', replaceOne);
  replaceAllBtn.addEventListener('click', replaceEvery);

  // Entrée parcourt les occurrences depuis les deux champs : on cherche
  // souvent la suivante sans quitter le champ de remplacement.
  for (const field of [queryField, replField]) {
    field.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        go(ev.shiftKey ? -1 : 1);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
      }
    });
  }

  // Ctrl+F et Ctrl+H ne sont plus écoutés ici : ils vivent dans la table de
  // `keys.js`, avec tous les autres, et `ui/keys.js` appelle `open`. Deux
  // écoutes auraient fini par se contredire — et le menu de l'onglet ne pouvait
  // pas annoncer une frappe qu'il ne connaissait pas.

  // Échap depuis la zone d'édition referme aussi la barre.
  for (const node of [area, rich]) {
    node.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && store.state.edition.find.open) {
        ev.preventDefault();
        store.toggleFind(false);
      }
    });
  }
}

/** Bascule une des trois façons de chercher. */
function toggle(key) {
  index = 0;
  store.setFind({ [key]: !store.state.edition.find[key] });
}
