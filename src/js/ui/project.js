// Boîte de dialogue « Paramètres du projet » : la mise en page du document, et
// la compilation par Pandoc.
//
// Les réglages accompagnent le dossier ouvert, pas l'application — deux projets
// peuvent demander deux mises en page différentes. Ils sont appliqués par des
// variables CSS portées par la racine, ce qui évite d'aller poser un style sur
// chaque paragraphe du rendu.

import { el, icon, replace, PATH } from './dom.js';
import * as store from '../store.js';
import * as api from '../api.js';
import { VARIABLES } from '../pandoc.js';

const button = document.getElementById('project-settings');
const dialog = document.getElementById('project-dialog');
const closeBtn = document.getElementById('project-dialog-close');
const doneBtn = document.getElementById('project-dialog-done');
const rootLabel = document.getElementById('project-dialog-root');
const savedLabel = document.getElementById('project-dialog-saved');
const alignSeg = document.getElementById('align-seg');
const leadingSeg = document.getElementById('leading-seg');
const ringSeg = document.getElementById('ring-seg');
const wrapSeg = document.getElementById('wrap-seg');
const scrollbarsSeg = document.getElementById('scrollbars-seg');
const spacingGrid = document.getElementById('spacing-grid');
const spacingReset = document.getElementById('spacing-reset');
const legend = document.getElementById('pandoc-legend');
const modeleList = document.getElementById('modele-list');
const modeleApply = document.getElementById('modele-apply');
const modeleCurrent = document.getElementById('modele-current');

/**
 * Les groupes de Pandoc — HTML, PDF et Word —, bâtis sur le même modèle : une
 * destination, des modèles de commande, un aperçu. `fields` associe à chaque
 * champ de `project.pandoc` sa zone de saisie ; `format` est le format côté
 * Rust. Le HTML porte un modèle de plus, celui de la page d'accueil.
 */
const byId = (id) => document.getElementById(id);
const COMPILERS = [
  { format: 'html', keys: ['htmlDest', 'htmlCommand', 'htmlIndexCommand'] },
  { format: 'pdf', keys: ['pdfDest', 'pdfCommand'] },
  { format: 'docx', keys: ['docxDest', 'docxCommand'] },
  // Le book n'a ni modèle de commande ni aperçu : son script est fixe.
  { format: 'book', keys: ['bookDest', 'bookFile'] },
].map(({ format, keys }) => ({
  format,
  fields: keys.map((key) => [key, byId(`pandoc-${kebab(key)}`)]),
  dest: byId(`pandoc-${format}-dest`),
  browse: byId(`pandoc-${format}-browse`),
  preview: byId(`pandoc-${format}-preview`),
  asked: 0,
}));

/** `htmlIndexCommand` donne `html-index-command` : l'identifiant de son champ. */
function kebab(key) {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Les champs de Pandoc tels qu'ils sont à l'écran, sans blancs aux bords. */
function screenPandoc() {
  return Object.fromEntries(
    COMPILERS.flatMap((c) => c.fields).map(([key, field]) => [key, field.value.trim()]),
  );
}

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
    project.align, project.lineHeight, project.showOutline, project.wrapSource,
    project.showScrollbars, spacing,
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
    // Le repli de la source vaut pour ses deux couches — la saisie et le calque
    // de la recherche : une seule variable, lue par la règle qui les tient
    // ensemble.
    css.setProperty('--source-wrap', project.wrapSource === false ? 'pre' : 'pre-wrap');

    // Les ascenseurs passent par un attribut et non par une variable : il faut
    // deux déclarations dans deux syntaxes pour couvrir les deux moteurs, et
    // une valeur ne saurait servir les deux (voir `app.css`). L'attribut porte
    // sa valeur plutôt que d'être nu : « hidden » se lit des deux côtés, là où
    // un `data-scrollbars` seul laisserait croire le contraire de ce qu'il dit.
    const html = document.documentElement;
    if (project.showScrollbars === false) html.setAttribute('data-scrollbars', 'hidden');
    // `removeAttribute` et non un `delete` sur `dataset` : celui-ci lève en
    // mode strict quand l'objet le refuse, et emporterait le reste du rendu.
    else html.removeAttribute('data-scrollbars');

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
  // Le dossier dont on règle les paramètres : on sait ainsi, sous le titre,
  // quel projet on est en train de changer.
  if (rootLabel.textContent !== (root ?? '')) {
    rootLabel.textContent = root ?? '';
    rootLabel.title = root ?? '';
  }
  check(alignSeg, 'align', project.align);
  check(leadingSeg, 'leading', String(project.lineHeight));
  check(ringSeg, 'ring', project.showOutline === false ? '0' : '1');
  check(wrapSeg, 'wrap', project.wrapSource === false ? '0' : '1');
  check(scrollbarsSeg, 'scrollbars', project.showScrollbars === false ? '0' : '1');
  fillSpacing(spacing);
  fillPandoc(project.pandoc ?? {});
  fillModeles(root, state.edition.modeles, project.modele ?? '');
}

/**
 * Le groupe des modèles : celui qui est en vigueur, et la liste de ceux que le
 * projet porte.
 *
 * La liste ne se rebâtit que lorsqu'elle a changé : la refaire à chaque rendu
 * — un espacement réglé, une commande tapée — replacerait le choix de
 * l'utilisateur sur le modèle en vigueur alors qu'il vient d'en désigner un
 * autre.
 */
let listed = null;

function fillModeles(root, names, current) {
  modeleCurrent.textContent = current || 'Aucun modèle appliqué';
  modeleCurrent.classList.toggle('modeles__current--none', !current);

  // Le projet entre dans la signature avec la liste : deux projets peuvent
  // porter les mêmes modèles, et la liste doit alors se reposer quand même
  // pour montrer le modèle en vigueur de celui qu'on ouvre.
  const sig = JSON.stringify([root, names]);
  if (sig !== listed) {
    listed = sig;
    replace(
      modeleList,
      names.length
        ? names.map((name) => el('option', { value: name }, name))
        // Un projet sans `confModele/` n'en porte aucun : le dire dans la
        // liste elle-même vaut mieux qu'une liste vide, qui ne dirait rien.
        : [el('option', { value: '' }, 'Aucun modèle dans confModele/')],
    );
    // Le modèle en vigueur est celui que la liste montre en s'ouvrant : c'est
    // celui qu'on réapplique le plus souvent.
    modeleList.value = names.includes(current) ? current : (names[0] ?? '');
  }

  modeleList.disabled = !names.length;
  modeleApply.disabled = !names.length;
}

/**
 * Applique le modèle choisi, après confirmation.
 *
 * La question passe par `api.ask` et non par `window.confirm` : cette webview
 * ne montre pas les boîtes du navigateur. Et elle se pose — ce qui recouvre des
 * fichiers du disque ne se lance pas sur un clic qu'on n'aurait pas voulu.
 */
async function applyModele() {
  const name = modeleList.value;
  if (!name) return;

  const ok = await api.ask(
    `Copier les fichiers du modèle « ${name} » dans conf/ ?\n\n`
      + 'Les fichiers de même nom y seront remplacés ; les autres restent en place.',
    { title: 'Appliquer un modèle', okLabel: 'Appliquer' },
  );
  if (!ok) return;

  try {
    const report = await store.applyModele(name);
    const copied = `${report.copied} fichier${report.copied > 1 ? 's' : ''} copié${report.copied > 1 ? 's' : ''}`;
    // Un fichier qui n'a pas pu être copié n'arrête pas les autres : le modèle
    // est posé, et le message dit ce qui lui manque.
    if (report.warnings.length) {
      store.notify(
        `Modèle « ${report.name} » : ${copied}, ${report.warnings.length} en échec — ${report.warnings[0]}`,
        'error',
      );
    } else {
      store.notify(`Modèle « ${report.name} » appliqué : ${copied} dans conf/.`);
    }
  } catch (err) {
    store.fail(err);
  }
}

/**
 * Remplit les champs de Pandoc.
 *
 * Un champ qui a le clavier n'est pas réécrit : on y est en train de taper, et
 * le rendu qu'un autre réglage déclenche remettrait la valeur enregistrée par
 * dessus la saisie.
 */
function fillPandoc(pandoc) {
  for (const c of COMPILERS) {
    for (const [key, field] of c.fields) {
      if (document.activeElement === field) continue;
      const wanted = pandoc[key] ?? '';
      if (field.value !== wanted) field.value = wanted;
    }
    if (c.preview) showPreview(c);
  }
}

/**
 * La commande telle qu'elle partirait pour le document ouvert, d'après ce que
 * les champs portent à l'instant — enregistré ou non : l'aperçu suit la frappe.
 */
function showPreview(c) {
  const tab = store.activeTab();
  if (!tab || !store.isMarkdown(tab)) {
    c.asked++;
    c.preview.textContent = 'Ouvrez un document Markdown pour voir la commande complète.';
    c.preview.classList.remove('pandoc__preview--bad');
    return;
  }
  // Les réponses peuvent revenir dans le désordre quand on tape vite : seule
  // la dernière demandée s'écrit.
  const mine = ++c.asked;
  api
    .pandocPreview(c.format, tab.path, screenPandoc())
    .then((command) => ({ command, bad: false }))
    .catch((err) => ({ command: String(err?.message ?? err), bad: true }))
    .then(({ command, bad }) => {
      if (mine !== c.asked) return;
      c.preview.textContent = command;
      c.preview.classList.toggle('pandoc__preview--bad', bad);
    });
}

let pandocTimer = null;

/**
 * Enregistre les champs de Pandoc — HTML et PDF —, tout de suite.
 *
 * Attendre que le champ soit quitté ne suffisait pas : fermer la boîte — par
 * sa croix, Échap ou un clic sur le voile — pendant qu'on y tape la masque
 * sans que `change` parte, et la commande saisie se perdait. La compilation
 * prenait alors la commande par défaut, sans filtre ni modèle. On enregistre
 * donc peu après la frappe, et à la fermeture ce qui attendait encore.
 *
 * Tous les champs en une écriture : deux enregistrements à la suite partiraient
 * chacun de l'état d'avant l'autre, et le second effacerait le premier. Rien ne
 * part si aucun n'a bougé : une simple visite n'écrit pas en base.
 */
function flushPandoc() {
  clearTimeout(pandocTimer);
  pandocTimer = null;
  const current = store.state.edition.project.pandoc ?? {};
  const shown = screenPandoc();
  const moved = Object.entries(shown).some(([key, value]) => (current[key] ?? '') !== value);
  const next = { ...current, ...shown };
  if (!moved) return;
  store.saveProjectSettings({ pandoc: next }).catch(store.fail);
}

/** La fermeture de la boîte, par où qu'elle passe : ce qui est saisi part d'abord. */
function closeDialog() {
  flushPandoc();
  store.toggleProjectDialog(false);
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

  // Le modèle par défaut vit côté Rust ; l'aperçu le montre en entier dès que
  // le champ est vide.
  for (const c of COMPILERS) {
    const command = byId(`pandoc-${c.format}-command`);
    if (command) command.placeholder = 'Vide : la commande par défaut de Pandoc, visible dans l’aperçu';
  }
  byId('pandoc-html-index-command').placeholder = 'Vide : le modèle de commande HTML';
  // La légende vient de la table des variables : une variable ajoutée dans
  // `pandoc.js` y paraît d'elle-même.
  replace(legend, VARIABLES.flatMap((v) => [
    el('code', {}, `{${v.name}}`),
    el('span', {}, v.label),
  ]));

  button.addEventListener('click', () => store.toggleProjectDialog(true));
  closeBtn.addEventListener('click', closeDialog);
  doneBtn.addEventListener('click', closeDialog);
  savedLabel.prepend(icon(PATH.check, { size: 13 }));

  // Un clic sur le voile ferme, un clic dans la boîte non.
  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) closeDialog();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && store.state.edition.dialogOpen) {
      ev.preventDefault();
      closeDialog();
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

  wrapSeg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'wrap') return;
    store.saveProjectSettings({ wrapSource: ev.target.value === '1' }).catch(store.fail);
  });

  modeleApply.addEventListener('click', applyModele);

  scrollbarsSeg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'scrollbars') return;
    store.saveProjectSettings({ showScrollbars: ev.target.value === '1' }).catch(store.fail);
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

  // L'aperçu suit la frappe ; l'enregistrement part une fois la frappe
  // retombée — pas à chaque touche —, et tout de suite en quittant le champ.
  for (const c of COMPILERS) {
    for (const [key, field] of c.fields) {
      field.addEventListener('input', () => {
        if (c.preview) showPreview(c);
        clearTimeout(pandocTimer);
        pandocTimer = setTimeout(flushPandoc, 600);
      });
      field.addEventListener('change', flushPandoc);
      // Entrée ne fait pas de retour à la ligne dans une commande : c'est une
      // seule ligne de terminal, que le champ ne présente sur plusieurs que
      // pour la lire.
      if (key.endsWith('Command')) {
        field.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') ev.preventDefault();
        });
      }
    }

    c.browse.addEventListener('click', async () => {
      try {
        const dir = await api.pickDirectory(c.dest.value.trim());
        if (!dir) return;
        c.dest.value = dir;
        if (c.preview) showPreview(c);
        flushPandoc();
      } catch (err) {
        store.fail(err);
      }
    });
  }
}
