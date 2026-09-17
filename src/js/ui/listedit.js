// Entrée dans une liste du rendu, et le rang d'une entrée.
//
// Le moteur d'édition ne sait pas toujours prolonger une liste : dans une liste
// aérée, chaque entrée porte un paragraphe, et Entrée y coupe le paragraphe au
// lieu de créer une entrée ; dans une liste à cocher, la case ne suit pas. On
// prend donc la main sur Entrée dès que le curseur est dans une entrée, pour
// que la frappe fasse partout ce qu'elle fait dans un traitement de texte :
//
//   - au milieu ou en fin d'entrée, elle coupe l'entrée en deux — ce qui suit
//     le curseur part dans une nouvelle entrée, avec une case décochée si la
//     liste en porte, dans un paragraphe si la liste est aérée ;
//   - sur une entrée vide, elle sort d'un rang : une sous-entrée remonte, une
//     entrée de premier rang quitte la liste et devient un paragraphe.
//
// Majuscule+Entrée garde son sens — un saut de ligne dans la même entrée —, et
// un bloc de code logé dans une entrée reste à `code.js`.
//
// Ce module est une feuille : il ne connaît que le rendu. `format.js` lui
// emprunte `nest` et `unnest` pour son retrait, si bien que la frappe et le
// menu déplacent une entrée de la même façon.

const rich = document.getElementById('editor-rich');

/**
 * Imbrique l'entrée sous celle qui la précède.
 *
 * La première entrée d'une liste n'a rien où s'imbriquer : en Markdown, une
 * sous-liste est le contenu d'une entrée, et sans entrée au-dessus, les quatre
 * espaces feraient un bloc de code.
 */
export function nest(li) {
  const host = li.previousElementSibling;
  if (host?.nodeName !== 'LI') return;

  const list = li.parentElement;
  const last = host.lastElementChild;
  if (last?.nodeName === list.nodeName) last.append(li);
  else {
    const made = document.createElement(list.nodeName);
    made.append(li);
    host.append(made);
  }
}

/** Remonte l'entrée d'un rang. Ce qui la suivait la suit encore. */
export function unnest(li) {
  const list = li.parentElement;
  const host = list?.parentElement;
  if (host?.nodeName !== 'LI') return;

  const after = [...list.children].slice([...list.children].indexOf(li) + 1);
  host.after(li);
  if (after.length) {
    const tail = document.createElement(list.nodeName);
    tail.append(...after);
    li.append(tail);
  }
  if (!list.children.length) list.remove();
}

const isList = (node) => node?.nodeName === 'UL' || node?.nodeName === 'OL';
const isBox = (node) => node?.nodeName === 'INPUT' && node.getAttribute('type') === 'checkbox';

/** L'entrée où se trouve le curseur — la plus profonde —, dans le rendu. */
function itemAt(node) {
  let at = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  while (at && at !== rich) {
    if (at.nodeName === 'PRE') return null;
    if (at.nodeName === 'LI') return rich.contains(at) ? at : null;
    at = at.parentElement;
  }
  return null;
}

/** La case de l'entrée, qu'elle soit posée en tête de l'entrée ou de son paragraphe. */
function boxOf(li) {
  const first = li.firstElementChild;
  if (isBox(first)) return first;
  if (first?.nodeName === 'P' && isBox(first.firstElementChild)) return first.firstElementChild;
  return null;
}

/**
 * L'entrée ne porte-t-elle rien ? Sa case et ses sous-listes ne comptent pas :
 * une case seule n'est pas un texte, et une sous-liste appartient à ses
 * propres entrées.
 */
function empty(li) {
  const copy = li.cloneNode(true);
  for (const node of copy.querySelectorAll('ul, ol, input')) node.remove();
  if (copy.querySelector('img')) return false;
  return !copy.textContent.replace(/​/g, '').trim();
}

/** Un nœud vide garde sa hauteur de ligne, et le curseur de quoi s'y poser. */
function fill(node) {
  if (!node.textContent && !node.querySelector('br, img, input')) node.append(document.createElement('br'));
}

function place(node, offset) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Coupe l'entrée au curseur : ce qui suit part dans une nouvelle entrée,
 * sous-listes comprises — elles appartiennent désormais à celle-ci.
 */
function split(li, range) {
  const lists = [...li.children].filter(isList);

  const tail = document.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  if (lists.length) tail.setEndBefore(lists[0]);
  else tail.setEnd(li, li.childNodes.length);
  const moved = tail.extractContents();

  const made = document.createElement('li');
  made.append(moved, ...lists);

  // Une liste aérée garde ses paragraphes : la nouvelle entrée en ouvre un si
  // la coupe n'en a pas emporté.
  const loose = li.firstElementChild?.nodeName === 'P';
  if (loose && made.firstElementChild?.nodeName !== 'P') {
    const p = document.createElement('p');
    while (made.firstChild && !isList(made.firstChild)) p.append(made.firstChild);
    made.prepend(p);
  }
  const head = loose ? made.firstElementChild : made;

  // Une liste à cocher prolonge ses cases, décochées : la nouvelle tâche n'est
  // pas faite parce que la précédente l'était.
  const box = boxOf(li);
  if (box && !isBox(head.firstElementChild)) {
    const fresh = box.cloneNode(false);
    fresh.removeAttribute('checked');
    fresh.checked = false;
    head.prepend(fresh, document.createTextNode(' '));
  }

  // Ce que la coupe a laissé vide doit rester visible et atteignable.
  for (const p of li.querySelectorAll(':scope > p')) fill(p);
  if (!loose) fill(li);
  fill(head);

  li.after(made);
  // Le curseur en tête du texte de la nouvelle entrée, après sa case.
  const text = isBox(head.firstChild) ? head.childNodes[1] : head.firstChild;
  if (text?.nodeType === Node.TEXT_NODE) place(text, box ? Math.min(1, text.length) : 0);
  else place(head, isBox(head.firstChild) ? 1 : 0);
}

/**
 * Sort l'entrée vide de la liste de premier rang : les entrées qui la
 * suivaient forment une nouvelle liste, et elle-même devient un paragraphe
 * entre les deux.
 */
function leave(li) {
  const list = li.parentElement;
  const after = [...list.children].slice([...list.children].indexOf(li) + 1);

  const p = document.createElement('p');
  p.append(document.createElement('br'));
  list.after(p);

  if (after.length) {
    const rest = list.cloneNode(false);
    // Une liste numérotée poursuit sa numérotation, et non la reprend à 1.
    if (list.nodeName === 'OL') {
      const start = Number(list.getAttribute('start') ?? 1);
      rest.setAttribute('start', String(start + [...list.children].indexOf(li)));
    }
    rest.append(...after);
    p.after(rest);
  }
  li.remove();
  if (!list.children.length) list.remove();
  place(p, 0);
}

function commit() {
  rich.dispatchEvent(new Event('input', { bubbles: true }));
}

export function wire() {
  rich.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.defaultPrevented || ev.isComposing) return;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!rich.isContentEditable || ev.target.closest?.('.chrome')) return;

    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const li = itemAt(sel.getRangeAt(0).startContainer);
    if (!li) return;

    ev.preventDefault();
    // Une sélection étendue part d'abord, comme sous une frappe ordinaire.
    if (!sel.isCollapsed) document.execCommand('delete');
    const range = sel.getRangeAt(0);
    const at = itemAt(range.startContainer);
    if (!at) return;

    if (empty(at)) {
      if (at.parentElement?.parentElement?.nodeName === 'LI') {
        unnest(at);
        place(at, isBox(at.firstChild) ? 1 : 0);
      } else leave(at);
    } else split(at, range);
    commit();
  });
}
