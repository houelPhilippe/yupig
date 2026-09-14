// Volet de lecture, à droite. Affiche l'article ouvert, sans quitter la grille.

import { el, replace } from './dom.js';
import { absolute, paragraphs } from '../format.js';
import * as store from '../store.js';
import { fill as fillThumb } from './thumb.js';
import { openExternal } from '../api.js';

const app = document.getElementById('app');
const reader = document.getElementById('reader');
const kicker = document.getElementById('reader-kicker');
const date = document.getElementById('reader-date');
const title = document.getElementById('reader-title');
const hero = document.getElementById('reader-hero');
const body = document.getElementById('reader-body');
const openBtn = document.getElementById('reader-open');
const favBtn = document.getElementById('reader-fav');

let link = '';

export function render(state) {
  const a = store.current();
  reader.hidden = !a;
  // Sert au point de rupture 1150 px : le volet des fils cède la place.
  app.classList.toggle('has-reader', Boolean(a));
  if (!a) return;

  kicker.textContent = a.feedName;
  date.textContent = [absolute(a.published ?? a.fetched), a.author].filter(Boolean).join(' · ');
  title.textContent = a.title;

  // Même bloc que la vignette des cartes, au gabarit du volet — et masqué par
  // le même réglage, sans quoi le levier laisserait passer une requête.
  hero.hidden = !state.settings.showThumbnails;
  if (hero.hidden) hero.replaceChildren();
  else fillThumb(hero, a);

  const parts = paragraphs(a.content || a.excerpt);
  replace(
    body,
    parts.length
      ? parts.map((p) => el('p', {}, p))
      : [el('p', {}, 'Ce flux ne fournit pas de texte. Ouvrez la source pour lire l’article.')],
  );

  link = a.link;
  openBtn.disabled = !link;
  favBtn.textContent = a.favorite ? '★ Retirer des favoris' : '★ Favori';
}

export function wire() {
  document.getElementById('reader-close').addEventListener('click', () => store.close());
  document.getElementById('reader-next').addEventListener('click', () => store.next().catch(store.fail));
  openBtn.addEventListener('click', () => openExternal(link).catch(store.fail));
  favBtn.addEventListener('click', () => {
    const a = store.current();
    if (a) store.toggleFavorite(a.id).catch(store.fail);
  });
}
