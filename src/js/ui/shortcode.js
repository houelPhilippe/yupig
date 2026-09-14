// Menu contextuel et boîte d'un shortcode.
//
// Un shortcode s'écrit `{{< nom argument >}}` — la forme que lisent Quarto et
// Hugo. Les trois passent par ici : le menu de mise en forme n'en propose plus
// la liste, c'est cette boîte qui la porte, et chacun y trouve ce qu'il
// réclame.
//
//   - `pagebreak` n'attend rien ;
//   - `include` prend un fichier, choisi en parcourant le disque, mais écrit
//     **relativement au document** pour que le projet reste déplaçable —
//     comme les images ;
//   - `meta` prend une propriété du bloc YAML en tête du document, choisie
//     parmi celles qu'il porte : le texte de l'onglet est la seule vérité, il
//     n'y a rien à demander à Rust.
//
// Les deux champs restent en place quel que soit le shortcode choisi : les
// faire paraître et disparaître ferait sauter la boîte sous les yeux. La barre
// d'état, elle, montre le texte exact qui sera écrit.
//
// La même boîte sert à en poser un et à relire celui qui est déjà là : c'est le
// menu contextuel du shortcode qui l'ouvre dans le second cas, et l'argument
// que le document porte l'emporte alors sur celui de la fois d'avant. Ce menu
// ne vaut que dans le rendu, seul endroit où un shortcode est un nœud plutôt
// qu'un morceau de texte.
//
// La boîte ne pose pas le texte elle-même : elle le rend à l'appelant, qui
// seul sait où l'écrire — `format.js` selon le regard en cours, ou le menu
// d'ici sur le shortcode visé.

import { el, icon, replace, wireHints, PATH } from './dom.js';
import * as store from '../store.js';
import * as api from '../api.js';
import * as menu from './menu.js';
import { splitFront } from '../frontmatter.js';

const rich = document.getElementById('editor-rich');
const dialog = document.getElementById('shortcode-dialog');
const heading = document.getElementById('shortcode-dialog-title');
const closeBtn = document.getElementById('shortcode-dialog-close');
const cancelBtn = document.getElementById('shortcode-cancel');
const insertBtn = document.getElementById('shortcode-insert');
const status = document.getElementById('shortcode-status');

const seg = document.getElementById('shortcode-seg');
const fileInput = document.getElementById('shortcode-file');
const browseBtn = document.getElementById('shortcode-browse');
const keySelect = document.getElementById('shortcode-key');

/**
 * Ce que chaque shortcode attend, et la place qu'il prend dans le document.
 *
 * `block` dit s'il occupe sa ligne ou s'il se glisse au fil du texte : c'est ce
 * que la boîte rend à l'appelant, avec le texte.
 */
const SHORTCODES = {
  pagebreak: { block: true, needs: null },
  include: { block: true, needs: 'file' },
  meta: { block: false, needs: 'key' },
};

/** La forme d'un shortcode, relue pour en retrouver le nom et l'argument. */
const SHORTCODE = /^\{\{<\s*([A-Za-z0-9_-]+)\s*(.*?)\s*>\}\}$/;

let deliver = null;
let say = () => {};

// ------------------------------------------------------------------ menu

/**
 * Ouvre le menu propre à un shortcode du rendu. Rendu à `format.js`, qui le
 * délègue comme celui d'une image.
 *
 * Un shortcode que la boîte ne connaît pas — le document peut en porter
 * d'autres, écrits à la main — garde son entrée « Propriétés », mais éteinte :
 * le menu conserve ses places, et l'on y voit que le retrait, lui, vaut pour
 * tous.
 */
export function open(node, x, y) {
  const read = parse(node.textContent);

  menu.open(x, y, [
    menu.title('Shortcode'),
    menu.item('Propriétés…', PATH.sliders, () => properties(node, read), !read),
    menu.separator(),
    menu.item('Supprimer le shortcode', PATH.trash, () => remove(node)),
  ]);
}

export function close() {
  menu.close();
}

/** Lit `{{< nom argument >}}` ; rend `null` si ce n'est pas un des trois. */
function parse(text) {
  const match = String(text ?? '').trim().match(SHORTCODE);
  if (!match || !(match[1] in SHORTCODES)) return null;
  return { name: match[1], argument: match[2] };
}

/**
 * Retire le shortcode du document.
 *
 * Le paragraphe qu'il occupait à lui seul — un `pagebreak`, un `include` — s'en
 * va avec lui, plutôt que de laisser une ligne vide au milieu du texte. Un
 * `meta` au fil d'une phrase, lui, ne fait partir que ses accolades.
 */
function remove(node) {
  const parent = node.parentElement;
  node.remove();
  if (parent?.tagName === 'P' && !parent.textContent.trim() && !parent.querySelector('img')) {
    parent.remove();
  }
  commit();
}

/** Le rendu vient de changer : l'éditeur ramène la zone au Markdown. */
function commit() {
  rich.dispatchEvent(new Event('input', { bubbles: true }));
}

// ------------------------------------------------------------------ boîte

/**
 * Ouvre la boîte pour écrire un shortcode neuf ; `run` reçoit le texte.
 *
 * Le shortcode choisi la fois précédente reste sélectionné : on en insère
 * souvent plusieurs du même genre à la suite.
 */
export function insert(run) {
  show(run, null);
}

/**
 * Ouvre la boîte sur un shortcode déjà posé.
 *
 * Le texte revient sur le nœud même, et non au point d'insertion : c'est le
 * shortcode visé qu'on relit, pas un autre qu'on ajoute.
 */
function properties(node, read) {
  if (!read) return;
  show((text) => rewrite(node, text), read);
}

function show(run, read) {
  deliver = run;

  if (read) {
    for (const input of seg.querySelectorAll('input[name="shortcode"]')) {
      input.checked = input.value === read.name;
    }
    if (read.name === 'include') fileInput.value = read.argument;
  }
  fillKeys(read?.name === 'meta' ? read.argument : null);

  // Le même cadre pour deux usages : son intitulé et son poussoir le disent.
  heading.textContent = read ? 'Propriétés du shortcode' : 'Insérer un shortcode';
  insertBtn.textContent = read ? 'Appliquer' : 'Insérer';

  refresh();

  dialog.hidden = false;
  seg.querySelector('input[name="shortcode"]:checked')?.focus();
}

function hide() {
  dialog.hidden = true;
  deliver = null;
}

/**
 * Réécrit un shortcode sans le déplacer.
 *
 * Seul son texte change : la balise qui l'entoure est celle que
 * `liftShortcodes` lui donnerait de toute façon, et la feuille de style tire
 * du paragraphe, non du nom, la façon de le montrer.
 */
function rewrite(node, text) {
  if (!node.isConnected) return;
  node.textContent = text;
  commit();
}

function picked() {
  return seg.querySelector('input[name="shortcode"]:checked')?.value ?? 'pagebreak';
}

/** Le texte qui partira dans le document. */
function text() {
  const name = picked();
  const argument = SHORTCODES[name].needs === 'file'
    ? fileInput.value.trim()
    : SHORTCODES[name].needs === 'key'
      ? keySelect.value
      : '';
  return `{{< ${name}${argument ? ` ${argument}` : ''} >}}`;
}

/**
 * L'aperçu de ce qui sera écrit.
 *
 * Les deux champs restent en place quel que soit le shortcode choisi : les
 * faire paraître et disparaître ferait sauter la boîte sous les yeux. C'est la
 * barre d'état qui dit lequel des deux compte — elle montre le texte exact.
 */
function refresh() {
  say(text());
}

// ------------------------------------------------------------- arguments

/**
 * Choisit le fichier à inclure en parcourant le disque.
 *
 * Ce que le document porte reste un chemin **relatif** à lui, calculé par
 * Rust — comme pour une image : un chemin absolu ne voudrait rien dire sur une
 * autre machine. Le sélecteur s'ouvre donc sur le projet, seul endroit d'où un
 * tel chemin garde un sens ; au-dehors, `files::link_from` refuse et le dit.
 */
async function browse() {
  const tab = store.activeTab();
  if (!tab) return;

  const chosen = await api.pickDocument(store.state.edition.root);
  if (!chosen) return;

  fileInput.value = await api.fileLink(tab.path, chosen);
  refresh();
}

/**
 * Les propriétés du bloc YAML en tête du document.
 *
 * Une lecture volontairement courte : les clés de premier niveau, et celles
 * d'un niveau d'indentation en dessous, écrites `parent.enfant` — la forme
 * qu'attend `meta`. Ce n'est pas un analyseur YAML, et cela n'a pas à l'être :
 * ce sont les propriétés que le document porte réellement, et `meta` n'a de
 * sens que sur celles-là.
 */
function keysOf(markdown) {
  const { inner } = splitFront(markdown);
  if (!inner) return [];

  const keys = [];
  let parent = null;
  for (const line of inner.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const top = line.match(/^([A-Za-z0-9_.-]+)\s*:/);
    if (top) {
      parent = top[1];
      keys.push(top[1]);
      continue;
    }
    const child = line.match(/^\s{1,4}([A-Za-z0-9_.-]+)\s*:/);
    if (child && parent) keys.push(`${parent}.${child[1]}`);
  }
  return [...new Set(keys)];
}

/**
 * Remplit la liste des propriétés ; `wanted` est celle que le shortcode porte
 * déjà.
 *
 * Elle reste offerte même si le document ne la porte plus : relire un
 * shortcode ne doit pas en changer le sens sous les yeux de qui l'ouvre.
 */
function fillKeys(wanted = null) {
  const keys = keysOf(store.activeTab()?.content);
  if (wanted && !keys.includes(wanted)) keys.unshift(wanted);

  // Celle du shortcode ouvert s'il y en a un, sinon celle choisie la fois
  // d'avant si le document la porte toujours.
  const kept = wanted && keys.includes(wanted)
    ? wanted
    : keys.includes(keySelect.value) ? keySelect.value : keys[0] ?? '';

  replace(keySelect, keys.map((key) => el('option', { value: key }, key)));
  if (!keys.length) {
    keySelect.append(el('option', { value: '' }, 'Ce document n’a pas de bloc YAML en tête'));
  }
  keySelect.value = kept;
}

// ------------------------------------------------------------------ vie

function submit() {
  const { block } = SHORTCODES[picked()];
  const out = text();
  const run = deliver;
  hide();
  run?.(out, block);
}

export function wire() {
  say = wireHints(dialog, status, text);

  closeBtn.append(icon(PATH.close, { size: 13 }));
  closeBtn.addEventListener('click', hide);
  cancelBtn.addEventListener('click', hide);
  insertBtn.addEventListener('click', submit);

  seg.addEventListener('change', refresh);
  fileInput.addEventListener('input', refresh);
  keySelect.addEventListener('change', refresh);
  browseBtn.addEventListener('click', () => browse().catch(store.fail));

  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) hide();
  });
  dialog.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      hide();
    }
    if (ev.key === 'Enter' && !ev.target.closest('.modal__foot')) {
      ev.preventDefault();
      submit();
    }
  });
}
