// En-tête : recherche, état de la collecte, boutons globaux.

import { relative } from '../format.js';
import * as store from '../store.js';

const search = document.getElementById('search');
const status = document.getElementById('sync-status');
const label = document.getElementById('sync-label');
const syncBtn = document.getElementById('sync-all');

export function render(state) {
  // On ne réécrit pas le champ pendant la frappe : le curseur sauterait.
  if (document.activeElement !== search) search.value = state.q;

  status.classList.toggle('is-busy', state.syncing);
  syncBtn.disabled = state.syncing;
  label.textContent = state.syncing
    ? 'Collecte en cours…'
    : state.stats.lastSync
      ? `Synchronisé ${relative(state.stats.lastSync)}`
      : 'Jamais synchronisé';
}

export function wire() {
  // 250 ms : assez pour ne pas relancer une requête SQL à chaque touche,
  // assez court pour que la grille suive la frappe.
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => store.setQuery(search.value).catch(store.fail), 250);
  });

  syncBtn.addEventListener('click', () => store.syncAll().catch(store.fail));
  document.getElementById('open-panel').addEventListener('click', () => {
    store.togglePanel(true);
    document.getElementById('new-feed')?.focus();
  });
}
