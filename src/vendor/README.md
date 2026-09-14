# Bibliothèques tierces embarquées

La CSP de l'application (`default-src 'self'`) interdit toute origine externe :
ces fichiers sont donc versionnés ici plutôt que chargés depuis un CDN. Ils sont
servis tels quels par `frontendDist`, sans étape de build — le dépôt n'a ni
`package.json` ni bundler, et ces deux fichiers sont des builds UMD autonomes.

| Fichier | Version | Licence | Origine |
|---|---|---|---|
| `marked.min.js` | 15.0.7 | MIT | https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js |
| `turndown.js` | 7.2.0 | MIT | https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js |

`marked` expose le global `marked` (Markdown → HTML), `turndown` expose
`TurndownService` (HTML → Markdown). Les deux sont chargés en `<script>`
classique dans `index.html`, **avant** le module `js/main.js`.

## Mise à jour

Remplacer le fichier, corriger la version ci-dessus, et relire
`js/markdown.js` : c'est lui qui assainit la sortie de `marked` avant tout
`innerHTML`. **Ne jamais insérer la sortie brute de `marked` dans le DOM** —
`marked` n'assainit rien depuis la v5, et la webview a accès à `__TAURI__`.
