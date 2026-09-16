// Couper, copier, coller — dans la zone d'édition comme dans son menu.
//
// Deux règles tiennent tout le module.
//
// **Ce qu'on copie part en Markdown.** La forme `text/plain` du presse-papiers
// porte le Markdown de la sélection, comme le fait déjà la copie d'un tableau :
// recollé dans « Code Markdown », dans un autre éditeur ou dans un terminal,
// c'est exactement ce que le fichier porterait. La forme `text/html`, elle, part
// pour « Modifier » et les traitements de texte, qui recollent du texte mis en
// forme plutôt que des étoiles et des dièses.
//
// **Ce qu'on colle passe par le Markdown.** Le HTML venu d'ailleurs — une page
// du navigateur, un traitement de texte — est ramené au Markdown par `turndown`
// puis relu par `marked` avant d'entrer dans le rendu. Rien ne s'installe donc
// dans le document que le fichier ne sache porter : ni police, ni classe, ni
// balise inconnue. C'est aussi ce qui donne son adresse d'affichage à une image
// collée — le Markdown repasse par `toFragment`, qui résout le chemin relatif
// en `asset:`. Le texte brut, lui, reste du texte brut : on ne le relit pas
// comme du Markdown, sans quoi coller « 2. rue du Port » dans un paragraphe y
// ouvrirait une liste numérotée.
//
// Les trois commandes ont deux portes — la frappe du moteur d'édition et
// l'entrée du menu — et une seule lecture de la sélection : `payload` sert aux
// deux, si bien que Ctrl+C et « Copier » mettent rigoureusement la même chose
// dans le presse-papiers.
//
// Le collage du menu fait exception sur un point, et c'est le seul : aucun
// script ne sait déclencher un collage, il lui faut donc lire le presse-papiers
// lui-même — ce que le moteur peut refuser. La frappe, elle, ne passe jamais par
// là : l'événement `paste` apporte déjà ce qu'il faut, sans permission à
// demander.

import * as store from '../store.js';
import { toFragment, toMarkdown } from '../markdown.js';
import { imageResolver } from './editor.js';
import * as code from './code.js';

const rich = document.getElementById('editor-rich');
const area = document.getElementById('editor-area');

export function wire() {
  // Le rendu est le seul des deux à avoir besoin qu'on reprenne la copie : ce
  // qu'il montre est du HTML, et le presse-papiers doit en recevoir le
  // Markdown. Dans la source, le texte sélectionné *est* déjà le Markdown, et
  // la copie du moteur fait exactement ce qu'il faut.
  rich.addEventListener('copy', (ev) => hand(ev));
  rich.addEventListener('cut', (ev) => {
    if (!hand(ev)) return;
    // Les deux formes sont posées, la coupe reste à faire : `preventDefault` a
    // retiré l'effacement en même temps que la copie du moteur.
    replaceSelection(false, '');
  });

  // Le collage, lui, se reprend dans les deux : c'est là que le HTML d'ailleurs
  // est ramené au Markdown avant d'entrer dans le document.
  rich.addEventListener('paste', (ev) => onPaste(ev, false));
  area.addEventListener('paste', (ev) => onPaste(ev, true));
}

// ------------------------------------------------------------ le menu

/** Y a-t-il de quoi couper ou copier ? Sinon les deux entrées sont éteintes. */
export function filled(source) {
  if (source) return area.selectionEnd > area.selectionStart;
  const range = richRange();
  return Boolean(range && !range.collapsed);
}

/**
 * Copie la sélection.
 *
 * Le menu le dit, la frappe non : un clic sur « Copier » ne change rien à
 * l'écran, et sans un mot on ne saurait pas s'il a porté. Ctrl+C, lui, n'a
 * jamais eu besoin qu'on le lui confirme.
 */
export async function copy(source) {
  const load = payload(source);
  if (!load) return;
  await write(load.text, load.html);
  store.notify('Sélection copiée.');
}

/**
 * Coupe la sélection.
 *
 * L'écriture dans le presse-papiers d'abord, l'effacement ensuite : si le
 * presse-papiers refuse, `write` lève et la sélection reste où elle est. Une
 * coupe qui efface sans avoir copié perdrait le texte.
 */
export async function cut(source) {
  const load = payload(source);
  if (!load) return;
  await write(load.text, load.html);
  replaceSelection(source, '');
}

/**
 * Colle, en lisant le presse-papiers.
 *
 * Seule l'entrée du menu passe par ici : la frappe, elle, reçoit l'événement
 * `paste`, qui porte déjà les deux formes. La lecture peut être refusée — c'est
 * une permission, et elle ne vaut qu'au geste de l'utilisateur ; on le dit
 * alors, en renvoyant à la frappe, qui ne la demande pas.
 */
export async function paste(source) {
  let flavours;
  try {
    flavours = await read();
  } catch {
    store.fail('Le presse-papiers n’a pas voulu se laisser lire ; Ctrl+V fait la même chose.');
    return;
  }

  const { html, text } = flavours;
  if (!html && !text) {
    store.notify('Le presse-papiers ne contient pas de texte.', 'error');
    return;
  }

  (source ? area : rich).focus({ preventScroll: true });
  insert(source, html, text);
}

/**
 * Écrit dans le presse-papiers, sous les deux formes quand il y en a deux.
 *
 * Un seul endroit sait le faire : la copie d'une sélection et celle d'un tableau
 * y passent toutes deux, et le repli — le texte seul, quand le moteur refuse les
 * deux formes — n'a pas à s'écrire deux fois.
 *
 * Lève quand rien n'a pu être écrit, plutôt que de le signaler elle-même :
 * l'appelant sait ce qu'il copiait, et la coupe a besoin de savoir que rien
 * n'est parti.
 */
export async function write(text, html = '') {
  if (html) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // Le moteur n'a pas voulu des deux formes : le Markdown seul reste ce qui
      // compte, puisque c'est lui que le fichier porte.
    }
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error('Le presse-papiers a refusé la copie.');
  }
}

// ------------------------------------------------------- ce qu'on copie

/**
 * Les deux formes de ce qui est sélectionné, ou `null` s'il n'y a rien.
 *
 * Dans la source, la sélection est du texte, et ce texte est déjà du Markdown :
 * il n'y a pas de seconde forme à donner.
 */
function payload(source) {
  if (source) {
    const text = area.value.slice(area.selectionStart, area.selectionEnd);
    return text ? { text, html: '' } : null;
  }

  const range = richRange();
  if (!range || range.collapsed) return null;

  const box = document.createElement('div');
  box.append(range.cloneContents());
  // Le mobilier d'éditeur n'est pas du texte : la liste des langages posée sur
  // un bloc de code ne part ni dans le fichier, ni dans le presse-papiers.
  for (const node of box.querySelectorAll('.chrome')) node.remove();
  // Une image recollée ailleurs doit porter son chemin relatif : l'adresse
  // `asset:` de l'affichage ne veut rien dire hors de cette machine.
  for (const img of box.querySelectorAll('img[data-src]')) {
    img.setAttribute('src', img.getAttribute('data-src'));
  }

  try {
    const text = toMarkdown(box.innerHTML);
    return text ? { text, html: box.innerHTML } : null;
  } catch {
    // `turndown` absent de vendor/ : mieux vaut laisser le moteur copier à sa
    // façon que de ne rien copier du tout.
    return null;
  }
}

/**
 * Pose les deux formes dans l'événement de copie ou de coupe.
 *
 * Rend vrai quand il a pris la main : la coupe s'en sert pour savoir qu'elle a
 * l'effacement à sa charge.
 */
function hand(ev) {
  const load = payload(false);
  if (!load || !ev.clipboardData) return false;

  ev.preventDefault();
  ev.clipboardData.setData('text/plain', load.text);
  ev.clipboardData.setData('text/html', load.html);
  return true;
}

/** La sélection, si elle est bien dans le rendu. */
function richRange() {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  return rich.contains(range.commonAncestorContainer) ? range : null;
}

// ------------------------------------------------------- ce qu'on colle

function onPaste(ev, source) {
  const data = ev.clipboardData;
  if (!data) return;

  const html = data.getData('text/html');
  const text = data.getData('text/plain');
  // Une image, un fichier : rien que ce module sache poser dans le document.
  // Le moteur non plus, mais c'est à lui d'en décider.
  if (!html && !text) return;

  ev.preventDefault();
  insert(source, html, text);
}

/**
 * Pose au point d'insertion ce que le presse-papiers portait.
 *
 * Le HTML l'emporte quand il y en a : c'est lui qui porte la mise en forme, et
 * `turndown` la ramène à ce que le fichier sait écrire. À défaut, le texte brut
 * est posé tel quel.
 */
function insert(source, html, text) {
  // Dans un bloc de code, le texte est du texte : la mise en forme n'y a pas
  // cours, et la ramener au Markdown y sèmerait des échappements.
  if (verbatim(source)) {
    type(source, text);
    return;
  }

  let markdown = '';
  try {
    if (html) markdown = toMarkdown(html);
  } catch {
    // Sans `turndown`, le texte brut reste.
  }

  // Dans la source, tout se dit en texte : le Markdown qu'on vient d'obtenir
  // s'y écrit tel quel.
  if (source) {
    type(true, markdown || text);
    return;
  }
  if (!markdown) {
    type(false, text);
    return;
  }

  const tab = store.activeTab();
  const box = document.createElement('div');
  try {
    box.append(toFragment(markdown, tab ? imageResolver(tab) : null));
  } catch {
    type(false, text);
    return;
  }

  // Un seul paragraphe : on le déplie. Sans cela, coller deux mots au milieu
  // d'une phrase y ouvrirait un paragraphe et couperait la phrase en deux.
  const only = box.childNodes.length === 1 ? box.firstElementChild : null;
  const out = only?.nodeName === 'P' ? only.innerHTML : box.innerHTML;

  rich.focus({ preventScroll: true });
  document.execCommand('insertHTML', false, out);
  // Un bloc de code collé arrive sans sa liste de langages : le rendu la repose
  // à chaque reconstruction, mais rien ne vient d'être reconstruit.
  code.decorate();
}

/**
 * Le point d'insertion est-il dans un bloc de code ?
 *
 * Dans la source, la question se règle aux clôtures : la première ouvre, la
 * suivante ferme — un nombre impair devant le point d'insertion, et l'on écrit
 * dans du code.
 */
function verbatim(source) {
  if (source) {
    const fences = area.value.slice(0, area.selectionStart).match(/^(?:```|~~~)/gm);
    return (fences?.length ?? 0) % 2 === 1;
  }

  const at = richRange()?.commonAncestorContainer;
  const node = at?.nodeType === Node.ELEMENT_NODE ? at : at?.parentElement;
  return Boolean(node?.closest?.('pre, code'));
}

/** Pose du texte au point d'insertion. Rien à poser, rien à faire. */
function type(source, text) {
  if (text) replaceSelection(source, text);
}

/**
 * Remplace la sélection par du texte — vide, c'est une coupe.
 *
 * Par le moteur plutôt qu'à la main : il tient l'historique d'annulation et
 * signale lui-même la saisie, dont le reste de l'application vit. S'il refuse —
 * la zone de saisie de la source n'est pas un document éditable, et tous les
 * moteurs n'y répondent pas —, on écrit nous-mêmes, au prix de l'annulation.
 */
function replaceSelection(source, text) {
  const host = source ? area : rich;
  host.focus({ preventScroll: true });

  const done = text
    ? document.execCommand('insertText', false, text)
    : document.execCommand('delete');
  if (done || !source) return;

  const { selectionStart: a, selectionEnd: b, value } = area;
  area.value = value.slice(0, a) + text + value.slice(b);
  area.setSelectionRange(a + text.length, a + text.length);
  // C'est cet événement que `ui/editor.js` écoute pour ramener la saisie au
  // document : sans lui, le texte serait à l'écran et nulle part ailleurs.
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Lit le presse-papiers, dans ses deux formes quand il les a.
 *
 * `read` d'abord : c'est le seul appel qui rende le HTML, donc la mise en forme.
 * Les moteurs qui ne l'ont pas gardent `readText`, qui ne rend que le texte.
 */
async function read() {
  try {
    const items = await navigator.clipboard.read();
    const item = items.find(
      (i) => i.types.includes('text/html') || i.types.includes('text/plain'),
    );
    if (!item) return { html: '', text: '' };

    const flavour = async (kind) =>
      (item.types.includes(kind) ? (await item.getType(kind)).text() : '');
    return { html: await flavour('text/html'), text: await flavour('text/plain') };
  } catch {
    return { html: '', text: await navigator.clipboard.readText() };
  }
}
