# Synchro Calendrier UdeM — instructions de session

Extension Chrome (Manifest V3, TypeScript) qui lit l'horaire et les examens du Centre
étudiant de l'UdeM (Synchro, PeopleSoft) sur la session déjà ouverte de l'étudiant, et
produit un fichier ICS + une détection de conflits + un compte à rebours d'examens.
**Tout reste dans le navigateur : aucun serveur, aucune clé, aucune transmission.**

## À lire en premier

1. `docs/ARCHITECTURE.md` — source de vérité : contrat JSON, structure, phases, ce qui a
   été observé sur Synchro (URL, iframes, format des heures).
2. `WORKLOG.md` — ce qui a été fait, et où en est le projet.

Ne pas redécider ce qui est tranché dans `ARCHITECTURE.md`. Si une décision change,
modifier le document **et** consigner le changement dans le WORKLOG.

## Règles

- **Une session = une phase.** Ne pas anticiper la phase suivante.
- **Tests verts avant tout commit** : `npx vitest run` puis `npm run build`
  (= `tsc --noEmit` + build Vite). Citer le SHA dans tout rapport.
- **Aucun projet externe comme référence.** Ce qui est vrai de Synchro se vérifie sur
  Synchro (fixtures dans `tests/fixtures/`) ; le calendrier universitaire se vérifie sur
  le site officiel de l'UdeM, source citée en commentaire.
- **`src/core/` est pur et déterministe** : pas d'API navigateur, pas de `Date.now()`
  caché — l'instant courant est toujours un paramètre.
- **Parser sur le texte**, jamais sur les ids ou classes PeopleSoft (sauf pour localiser
  un tableau).
- **Fixtures anonymisées** avant commit (`node scripts/scrub-fixture.mjs`).
- Permissions minimales : `storage`, `alarms`, host Synchro uniquement.
- Aucune dépendance ajoutée sans une ligne de justification dans le WORKLOG.
- Code et identifiants en anglais ; commentaires et interface en français.

## Commandes

```
npm ci                 # installer (Node 24)
npx vitest run         # tests unitaires (happy-dom)
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
