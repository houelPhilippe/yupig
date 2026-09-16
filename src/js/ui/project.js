// Boîte de dialogue « Paramètres du projet » : la mise en page du document.
//
// Les réglages accompagnent le dossier ouvert, pas l'application — deux projets
// peuvent demander deux mises en page différentes. Ils sont appliqués par des
// variables CSS portées par la racine, ce qui évite d'aller poser un style sur
// chaque paragraphe du rendu.

import { el, icon, PATH } from './dom.js';
import * as store from '../store.js';

const button = document.getElementById('project-settings');
const dialog = document.getElementById('project-dialog');
const closeBtn = document.getElementById('project-dialog-close');
const alignSeg = document.getElementById('align-seg');
const leadingSeg = document.getElementById('leading-seg');
const ringSeg = document.getElementById('ring-seg');
const spacingGrid = document.getElementById('spacing-grid');
const spacingReset = document.getElementById('spacing-reset');

/** L'alignement demandé, traduit en valeur CSS. */
const ALIGN = { gauche: 'left', justifie: 'justify' };

/**
 * Les espacements de la mise en page : ce qui s'aère au-dessus et au-dessous de
 * chaque sorte de bloc.
 *
 * Cette table est le **seul** endroit qui les nomme. Elle donne pour chacun son
 * intitulé, la racine de sa clé et les deux valeurs par défaut ; tout le reste
 * s'en déduit — les champs de la boîte, les clés qui partent en base, et les
 * variables CSS que la feuille de style consomme. En ajouter un ne demande donc
 * qu'une ligne ici et une règle dans `app.css` : ni champ à écrire dans
 * `index.html`, ni colonne, ni migration.
 *
 * Les valeurs sont en pixels à 100 % de zoom — des entiers, lisibles tels quels
 * dans la table clé/valeur comme l'interligne, et que le zoom du document
 * multiplie ensuite.
 *
 * Entre deux blocs, l'écart est la **somme** de l'« après » du premier et de
 * l'« avant » du second (voir `app.css`). Les valeurs par défaut sont réglées
 * sur cette règle pour redonner l'aspect du modèle, qui faisait fusionner les
 * deux marges : 16 entre deux paragraphes, 24 avant un titre (16 + 8), 12 après
 * lui (12 + 0).
 */
const SPACING = [
  // Les six niveaux partent avec le même écart : c'est ce que la feuille de
  // style faisait d'un seul bloc. Les distinguer est désormais possible, mais
  // ce n'est pas à l'application de le décider pour un document existant.
  { key: 'h1', label: 'Titre 1', before: 8, after: 12 },
  { key: 'h2', label: 'Titre 2', before: 8, after: 12 },
  { key: 'h3', label: 'Titre 3', before: 8, after: 12 },
  { key: 'h4', label: 'Titre 4', before: 8, after: 12 },
  { key: 'h5', label: 'Titre 5', before: 8, after: 12 },
  { key: 'h6', label: 'Titre 6', before: 8, after: 12 },
  { key: 'p', label: 'Paragraphe', before: 0, after: 16 },
  // La liste à cocher est une liste à puces : elle suit la même mesure.
  { key: 'ul', label: 'Liste à puces', before: 0, after: 16 },
  { key: 'ol', label: 'Liste numérotée', before: 0, after: 16 },
  { key: 'pre', label: 'Bloc de code', before: 0, after: 16 },
  { key: 'shortcode', label: 'Shortcode', before: 0, after: 16 },
  { key: 'figure', label: 'Image', before: 0, after: 16 },
  { key: 'table', label: 'Tableau', before: 0, after: 16 },
];

/** Au-delà, ce n'est plus une mise en page mais une page blanche. */
const SPACING_MAX = 200;

/**
 * De `h1Before` à `--doc-space-h1-before`.
 *
 * La clé est en camelCase — c'est la forme que Serde attend et celle qui part
 * en base ; la variable CSS est en tirets, comme toutes les autres. Une seule
 * écriture du nom, deux formes.
 */
const cssVar = (key) => `--doc-space-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** Les deux clés d'une ligne, avec leur valeur par défaut. */
function ends(row) {
  return [
    { key: `${row.key}Before`, fallback: row.before, label: 'Avant' },
    { key: `${row.key}After`, fallback: row.after, label: 'Après' },
  ];
}

let applied = null;
let built = false;

export function render(state) {
  const { project, dialogOpen, root } = state.edition;
  const spacing = project.spacing ?? {};

  // La mise en page se pose quelle que soit l'application à l'écran, avant
  // toute autre condition. Elle décrit le document, pas la coque : la lier à
  // « Édition » ferait qu'un chemin qui rend la main plus tôt laisserait le
  // rendu sans aucune de ses mesures — et une variable absente ne vaut pas la
  // valeur du modèle, elle vaut zéro. Cela ne coûte rien devant « Veille » :
  // le calcul de style ne reprend que si une valeur a bougé.
  const sig = JSON.stringify([
    project.align, project.lineHeight, project.showOutline, spacing,
  ]);
  if (sig !== applied) {
    applied = sig;
    const css = document.documentElement.style;
    css.setProperty('--doc-align', ALIGN[project.align] ?? 'left');
    // L'interligne est stocké en centièmes : 165 vaut 1,65.
    css.setProperty('--doc-leading', String(project.lineHeight / 100));
    // Le liseré se retire par son épaisseur : une règle de moins à écrire, et
    // la feuille de style garde la couleur et la place du trait.
    css.setProperty('--doc-ring', project.showOutline === false ? '0' : '2px');

    // Les espacements sont posés tous ensemble, réglés ou non : la feuille de
    // style n'en déclare aucun, c'est cette table qui porte les valeurs par
    // défaut — une seule écriture du nombre, et rien à tenir en double.
    for (const row of SPACING) {
      for (const end of ends(row)) {
        css.setProperty(cssVar(end.key), String(measure(spacing[end.key], end.fallback)));
      }
    }
  }

  // Le reste appartient à la boîte, donc à « Édition ».
  if (state.app !== 'edition') return;

  // Sans projet ouvert, il n'y a pas de réglages à modifier.
  button.disabled = !root;
  dialog.hidden = !dialogOpen;

  if (!dialogOpen) return;
  check(alignSeg, 'align', project.align);
  check(leadingSeg, 'leading', String(project.lineHeight));
  check(ringSeg, 'ring', project.showOutline === false ? '0' : '1');
  fillSpacing(spacing);
}

/**
 * La valeur retenue pour un espacement : celle du projet, ou celle du modèle.
 *
 * Bornée ici aussi, et pas seulement côté Rust : la valeur part dans une
 * variable CSS, et une base recopiée à la main ne doit pas pouvoir y mettre
 * n'importe quoi.
 */
function measure(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(SPACING_MAX, n));
}

/**
 * Remplit les champs de la grille.
 *
 * Un champ vide vaut « comme le modèle » : c'est ce que dit son `placeholder`,
 * qui porte le nombre par défaut. Régler un espacement à sa valeur d'origine
 * n'écrit donc rien en base, et vider le champ l'en retire.
 */
function fillSpacing(spacing) {
  for (const field of spacingGrid.querySelectorAll('input[data-key]')) {
    const value = spacing[field.dataset.key];
    const wanted = value === null || value === undefined ? '' : String(value);
    // Ne réécrire que si cela diverge : réassigner replacerait le curseur.
    if (field.value !== wanted) field.value = wanted;
  }
}

/**
 * Bâtit la grille des espacements d'après `SPACING`.
 *
 * Elle se construit en JavaScript et non dans `index.html` pour que la table
 * ci-dessus reste le seul endroit qui nomme ces réglages : douze lignes écrites
 * à la main dans le balisage finiraient par ne plus lui correspondre.
 */
function buildSpacing() {
  if (built) return;
  built = true;

  const cells = [
    el('div.spacing__head', {}, 'Bloc'),
    el('div.spacing__head', {}, 'Avant'),
    el('div.spacing__head', {}, 'Après'),
  ];

  for (const row of SPACING) {
    cells.push(el('label.spacing__label', { for: `space-${row.key}Before` }, row.label));
    for (const end of ends(row)) {
      cells.push(el('input.input.spacing__field', {
        id: `space-${end.key}`,
        type: 'number',
        min: '0',
        max: String(SPACING_MAX),
        step: '1',
        inputmode: 'numeric',
        autocomplete: 'off',
        'data-key': end.key,
        placeholder: String(end.fallback),
        'aria-label': `${row.label} — espace ${end.label.toLowerCase()}, en pixels`,
      }));
    }
  }
  spacingGrid.append(...cells);
}

function check(seg, name, value) {
  for (const input of seg.querySelectorAll(`input[name="${name}"]`)) {
    input.checked = input.value === value;
  }
}

export function wire() {
  button.append(icon(PATH.sliders, { size: 14 }));
  closeBtn.append(icon(PATH.close, { size: 13 }));
  buildSpacing();

  button.addEventListener('click', () => store.toggleProjectDialog(true));
  closeBtn.addEventListener('click', () => store.toggleProjectDialog(false));

  // Un clic sur le voile ferme, un clic dans la boîte non.
  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) store.toggleProjectDialog(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && store.state.edition.dialogOpen) {
      ev.preventDefault();
      store.toggleProjectDialog(false);
    }
  });

  alignSeg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'align') return;
    store.saveProjectSettings({ align: ev.target.value }).catch(store.fail);
  });

  leadingSeg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'leading') return;
    store.saveProjectSettings({ lineHeight: Number(ev.target.value) }).catch(store.fail);
  });

  ringSeg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'ring') return;
    store.saveProjectSettings({ showOutline: ev.target.value === '1' }).catch(store.fail);
  });

  // `change` et non `input` : un nombre se tape chiffre par chiffre, et écrire
  // en base à chaque touche ferait trois allers-retours pour « 120 ». Le champ
  // quitté — ou la flèche du sélecteur — suffit à appliquer.
  spacingGrid.addEventListener('change', (ev) => {
    const key = ev.target.dataset?.key;
    if (!key) return;

    const raw = ev.target.value.trim();
    // Vidé, le réglage retourne au modèle : on retire la clé plutôt que d'y
    // écrire un zéro, qui serait un espacement nul et non une absence de
    // réglage.
    if (raw === '') {
      store.saveProjectSpacing({ [key]: null }).catch(store.fail);
      return;
    }

    const px = measure(raw, null);
    // Ce qui n'est pas un nombre ne s'enregistre pas : le champ reprend la
    // valeur en vigueur au prochain rendu.
    if (px === null) {
      store.emit();
      return;
    }
    // Le champ montre tout de suite ce qui a été retenu — « 900 » devient 200.
    ev.target.value = String(px);
    store.saveProjectSpacing({ [key]: px }).catch(store.fail);
  });

  spacingReset.addEventListener('click', () => {
    store.saveProjectSpacing(null).catch(store.fail);
  });
}
