# Architecture — Synchro Calendrier UdeM

## 1. Objectif

Extension WebExtension (Manifest V3) qui, sur la session Synchro déjà ouverte de
l'étudiant, lit la page Horaire et la page Examens, produit un JSON propre, génère un ICS
(récurrences hebdomadaires + exclusions relâche/fériés + examens), détecte les conflits et
affiche un popup avec compte à rebours. Zéro serveur, zéro clé, stockage local seulement.

## 2. Contrat de données

Défini dans `src/core/model.ts` (source unique, versionné par `SCHEMA_VERSION`).

- `Schedule { schemaVersion, capturedAt, term, courses[], exams[] }`
- `Course { code "MAT1400", title, section, classNumber?, component TH|TP|LAB|AUTRE, meetings[], notes? }`
- `Meeting { weekday 1–7 (ISO), start "HH:MM", end "HH:MM", location, dateStart, dateEnd, note? }`
- `Exam { courseCode, kind intra|final|autre, date, start, end, location, label }`
- `Occurrence` : séance ou examen ramené à une date concrète — unité commune du
  générateur ICS et du détecteur de conflits.
- `Conflict { kind cours-cours|cours-examen|examen-examen, a, b, date, start, end }`

Décisions :
- Heures locales America/Toronto, jamais d'objet `Date` dans le modèle.
- Si Synchro affiche des fins d'heure en `:29`, le parser les arrondit à `:30`
  (constante documentée dans `parse.ts`) pour des blocs de calendrier propres.

## 3. Flux

```
Content script (all_frames, host Synchro)
  └─ content/extract.ts : DOM → RawBlock[] (texte uniquement)
        └─ message "SCHEDULE_CAPTURED" → service worker
Service worker (background/index.ts)
  └─ core/parse.ts (texte → Schedule) → chrome.storage.local
  └─ badge = jours avant le prochain examen (core/countdown.ts), chrome.alarms 1×/jour
Popup (popup/)
  └─ cours, examens, conflits (core/conflicts.ts), « Exporter .ics » (core/ics.ts),
     repli « Coller mon horaire » (même parse.ts)
```

`src/core/` ne dépend d'aucune API navigateur. Les exclusions de dates viennent de
`core/calendar-udem.ts` et sont passées **en paramètre** à `expand.ts` / `ics.ts`.

## 4. Propriétaires des fichiers (Phase 0–1, sessions parallèles)

| Fichiers | Propriétaire |
|---|---|
| `core/calendar-udem.ts` + test | session `calendar-udem` |
| `core/expand.ts`, `core/ics.ts` + tests | session `ics-generator` |
| `core/conflicts.ts`, `core/countdown.ts` + tests | session `conflicts` |
| tout le reste (model, parse, content, background, popup, docs, fixtures) | intégratrice |

## 5. Ce qui a été observé sur Synchro

- 2026-09-09 : hôte `academique-dmz.synchro.umontreal.ca`, chemin PeopleSoft
  `/psp/acprpr9/`, page de connexion `?cmd=login&languageCd=CFR`. Le `matches` du manifest
  est `https://*.synchro.umontreal.ca/*`.
- Page Horaire, page Examens, iframes, en-têtes de tableau, format des heures et des
  dates : **à compléter lors de la capture (Phase 0, étape 3)**.

## 6. Phases

0. Amorçage, fixtures capturées et anonymisées, docs.
1. Modèle + parser texte + calendrier universitaire (tests sur `horaire-A26.txt`).
2. Extraction DOM, content script, stockage, popup minimal.
3. Générateur ICS + export.
4. Examens, badge, compte à rebours.
5. Conflits, mode « coller mon horaire », signalement de bug.
6. Publication (icônes, captures, politique de confidentialité, Web Store), port Firefox.

Hors portée v1 : synchronisation Google Calendar par OAuth, Safari.
