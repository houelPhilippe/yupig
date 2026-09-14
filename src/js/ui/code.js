// Blocs de code : leur insertion, et le choix du langage posé sur le bloc.
//
// Le langage vit dans la classe `language-…` du `<code>` : c'est là que `marked`
// l'a mis en lisant les trois accents graves du fichier, et c'est de là que
// `turndown` le reprend pour les réécrire. La liste déroulante n'est donc qu'une
// vue sur cette classe — rien d'autre n'est à tenir.
//
// Elle porte la classe `chrome` : c'est du mobilier d'éditeur, que `markdown.js`
// retire avant toute conversion. Rien de ce qui la compose ne part dans le
// fichier, et elle ne paraît qu'en « Modifier ».

import { el, isTab } from './dom.js';

const rich = document.getElementById('editor-rich');

/**
 * Les langages proposés.
 *
 * La valeur est celle qu'écrit le fichier après les accents graves ; l'intitulé
 * est ce qu'on lit dans la liste. Un bloc dont le langage n'est pas de la liste
 * garde le sien : il s'ajoute en tête plutôt que d'être perdu au premier
 * affichage.
 */
const LANGS = [
  ['', 'Texte brut'],
  ['bash', 'Bash'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['css', 'CSS'],
  ['html', 'HTML'],
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['json', 'JSON'],
  ['markdown', 'Markdown'],
  ['python', 'Python'],
  ['rust', 'Rust'],
  ['sql', 'SQL'],
  ['toml', 'TOML'],
  ['typescript', 'TypeScript'],
  ['xml', 'XML'],
  ['yaml', 'YAML'],
];

/**
 * Le dernier choix de la liste : un langage qui n'y est pas.
 *
 * Les blocs de code servent à tout, et une liste ne peut pas tout prévoir —
 * `texinfo`, `dot`, `nix`… Ce qu'on saisit là s'écrit tel quel après les
 * accents graves, et rejoint la liste du bloc.
 */
const OTHER = '…';

/** Le langage d'un bloc, lu sur la classe de son `<code>`. */
function languageOf(code) {
  return (code.getAttribute('class') ?? '').match(/language-(\S+)/)?.[1] ?? '';
}

/**
 * Pose la liste des langages sur les blocs de code qui n'en ont pas.
 *
 * Appelée après chaque reconstruction du rendu : celle-ci repart du Markdown,
 * qui ne porte évidemment pas le mobilier de l'éditeur.
 */
export function decorate() {
  // En lecture seule, il n'y a rien à choisir.
  if (!rich.isContentEditable) return;

  for (const pre of rich.querySelectorAll('pre')) {
    if (pre.querySelector('.chrome')) continue;
    const code = pre.querySelector('code');
    // La liste vient après le code : le curseur qui entre dans le bloc tombe
    // ainsi dans le texte, jamais derrière un outil.
    if (code) pre.append(picker(code));
  }
}

function picker(code) {
  const current = languageOf(code);
  const known = LANGS.some(([value]) => value === current);
  // Un langage venu du fichier et absent de la liste s'y ajoute en tête plutôt
  // que d'être perdu au premier affichage.
  const list = [...(known ? LANGS : [[current, current], ...LANGS]), [OTHER, 'Autre…']];

  const select = el('select.code-lang__select', {
    'aria-label': 'Langage du bloc de code',
    title: 'Langage du bloc de code',
    // Les deux événements : selon le moteur, une liste déroulante annonce son
    // nouveau choix par l'un ou par l'autre. Poser deux fois la même classe ne
    // coûte rien, la manquer coûterait le langage.
    onchange: (ev) => choose(code, ev.target),
    oninput: (ev) => choose(code, ev.target),
  });
  for (const [value, label] of list) {
    select.append(el('option', { value, selected: value === current ? true : null }, label));
  }

  return el('div.code-lang.chrome', { contenteditable: 'false' }, select);
}

function choose(code, select) {
  // Les deux événements annoncent le même choix : le second arrive sur une
  // liste déjà remplacée par `repaint`, il n'a plus rien à faire.
  if (!select.isConnected) return;
  let language = select.value;

  if (language === OTHER) {
    const asked = prompt(
      'Langage du bloc de code, tel qu’il s’écrit après les accents graves :',
      languageOf(code),
    );
    // Annulé : la liste montre encore « Autre… », on la remet sur le langage
    // en place.
    if (asked === null) {
      repaint(code);
      return;
    }
    language = asked.trim().replace(/[\s`]+/g, '');
  }

  if (language) code.setAttribute('class', `language-${language}`);
  else code.removeAttribute('class');
  repaint(code);
  commit();
}

/** Refait la liste du bloc, pour qu'elle montre le langage qui vient d'être posé. */
function repaint(code) {
  const pre = code.closest('pre');
  if (!pre) return;
  pre.querySelector('.chrome')?.remove();
  pre.append(picker(code));
}

/**
 * Un bloc de code vierge, prêt à être posé dans le document.
 *
 * Son contenu est un simple saut de ligne, et non un `<br>` : dans un bloc de
 * code tout est texte, sauts compris — c'est ce que `turndown` recopie entre
 * les accents graves. Le saut final n'est pas rendu, il ne fait donc que
 * donner au curseur une ligne où se poser.
 */
export function element(language = '') {
  const code = el('code', {});
  if (language) code.setAttribute('class', `language-${language}`);
  code.append(document.createTextNode('\n'));
  return el('pre', {}, code);
}

// ------------------------------------------------------------ la frappe

/**
 * Ce qu'écrit la touche de tabulation.
 *
 * Une vraie tabulation, comme dans un éditeur de texte simple : c'est la frappe
 * même, elle traverse le fichier sans se transformer, et la feuille de style
 * dit sur quelle colonne elle tombe (`tab-size`). Retirer l'indentation
 * reprend au choix une tabulation ou quatre espaces, pour aussi savoir défaire
 * ce qu'un autre outil a écrit.
 */
const INDENT = '\t';

/**
 * Le `<code>` du bloc où se trouve le curseur, s'il y en a un.
 */
function codeAt() {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;

  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const code = node?.closest('pre > code');
  return code && rich.contains(code) ? code : null;
}

/**
 * Passe à la ligne dans le bloc.
 *
 * Laissée au moteur, la touche Entrée coupe le bloc ou en sort — dans un bloc
 * de code, elle doit poser un saut de ligne, et rien d'autre.
 */
function newline(code) {
  const sel = window.getSelection();
  const range = sel.getRangeAt(0);
  range.deleteContents();

  // Un saut en fin de bloc n'est pas rendu : il en faut deux pour que la ligne
  // ouverte existe à l'écran. Le second est celui que `turndown` retire en
  // écrivant le fichier, la source n'en garde donc pas trace.
  const tail = document.createRange();
  tail.setStart(range.endContainer, range.endOffset);
  tail.setEnd(code, code.childNodes.length);
  const text = document.createTextNode(tail.toString() ? '\n' : '\n\n');

  range.insertNode(text);
  const at = document.createRange();
  at.setStart(text, 1);
  at.collapse(true);
  sel.removeAllRanges();
  sel.addRange(at);
  commit();
}

/**
 * Sort du bloc par le bas — Ctrl+Entrée.
 *
 * Sans cela, un bloc de code en fin de document serait sans issue : la touche
 * Entrée y écrit désormais, et il n'y a plus rien après lui où poser le
 * curseur.
 */
function leave(code) {
  const pre = code.closest('pre');
  let next = pre.nextElementSibling;

  if (!next || next.tagName !== 'P') {
    next = el('p', {}, el('br'));
    pre.after(next);
    commit();
  }

  const at = document.createRange();
  at.selectNodeContents(next);
  at.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(at);
}

/**
 * La position de la sélection dans le texte du bloc.
 *
 * Tout se dit ici en décalages de caractères plutôt qu'en nœuds : le contenu
 * d'un bloc de code est du texte pur, et raisonner dessus évite d'avoir à
 * suivre le découpage en nœuds que la frappe laisse derrière elle.
 */
function textRange(code) {
  const range = window.getSelection().getRangeAt(0);
  return {
    text: code.textContent,
    from: offsetOf(code, range.startContainer, range.startOffset),
    to: offsetOf(code, range.endContainer, range.endOffset),
  };
}

function offsetOf(code, node, at) {
  const range = document.createRange();
  range.selectNodeContents(code);
  range.setEnd(node, at);
  return range.toString().length;
}

/** Réécrit le bloc d'un seul tenant et y replace la sélection. */
function rewrite(code, text, from, to) {
  code.textContent = text;
  const node = code.firstChild ?? code.appendChild(document.createTextNode(''));

  const range = document.createRange();
  range.setStart(node, Math.min(from, node.length));
  range.setEnd(node, Math.min(to, node.length));

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  commit();
}

/**
 * Indente ou désindente, à la façon d'un éditeur de texte.
 *
 * Au curseur seul, la tabulation s'écrit là où l'on est. Dès que la sélection
 * couvre plusieurs lignes — et toujours, pour la désindentation — ce sont les
 * lignes entières qui se décalent, y compris celle où la sélection s'arrête.
 */
function shift(code, out) {
  const { text, from, to } = textRange(code);
  const spans = to > from && text.slice(from, to).includes('\n');

  if (!out && !spans) {
    const at = from + INDENT.length;
    rewrite(code, text.slice(0, from) + INDENT + text.slice(to), at, at);
    return;
  }

  // De la première ligne touchée à la fin de la dernière.
  const start = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const eol = text.indexOf('\n', to);
  const stop = eol < 0 ? text.length : eol;

  const deltas = [];
  const lines = text.slice(start, stop).split('\n').map((line) => {
    if (!out) {
      // Une ligne vide n'a rien à aligner : on ne l'encombre pas.
      const add = line.trim() ? INDENT : '';
      deltas.push(add.length);
      return add + line;
    }
    const found = line.match(/^(\t| {1,4})/);
    deltas.push(found ? -found[0].length : 0);
    return found ? line.slice(found[0].length) : line;
  });

  const total = deltas.reduce((sum, d) => sum + d, 0);
  const head = Math.max(start, from + deltas[0]);
  rewrite(
    code,
    text.slice(0, start) + lines.join('\n') + text.slice(stop),
    head,
    Math.max(head, to + total),
  );
}

export function wire() {
  rich.addEventListener('keydown', (ev) => {
    if (!rich.isContentEditable) return;

    const tab = isTab(ev);
    if (!tab && ev.key !== 'Enter') return;
    // La liste des langages garde ses touches : Entrée l'ouvre, Tabulation la
    // quitte.
    if (ev.target.closest?.('.chrome')) return;
    // Les raccourcis du système gardent leur sens : seule la frappe nue, ou
    // avec Majuscule, appartient au bloc.
    if (tab && (ev.ctrlKey || ev.metaKey || ev.altKey)) return;

    const code = codeAt();
    if (!code) return;

    ev.preventDefault();
    if (tab) shift(code, ev.shiftKey);
    else if (ev.ctrlKey || ev.metaKey) leave(code);
    else newline(code);
  });
}

/** Renvoie au Markdown ce que l'on vient de changer. */
function commit() {
  rich.dispatchEvent(new Event('input', { bubbles: true }));
}
