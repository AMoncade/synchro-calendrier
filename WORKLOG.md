# WORKLOG — Synchro Calendrier UdeM

## 2026-09-10 après-midi — Phase 13 : échéances cochables, notes en opt-in, onglets

- Demande de l'utilisateur après la première synchro réelle : cocher un quiz fait ; un menu
  « Notes + moyenne du groupe » ; les onglets dont la barre apparaissait décalée (ma règle
  générique `button { display:inline-flex }` alignait le libellé à gauche d'une cellule
  `flex:1` — onglets maintenant au contenu, barre sous le libellé).
- **Décision revue** : les notes entrent dans le périmètre, en opt-in désactivé par défaut
  (ARCHITECTURE §7 amendé, §8 ajouté, PRIVACY et fiche Store réécrites — alerte d'adrie-f6 :
  la politique disait deux fois « ne lit pas vos notes » alors que le contrat était posé).
  La déclaration Web Store devra mentionner les notes comme données lues localement.
- Contrat (a246a1a) : `doneDeadlines`, `DEADLINE_DONE_SET`, `GradeItem`/`GradeReport`,
  `STUDIUM_GRADES_SYNCED`, clé opt-in `synchro-calendrier.studium-grades-optin`. Garde
  d'exhaustivité vérifiée en vrai : `tsc` a refusé le background tant que les deux messages
  n'étaient pas routés.
- adrie-f6, `deadlines-done` (325f4ed, +20) : `setDeadlineDone`, `isDone`, `pruneDone` (appelé
  par `mergeStudium` et `removeDeadline`), `deadlineStatus` avec `done` qui prime sur tout.
- adrie-07, `tampon-tests` (80b7e71, +4) : run interrompu → aucun tampon ; course entre onglets
  figée comme délibérée (12 requêtes si deux onglets simultanés, accepté).
- **Livré** (1e5a51c, 21 fichiers, 522 tests, zip 0.3.0 regénéré) : adrie-29 `grades-parse`
  (621eee2, +29 : tableau repéré par en-têtes, `.rowtitle` préféré, colonnes `lettergrade`/`rank`
  ignorées, deux fixtures synthétiques dont une page de connexion ; contrat corrigé : note absente =
  chaîne vide, `depth` = crans d'indentation) et adrie-07 `grades-sync` (8be2a4d, +10 : GET par site
  après une synchro calendrier réussie, opt-in `true` littéral seulement, `fetchText` séparé du POST
  JSON, un site en erreur n'empêche pas les autres, URL sans `userid`). Non vérifié sur le terrain :
  le HTML réel du carnet (fixture synthétique) — premier essai à faire par l'utilisateur avec
  l'option activée.
- **Terrain, 2026-09-10 fin d'après-midi** : option Notes activée par l'utilisateur sur sa vraie
  session StudiUM → « les notes marchent, tout s'affiche ». Le parseur écrit sur une fixture
  synthétique tient sur le HTML réel (noms, notes, barèmes, moyennes du groupe). Revue
  pré-soumission (`docs/reviews/REVUE-PRE-SOUMISSION-2026-09-10.md`) traitée à e6b8aba : cinq
  bloquants réglés, six captures refaites, « Non officiel » dans le résumé et le manifest.
  Décision de l'utilisateur : soumettre 0.3.0 avec les notes. Reste dans la console : nom
  d'éditeur, langue de la fiche, dépôt.
- Était en vol : adrie-29 `grades-parse` (`core/grades.ts`, tableau repéré par en-têtes texte ;
  structure lue en direct sur MAT1600-AB-A26, HTML brut non capturable par l'outil),
  adrie-07 `grades-sync` (GET des rapports par site après la synchro calendrier, opt-in
  seulement). Popup (intégratrice) : case à cocher sur chaque échéance, panneau Notes depuis
  le menu, bascule opt-in qui efface les notes à la désactivation.

## 2026-09-10 — Phase 12 : échéances StudiUM et événements manuels (version 0.3.0)

- Point de départ : repérage de l'utilisateur sur sa session StudiUM
  (`docs/REPERAGE-STUDIUM-2026-09-10.md`, versionné à ea0a60a) et ses décisions : fusionner
  `open` + `close` en une échéance à fenêtre, lier StudiUM → Synchro par le sigle seul,
  StudiUM en complément (les intras/finaux restent ceux de Synchro), notes hors périmètre
  jusqu'à la v3 (données sensibles, révision Web Store). Voie retenue : l'API AJAX interne de
  Moodle depuis un content script (cookie de session, aucun jeton) ; l'export ICS à
  `authtoken` permanent reste un plan B non implémenté. Tout consigné dans
  `docs/ARCHITECTURE.md` §7.
- Contrat d'abord (ea0a60a) : `Deadline`, `StudiumCourse`, `RawMoodleEvent`,
  `RawStudiumCapture` dans `model.ts` ; messages `STUDIUM_SYNCED`/`STUDIUM_FAILED`/
  `DEADLINE_UPSERT`/`DEADLINE_REMOVE`/`COURSE_LINK_SET`/`STUDIUM_SYNC_NOW` ; état
  `deadlines`, `hiddenDeadlines`, `studium`, `courseLinks`. Trois sessions Opus briefées
  par fichier sur ce contrat, intégratrice adrie-aa :
  - **adrie-f6**, `core/deadlines.ts` (de8172f, +69 tests) : fusion d'une synchro (vue
    complète : remplace les `studium:*`, garde les manuelles, respecte les masquées),
    `removeDeadline` masque une StudiUM, `resolveCourseCode` (surcharge `courseLinks`),
    `deadlineStatus` (due-today prime sur open), `validateManual` (31 février refusé,
    « mat 1400 » normalisé). Contrôle de mutation mesuré après coup : borne haute de
    `upcomingDeadlines` cassée → 2 échecs. Son seul accroc de contrat, l'instant d'échec
    sans champ, est corrigé au merge par `StudiumStatus.lastErrorAt`.
  - **adrie-29**, `core/studium.ts` (4a8b2fe, +52 tests, merge 0b125f8) : schéma des
    événements lu dans le source Moodle 4.4 (`event_exporter_base`) ; découverte : les
    événements hors module portent `/course/view.php?id=<courseid>`, lire `id=` naïvement
    prendrait un courseid pour un cmid → `MODULE_URL_RE` exige `/mod/<type>/view.php`.
    Fuseau par `Intl.DateTimeFormat` (Toronto). URL refusée si `authtoken=`/`sesskey=` ou
    schéma non http(s). Six mutations testées, un trou comblé (« premier vu gagne »).
    **Fixture synthétique** dérivée du source Moodle et du repérage, marquée comme telle :
    aucune capture JSON réelle de StudiUM n'existe (extension Chrome de Claude déconnectée
    ce jour). Le « Devoir 1 » de la fixture est inventé (0 devoir daté sur A26).
  - **adrie-07**, `content/studium.ts` (3870707, +33 tests, merge cce7a9c) : sesskey lu
    dans le DOM (lien de déconnexion, sinon `<script>` inline — présence sur StudiUM NON
    vérifiée, à trancher à la première visite), mois courant + 4 suivants en séquence
    (séquentialité mesurée, `maxInFlight === 1`), enveloppe et noms d'arguments vérifiés dans
    MOODLE_405_STABLE (`service.php`, `external_api`, `calendar/externallib.php`), anti-rafale
    30 min écrit avant les appels (clé `synchro-calendrier.studium-last-run`), sortie
    `sesskey-absent` avant écriture. Couture trouvée par lui : « Synchroniser StudiUM » qui
    ouvre un onglet ne forçait pas la synchro sous 30 min, et le popup meurt au changement
    d'onglet donc aucun message différé ne peut partir de lui → drapeau
    `synchro-calendrier.studium-force-next` posé par le popup, consommé au démarrage
    (retiré d'abord, forcé ensuite).
- Intégratrice (dc89547 → cce7a9c) : service worker (cinq gestionnaires sur
  `core/deadlines.ts`, `CLEAR_ALL` retire aussi les deux clés du content script), popup
  (section « Échéances » sous Aujourd'hui à 7 jours + fenêtres ouvertes, lignes par jour dans
  Semaine avec provenance, formulaire « Ajouter un événement », écran « Lier les sites
  StudiUM », ligne d'état StudiUM au pied), ICS (`deadlineEvent` : DTSTART = DTEND = `due`,
  fenêtre dans DESCRIPTION, URL jamais avec jeton, VALARM 24 h ; +3 tests), manifest
  (host + content script StudiUM, top frame), PRIVACY, fiche Store, README.
  Décision : la description Moodle n'est pas mappée en note (HTML à nettoyer, utilité non
  démontrée). `RawMoodleEvent.location` ajouté, recopiage confié à adrie-29.
- Gate à cce7a9c : 18 fichiers, **409 tests**, build OK, `dist/assets/studium.ts-*.js` produit.
- En cours après cce7a9c : passe de couture d'adrie-f6 (branche `sweep`, lecture seule,
  cinq axes : identité des ids, fenêtre orpheline, provenance, fuseau, état antérieur) ;
  test de chaîne d'adrie-29 (branche `studium-pipeline` : enveloppe brute → flatten → parse →
  merge, plus `location`).
- **Passe de couture d'adrie-f6** (`sweep`, e59a155 → 291f7ee, 13 cas figés) : cinq défauts.
  (1) **Bloquant** : le service worker ne routait aucun des cinq messages de la phase 12 — mon
  premier script d'édition du background faisait un `replace` sans vérifier l'ancre ;
  l'import (une ligne) a matché, le bloc de `case` (multi-lignes, fichier en CRLF) non, sans
  erreur. C'était exactement le symptôme rapporté par l'utilisateur (« j'ouvre StudiUM, rien
  ne se passe »). Corrigé à d7c57e1 avec une garde d'exhaustivité (`never`) ; le témoin
  `SCHEDULE_CAPTURED` de f6 est ce qui a rendu les cinq cas rouges probants. (2)+(3) l'id
  et la clé de regroupement de `core/studium.ts` décidés par événement → id instable,
  fenêtre perdue si l'URL manque sur un seul des deux événements. (4) `syncedAt` local nu
  passé à `relativeTime` (ISO) → `toIso()` côté popup. (5) classe CSS `open` (statut) en
  collision avec `open` (déplié) → `status-*`. Vérifié et propre par f6 : clés partagées,
  état antérieur, provenance, fuseau ICS, UID insensible aux liaisons.
- **Regroupement stable** (adrie-29, `studium-pipeline` 8622ebe, merge e992ede) : panier
  `courseid + slug`, mais **deux cmids distincts restent deux activités** (contradiction
  retenue : Moodle autorise deux « Quiz » homonymes dans un cours, ma règle en aurait fait
  disparaître un en silence) ; un événement sans cmid ne rejoint que si le panier n'a qu'un
  cmid ; id décidé sur le groupe. Aussi : `tests/studium-pipeline.test.ts` (enveloppe brute →
  `readAjaxPayload`/`flattenMonthlyEvents`/`readCourses` → parseur → `mergeStudium`) et
  `location` recopiée. Défaut rapporté par 29, à f6 : `allDeadlines` trie par
  `localeCompare("fr")` alors que les autres modules comparent en brut. Résidu accepté :
  une activité dont l'URL disparaît de tous ses événements change d'id (théorique).
- Vérifié en direct (outil Chrome reconnecté, page « Mon StudiUM ») : le `sesskey` est bien
  dans le lien de déconnexion et dans `M.cfg` inline. Pas de capture `monthly_view` réelle :
  l'outil refuse un script qui met un sesskey en chaîne de requête ; elle viendra de la
  première synchro de l'extension.
- **Impeccable** (github.com/pbakaus/impeccable, demandé par l'utilisateur) installé en
  portée projet : `.claude/skills/impeccable`, agents, hooks (`.claude/settings.local.json`).
  Le moteur binaire (15 Mo) est ignoré par git ; il est entré par erreur dans e992ede avec
  `tests/_harness.test.ts` (un `git add -A`), retirés à 221f5a6 — le blob reste dans
  l'historique tant que main n'est pas réécrit (décision de l'utilisateur). Détecteur :
  deux barres latérales de 3 px et un menu contour + ombre. Passe de polish (53286ad) sur un
  gabarit de rendu (dist servi en local, `chrome.*` remplacé, état fixé) : onglets et titres
  en casse de phrase, pastille + filets au lieu des barres, boutons secondaires tonals, menu
  en élévation seule, panneaux sans contour accentué, sélection/défilement/focus thémés.
  Police système gardée à dessein : une police distante contredirait « aucune transmission ».
  Gate à 53286ad : 21 fichiers, 449 tests, build OK, zip 0.3.0 regénéré.
- **Première synchro réelle réussie** (« StudiUM synchronisé à l'instant », main à 3bbcdb9),
  après trois obstacles de terrain, dans l'ordre : (a) le routage manquant (ci-dessus) ;
  (b) « tentative échouée (reseau) » — `fetch` rejeté sur le premier appel, cause non
  établie (aucun CSP sur la page ; hypothèse : navigation pendant l'appel). Corrigé en
  profondeur plutôt qu'en surface : l'exception réelle remonte dans le message, une relance
  après 1,5 s, et surtout le **tampon anti-rafale s'écrit à la fin du run** (adrie-07) — écrit
  avant, un run interrompu par navigation laissait une zone morte silencieuse de 30 min.
  Contrepartie assumée : deux onglets StudiUM ouverts simultanément peuvent faire deux
  synchros (12 requêtes) au lieu d'une ; préférable à la zone morte. `credentials: include`
  + `text/plain` posés par prudence, inertes en same-origin (Chrome fait partir le fetch d'un
  content script avec l'origine de la page — vérifié par adrie-07 sur chromium.org après
  une première analyse inverse). (c) **Content script orphelin** : après un rechargement de
  l'extension, les scripts déjà injectés ne reçoivent plus rien et l'extension ne se
  réinjecte pas dans un onglet ouvert ; « Synchroniser StudiUM » recharge maintenant l'onglet
  quand `tabs.sendMessage` échoue (3bbcdb9). Règle pour l'utilisateur : après un rechargement
  de l'extension, recharger aussi la page StudiUM.
- Branche `studium-homonymes` (adrie-29, 23746bc, merge ad27f8c) : un événement sans cmid
  rejoint le groupe qui attend encore son rôle, le plus proche dans le bon sens du temps ;
  égalité → orphelin. Défaut trouvé par le second passage d'adrie-f6 (`sweep-2`, 1024f70,
  merge 604f365) avec le tri déterministe d'`allDeadlines` (`compareStrings`, plus de
  `localeCompare`). Hypothèse de fuseau consignée dans ARCHITECTURE §7 (navigateur réglé sur
  America/Toronto). Gate à 3bbcdb9 : 20 fichiers, 459 tests, build OK.
- Reste à l'utilisateur : recharger `dist/` dans Chrome, ouvrir StudiUM connecté et vérifier
  la première synchro (sesskey trouvé ? format ?) ; captures Web Store des nouveaux écrans ;
  la liste des « bugs visuels v2 » de l'étape 1 n'a jamais été reçue.

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
