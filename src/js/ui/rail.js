// Rail replié : un monogramme par fil, la pastille marquant les non-lus.

import { el, replace } from './dom.js';
import * as store from '../store.js';

const host = document.getElementById('rail-feeds');
const rail = document.getElementById('rail');

export function render(state) {
  // Rail et volet sont deux états du même objet : jamais les deux à la fois.
  rail.hidden = state.panelOpen;
  if (state.panelOpen) return;

  replace(
    host,
    state.feeds.map((f) => {
      const selected = state.feedId === f.id;
      const btn = el(
        'button.mono.mono--rail',
        {
          title: `${f.name} — ${f.unread} non lus`,
          'aria-pressed': String(selected),
          onclick: () => store.selectFeed(f.id).catch(store.fail),
        },
        f.mono,
      );
      if (f.ok && f.unread > 0) btn.append(el('span.mono__dot'));
      if (!f.ok) btn.style.borderColor = 'var(--color-accent)';
      return btn;
    }),
  );
}
