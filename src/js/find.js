// Moteur de recherche et de remplacement, sans DOM ni état.
//
// Les deux modes d'édition l'appellent sur des textes différents — la source
// Markdown pour « Code Markdown », le texte rendu pour « Modifier » — mais les
// règles de correspondance, elles, sont les mêmes des deux côtés. Elles vivent
// donc ici, où elles se lisent et s'éprouvent seules.

/** Rend inoffensif ce qui, dans une recherche littérale, a un sens en regex. */
function quote(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * L'expression qui reconnaît ce qu'on cherche.
 *
 * `null` pour une recherche vide — il n'y a alors rien à chercher, ce qui
 * n'est pas une erreur. Une expression régulière mal formée, elle, lève : la
 * barre l'affiche plutôt que de chercher autre chose que ce qui est demandé.
 */
export function pattern(query, { matchCase = false, wholeWord = false, regex = false } = {}) {
  if (!query) return null;
  const body = regex ? query : quote(query);
  // Le groupe non capturant garde les alternatives entières dans les limites
  // de mot : sans lui, « \bchat|chien\b » ne borne que le premier et le dernier.
  const source = wholeWord ? `\\b(?:${body})\\b` : body;
  return new RegExp(source, matchCase ? 'g' : 'gi');
}

/**
 * Toutes les occurrences, dans l'ordre du texte.
 *
 * Les correspondances vides sont écartées : `a*` en reconnaît une entre chaque
 * lettre, qu'on ne saurait ni montrer ni remplacer. Elles font aussi tourner en
 * rond un `exec` global, d'où l'avance forcée.
 */
export function search(text, re) {
  if (!re) return [];
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length, groups: m });
    // Garde-fou : un texte long et une expression coûteuse ne doivent pas
    // figer la fenêtre. Au-delà, on remplace ce qu'on a vu.
    if (out.length >= 10_000) break;
  }
  return out;
}

/**
 * Le texte à écrire à la place d'une occurrence.
 *
 * Les références `$1`, `$&` et `$$` n'ont de sens qu'en expression régulière :
 * dans une recherche littérale, un `$` du champ de remplacement est un dollar,
 * et rien d'autre. C'est pourquoi la substitution est écrite ici plutôt que
 * confiée à `String.replace`, qui les interprète toujours.
 */
export function expand(match, replacement, regex = false) {
  if (!regex) return replacement;
  return replacement.replace(/\$(\$|&|\d{1,2})/g, (all, key) => {
    if (key === '$') return '$';
    if (key === '&') return match.groups[0];
    const n = Number(key);
    const group = match.groups[n];
    // Un groupe qui n'existe pas se lit tel quel : « $9 » sans neuvième groupe
    // vaut mieux affiché que silencieusement effacé.
    return group === undefined ? all : group;
  });
}

/**
 * Réécrit un texte, occurrence par occurrence, de la fin vers le début.
 *
 * L'ordre importe : remplacer depuis le début décalerait toutes les positions
 * suivantes. Partir de la fin les laisse valides jusqu'au bout.
 */
export function replaceAll(text, matches, replacement, regex = false) {
  let out = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    out = out.slice(0, m.start) + expand(m, replacement, regex) + out.slice(m.end);
  }
  return out;
}

/**
 * L'occurrence à viser après un déplacement.
 *
 * Le parcours boucle : passé la dernière on revient à la première, ce qu'on
 * attend d'une recherche dans un document.
 */
export function step(index, total, delta) {
  if (total === 0) return 0;
  return (((index + delta) % total) + total) % total;
}
