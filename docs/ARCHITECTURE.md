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
Content script (all_frames, host Synchro) — content/synchro.ts
  └─ content/extract.ts : DOM → RawCapture (texte uniquement, tableaux repérés par en-têtes)
  └─ core/parse.ts : RawCapture → Schedule (jours, heures :29→:30, dates, EXI/EXF → examens)
        └─ message "SCHEDULE_CAPTURED" { schedule, source } → service worker
Service worker (background/index.ts)
  └─ core/store.ts : fusion (liste remplace, centre ne remplace pas liste) → chrome.storage.local
  └─ badge = jours avant le prochain examen (core/countdown.ts), chrome.alarms 1×/h
Popup (popup/)
  └─ GET_STATE → core/store.currentTerm ; cours, examens, conflits (core/expand + conflicts),
     « Exporter .ics » (core/ics.ts + calendar-udem.excludedDates), « Copier »,
     repli « Coller mon horaire » (core/parse.parsePastedText → SCHEDULE_CAPTURED)
```

Décision (2026-09-09) : le parsing se fait dans le **content script**, pas dans le service
worker, pour que celui-ci ne reçoive qu'un `Schedule` déjà valide et reste trivial.

`src/core/` ne dépend d'aucune API navigateur. Les exclusions de dates viennent de
`core/calendar-udem.ts` et sont passées **en paramètre** à `expand.ts` / `ics.ts`.

## 4. Propriétaires des fichiers

Historique (2026-09-09, sessions parallèles) : `calendar-udem.ts` par la session
`calendar-udem`, `conflicts.ts`/`countdown.ts` par la session `conflicts`, `expand.ts`/`ics.ts`
écrits par la session `ics-generator` puis repris par l'intégratrice ; tout le reste par
l'intégratrice. Depuis l'assemblage, **une seule session à la fois** sur `main`.

## 5. Ce qui a été observé sur Synchro

- 2026-09-09 : hôte `academique-dmz.synchro.umontreal.ca`, chemin PeopleSoft
  `/psp/acprpr9/`, page de connexion `?cmd=login&languageCd=CFR`. Le `matches` du manifest
  est `https://*.synchro.umontreal.ca/*`.
- Connexion SAML via `saml.authentification.umontreal.ca` ; l'accueil est une page Fluid
  (`/psc/acprpr9/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL`). **Aucun iframe** sur les
  pages utiles : le chemin `/psc/` sert le contenu sans le cadre portail. `all_frames: true`
  reste dans le manifest par prudence, mais n'a pas été nécessaire.
- **Page Centre étudiant** (`SA_LEARNER_SERVICES.SSS_STUDENT_CENTER.GBL`) : résumé de
  l'horaire dans le bloc `win0divUMET_WKLSCHD_VW$0`, tableau `UMET_WKLSCHD_VW$scroll$0`,
  colonnes « Dates limites | SGA | Cours | Horaire ». Cellule Cours = `MAT 1400-A` + `TH (1490)`
  (sigle-section, puis volet et nº de classe). Cellule Horaire = une ou plusieurs paires
  « `J 08:30 - 10:29` / `B-0215  Pav. 3200 J.-Brillant` » séparées par une ligne vide,
  parfois précédées de « En ligne ». **Pas de dates de début/fin** ici. Fixture :
  `tests/fixtures/centre-etudiant-A26.{html,txt}`.
- **Page « Votre horaire cours »** (`SA_LEARNER_SERVICES.SSR_SSENRL_LIST.GBL`, vue Liste ;
  atteinte via le bouton « Horaire hebdomadaire » puis le radio « Liste », après une page de
  **sélection du trimestre** quand plusieurs sont inscrits). C'est la source complète :
  - en-tête de trimestre dans `win0divDERIVED_REGFRM1_SSR_STDNTKEY_DESCR` :
    « Automne 2026 | Premier cycle | Université de Montréal » ;
  - un bloc par cours, titre `<h2>MAT 1400 - Calcul 1</h2>`, tableau de statut
    (`SSR_DUMMY_RECVW$scroll$N`), tableau des séances **`UMET_CLS_EXM_VW$scroll$N`** et,
    parfois, tableau de remarques `UMET_CLS_NOTEVW$scroll$N` ;
  - colonnes du tableau des séances : Nº cours | Section | Volet | Jours et heures | Local |
    Enseignant | Dates début/fin | URL. La première rangée d'un volet porte nº/section/volet,
    les rangées de continuation les laissent vides ;
  - volets vus : `TH`, `TP`, **`EXI` (examen intra), `EXF` (examen final)**. Les examens sont
    donc dans le même tableau, avec une **date unique** (`26/10/2026`) au lieu d'une plage ;
  - jours : `Lun`, `Ma`, `Mer`, `J`, `V` (samedi/dimanche non observés) ; heures
    `08:30 - 10:29` (fin en `:29`) ; dates `jj/mm/aaaa` ; plage `31/08/2026 - 16/10/2026` ;
  - les plages sont **déjà découpées** autour de la relâche (16/10 → 26/10) et des examens
    qui tombent sur un créneau de TP (ex. TP du mercredi absent le 07/10 et le 11/11) ; les
    fériés (07/09, 12/10) ne le sont pas → le calendrier universitaire reste nécessaire ;
  - cas particuliers : « `À communiquer 08:30 - 10:29` » + local « En ligne » (séance sans
    jour fixe) ; enseignant « À communiquer » ; cellule URL parfois « SGA ».
  - Fixtures : `tests/fixtures/liste-A26.txt` (texte collé des 4 cours, tel que `innerText`),
    `liste-A26.rows.json` (rangées structurées des 4 cours, oracle d'`extract.ts`),
    `liste-A26.html` (HTML allégé réel de 2 blocs : MAT 1600 et STT 1700, + en-tête).
  - Le calendrier hebdomadaire (`SSR_SSENRL_SCHD_W.GBL`) affiche cours en vert et examens en
    jaune, mais n'est pas utilisé.
- L'URL de ces pages contient `EMPLID=<matricule>` : ne jamais journaliser ni stocker l'URL.

## 6. Phases

0. Amorçage, fixtures capturées et anonymisées, docs.
1. Modèle + parser texte + calendrier universitaire (tests sur `horaire-A26.txt`).
2. Extraction DOM, content script, stockage, popup minimal.
3. Générateur ICS + export.
4. Examens, badge, compte à rebours.
5. Conflits, mode « coller mon horaire », signalement de bug.
6. Publication (icônes, captures, politique de confidentialité, Web Store), port Firefox.

Hors portée v1 : synchronisation Google Calendar par OAuth, Safari.
