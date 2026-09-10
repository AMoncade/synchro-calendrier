# WORKLOG — Synchro Calendrier UdeM

## 2026-09-09 soir — v2 (spec de l'utilisateur, Downloads/SPEC.md)

- Dépôt GitHub public créé et main poussé : https://github.com/AMoncade/synchro-calendrier
  (5e627fb, licence MIT). Merges : `integration` (test bout en bout d'a6, 141 tests),
  `packaging` (`npm run package`, docs/INSTALL.md, docs/FIREFOX.md), `icon-source`.
- Quatre défauts de couture corrigés (bd5c68a) : UID ICS avec date de début, provenance du
  collage rendue par `parsePasted`, date locale pour deviner le trimestre, notes par cours ;
  max-wait 2,5 s sur l'anti-rebond du content script.
- Spec v2 acceptée sauf : table des temps de marche entre pavillons (§8.2, données
  invérifiables sans relevé sur place — différé), grille horaire de la semaine (§5 : liste
  groupée par jour d'abord, comme la spec l'autorise), isolation du popup par Shadow DOM
  (§1.1 : le popup est un document séparé, les styles de la page hôte ne l'atteignent pas ;
  le « 1 » signalé est à reproduire sur capture d'écran avant de corriger).
- Répartition : `src/format/` (a6, branche `format`), `core/today.ts` + `core/alerts.ts` +
  icon32 (48, branche `today`), `core/ics.ts` VALARM/SUMMARY v2 + `core/gcal.ts` (f4,
  branche `ics-v2`). Intégratrice : popup à onglets (écrit, en attente des modules), badge =
  cours restants aujourd'hui, manifest, README/captures.
- **Passe de couture d'a6 sur le popup v2** (`popup-sweep`, 11 tests) : « journée chargée » calculée
  sur la présence effective (blocs fusionnés) et non l'amplitude — 11 journées sur 68 au lieu de
  23 ; rendu complet à minuit et « Mis à jour » rafraîchi ; clés de dépliage séparées Semaine /
  Examens ; repli du panneau de détail sur le sigle seul ; congé nommé aussi dans Aujourd'hui ;
  helpers de dates repris de `format/` et `expand.ts`. 252 tests.
- **Retouches d'après captures** (d53eccd) puis **rapport UI externe** D1–D6 (6c62926,
  rapport sous `docs/reviews/`). Dédoublonnage des séances dans le panneau de détail.
- **Publication préparée** (6028a6a) : `npm run package` → `synchro-calendrier-0.2.0.zip` ;
  cinq captures 1280×800 dans `docs/store/` rendues depuis le vrai build (popup servi hors
  extension avec API chrome remplacées et horloge figée, gabarit dans le scratchpad de la
  session, mise au format par `npm run store-shots`) ; `docs/STORE.md` aligné sur la v2 ;
  README avec captures et section « Quand l'UdeM change son affichage ».
- **v2 livrée** (0519cdb → 03ba4db, version 0.2.0, 245 tests) : modules `format` (a6),
  `today`/`alerts` (48), `ics-v2`/`gcal` (f4) mergés ; popup à onglets écrit par
  l'intégratrice ; icône 32 px ; « 1er » et « hier » (format-2). Le « 1 » vu par
  l'utilisateur dans la marge était le glyphe ℹ des remarques, remplacé par « Note : ».
  En attente : captures d'écran de l'utilisateur, branches `ics-location` (fullLocation
  partagé) et `countdown-cleanup` (module orphelin).

## 2026-09-09 — Phase 0 (en cours)

- Squelette Vite 8 + @crxjs/vite-plugin 2.7 + Vitest 5 + happy-dom 20 + TypeScript,
  manifest MV3 (`storage`, `alarms`, host Synchro), modèle de données `src/core/model.ts`.
  Justification des dépendances : CRXJS produit des content scripts IIFE et gère le
  manifest ; happy-dom permet de tester l'extraction DOM sur les fixtures sans navigateur.
- Hôte Synchro confirmé dans Chrome : `academique-dmz.synchro.umontreal.ca/psp/acprpr9/`.
- Trois sessions parallèles briefées (worktrees `calendar-udem`, `ics-generator`,
  `conflicts`) sur le noyau pur ; l'intégratrice garde capture, parser, docs.
- Mergé sur `main` : `calendar-udem` (d2812dc → db683e5, 21 tests) et `conflicts`
  (ab94d86 → 2348276, 46 tests) ; gate vert sur main à chaque merge (`npx vitest run`,
  `npm run build`). `ics-generator` en cours : 4 fichiers non commités, 1 test rouge
  (exclusion) signalé à la session.
- Calendrier universitaire : sources = PDF du registraire 2026-2027 et calendrier FAS
  A26-H27, consultés le 2026-09-09. Les dates FAS (fin des cours, examens, 5 octobre)
  sont une lecture de grille visuelle du PDF : **à faire confirmer par un humain avant
  la 1.0**.
- Fixtures capturées dans Chrome sur la session de l'utilisateur (047bba8) : Centre étudiant
  et « Votre horaire cours » (vue Liste). Découverte clé : **les examens (volets EXI/EXF)
  sont dans le même tableau que les séances**, pas de page Examens séparée ; les plages de
  dates sont déjà coupées autour de la relâche. Structure décrite dans ARCHITECTURE §5.
  Transfert via l'outil JavaScript de Chrome par tranches de 900 caractères avec
  substitution de `=`, `$`, `;` (le filtre de l'outil bloquait le HTML brut).
- Contrat de capture brute `RawCapture` ajouté au modèle (3071aa2) ; briefs 2 envoyés :
  `extract.ts` (session calendar-udem, branche `extract`), `background/index.ts` +
  `core/store.ts` + `lib/messages.ts` (session conflicts, branche `background`).
- Parser `core/parse.ts` + repli texte (d2a7418) : 66 tests verts sur main, build OK.
- Session `ics-generator` silencieuse depuis 16:23 (4 fichiers non commités, 1 test rouge) :
  reprise par l'intégratrice (d7d3840). Le test rouge était une erreur du test (filtre qui
  attrapait l'examen), le code d'expansion et d'ICS est intact. 103 tests.
- Briefs 2 (extract, background) retirés à 17:35 : les deux sessions n'avaient rien commencé.
  Tout écrit par l'intégratrice : `content/extract.ts`, `content/synchro.ts`,
  `background/index.ts`, `core/store.ts`, `lib/messages.ts`, popup complet. **120 tests
  verts, build OK** — l'extension est assemblée de bout en bout mais **pas encore chargée dans
  Chrome** : c'est la prochaine vérification (chrome://extensions → charger `dist/`).
- Branche `store` mergée (d65badc) : icônes réelles, README, fiche Web Store (`docs/STORE.md`).
  Script `npm run icons` ajouté. Dépendance : `@resvg/resvg-js` ^2.6.2 (devDependency,
  2026-09-09) — rasterise `assets/icon.svg` en PNG 16/48/128 via
  `scripts/make-icons.mjs`. Moteur SVG en Rust livré en binaires préconstruits : aucun
  navigateur headless, ni node-gyp, ni ImageMagick ; génération reproductible avec `npm ci`.
  Outil de build uniquement, jamais importé par l'extension. ~4,4 Mo dans node_modules.
- Extraction vérifiée sur la **vraie page** Synchro (sonde injectée) : 4 cours, rangées et
  trimestre exacts. Variante réelle trouvée et corrigée (2b3e39a) : rangée vide avant
  « Remarques cours » dans le premier tableau de remarques.
- Décision : la colonne « URL » (icône SGA) est ignorée par l'extraction et le repli texte.
- Décision : le content script fait extraction **et** parsing, le service worker ne reçoit
  qu'un `Schedule` (docs/ARCHITECTURE.md §3 mis à jour).
