// Illustration d'un article : la photo portée par le flux, à défaut le
// monogramme sur l'aplat gris du modèle. Partagé par la grille et le volet de
// lecture, qui ne s'appellent pas entre eux.

import { el } from './dom.js';

/**
 * Remplit un conteneur déjà stylé (`.card__thumb`, `.reader__hero`).
 *
 * C'est l'appelant qui décide d'afficher le bloc ou non : masquer la vignette
 * est le seul moyen d'empêcher la requête vers le serveur d'images du média.
 */
export function fill(box, article) {
  box.replaceChildren();
  box.classList.remove('grayscale');

  const mono = () => {
    box.classList.add('grayscale');
    box.append(el('span', {}, article.feedMono));
  };

  if (!article.image) {
    mono();
    return box;
  }

  const img = el('img', {
    src: article.image,
    // Décorative : le titre voisin dit déjà de quoi il s'agit.
    alt: '',
    loading: 'lazy',
    // Un serveur d'images tiers n'a pas à connaître la page qui l'appelle.
    referrerpolicy: 'no-referrer',
    // Adresse morte, format refusé, requête bloquée par la CSP : on retombe
    // sur le monogramme plutôt que de laisser un cadre vide.
    onerror: () => {
      img.remove();
      mono();
    },
  });
  box.append(img);
  return box;
}
