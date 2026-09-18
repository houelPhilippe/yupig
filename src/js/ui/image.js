// Menu contextuel et boîte de propriétés d'une image.
//
// Markdown ne sait dire ni légende, ni taille, ni alignement. Les trois se
// portent sur une `<figure>` **dans l'aperçu**, mais s'écrivent dans le fichier
// avec la syntaxe d'attributs de Pandoc / Quarto :
//
//     ![la légende](image.svg){fig-align="center" width=90%}
//
// `markdown.js` fait la traduction dans les deux sens. L'adresse `asset:` de
// l'aperçu ne part donc jamais dans le fichier : c'est `data-src` qui y va.

import { el, icon, replace, wireHints, PATH } from './dom.js';
// Le calage au pointeur est celui du cadre commun : un seul endroit sait le faire.
import { place } from './menu.js';
import * as store from '../store.js';
import * as api from '../api.js';
import { imageResolver } from './editor.js';
import { captionInto, captionSource, captionText, CAPTION_LINK } from '../markdown.js';

const rich = document.getElementById('editor-rich');
const dialog = document.getElementById('image-dialog');
const closeBtn = document.getElementById('image-dialog-close');
const file = document.getElementById('image-file');
const browseBtn = document.getElementById('image-browse');
const caption = document.getElementById('image-caption');
const linkBtn = document.getElementById('image-link');
const linkField = document.getElementById('image-link-field');
const linkUrl = document.getElementById('image-link-url');
const linkApply = document.getElementById('image-link-apply');
const size = document.getElementById('image-size');
const alignSeg = document.getElementById('image-align');
const status = document.getElementById('image-status');

// Ce que la barre d'état affiche quand aucun champ n'est parcouru : le chemin
// de l'image, tel qu'il est écrit dans le document.
let resting = '';
let say = () => {};

let menu = null;
// Le fragment de légende que le bouton « lien » va entourer. Il se retient au
// clic : ouvrir le champ d'adresse fait perdre la sélection au champ Légende.
let span = null;
// L'image sur laquelle porte la boîte de propriétés. C'est un nœud du
// document, pas un état partagé : il n'a rien à faire dans `store`.
let target = null;

// ------------------------------------------------------------------ menu

/** Ouvre le menu propre à une image. Rendu à `format.js`, qui le délègue. */
export function open(img, x, y) {
  close();
  // En lecture seule on peut copier et rafraîchir, pas modifier.
  const editable = store.state.edition.mode === 'edit';

  menu = el('div.ctx', {
    role: 'menu',
    onmousedown: (ev) => ev.preventDefault(),
  });

  replace(
    menu,
    [
      el('div.ctx__title', {}, 'Image'),
      editable ? entry('Propriétés…', PATH.sliders, () => openDialog(img)) : null,
      entry('Actualiser l’image', PATH.refresh, () => refresh(img)),
      editable ? entry('Couper l’image', PATH.cut, () => cut(img)) : null,
      entry('Copier l’image', PATH.copy, () => copy(img)),
      editable ? el('div.ctx__sep') : null,
      editable ? entry('Supprimer l’image', PATH.trash, () => remove(img)) : null,
    ].filter(Boolean),
  );

  place(menu, x, y);
}

export function close() {
  menu?.remove();
  menu = null;
}

function entry(label, path, run) {
  const mark = el('span.ctx__mark');
  mark.append(icon(path, { size: 13 }));
  return el(
    'button.ctx__item',
    {
      role: 'menuitem',
      onclick: () => {
        close();
        Promise.resolve(run()).catch(store.fail);
      },
    },
    mark,
    el('span', {}, label),
  );
}

// -------------------------------------------------------------- actions

/**
 * Recharge l'image depuis le disque.
 *
 * La webview garde l'image en cache : sans adresse distincte, un fichier
 * modifié par ailleurs continuerait d'afficher l'ancienne version. On ne
 * touche qu'à `src` — `data-src` porte le chemin qui repart dans le fichier,
 * et le document n'est donc pas marqué comme modifié.
 */
function refresh(img) {
  const src = img.getAttribute('src');
  if (!src) return;
  const base = src.split('?')[0];
  img.setAttribute('src', `${base}?t=${Date.now()}`);
}

/**
 * Copie l'image dans le presse-papiers.
 *
 * Les octets viennent de Rust plutôt que d'un `fetch` : la CSP n'autorise pas
 * la webview à se connecter au protocole `asset`. Si le presse-papiers refuse
 * une image — le support varie selon les moteurs — on se rabat sur la
 * référence Markdown, qui reste utile pour la recoller ailleurs.
 *
 * Rend vrai quand quelque chose est bien parti : la coupe s'en sert pour savoir
 * si elle peut retirer l'image.
 */
async function copy(img) {
  const path = img.getAttribute('data-src');
  if (!path) return false;

  const reference = `![${img.getAttribute('alt') ?? ''}](${path})`;
  try {
    const { mime, base64 } = await api.readImage(path);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
  } catch {
    try {
      await navigator.clipboard.writeText(reference);
      store.fail('Image non copiable telle quelle : sa référence Markdown l’a été.');
    } catch {
      store.fail('Le presse-papiers a refusé la copie.');
      return false;
    }
  }
  return true;
}

/**
 * Coupe l'image : la copie, puis le retrait.
 *
 * Dans cet ordre, et pas l'inverse : si le presse-papiers refuse tout — les
 * octets comme la référence Markdown —, l'image reste dans le document. La
 * référence seule suffit à couper : c'est elle que porte le fichier.
 */
async function cut(img) {
  if (await copy(img)) remove(img);
}

/**
 * Retire l'image du document.
 *
 * C'est la figure qui part quand il y en a une : sans elle, sa légende
 * resterait seule sous un trou. Le paragraphe que l'image occupait à elle
 * seule s'en va avec, plutôt que de laisser une ligne vide dans le texte.
 */
function remove(img) {
  const node = figureOf(img) ?? img;
  const parent = node.parentElement;
  node.remove();
  if (parent?.tagName === 'P' && !parent.textContent.trim() && !parent.querySelector('img')) {
    parent.remove();
  }
  // La boîte de propriétés porterait sur une image qui n'est plus là.
  if (target === img) closeDialog();
  commit();
}

// ----------------------------------------------------------- propriétés

/** La figure qui entoure l'image, s'il y en a une. */
function figureOf(img) {
  return img.parentElement?.tagName === 'FIGURE' ? img.parentElement : null;
}

/** La figure qui entoure l'image — créée au besoin. */
function ensureFigure(img) {
  const existing = figureOf(img);
  if (existing) return existing;
  const figure = document.createElement('figure');
  img.replaceWith(figure);
  figure.append(img);
  return figure;
}

function readLayout(img) {
  const figure = figureOf(img);
  const style = figure?.getAttribute('style') ?? '';
  const width = style.match(/width:\s*(\d+(?:\.\d+)?)%/);
  const left = /margin-left:\s*auto/.test(style);
  const right = /margin-right:\s*auto/.test(style);

  return {
    caption: captionSource(figure?.querySelector('figcaption')),
    width: width ? Math.round(Number(width[1])) : 100,
    // Les deux marges automatiques centrent ; la seule marge gauche pousse à
    // droite ; sinon l'image reste à gauche.
    align: left && right ? 'centre' : left ? 'droite' : 'gauche',
  };
}

function openDialog(img) {
  target = img;
  const layout = readLayout(img);

  file.value = img.getAttribute('data-src') ?? img.getAttribute('src') ?? '';
  caption.value = layout.caption;
  size.value = String(layout.width);
  for (const input of alignSeg.querySelectorAll('input[name="imgalign"]')) {
    input.checked = input.value === layout.align;
  }
  resting = img.getAttribute('data-src') ?? '';
  say(resting);

  closeLink();
  dialog.hidden = false;
  caption.focus();
  caption.setSelectionRange(caption.value.length, caption.value.length);
  refreshLink();
}

function closeDialog() {
  closeLink();
  dialog.hidden = true;
  target = null;
}

/**
 * Change le fichier affiché, sans toucher au reste.
 *
 * Le document ne porte que le chemin relatif — c'est `data-src` qui le garde.
 * L'aperçu, lui, a besoin de l'adresse `asset:` que seul le résolveur sait
 * bâtir : hors du dossier du projet il n'y en a pas, et l'image reste alors
 * sans `src` plutôt que d'en porter un qui ne veut rien dire.
 */
function swap(link) {
  const tab = store.activeTab();
  if (!target || !tab || !link) return;

  target.setAttribute('data-src', link);
  const url = imageResolver(tab)?.(link);
  if (url) target.setAttribute('src', url);
  else target.removeAttribute('src');

  // La barre d'état porte le chemin de l'image : il vient de changer.
  resting = link;
  say(resting);
  commit();
}

/** Désigne un autre fichier, écrit en lien relatif au document. */
async function browse() {
  const tab = store.activeTab();
  if (!target || !tab) return;

  const chosen = await api.pickImage();
  if (!chosen) return;

  const link = await api.fileLink(tab.path, chosen);
  file.value = link;
  swap(link);
}

/** Reporte les trois champs sur la figure. */
function apply() {
  if (!target) return;

  const width = Math.min(100, Math.max(5, Number(size.value) || 100));
  const align = alignSeg.querySelector('input[name="imgalign"]:checked')?.value ?? 'gauche';
  const legend = caption.value.trim();

  // Une image sans légende, à taille pleine et alignée à gauche n'a plus
  // besoin de sa figure : on la lui retire plutôt que de laisser du balisage
  // vide dans le document.
  if (!legend && width === 100 && align === 'gauche') {
    const figure = figureOf(target);
    if (figure) figure.replaceWith(target);
    commit();
    return;
  }

  const figure = ensureFigure(target);
  const decls = [];
  if (width !== 100) decls.push(`width: ${width}%`);
  if (align === 'centre') decls.push('margin-left: auto', 'margin-right: auto');
  else if (align === 'droite') decls.push('margin-left: auto', 'margin-right: 0');
  // « Gauche » est le comportement par défaut : on n'écrit rien, et le
  // Markdown ne porte alors aucun `fig-align`.
  if (decls.length) figure.setAttribute('style', decls.join('; '));
  else figure.removeAttribute('style');

  let node = figure.querySelector('figcaption');
  if (legend) {
    if (!node) {
      node = document.createElement('figcaption');
      figure.append(node);
    }
    captionInto(node, legend);
  } else {
    node?.remove();
  }
  // Chez Pandoc, le texte entre crochets est à la fois la légende et le texte
  // de remplacement. L'`alt` n'a toutefois que faire de la syntaxe des liens :
  // il n'en garde que le texte, qui est ce qu'une synthèse vocale doit lire.
  target.setAttribute('alt', captionText(legend));

  commit();
}

// --------------------------------------------------- lien de la légende

/** Le lien déjà posé qui contient une position de la légende, s'il y en a un. */
function linkAt(value, pos) {
  for (const found of value.matchAll(CAPTION_LINK)) {
    const start = found.index;
    const end = start + found[0].length;
    if (pos >= start && pos <= end) {
      return { start, end, text: found[1], href: found[2] };
    }
  }
  return null;
}

/**
 * Ce sur quoi le bouton « lien » va porter.
 *
 * Le curseur posé dans un lien existant le désigne — c'est lui qu'on modifie,
 * sélection ou non. Sinon il faut un fragment sélectionné : sans texte à
 * entourer, il n'y a pas de lien à poser.
 */
function spanOf() {
  const value = caption.value;
  const from = caption.selectionStart ?? 0;
  const to = caption.selectionEnd ?? 0;

  const existing = linkAt(value, from);
  if (existing) return existing;
  if (from === to) return null;
  return { start: from, end: to, text: value.slice(from, to), href: '' };
}

/** Accorde le bouton à ce que la légende a de sélectionné. */
function refreshLink() {
  const found = spanOf();
  linkBtn.disabled = !found;
  linkBtn.title = !found
    ? 'Sélectionnez d’abord le texte à lier'
    : found.href
      ? 'Modifier le lien'
      : 'Lier le texte sélectionné';
}

/** Ouvre le champ d'adresse sur le fragment retenu. */
function beginLink() {
  // La sélection se retient maintenant : donner le focus au champ d'adresse
  // la ferait perdre au champ Légende.
  span = spanOf();
  if (!span) return;
  linkUrl.value = span.href;
  linkField.hidden = false;
  linkUrl.focus();
  linkUrl.select();
}

function closeLink() {
  linkField.hidden = true;
  linkUrl.value = '';
  span = null;
}

/** Pose, change ou retire le lien, puis reporte la légende sur la figure. */
function applyLink() {
  if (!span) return closeLink();

  const href = linkUrl.value.trim();
  // Une adresse vide retire le lien et ne garde que son texte.
  const written = href ? `[${span.text}](${href})` : span.text;
  const { start, end } = span;
  caption.value = caption.value.slice(0, start) + written + caption.value.slice(end);

  closeLink();
  caption.focus();
  caption.setSelectionRange(start, start + written.length);
  apply();
  refreshLink();
}

function commit() {
  rich.dispatchEvent(new Event('input', { bubbles: true }));
}

export function wire() {
  // Au repos, la barre d'état porte le chemin de l'image.
  say = wireHints(dialog, status, () => resting);
  closeBtn.append(icon(PATH.close, { size: 13 }));
  closeBtn.addEventListener('click', closeDialog);
  linkBtn.append(icon(PATH.link, { size: 13 }));

  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) closeDialog();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || dialog.hidden) return;
    ev.preventDefault();
    // Le champ d'adresse ouvert se referme seul : la boîte ne part qu'au
    // deuxième Échap, sinon on perdrait les trois autres champs pour un lien
    // qu'on renonçait seulement à poser.
    if (!linkField.hidden) {
      closeLink();
      caption.focus();
      refreshLink();
      return;
    }
    closeDialog();
  });

  // `change` plutôt que `input` : sur un champ de texte il attend la validation
  // ou la sortie du champ, ce qui évite de réécrire le document à chaque touche.
  for (const field of [caption, size, alignSeg]) {
    field.addEventListener('change', apply);
  }

  // Le fichier ne passe pas par `apply` : il ne touche ni à la légende, ni à
  // la taille, ni à l'alignement — seulement aux deux chemins de la balise.
  file.addEventListener('change', () => swap(file.value.trim()));
  browseBtn.addEventListener('click', () => browse().catch(store.fail));
  // Le bouton ne s'allume que si la légende a de quoi lier : ces quatre
  // événements couvrent la sélection à la souris comme au clavier.
  for (const kind of ['select', 'keyup', 'mouseup', 'input']) {
    caption.addEventListener(kind, refreshLink);
  }
  // Le bouton ne prend pas le focus : sans cela le champ Légende le perdrait
  // au clic, et `spanOf` lirait une sélection déjà défaite.
  linkBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
  linkBtn.addEventListener('click', beginLink);
  linkApply.addEventListener('click', applyLink);
  linkUrl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      applyLink();
    }
  });

  caption.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      apply();
      closeDialog();
    }
  });
}
