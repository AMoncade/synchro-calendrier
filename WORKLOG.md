# WORKLOG — Synchro Calendrier UdeM

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
  reprise par l'intégratrice, voir commit suivant.
