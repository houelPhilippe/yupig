// Volet droit, second contenu : les cinq clés que l'application sait poser en
// tête du document — title, subtitle, photo, abstract-title, toc-depth.
//
// Ce bloc n'a de sens qu'au tout début du fichier — Quarto n'en lit pas
// ailleurs — et c'est `frontmatter.js` qui l'y écrit, quel que soit l'endroit
// où se trouve le curseur : rien ici ne se pose au point d'insertion.
//
// Il n'y a rien à valider : un champ quitté écrit dans la source, comme les
// propriétés d'une image. L'écriture ne passe pas par le rendu — le bloc n'y
// entre jamais — mais directement par `store.edit`, `flush()` d'abord, pour ne
// pas effacer une saisie de « Modifier » qui n'aurait pas encore rejoint le
// Markdown.

import * as store from '../store.js';
import * as api from '../api.js';
import { flush } from './editor.js';
import * as front from '../frontmatter.js';

const pane = document.getElementById('frontmatter-pane');
const hint = document.getElementById('fm-hint');
const browseBtn = document.getElementById('fm-photo-browse');

/** Les champs, par la clé qu'ils portent dans le bloc. */
const FIELDS = {
  title: document.getElementById('fm-title'),
  subtitle: document.getElementById('fm-subtitle'),
  photo: document.getElementById('fm-photo'),
  'abstract-title': document.getElementById('fm-abstract'),
  'toc-depth': document.getElementById('fm-depth'),
};

export function render(state) {
  if (state.app !== 'edition') return;

  const showing = state.edition.aside === 'front';
  pane.hidden = !showing;
  if (!showing) return;

  const tab = store.activeTab();
  const markdown = store.isMarkdown(tab);

  for (const field of Object.values(FIELDS)) field.disabled = !markdown;
  hint.hidden = markdown;
  if (!markdown) {
    hint.textContent = tab
      ? 'Le bloc YAML ne se pose que sur un document Markdown.'
      : 'Aucun document ouvert.';
  }

  fill(markdown ? tab : null);
}

/**
 * Remplit les champs d'après le bloc en tête du document.
 *
 * Jamais sous les doigts : le champ en cours de saisie garde ce qui y est
 * tapé, sinon la moindre frappe ailleurs dans l'application le réécrirait.
 */
function fill(tab) {
  const values = tab ? front.read(tab.content) : {};
  for (const [key, field] of Object.entries(FIELDS)) {
    if (field === document.activeElement) continue;
    const want = values[key] ?? '';
    if (field.value !== want) field.value = want;
  }
}

/** Montre le volet et porte le clavier sur le premier champ. */
export function reveal() {
  store.setAside('front');
  FIELDS.title.focus();
  FIELDS.title.select();
}

/**
 * Reporte un champ sur la source.
 *
 * Rien n'est écrit quand la valeur n'a pas bougé : sans cette comparaison, une
 * simple visite du champ suffirait à réécrire le bloc — et à marquer le
 * document modifié — au seul motif que le fichier ne l'avait pas écrit dans
 * la forme que `frontmatter.js` emploie.
 */
function apply(key) {
  const tab = store.activeTab();
  if (!store.isMarkdown(tab)) return;

  const value = FIELDS[key].value.trim();
  if ((front.read(tab.content)[key] ?? '') === value) return;

  flush();
  const next = front.write(tab.content, { [key]: value });
  store.edit(tab.path, next);
  store.reoutline(tab.path).catch(() => {});
}

/**
 * Choisit une image et pose son lien, relatif au document — la même
 * traduction que pour une image insérée dans le texte.
 */
async function browse() {
  const tab = store.activeTab();
  if (!store.isMarkdown(tab)) return;

  const file = await api.pickImage();
  if (!file) return;

  FIELDS.photo.value = await api.fileLink(tab.path, file);
  apply('photo');
}

export function wire() {
  for (const [key, field] of Object.entries(FIELDS)) {
    // `change` plutôt que `input` : sur un champ de texte il attend la sortie
    // du champ ou la validation, ce qui évite de réécrire le document à
    // chaque touche.
    field.addEventListener('change', () => apply(key));

    // Entrée vaut validation — sauf là où elle sert à écrire une ligne de
    // plus : la valeur y part alors en bloc littéral dans le fichier.
    if (field.tagName === 'TEXTAREA') continue;
    field.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      apply(key);
    });
  }

  browseBtn.addEventListener('click', () => browse().catch(store.fail));
}
