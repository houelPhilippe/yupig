// Grille de cartes : l'écran principal. Une carte = un article collecté.

import { el, icon, replace, PATH } from './dom.js';
import { relative, plural } from '../format.js';
import * as store from '../store.js';
import { fill as fillThumb } from './thumb.js';

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const countLine = document.getElementById('count-line');
const scopeTitle = document.getElementById('scope-title');
const scopeMeta = document.getElementById('scope-meta');
const keyword = document.getElementById('keyword');
const keywordLabel = document.getElementById('keyword-label');

export function render(state) {
  const { articles, stats } = state;
  const feed = state.feedId ? state.feeds.find((f) => f.id === state.feedId) : null;

  scopeTitle.textContent = feed ? feed.name : 'Tous les articles';
  scopeMeta.textContent = feed
    ? `${feed.url} · ${feed.unread} non lus`
    : `${plural(stats.feeds, 'fil')} · ${stats.unread} non lus · ${lastSync(stats.lastSync)}`;

  for (const chip of document.querySelectorAll('.chip[data-filter]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter));
  }
  labelChips(stats);

  const hasKeyword = state.q.trim().length > 0;
  keyword.hidden = !hasKeyword;
  if (hasKeyword) keywordLabel.textContent = `Mot-clé : ${state.q.trim()}`;

  const cards = articles.map((a) => card(a, state));
  if (state.settings.showReservedTile && articles.length > 0) cards.push(reserved());
  replace(grid, cards);

  empty.hidden = articles.length > 0;
  countLine.textContent = articles.length
    ? `${plural(articles.length, 'article')} affiché${articles.length > 1 ? 's' : ''} sur ${stats.total} collectés`
    : `${stats.total} article${stats.total > 1 ? 's' : ''} collectés au total`;
}

/** Les compteurs vivent dans le libellé des puces, comme dans le modèle. */
function labelChips(stats) {
  const counts = { tous: stats.total, nonlus: stats.unread, favoris: stats.favorites };
  const names = { tous: 'Tous', nonlus: 'Non lus', favoris: 'Favoris' };
  for (const chip of document.querySelectorAll('.chip[data-filter]')) {
    const k = chip.dataset.filter;
    chip.textContent = `${names[k]} · ${counts[k]}`;
  }
}

function lastSync(iso) {
  const r = relative(iso);
  return r ? `dernière collecte ${r}` : 'jamais collecté';
}

function card(a, state) {
  const node = el('article.card');
  if (a.read) node.classList.add('is-read');
  if (state.openId === a.id) node.classList.add('is-active');

  if (state.settings.showThumbnails) node.append(fillThumb(el('div.card__thumb'), a));

  const meta = el('div.card__meta');
  if (!a.read) meta.append(el('span.card__unread'));
  meta.append(
    el('span.card__kicker', {}, a.feedName),
    el('span.card__time', { title: a.published ?? a.fetched }, relative(a.published ?? a.fetched)),
  );

  const title = el('h4.card__title', {
    role: 'button',
    tabindex: '0',
    onclick: () => store.open(a.id).catch(store.fail),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        store.open(a.id).catch(store.fail);
      }
    },
  }, a.title);

  const read = el('button.btn.btn-secondary.btn-icon', {
    title: a.read ? 'Marquer comme non lu' : 'Marquer comme lu',
    onclick: () => store.toggleRead(a.id).catch(store.fail),
    style: a.read ? 'background:color-mix(in srgb, var(--color-text) 12%, transparent)' : null,
  });
  read.append(icon(PATH.check, { width: 2.2 }));

  const fav = el('button.btn.btn-secondary.btn-icon.btn--fav', {
    title: a.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris',
    onclick: () => store.toggleFavorite(a.id).catch(store.fail),
  });
  if (a.favorite) fav.classList.add('is-on');
  fav.append(icon(PATH.star, { fill: a.favorite ? 'currentColor' : 'none' }));

  const open = el('button.btn.btn-secondary.btn--open', {
    onclick: () => store.open(a.id).catch(store.fail),
  });
  open.append(icon(PATH.book, { size: 14 }), 'Lire');

  node.append(
    el(
      'div.card__body',
      {},
      meta,
      title,
      el('p.card__excerpt', {}, a.excerpt || 'Pas de résumé fourni par ce flux.'),
      el('div.card__actions', {}, read, fav, open),
    ),
  );
  return node;
}

/** Emplacement au même gabarit que les cartes, repris du modèle. */
function reserved() {
  return el(
    'article.reserved',
    {},
    el('h6', {}, 'Bloc réservé'),
    el('p', {}, 'Emplacement au même gabarit que les cartes, prêt à recevoir une autre source : indicateurs, météo, notes d’équipe.'),
    el('div.spacer'),
    el('button.btn.btn-secondary', { style: 'justify-content:flex-start', disabled: true }, 'Choisir une source'),
  );
}
