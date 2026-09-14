// Bloc YAML en tête du document — cinq clés que l'application sait poser :
// title, subtitle, photo, abstract-title, toc-depth.
//
// Comme les grilles Pandoc et les shortcodes, ce n'est pas un analyseur YAML :
// une seule passe sur les lignes de premier niveau. Les cinq clés connues se
// lisent et s'écrivent ici ; tout le reste du bloc — lignes, ordre, valeurs
// qu'il porte déjà — survit intact, comme `data-attrs` garde d'un tableau ce
// que l'application ne sait pas éditer.
//
// Le bloc n'a de sens qu'au tout début du fichier : `write` l'y pose toujours,
// quel que soit l'endroit d'où on l'appelle.

/** `---`, les lignes qu'il enferme, et le `---` (ou `...`) qui referme. */
const FRONT = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*\r?\n?/;

/** Les cinq clés connues, dans l'ordre où elles s'écrivent. */
export const FIELDS = ['title', 'subtitle', 'photo', 'abstract-title', 'toc-depth'];

/**
 * Les clés dont la valeur est un nombre.
 *
 * `toc-depth: 3` est un entier, pas un texte : l'écrire entre guillemets en
 * ferait une chaîne, que Quarto lirait autrement. Les quatre autres champs
 * sont du texte, et `quote` les protège au besoin — un titre qui ne serait
 * qu'une année doit rester un titre.
 */
const NUMBERS = new Set(['toc-depth']);

/** Sépare l'en-tête YAML — délimiteurs compris — du reste du document. */
export function splitFront(markdown) {
  const src = String(markdown ?? '');
  const found = src.match(FRONT);
  if (!found) return { head: '', inner: '', body: src };
  return { head: found[0], inner: found[1], body: src.slice(found[0].length) };
}

function isTop(line) {
  return /^[A-Za-z0-9_.-]+:/.test(line);
}

/**
 * Les lignes de l'en-tête, groupées par clé de premier niveau : une entrée
 * porte sa ligne et celles, indentées, qui la suivent — une valeur sur
 * plusieurs lignes n'est ainsi jamais coupée en deux.
 */
function entries(inner) {
  const out = [];
  for (const line of inner ? inner.split(/\r?\n/) : []) {
    if (isTop(line)) out.push({ key: line.slice(0, line.indexOf(':')).trim(), lines: [line] });
    else if (out.length) out[out.length - 1].lines.push(line);
  }
  return out;
}

/**
 * Une valeur qui a besoin de guillemets : un espace en bord, un caractère
 * réservé de YAML en tête, un nombre, ou un mot que YAML lirait pour un
 * booléen plutôt qu'un texte.
 */
function needsQuote(v) {
  if (v === '') return false;
  if (/^\s|\s$/.test(v)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(v)) return true;
  if (/:(\s|$)|\s#/.test(v)) return true;
  if (/^(true|false|null|~|yes|no)$/i.test(v)) return true;
  if (/^[-+]?\d+(\.\d+)?$/.test(v)) return true;
  return false;
}

function quote(v) {
  return needsQuote(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
}

function unquote(v) {
  const t = v.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/**
 * La valeur d'une entrée.
 *
 * Le texte qui suit les deux-points — ou, quand il n'y a là qu'un `|` ou un
 * `>`, les lignes indentées qui suivent, rendues à leur marge : c'est la forme
 * qu'une valeur de plusieurs lignes prend en YAML. `>` replie ses lignes en un
 * paragraphe, `|` les garde telles quelles.
 */
function value(entry) {
  const head = entry.lines[0].slice(entry.lines[0].indexOf(':') + 1).trim();
  if (!/^[|>][-+]?\d*$/.test(head)) return unquote(head);

  const body = entry.lines.slice(1);
  const filled = body.filter((line) => line.trim());
  if (!filled.length) return '';

  const indent = Math.min(...filled.map((line) => line.match(/^[ \t]*/)[0].length));
  const lines = body.map((line) => line.slice(indent));
  return (head.startsWith('>') ? lines.join(' ') : lines.join('\n')).trim();
}

/** Les cinq champs connus, lus dans l'en-tête — absents de l'objet s'ils n'y sont pas. */
export function read(markdown) {
  const { inner } = splitFront(markdown);
  const values = {};
  for (const e of entries(inner)) {
    if (!FIELDS.includes(e.key)) continue;
    values[e.key] = value(e);
  }
  return values;
}

/**
 * Écrit les champs connus en tête du document — en place s'ils y étaient
 * déjà, à la suite du bloc sinon. Une valeur vide retire la clé ; un en-tête
 * qui ne porterait plus rien disparaît avec ses délimiteurs.
 */
export function write(markdown, fields) {
  const { inner, body } = splitFront(markdown);
  const list = entries(inner);

  for (const key of FIELDS) {
    if (!(key in fields)) continue;
    const value = String(fields[key] ?? '').trim();
    const at = list.findIndex((e) => e.key === key);
    if (!value) {
      if (at >= 0) list.splice(at, 1);
      continue;
    }
    const bare = NUMBERS.has(key) && /^\d+$/.test(value);
    // Une valeur de plusieurs lignes ne tient pas sur la ligne de la clé : elle
    // s'écrit en bloc littéral, seule forme qui garde les retours tels quels.
    const lines = value.includes('\n')
      ? [`${key}: |`, ...value.split('\n').map((line) => (line ? `  ${line}` : ''))]
      : [`${key}: ${bare ? value : quote(value)}`];

    if (at >= 0) list[at] = { key, lines };
    else list.push({ key, lines });
  }

  // Plus rien à porter : le bloc s'en va tout entier, délimiteurs compris, et
  // le document reprend à sa première ligne de texte.
  if (!list.length) return body.replace(/^\r?\n+/, '');

  const raw = list.flatMap((e) => e.lines).join('\n');
  return `---\n${raw}\n---\n\n${body.replace(/^\r?\n+/, '')}`;
}
