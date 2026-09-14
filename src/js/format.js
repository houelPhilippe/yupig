// Mise en forme des dates et des libellés. Le modèle affiche « il y a 22 min »,
// « hier », « 2 jours » : ces règles-là sont reproduites telles quelles.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const LONG = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

/** « à l’instant », « il y a 22 min », « il y a 3 h », « hier », « 4 jours ». */
export function relative(iso, now = Date.now()) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = now - t;

  if (d < MINUTE) return 'à l’instant';
  if (d < HOUR) return `il y a ${Math.floor(d / MINUTE)} min`;
  if (d < DAY) return `il y a ${Math.floor(d / HOUR)} h`;
  if (d < 2 * DAY) return 'hier';
  if (d < 30 * DAY) return `${Math.floor(d / DAY)} jours`;
  return absolute(iso).split(',')[0];
}

/** « 3 septembre 2026, 08:14 » — l'en-tête du volet de lecture. */
export function absolute(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : LONG.format(new Date(t));
}

/** Accord au pluriel : `plural(1, 'article')` → « 1 article ». */
export function plural(n, singular, suffix = 's') {
  return `${n} ${singular}${n > 1 ? suffix : ''}`;
}

/** Découpe un texte continu en paragraphes lisibles pour le volet droit. */
export function paragraphs(text, target = 3) {
  const clean = (text || '').trim();
  if (!clean) return [];

  const byBreak = clean.split(/\n{2,}|\r\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (byBreak.length > 1) return byBreak;

  // Un flux rend souvent un bloc unique : on regroupe par phrases pour
  // retrouver le rythme des trois paragraphes du modèle.
  const sentences = clean.match(/[^.!?…]+[.!?…]+(\s|$)|[^.!?…]+$/g);
  if (!sentences || sentences.length <= target) return [clean];

  const per = Math.ceil(sentences.length / target);
  const out = [];
  for (let i = 0; i < sentences.length; i += per) {
    out.push(sentences.slice(i, i + per).join('').trim());
  }
  return out.filter(Boolean);
}
