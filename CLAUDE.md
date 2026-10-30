# ClientSide Horaire — instructions de session

Extension Chrome (Manifest V3, TypeScript) qui lit l'horaire et les examens du Centre
étudiant de l'UdeM (Synchro, PeopleSoft) sur la session déjà ouverte de l'étudiant, et
produit un fichier ICS + une détection de conflits + un compte à rebours d'examens.
Depuis la phase 12 (2026-09-10), elle lit aussi les échéances (quiz, devoirs) du calendrier
StudiUM par l'API AJAX interne de Moodle, sur la session ouverte de l'étudiant.
**Tout reste dans le navigateur : aucun serveur, aucune clé, aucune transmission de données de
l'étudiant.** Depuis la phase 15, l'onglet « Prochaine session » TÉLÉCHARGE le catalogue public
de Plan ton bacc (GET de JSON sur udem-plan-ton-bacc.vercel.app, sans permission d'hôte) et
embarque son moteur (`vendor/clientside-labs-moteur-*.tgz`, voir WORKLOG).

## À lire en premier

1. `docs/ARCHITECTURE.md` — source de vérité : contrat JSON, structure, phases, ce qui a
   été observé sur Synchro (URL, iframes, format des heures).
2. `WORKLOG.md` — ce qui a été fait, et où en est le projet.

Ne pas redécider ce qui est tranché dans `ARCHITECTURE.md`. Si une décision change,
modifier le document **et** consigner le changement dans le WORKLOG.

## Règles

- **Une session = une phase.** Ne pas anticiper la phase suivante.
- **Tests verts avant tout commit** : `npm test` puis `npm run build`
  (= `tsc --noEmit` + build Vite). Citer le SHA dans tout rapport.
- **Aucun projet externe comme référence.** Ce qui est vrai de Synchro se vérifie sur
  Synchro (fixtures dans `tests/fixtures/`) ; le calendrier universitaire se vérifie sur
  le site officiel de l'UdeM, source citée en commentaire.
- **`src/core/` est pur et déterministe** : pas d'API navigateur, pas de `Date.now()`
  caché — l'instant courant est toujours un paramètre.
- **Parser sur le texte**, jamais sur les ids ou classes PeopleSoft (sauf pour localiser
  un tableau).
- **Fixtures anonymisées** avant commit (`node scripts/scrub-fixture.mjs`).
- Permissions minimales : `storage`, `alarms`, hosts Synchro et StudiUM uniquement (le
  catalogue de Plan ton bacc se lit par CORS ordinaire, sans permission d'hôte)
  (StudiUM depuis la phase 12 : calendrier et liste des cours ; les notes seulement avec
  l'option « Notes », désactivée par défaut — phase 13, ARCHITECTURE §8).
- Aucune dépendance ajoutée sans une ligne de justification dans le WORKLOG.
- Code et identifiants en anglais ; commentaires et interface en français.

## Commandes

```
npm ci                 # installer (Node 24)
npm test               # tests unitaires (happy-dom) ; jamais `npx` : il télécharge un paquet absent
npm run build          # tsc --noEmit + vite build → dist/
```

Charger `dist/` dans Chrome : `chrome://extensions` → mode développeur → « Charger
l'extension non empaquetée ».

## Travail en parallèle

Plusieurs sessions Claude peuvent travailler en worktrees (`synchro-calendrier-<sujet>`,
branche `<sujet>`). Une seule session (l'intégratrice) merge sur `main`. Chaque fichier a
un propriétaire (tableau dans `docs/ARCHITECTURE.md` §4) ; pour modifier le fichier d'un
autre, envoyer le patch, pas l'éditer. Seule l'intégratrice écrit dans `WORKLOG.md`,
`CLAUDE.md` et `docs/`.

## À la fin de chaque tâche

1. Ajouter une entrée datée en haut de `WORKLOG.md` (intégratrice).
2. Commiter : `phase<N>: <verbe> <objet>`.
