// Boîte du lien : quatre sortes de cible, un seul Markdown en sortie.
//
// Un lien s'écrit toujours `[texte](cible)` — c'est ce que le fichier porte,
// quelle que soit la sorte choisie. Ce qui change, c'est ce qu'on met dans la
// cible :
//
//   - **URL** : une adresse, telle quelle ;
//   - **Fichier** : un fichier du disque, écrit **relativement au document**
//     pour que le projet reste déplaçable — comme une image ou un `include` ;
//   - **ID** : un signet déjà posé dans le document, visé par `#identifiant` ;
//   - **Titre** : un titre du document. S'il n'a pas de signet, la boîte en
//     propose un et le fait poser : un lien vers un titre sans signet
//     dépendrait de l'identifiant que l'outil de compilation lui inventerait,
//     et ceux de Pandoc, de Quarto et de GitHub ne s'accordent pas.
//
// Les deux contrôles de cible — le champ et la liste — restent en place quelle
// que soit la sorte : les faire paraître et disparaître ferait sauter la boîte
// sous les yeux. C'est la barre d'état qui dit lequel compte, en montrant le
// texte exact qui sera écrit. La boîte du shortcode fait de même.
//
// Elle ne pose rien elle-même : elle rend à l'appelant le texte, la cible et,
// s'il y a lieu, le signet à poser — lui seul sait où écrire, selon le regard
// porté sur le document.
//
// La même boîte relit un lien déjà posé, depuis son menu contextuel : sa cible
// dit alors quelle sorte cocher, et ce qu'on valide remplace le lien visé au
// lieu d'en ajouter un.

import { el, icon, replace, wireHints, PATH } from './dom.js';
import * as store from '../store.js';
import * as api from '../api.js';
import { slug, unique } from '../anchors.js';

const dialog = document.getElementById('link-dialog');
const heading = document.getElementById('link-dialog-title');
const closeBtn = document.getElementById('link-dialog-close');
const cancelBtn = document.getElementById('link-cancel');
const insertBtn = document.getElementById('link-insert');
const status = document.getElementById('link-status');

const seg = document.getElementById('link-seg');
const labelField = document.getElementById('link-label');
const targetField = document.getElementById('link-target');
const browseBtn = document.getElementById('link-browse');
const pickSelect = document.getElementById('link-pick');

/**
 * Ce que chaque sorte de lien attend, et ce que son champ annonce.
 *
 * `needs` dit lequel des deux contrôles porte la cible : le champ de texte
 * (`target`) ou la liste (`pick`).
 */
const KINDS = {
  url: { needs: 'target', placeholder: 'https://exemple.fr' },
  file: { needs: 'target', placeholder: 'annexes/tableau.xlsx' },
  id: { needs: 'pick', placeholder: '' },
  heading: { needs: 'pick', placeholder: '' },
};

let deliver = null;
let context = null;
let say = () => {};

/**
 * Ouvre la boîte.
 *
 * `about` décrit le document sans dire d'où on le lit : les titres, les signets
 * déjà pris, et le texte sélectionné s'il y en a un. Chaque titre porte une
 * `key` que la boîte ne regarde pas — elle la rend telle quelle à l'appelant,
 * qui sait à quoi elle correspond : un nœud du rendu, ou un rang de ligne.
 *
 * `about.href`, quand il est donné, est la cible d'un lien déjà posé : la
 * boîte s'ouvre alors sur lui, pour le modifier.
 *
 * `run` reçoit `{ label, href, signet }`, où `signet` — quand il y en a un —
 * désigne le titre à marquer et l'identifiant à lui poser.
 */
export function open(about, run) {
  context = about;
  deliver = run;

  const editing = about.href != null;
  heading.textContent = editing ? 'Propriétés du lien' : 'Insérer un lien';
  insertBtn.textContent = editing ? 'Appliquer' : 'Insérer';

  labelField.value = about.label ?? '';
  if (editing) {
    const on = kindOf(about.href, about.ids);
    for (const input of seg.querySelectorAll('input[name="link"]')) {
      input.checked = input.value === on;
    }
    targetField.value = on === 'id' ? '' : about.href;
  }
  fillPick();
  if (editing && kind() === 'id') pickSelect.value = about.href.slice(1);
  dress();
  refresh();

  dialog.hidden = false;
  // Le texte d'abord : c'est ce qu'on a le plus souvent à écrire, la cible
  // venant ensuite du disque ou de la liste.
  labelField.focus();
  labelField.select();
}

function hide() {
  dialog.hidden = true;
  deliver = null;
  context = null;
}

/**
 * La sorte d'une cible déjà écrite.
 *
 * Un `#signet` qui vise un signet du document se relit comme tel ; un signet
 * absent reste dans le champ de texte, tel qu'il est écrit, plutôt que d'être
 * remplacé en silence par le premier de la liste. Une adresse porte son
 * protocole ; tout le reste est un chemin de fichier.
 */
function kindOf(href, ids) {
  if (href.startsWith('#') && ids.includes(href.slice(1))) return 'id';
  if (href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return 'url';
  return 'file';
}

function kind() {
  return seg.querySelector('input[name="link"]:checked')?.value ?? 'url';
}

/** Le champ de texte annonce ce que la sorte choisie y attend. */
function dress() {
  targetField.placeholder = KINDS[kind()].placeholder;
  // Parcourir le disque n'a de sens que pour un fichier.
  browseBtn.disabled = kind() !== 'file';
}

/**
 * Remplit la liste, selon que l'on vise un signet ou un titre.
 *
 * Les deux vocabulaires ne se mélangent pas : « ID » offre les signets déjà
 * posés — ce sont des cibles qui existent —, « Titre » offre tous les titres,
 * qu'ils aient un signet ou non, puisque la boîte sait en poser un.
 */
function fillPick() {
  if (!context) return;
  const on = kind();

  const options = on === 'id'
    ? context.ids.map((id) => el('option', { value: id }, `#${id}`))
    : context.headings.map((head, at) => el(
      'option',
      { value: String(at) },
      // Le niveau se lit au retrait : un sommaire se parcourt mieux ainsi
      // qu'avec six intitulés qui se ressemblent.
      `${'\u2003'.repeat(head.level - 1)}${head.text}${head.id ? ` (#${head.id})` : ''}`,
    ));

  const kept = pickSelect.value;
  replace(pickSelect, options);
  if (!options.length) {
    pickSelect.append(el('option', { value: '' }, on === 'id'
      ? 'Ce document ne porte aucun signet'
      : 'Ce document n’a pas de titre'));
  }
  // Garder le choix précédent s'il existe encore : changer de sorte puis
  // revenir ne doit pas le perdre.
  if ([...pickSelect.options].some((o) => o.value === kept)) pickSelect.value = kept;
}

/**
 * La cible retenue, et le signet à poser s'il en faut un.
 *
 * `null` quand rien n'est utilisable : la barre d'état le dit et le poussoir
 * reste éteint, plutôt que d'écrire un lien qui ne mène nulle part.
 */
function aim() {
  if (!context) return null;
  const on = kind();

  if (KINDS[on].needs === 'target') {
    const value = targetField.value.trim();
    return value ? { href: value, fallback: value, signet: null } : null;
  }

  if (on === 'id') {
    const id = pickSelect.value;
    return id ? { href: `#${id}`, fallback: id, signet: null } : null;
  }

  const at = Number(pickSelect.value);
  const head = context.headings[at];
  if (!head) return null;

  // Le titre porte déjà son signet : on le vise, sans rien changer au document.
  if (head.id) return { href: `#${head.id}`, fallback: head.text, signet: null };

  // Il n'en a pas : on lui en propose un, unique parmi ceux déjà pris, et
  // l'appelant le posera en même temps qu'il écrira le lien.
  const id = unique(slug(head.text), context.ids);
  return {
    href: `#${id}`,
    fallback: head.text,
    signet: { key: head.key, id },
  };
}

/**
 * Le texte du lien : celui qu'on a saisi, ou à défaut ce que la cible sait
 * dire de lui-même.
 *
 * Un lien sans texte ne se voit pas — `[](cible)` ne laisse rien à cliquer. Le
 * nom du titre visé ou celui du fichier vaut mieux que ce vide, et reste
 * modifiable une fois posé.
 */
function label(target) {
  const written = labelField.value.trim();
  if (written) return written;
  if (!target) return '';
  // D'un chemin, seul le nom du fichier fait un texte lisible.
  return target.fallback.split('/').pop() || target.fallback;
}

/** Le Markdown exact qui partira dans le document, ou ce qui l'en empêche. */
function preview() {
  const target = aim();
  if (!target) {
    return KINDS[kind()].needs === 'target'
      ? 'Indiquez la cible du lien.'
      : 'Choisissez la cible dans la liste.';
  }

  const text = `[${label(target)}](${target.href})`;
  if (!target.signet) return text;
  // Poser un signet modifie le titre visé : autant le dire avant de le faire.
  return `${text} — et le signet {#${target.signet.id}} sera posé sur le titre visé.`;
}

function refresh() {
  dress();
  insertBtn.disabled = aim() === null;
  say(preview());
}

/**
 * Choisit le fichier en parcourant le disque.
 *
 * Ce que le document porte reste un chemin **relatif** à lui, calculé par
 * Rust : un chemin absolu ne voudrait rien dire sur une autre machine. Le
 * sélecteur s'ouvre donc sur le projet, seul endroit d'où un tel chemin garde un
 * sens ; au-dehors, `files::link_from` refuse et le dit.
 */
async function browse() {
  const tab = store.activeTab();
  if (!tab) return;

  const chosen = await api.pickAnyFile(store.state.edition.root);
  if (!chosen) return;

  targetField.value = await api.fileLink(tab.path, chosen);
  refresh();
}

function submit() {
  const target = aim();
  if (!target) return;

  const out = { label: label(target), href: target.href, signet: target.signet };
  const run = deliver;
  hide();
  run?.(out);
}

export function wire() {
  say = wireHints(dialog, status, preview);

  closeBtn.append(icon(PATH.close, { size: 13 }));
  closeBtn.addEventListener('click', hide);
  cancelBtn.addEventListener('click', hide);
  insertBtn.addEventListener('click', submit);

  seg.addEventListener('change', () => {
    // La liste ne porte pas le même vocabulaire d'une sorte à l'autre.
    fillPick();
    refresh();
  });
  labelField.addEventListener('input', refresh);
  targetField.addEventListener('input', refresh);
  pickSelect.addEventListener('change', refresh);
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
