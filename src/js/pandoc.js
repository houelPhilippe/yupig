// Compilation par Pandoc : la légende des variables d'un modèle de commande, et
// ce qui distingue les deux formats.
//
// La commande d'un projet s'écrit une fois, avec des variables à la place de ce
// qui change d'un document à l'autre — `pandoc {fichier} … -o {sortie}`. Leur
// remplacement ne se fait **pas** ici : il vit dans `src-tauri/src/pandoc.rs`,
// qui lit le modèle en base, le découpe en arguments et lance Pandoc. L'aperçu
// des paramètres l'interroge (`api.pandocPreview`) plutôt que de refaire le
// calcul : deux lectures finiraient par ne plus s'accorder, et l'aperçu
// montrerait autre chose que ce qui part.
//
// Il ne reste donc ici que ce que la boîte affiche : le nom de chaque variable
// et ce qu'elle vaut. Les noms doivent être ceux de `Vars::value`, côté Rust ;
// les clés de `FORMATS`, ceux de `Format`.

export const VARIABLES = [
  { name: 'fichier', label: 'le document, relatif au projet' },
  { name: 'sortie', label: 'le document produit : destination + même chemin, en .html ou .pdf' },
  { name: 'destination', label: 'le répertoire de destination' },
  { name: 'dossier', label: 'le dossier du document, relatif au projet' },
  { name: 'nom', label: 'le nom du document, sans extension' },
];

/** Les formats de compilation : leur nom à l'écran, et ce que produit l'un d'eux. */
export const FORMATS = {
  html: { label: 'HTML', product: 'Page HTML produite' },
  pdf: { label: 'PDF', product: 'PDF produit' },
};
