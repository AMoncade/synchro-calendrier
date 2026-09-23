# Firefox

État (2026-09-23, version 0.3.1) : **porté**. Aucune ligne de `src/` ne diffère entre les deux
navigateurs ; la version Firefox est une **seconde sortie de build**, `dist-firefox/`, dérivée
de `dist/` par `scripts/firefox.mjs`.

```
npm run build:firefox     # dist/ puis dist-firefox/
npm run package:firefox   # synchro-calendrier-<version>-firefox.zip
```

Essai à la main, avec un profil jetable (les connexions Synchro et StudiUM se font dans la
fenêtre ouverte) :

```
npx web-ext run --source-dir dist-firefox --firefox-profile <dossier> --profile-create-if-missing --keep-profile-changes
```

Vérifié ce jour-là dans Firefox, sur la vraie session de l'utilisateur :

| | Résultat |
|---|---|
| `web-ext lint` sur `dist-firefox/` | 0 erreur, 0 avertissement |
| Capture Synchro (« Votre horaire cours », vue Liste) → popup | OK |
| Synchronisation StudiUM (menu ⋯ → Synchroniser StudiUM) | OK |
| Retour sur Synchro après StudiUM : l'état StudiUM survit | OK (après correctif, voir plus bas) |
| Téléchargement du `.ics` depuis le popup | OK : fichier iCalendar valide, 60 événements (cours, examens, échéances StudiUM), aucun UID en double |

## Ce qui diffère de la sortie Chrome

Trois choses, toutes appliquées par `scripts/firefox.mjs` (tests : `tests/firefox.test.ts`).

### 1. Arrière-plan : `scripts` au lieu de `service_worker`

> `background.service_worker` is not supported (see Firefox bug 1573659).
> — [MDN, manifest.json/background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)

Le chargeur émis par CRXJS (`service-worker-loader.js`) devient le script d'une *event page*,
`type: "module"` conservé. Le code d'arrière-plan convient tel quel : il n'enregistre que des
écouteurs au premier tour et ne garde rien en mémoire entre deux réveils.

### 2. Content scripts : scripts classiques autonomes, sans `import()`

CRXJS charge chaque content script par un petit chargeur qui fait
`import(chrome.runtime.getURL(...))`. Sous Firefox MV3, cet import échoue à chaque page :

```
TypeError: error loading dynamically imported module: moz-extension://…/assets/synchro.ts-….js
```

constaté le 2026-09-23 sur Synchro, avant et après connexion, alors que le module et ses
dépendances étaient bien déclarés dans `web_accessible_resources`. Cause documentée côté
Mozilla, bug toujours ouvert : l'import d'un content script MV3 passe par le chargeur de
modules de la page, pas par celui de l'extension
([bug 1803950](https://bugzilla.mozilla.org/show_bug.cgi?id=1803950)). L'option
`browser: "firefox"` de CRXJS 2.7 ne change rien à ce chargeur (lu dans
`node_modules/@crxjs/vite-plugin/dist/index.mjs`) : elle ne touche qu'à l'arrière-plan et à
`use_dynamic_url`.

`scripts/firefox.mjs` reconstruit donc `src/content/synchro.ts` et `src/content/studium.ts`
en IIFE (`content/synchro.js`, `content/studium.js`) avec l'API de build de Vite — aucune
dépendance ajoutée —, reprend les `content_scripts` du manifeste **source** en y pointant, et
retire `web_accessible_resources`, qui ne servait qu'à ces chargeurs.

### 3. Réglages Gecko

```json
"browser_specific_settings": {
  "gecko": {
    "id": "synchro-calendrier@moncade.com",
    "strict_min_version": "140.0",
    "data_collection_permissions": { "required": ["none"] }
  },
  "gecko_android": { "strict_min_version": "142.0" }
}
```

- `id` : obligatoire pour signer en MV3, **définitif** dès la première publication sur AMO.
  Pas d'identifiant en `@umontreal.ca` : l'extension n'est pas un produit de l'Université.
- `data_collection_permissions` : exigé par AMO pour toute nouvelle extension depuis le
  2025-11-03, connu à partir de Firefox 140 (bureau) et 142 (Android), d'où les versions
  minimales.
  > data transmission refers to any data collected, used, transferred, shared, or handled
  > outside the add-on or the local browser.
  > — [Extension Workshop, Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)

  `none` décrit l'extension : tout est lu et gardé dans le navigateur. **Zone grise à trancher
  par l'auteur avant la soumission** : le bouton « Ajouter à Google Agenda » ouvre une URL
  Google qui contient le titre, la date et le local du cours, au clic de l'utilisateur. La page
  citée ne prévoit aucune exception pour une action déclenchée par l'utilisateur.

## Ce que l'audit du 2026-09-09 disait de faux

L'audit précédent (lu sur `a76293b`) annonçait deux blocages. Le second était faux :

> In Manifest V3, Firefox supports promises for asynchronous events in the `chrome.*` namespace.
> — [Extension Workshop, guide de migration MV3](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)

Aucun `await chrome.*` n'a eu à changer. En revanche, l'audit n'avait pas vu le vrai blocage,
le chargeur des content scripts (§2 ci-dessus), qu'il avait seulement classé « non vérifié ».

Le `fetch` du content script StudiUM, lui, marche sous Firefox : un script de diagnostic
temporaire (hors dépôt) a comparé le `fetch` du content script et celui de la page
(`window.wrappedJSObject.fetch`) sur le même appel Moodle en lecture seule : HTTP 200 et
données reçues dans les deux cas, cookie de session compris. L'échec
`servicerequireslogin` vu une fois pendant l'essai date d'une tentative faite pendant la
connexion SAML.

## Défaut trouvé en chemin (touchait aussi Chrome)

`mergeCapture` (`src/core/store.ts`) reconstruisait l'état avec ses quatre champs Synchro
seulement : chaque capture Synchro effaçait l'état StudiUM, les échéances, les cochées, les
masquées, les liaisons et les notes. Présent depuis la phase 2, donc dans la 0.3.0 publiée
sur le Chrome Web Store. Corrigé en 0.3.1, épinglé par le test « garde tout ce qui ne vient pas
de Synchro » de `tests/store.test.ts`.

## Publication sur addons.mozilla.org (AMO)

- Le code publié est empaqueté par Vite : AMO exige le **code source** et des instructions de
  build qui redonnent des fichiers identiques
  ([Source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)).
  Les instructions pour les relecteurs sont dans `BUILD-FIREFOX.md` (en anglais).
- Firefox en version stable n'installe pas durablement une extension non signée : même pour
  une distribution privée, il faut passer par AMO (« listed », publique avec mises à jour
  automatiques, ou « unlisted », fichier `.xpi` signé à distribuer soi-même)
  ([Signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)).
