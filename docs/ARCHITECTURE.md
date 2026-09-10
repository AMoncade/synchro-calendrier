# Architecture — Synchro Calendrier UdeM

## 1. Objectif

Extension WebExtension (Manifest V3) qui, sur la session Synchro déjà ouverte de
l'étudiant, lit la page « Votre horaire cours » (séances et examens dans le même tableau)
et le résumé du Centre étudiant, produit un JSON propre, génère un ICS (récurrences
hebdomadaires + exclusions relâche/fériés + examens avec rappels), détecte les conflits et
affiche un popup à trois onglets. Zéro serveur, zéro clé, stockage local seulement.

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

### Modules v2 (2026-09-09, spec de l'utilisateur)

- `src/format/` — texte affiché : dates françaises (table maison, « 1er »), temps relatif,
  locaux abrégés (`B-0215 · J.-Brillant`) ou longs (`B-0215, Pavillon J.-Brillant`), sigle
  compact, noms de volet, durées, palette par sigle (`courseColors` sur l'horaire entier :
  couleurs distinctes jusqu'à neuf cours). Pur ; `core/` **peut** importer `format/`, jamais
  l'inverse.
- `core/today.ts` — `buildTodayView(occurrences, exams, now)` : jour affiché (aujourd'hui,
  demain, prochain jour de cours, rien, trimestre terminé), blocs « now / next / later »,
  ≤ 6 éléments, prochain examen sous 30 jours. Convention : un bloc est en cours sur
  [début, fin[.
- `core/alerts.ts` — grappes d'examens (≥ 3 en 8 jours), journée chargée (> 6 h ou ≥ 3
  blocs), `classesRemainingToday` (badge).
- `core/ics.ts` v2 — `VALARM` (examens 24 h et 1 h, cours 15 min sur option), `SUMMARY`
  `MAT1400-A — Théorie` (avec section : TH-A et TP-A102 sont deux entrées), `CATEGORIES`.
- `core/gcal.ts` — URL « Ajouter à Google Agenda » pour un examen (heure locale + `ctz`).
- Popup v2 (`src/popup/`) : onglets Aujourd'hui / Semaine (liste par jour) / Examens
  (intras, finals, passés masquables), menu ⋯, repli « coller » plein cadre seulement sans
  horaire, panneaux dépliables (copier le local, carte du campus, Google Agenda). État
  d'interface dans `chrome.storage.local` (`synchro-calendrier.ui`), onglet ramené à
  Aujourd'hui après 4 h. Badge = cours restants aujourd'hui.
- Différé : temps de marche entre pavillons (§8.2 de la spec, aucune donnée fiable), grille
  horaire de la semaine (§5).

## 4. Propriétaires des fichiers

Historique (2026-09-09, sessions parallèles) : `calendar-udem.ts` par la session
`calendar-udem`, `conflicts.ts`/`countdown.ts` par la session `conflicts`, `expand.ts`/`ics.ts`
écrits par la session `ics-generator` puis repris par l'intégratrice ; tout le reste par
l'intégratrice. Depuis l'assemblage, **une seule session à la fois** sur `main`.

Phase 12 (2026-09-10, trois sessions en worktrees, intégratrice `adrie-aa`) :

| Fichier | Propriétaire | Branche |
|---|---|---|
| `src/core/deadlines.ts`, `tests/deadlines.test.ts` | session **deadlines** | `deadlines` |
| `src/core/studium.ts`, `tests/studium.test.ts`, `tests/fixtures/studium-*.json` | session **studium-parse** | `studium-parse` |
| `src/content/studium.ts`, `tests/studium-content.test.ts` | session **studium-sync** | `studium-sync` |
| `src/core/model.ts`, `src/lib/messages.ts`, `src/background/index.ts`, `manifest.json`, `src/popup/*`, `docs/*` | intégratrice | `main` |

Un patch sur un fichier de l'intégratrice (manifest, background, messages) se **propose dans
le rapport de fin**, il ne se commite pas sur la branche.

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

## 7. Échéances (phase 12, 2026-09-10)

Source : `docs/REPERAGE-STUDIUM-2026-09-10.md` (lu en direct sur la session StudiUM de
l'utilisateur). Décisions :

- **StudiUM est un complément, pas une deuxième source d'échéances.** Les intras et finaux
  restent ceux de Synchro. StudiUM apporte les quiz et devoirs (50 événements sur A26, tous
  des quiz, deux sites -AB) ; les autres sites n'ont aucune activité évaluée.
- **Voie principale : l'API AJAX interne de Moodle** (`/lib/ajax/service.php?sesskey=…&info=…`,
  méthodes `core_calendar_get_calendar_monthly_view` et
  `core_course_get_enrolled_courses_by_timeline_classification`), appelée par un content script
  sur `studium.umontreal.ca` avec le cookie de session. Aucun jeton stocké. L'export ICS
  (jeton permanent `authtoken`) reste un plan B non implémenté ; s'il l'est un jour, le jeton
  va dans `chrome.storage.local` seulement, jamais `sync`, et jamais dans un export.
- **`sesskey`** : lu dans le DOM de la page StudiUM visitée (inline `M.cfg` ou lien de
  déconnexion `?sesskey=`), par le content script, à chaque visite. Pas d'onglet caché, pas de
  fetch depuis le service worker. Si absent ou expiré (réponse Moodle `invalidsesskey`), le
  content script envoie `STUDIUM_FAILED` et le popup affiche « Ouvre StudiUM une fois pour
  synchroniser ».
- **`open` + `close` = une échéance**, fusionnée par `courseid + activityname` (ou par le
  `cmid` de l'URL). `close` orphelin → échéance sans `start` (quiz toujours ouvert) ; `open`
  orphelin → ignoré. Les autres `eventtype` (`due` des devoirs, `user`, `course`) : `due` →
  `kind: "devoir"`, le reste ignoré.
- **Le parseur est idempotent** (même événement deux fois → une échéance, premier vu gagne),
  parce que la même échéance revient d'une synchronisation à l'autre et reviendrait d'une
  méthode d'API à l'autre (`upcoming_view` vs `monthly_view`). Ce n'est PAS parce que deux
  vues mensuelles se recouvrent : vérifié par adrie-29 dans `week_exporter` (MOODLE_404),
  `prepadding`/`postpadding` sont des cases vides sans événement, les mois sont disjoints.
  Question ouverte (2026-09-10) : un événement à `timeduration > 0` est-il rattaché à chaque
  jour couvert (`calendar/lib.php`, `calendar_get_events_by_day`) ? Sans effet sur A26
  (50 événements, tous à durée nulle) ; si oui, c'est le dédoublonnage par `id` de
  `content/studium.ts` qui absorbe.
- **Liaison StudiUM → Synchro par le sigle seul**, tiré du `shortname` :
  `^([A-Z]{3}d{4})-([A-Z0-9]+)-([AHE]d{2})$`. La section StudiUM (-AB = site de TP) n'a pas
  d'équivalent Synchro. Le popup a un écran de liaison (sites à gauche, sigles Synchro à
  droite, pré-rempli) dont les choix vont dans `StoredState.courseLinks` et priment sur la
  déduction.
- **Un `Deadline` est un instant local** `"AAAA-MM-JJTHH:MM"` ; la conversion depuis
  `timestart` (secondes Unix) se fait en America/Toronto dans `core/studium.ts` avec
  `Intl.DateTimeFormat`, pas avec `toISOString()`.
- **Événements manuels** : mêmes `Deadline`, `source: "manuel"`, `id: manuel:<uuid>` (uuid
  fourni par l'appelant, `core/` reste pur). Créés dans le popup, validés par
  `core/deadlines.ts`.
- **Dans l'interface**, chaque échéance affiche sa provenance (`StudiUM` / `Ajouté à la main`)
  pour qu'une donnée manquante se comprenne. Les notes (carnet StudiUM) sont **hors périmètre**
  jusqu'à la v3 : données sensibles, révision Web Store plus lourde, opt-in séparé.

Flux :

```
Content script (host studium.umontreal.ca) — content/studium.ts
  └─ sesskey depuis le DOM ; fetch mois courant + 4 suivants (monthly_view), sites (timeline)
  └─ core/studium.ts : RawStudiumCapture → { deadlines: Deadline[], courses: StudiumCourse[] }
        └─ "STUDIUM_SYNCED" → service worker   (ou "STUDIUM_FAILED")
Service worker
  └─ core/deadlines.ts : mergeStudium (remplace les `studium:*`, garde les manuelles,
     respecte hiddenDeadlines), upsert/remove manuel, courseLinks → chrome.storage.local
Popup
  └─ core/deadlines.ts : resolveCourseCode, upcoming, byDay → sections « Échéances » dans
     Aujourd'hui et Semaine, onglet Examens inchangé ; formulaire manuel ; écran de liaison.
```

Hypothèse de fuseau (tranchée le 2026-09-10, second passage d'adrie-f6) : `core/studium.ts` ancre
`due`/`start` à America/Toronto, le popup compare à l'heure de la machine (`localNow`). C'est
cohérent avec tout le reste de l'extension (l'horaire Synchro est en heure locale comparée à
l'heure machine) : **l'extension suppose que le navigateur est réglé sur America/Toronto**.
Un étudiant en voyage verra des statuts décalés de l'écart de fuseau ; hors périmètre.

Permission ajoutée : `host_permissions` + `content_scripts` sur `https://studium.umontreal.ca/*`
(déclaration Web Store et `docs/PRIVACY.md` à aligner).
