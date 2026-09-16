// Ce qu'on fait d'un fichier du projet : le renommer, copier son nom, le
// dupliquer, l'effacer.
//
// Les quatre commandes ont deux portes — le menu de l'onglet, celui de la ligne
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
  return [
    menu.item('Renommer…', PATH.pencil, () => rename(file, flush)),
    menu.item('Copier le nom', PATH.copy, () => copyName(file)),
    menu.item('Dupliquer', PATH.duplicate, () => duplicate(file)),
    menu.item('Supprimer…', PATH.trash, () => remove(file)),
  ];
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
