// Ce qu'on fait d'un fichier du projet : le compiler en HTML, en PDF ou en
// Word, le renommer, copier son nom, le dupliquer, l'effacer.
//
// Les commandes ont deux portes — le menu de l'onglet, celui de la ligne
// de l'arbre —, et c'est le même fichier des deux côtés : un document n'a pas
// deux jeux de commandes selon l'endroit d'où on le montre. Elles vivent donc
// ici, et les deux menus reprennent `entries` telle quelle.
//
// Rien de ce module ne touche au disque : tout passe par une action du `store`,
// qui appelle Rust, relit l'arborescence et recale l'onglet. La question — le
// nouveau nom, la confirmation d'un effacement — se pose ici, parce que c'est
// ici qu'on sait ce qu'on allait faire.

import { PATH } from './dom.js';
import * as store from '../store.js';
import * as api from '../api.js';
import * as menu from './menu.js';
import * as prompt from './prompt.js';
import * as journal from './journal.js';
import { FORMATS } from '../pandoc.js';

/**
 * Les quatre entrées, pour un fichier `{ path, name }` — un onglet comme un
 * nœud de l'arbre : les deux portent ces deux champs, et rien d'autre n'est
 * demandé ici.
 *
 * `flush` est celui de `ui/editor.js` : ce qui ramène au Markdown la saisie en
 * cours. Il arrive par l'appelant plutôt que par un `import`, pour que ce
 * module reste une feuille — l'éditeur le charge, il ne peut donc pas le
 * charger en retour.
 */
export function entries(file, flush) {
  const markdown = /\.(md|markdown|mdown)$/i.test(file.name);
  return [
    // Éteinte hors Markdown plutôt que retirée : le menu garde ses places, et
    // l'on y apprend ce qu'un document permet.
    menu.item('Compiler en HTML', PATH.compile, () => compile(file, 'html', flush), !markdown),
    menu.item('Compiler en PDF', PATH.compile, () => compile(file, 'pdf', flush), !markdown),
    menu.item('Compiler en Word', PATH.compile, () => compile(file, 'docx', flush), !markdown),
    menu.separator(),
    menu.item('Renommer…', PATH.pencil, () => rename(file, flush)),
    menu.item('Copier le nom', PATH.copy, () => copyName(file)),
    menu.item('Dupliquer', PATH.duplicate, () => duplicate(file)),
    menu.item('Supprimer…', PATH.trash, () => remove(file)),
  ];
}

/**
 * Compile le document par Pandoc, en HTML ou en PDF (`format`), d'après les
 * réglages du projet.
 *
 * Pandoc lit le fichier **sur le disque** : des modifications non enregistrées
 * n'y seraient pas. On le dit, et l'on propose d'enregistrer d'abord — plutôt
 * que d'enregistrer d'office, ou de compiler une version que l'on n'a plus
 * sous les yeux. `flush` avant la question : la saisie en cours doit compter
 * dans ce qu'on juge modifié.
 */
async function compile(file, format, flush) {
  const { label, product } = FORMATS[format];
  // Une seule compilation à la fois : le journal n'en suit qu'une, et deux
  // copies des mêmes ressources vers la même destination se marcheraient
  // dessus.
  if (journal.busy()) {
    store.notify('Une compilation est déjà en cours.', 'error');
    return;
  }
  flush();
  const tab = store.state.edition.tabs.find((t) => t.path === file.path);
  if (tab && store.isDirty(tab)) {
    const ok = await api.ask(
      `« ${file.name} » a des modifications non enregistrées.\n\n` +
        'Pandoc compile le fichier tel qu’il est sur le disque : enregistrer puis compiler ?',
      { title: `Compiler en ${label}`, okLabel: 'Enregistrer et compiler' },
    );
    if (!ok) return;
    try {
      await store.saveDocument(tab.path);
    } catch (err) {
      store.fail(err);
      return;
    }
  }

  // Le journal suit la compilation ligne à ligne ; le toast ne dira que l'issue.
  journal.start(`Compilation ${label} de « ${file.name} »`);
  try {
    const done = await store.compileDocument(file.path, format);
    const warnings = (done.resources?.warnings.length ?? 0) + (done.log ? 1 : 0);
    journal.finish(true, done.output ? `${product} : ${done.output}` : 'Compilation terminée.');
    const page = done.output ? ` : ${done.output}` : '.';
    const note = warnings ? '\nDes avertissements sont au journal.' : '';
    store.notify(`${product}${page}${resourcesLine(done.resources)}${note}`, 'ok', 6000);
  } catch (err) {
    // Le message complet est déjà au journal, envoyé par Rust : le toast ne
    // fait qu'y renvoyer.
    journal.finish(false, '');
    store.notify(
      `Échec de la compilation ${label} de « ${file.name} » : voir le journal.\n${clip(String(err?.message ?? err), 160)}`,
      'error',
      8000,
    );
  }
}

/**
 * Créer, dans un dossier du projet — `dir` vide pour la racine.
 *
 * Les deux entrées valent partout où l'on crée : le menu d'un dossier de
 * l'arbre, celui du fond du volet et le bouton de sa tête, qui visent la
 * racine. C'est le même geste, donc les mêmes entrées.
 */
export function newEntries(dir = '') {
  return [
    menu.item('Créer un fichier Markdown…', PATH.file, () => createFile(dir)),
    menu.item('Créer un répertoire…', PATH.folder, () => createDir(dir)),
  ];
}

/** Le dossier tel qu'un message le nomme : la racine n'a pas de nom. */
const place = (dir) => (dir ? `« ${dir.split('/').pop()} »` : 'le projet');

async function createFile(dir) {
  const asked = await prompt.open({
    title: 'Créer un fichier Markdown',
    label: `Nom du document, dans ${place(dir)}`,
    value: '',
    okLabel: 'Créer',
    hint: 'L’extension .md est ajoutée si vous ne l’écrivez pas.',
  });
  if (asked === null || !asked.trim()) return;

  try {
    const path = await store.createFile(dir, asked);
    store.notify(`« ${path.split('/').pop()} » créé.`);
  } catch (err) {
    store.fail(err);
  }
}

async function createDir(dir) {
  const asked = await prompt.open({
    title: 'Créer un répertoire',
    label: `Nom du dossier, dans ${place(dir)}`,
    value: '',
    okLabel: 'Créer',
    hint: 'Un nom, non un chemin : le dossier est créé là où vous êtes.',
  });
  if (asked === null || !asked.trim()) return;

  try {
    const path = await store.createDir(dir, asked);
    store.notify(`Dossier « ${path.split('/').pop()} » créé.`);
  } catch (err) {
    store.fail(err);
  }
}

/**
 * Les commandes d'un dossier de l'arbre.
 *
 * `flush` arrive par l'appelant, comme pour un fichier : la saisie en cours
 * doit avoir rejoint le Markdown avant qu'on juge ce qui est modifié.
 */
export function dirEntries(dir, flush) {
  return [
    ...newEntries(dir.path),
    menu.separator(),
    menu.item('Compiler en HTML les documents du dossier', PATH.compile, () => compileDir(dir, 'html', flush)),
    menu.item('Compiler en PDF les documents du dossier', PATH.compile, () => compileDir(dir, 'pdf', flush)),
    menu.item('Compiler en Word les documents du dossier', PATH.compile, () => compileDir(dir, 'docx', flush)),
  ];
}

/**
 * Compile en HTML ou en PDF, un par un, les documents Markdown du dossier — le
 * dossier seul, sans ses sous-dossiers : ce qu'on voit sous lui en le dépliant.
 *
 * Les ressources — en HTML seulement — ne sont copiées qu'au premier : tous
 * partent vers la même destination, et refaire la copie à chaque document ne
 * ferait que relire le disque. Un échec n'arrête pas la série — les autres
 * documents n'y sont pour rien — ; le journal dit lequel et pourquoi, le toast
 * en fait le compte.
 *
 * Les documents ouverts et modifiés font l'objet d'une seule question, pour
 * toute la série, plutôt que d'une par document.
 */
async function compileDir(dir, format, flush) {
  await compileSeries({
    format,
    flush,
    list: async () => ({ paths: await store.markdownInDir(dir.path), missing: [] }),
    empty: `Aucun document Markdown dans « ${dir.name} ».`,
    title: (total, label) => `Compilation ${label} de ${total} document(s) du dossier « ${dir.name} »`,
    scope: `« ${dir.name} »`,
    // Tous dans le même dossier : le nom suffit à les distinguer.
    shown: (path) => path.split('/').pop(),
  });
}

/**
 * Compile en HTML, en PDF ou en Word (`format`), un par un, les documents du
 * projet : ceux dont
 * `conf/bibliotheque.yaml` nomme la page, dans l'ordre du fichier — celui des
 * lots —, sauf la page d'accueil, `index.md` à la racine.
 *
 * La bibliothèque et non le dossier : un projet porte des milliers de `.md`,
 * et seuls ceux que le site publie sont ses documents. Un document qu'elle
 * nomme sans qu'il existe est signalé au journal, sans arrêter la série.
 *
 * Mêmes règles que pour un dossier : une question pour tous les documents
 * modifiés, ressources copiées au premier seulement (en HTML), un échec qui
 * n'arrête pas la série. Le journal nomme chaque document par son chemin : deux dossiers
 * peuvent porter un fichier du même nom.
 */
export async function compileProject(format, flush) {
  await compileSeries({
    format,
    flush,
    list: async () => {
      const { found, missing } = await store.markdownInProject();
      return { paths: found.filter((p) => p.toLowerCase() !== 'index.md'), missing };
    },
    empty: 'Aucun document à compiler : conf/bibliotheque.yaml n’en nomme pas.',
    title: (total, label) => `Compilation ${label} du projet : ${total} document(s)`,
    scope: 'Projet',
    shown: (path) => path,
  });
}

/**
 * Compile le **book** : un seul PDF pour tout le projet, parties comprises.
 *
 * Ce n'est pas une série : le script du projet assemble les documents de
 * `conf/book_structure.yaml` et n'appelle Pandoc qu'une fois. Les documents
 * modifiés font l'objet d'une seule question, comme pour une série — le script
 * lit les fichiers sur le disque.
 */
export async function compileBook(flush) {
  if (journal.busy()) {
    store.notify('Une compilation est déjà en cours.', 'error');
    return;
  }
  flush();

  const dirty = store.state.edition.tabs.filter((t) => store.isDirty(t));
  if (dirty.length) {
    const names = dirty.map((t) => `« ${t.name} »`).join(', ');
    const ok = await api.ask(
      `Modifications non enregistrées : ${names}.\n\n` +
        'Le book est assemblé depuis les fichiers du disque : enregistrer puis compiler ?',
      { title: 'Compiler un book', okLabel: 'Enregistrer et compiler' },
    );
    if (!ok) return;
    try {
      for (const tab of dirty) await store.saveDocument(tab.path);
    } catch (err) {
      store.fail(err);
      return;
    }
  }

  journal.start('Compilation du book (PDF)');
  try {
    const done = await store.compileBook();
    journal.finish(true, done.output ? `Book produit : ${done.output}` : 'Compilation terminée.');
    const note = done.log ? '\nDes avertissements sont au journal.' : '';
    store.notify(`Book produit${done.output ? ` : ${done.output}` : '.'}${note}`, 'ok', 6000);
  } catch (err) {
    journal.finish(false, '');
    store.notify(
      `Échec de la compilation du book : voir le journal.\n${clip(String(err?.message ?? err), 160)}`,
      'error',
      8000,
    );
  }
}

/**
 * Compile une série de documents, un par un : ce que partagent la compilation
 * d'un dossier et celle du projet.
 *
 * - `list` rend `{ paths, missing }` : les chemins à compiler, et ceux qu'on
 *   aurait dû compiler mais qui n'existent pas ;
 * - `empty` est le message d'une série vide ;
 * - `title` fait l'intitulé du journal ;
 * - `scope` ouvre le message de fin ;
 * - `shown` dit comment un document se nomme au journal.
 */
async function compileSeries({ format, flush, list, empty, title, scope, shown }) {
  const { label, product } = FORMATS[format];
  if (journal.busy()) {
    store.notify('Une compilation est déjà en cours.', 'error');
    return;
  }
  flush();

  let paths;
  let missing;
  try {
    ({ paths, missing } = await list());
  } catch (err) {
    store.fail(err);
    return;
  }
  if (!paths.length) {
    store.notify(missing.length ? `${empty}\nAbsents : ${missing.join(', ')}` : empty, 'error');
    return;
  }

  const dirty = store.state.edition.tabs.filter((t) => paths.includes(t.path) && store.isDirty(t));
  if (dirty.length) {
    const names = dirty.map((t) => `« ${t.name} »`).join(', ');
    const ok = await api.ask(
      `Modifications non enregistrées : ${names}.\n\n` +
        'Pandoc compile les fichiers tels qu’ils sont sur le disque : enregistrer puis compiler ?',
      { title: `Compiler en ${label}`, okLabel: 'Enregistrer et compiler' },
    );
    if (!ok) return;
    try {
      for (const tab of dirty) await store.saveDocument(tab.path);
    } catch (err) {
      store.fail(err);
      return;
    }
  }

  const total = paths.length;
  journal.start(title(total, label));
  for (const path of missing) journal.note('warn', `Absent du projet, ignoré : ${path}`);
  const failed = [];
  let warned = 0;

  for (const [i, path] of paths.entries()) {
    journal.progress(i, total);
    journal.note('step', `[${i + 1}/${total}] ${shown(path)}`);
    try {
      const done = await store.compileDocument(path, format, i === 0);
      if (done.log || done.resources?.warnings.length) warned++;
      journal.note('done', done.output ? `${product} : ${done.output}` : 'Compilation terminée.');
    } catch {
      // Le message est déjà au journal, envoyé par Rust.
      failed.push(shown(path));
    }
  }

  journal.progress(total, total);
  const ok = total - failed.length;
  const summary = `${ok} sur ${total} document(s) compilé(s)`;
  journal.finish(!failed.length, failed.length ? `${summary} — échec : ${failed.join(', ')}` : summary);

  const absent = missing.length ? `\n${missing.length} document(s) absent(s) — voir le journal.` : '';
  const note = warned ? '\nDes avertissements sont au journal.' : '';
  if (failed.length) {
    store.notify(`${scope} : ${summary}, ${failed.length} en échec — voir le journal.${absent}`, 'error', 8000);
  } else {
    store.notify(`${scope} : ${summary}.${absent}${note}`, 'ok', 6000);
  }
}

/** Ce que la copie des ressources a fait, en une ligne ; rien sans liste. */
function resourcesLine(report) {
  if (!report) return '';
  const copied = report.copied === 1 ? '1 copiée' : `${report.copied} copiées`;
  return `\nRessources : ${copied}, ${report.upToDate} déjà à jour`;
}

/** Un journal trop long ne tiendrait pas dans un message. */
function clip(text, max = 400) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Renomme le fichier.
 *
 * `flush` d'abord, comme pour « Réactualiser » : l'onglet est désigné par son
 * chemin, le changer refait donc l'affichage du document — et ce qui n'est
 * encore que dans le rendu s'en irait avec l'ancien nom. Il se fait avant la
 * boîte et non après : celle-ci prend le clavier, la saisie en cours doit donc
 * être déjà revenue au Markdown quand elle s'ouvre.
 */
async function rename(file, flush) {
  flush();
  const asked = await prompt.open({
    title: 'Renommer le fichier',
    label: 'Nouveau nom',
    value: file.name,
    okLabel: 'Renommer',
    hint: 'Un nom, non un chemin : le fichier reste dans son dossier.',
  });
  // Renoncé, ou rendu inchangé : il n'y a rien à demander à Rust.
  if (asked === null || asked === file.name) return;

  try {
    const path = await store.renameFile(file.path, asked);
    store.notify(`Renommé en « ${path.split('/').pop()} ».`);
  } catch (err) {
    store.fail(err);
  }
}

/**
 * Le nom du fichier dans le presse-papiers.
 *
 * `navigator.clipboard` directement, et non le `write` de `ui/clipboard.js` :
 * celui-ci existe pour les deux formes d'une sélection du document — du texte
 * et du HTML — et il importe l'éditeur, que ce module-ci sert. Un nom de
 * fichier n'a qu'une forme.
 */
function copyName(file) {
  navigator.clipboard
    .writeText(file.name)
    .then(() => store.notify('Nom copié.'))
    .catch(() => store.fail('Le presse-papiers a refusé la copie.'));
}

/**
 * Une copie du fichier, à côté de lui.
 *
 * Le message nomme la copie et pas seulement le geste : elle prend sa place
 * dans l'ordre alphabétique de l'arbre, parfois loin de l'original, et son nom
 * est ce qu'on a besoin de savoir pour la retrouver.
 */
async function duplicate(file) {
  try {
    const path = await store.duplicateFile(file.path);
    store.notify(`Copie créée : « ${path.split('/').pop()} ».`);
  } catch (err) {
    store.fail(err);
  }
}

/**
 * Efface le fichier, après confirmation.
 *
 * La question passe par la boîte du système (`api.ask`) et non par
 * `window.confirm`, que cette webview ne montre pas : l'appel rendait `false`
 * sans rien afficher, et la suppression se trouvait annulée en silence — rien
 * ne paraissait, et la liste n'avait en effet rien à actualiser.
 */
async function remove(file) {
  const tab = store.state.edition.tabs.find((t) => t.path === file.path);
  const unsaved = tab && store.isDirty(tab) ? '\nIl porte des modifications non enregistrées.' : '';

  const ok = await api.ask(
    `Supprimer « ${file.name} » ?${unsaved}\n\n` +
      'Le fichier est effacé du disque : cette action est sans retour.',
    { title: 'Supprimer le fichier', okLabel: 'Supprimer' },
  );
  if (!ok) return;

  try {
    await store.deleteFile(file.path);
    store.notify(`« ${file.name} » supprimé.`);
  } catch (err) {
    store.fail(err);
  }
}
