// Demande d'une ligne : une question, un champ, deux issues.
//
// C'est ce que `window.prompt` ferait, si la webview le montrait. Elle ne le
// montre pas : l'appel rendait `null` sans que rien ne paraisse à l'écran, et
// la commande se trouvait annulée en silence — « Renommer » semblait sans
// effet. La boîte du système, elle, ne sait poser que des questions fermées
// (`api.ask`) : pour un mot à saisir, il faut la nôtre.
//
// Elle ne sait rien de ce qu'on lui fait dire : elle rend la ligne saisie à qui
// l'a ouverte, comme la boîte du signet rend son identifiant. La réponse arrive
// par une promesse plutôt que par un rappel — c'est ce qui permet à l'appelant
// de s'écrire dans l'ordre où il se lit, `const nom = await open(…)`.

import { icon, PATH } from './dom.js';

const dialog = document.getElementById('prompt-dialog');
const heading = document.getElementById('prompt-dialog-title');
const labelNode = document.getElementById('prompt-label');
const field = document.getElementById('prompt-field');
const status = document.getElementById('prompt-status');
const closeBtn = document.getElementById('prompt-dialog-close');
const cancelBtn = document.getElementById('prompt-cancel');
const applyBtn = document.getElementById('prompt-apply');

// La boîte est unique : `deliver` est la promesse en cours, s'il y en a une.
let deliver = null;

/**
 * Ouvre la boîte et rend ce qui a été saisi, ou `null` si l'on renonce.
 *
 * `hint` s'écrit dans la barre d'état de la boîte : ce que la valeur doit être,
 * dit une fois pour toutes plutôt qu'en message d'erreur après coup.
 */
export function open({ title, label, value = '', okLabel = 'Valider', hint = '' }) {
  // Deux boîtes ne peuvent pas être à l'écran : si la précédente y est encore,
  // c'est qu'elle n'a pas été refermée — on la clôt comme un renoncement,
  // plutôt que de laisser sa promesse en suspens pour toujours.
  close(null);

  heading.textContent = title;
  labelNode.textContent = label;
  applyBtn.textContent = okLabel;
  status.textContent = hint;
  field.value = value;

  dialog.hidden = false;
  refresh();
  field.focus();
  field.select();

  return new Promise((resolve) => {
    deliver = resolve;
  });
}

/** Referme en rendant `answer` à qui attend. */
function close(answer) {
  const resolve = deliver;
  deliver = null;
  dialog.hidden = true;
  resolve?.(answer);
}

/** Une ligne vide n'est pas une réponse : le poussoir s'éteint. */
function refresh() {
  applyBtn.disabled = field.value.trim() === '';
}

function submit() {
  const text = field.value.trim();
  if (text) close(text);
}

export function wire() {
  closeBtn.append(icon(PATH.close, { size: 13 }));

  closeBtn.addEventListener('click', () => close(null));
  cancelBtn.addEventListener('click', () => close(null));
  applyBtn.addEventListener('click', submit);
  field.addEventListener('input', refresh);

  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) close(null);
  });
  // Les deux touches propres à une boîte, comme partout ailleurs : tant qu'elle
  // est à l'écran, le clavier lui appartient.
  dialog.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close(null);
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      submit();
    }
  });
}
