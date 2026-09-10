# Revue pré-soumission — Synchro Calendrier UdeM 0.3.0

**Date :** 2026-09-10 · **Portée :** repérage complet avant dépôt au Chrome Web Store.
Lecture seule, aucun fichier du projet modifié.

> **Note de méthode.** Le shell sur ta machine n'a pas pu monter le dossier cette fois
> (`no Plan9 drive shares mounted`), donc **je n'ai pas relancé `npm test` ni `npm run build`**.
> Tout le reste vient de la lecture directe des fichiers. Relance les deux avant de zipper.

---

## 1. Ce qui a changé depuis ma revue du 9 septembre

Tu as construit l'intégration StudiUM entre-temps. Ça change complètement le dossier de
soumission — ce n'est plus la même extension du point de vue d'un examinateur.

| | 9 sept (0.2.0) | 10 sept (0.3.0) |
|---|---|---|
| Hôtes | Synchro | Synchro **+ studium.umontreal.ca** |
| Requêtes réseau | **aucune** | **2 `fetch`** vers StudiUM |
| Données lues | horaire, examens | + échéances, sites de cours, **notes et moyennes de groupe** |
| `popup.ts` | 26 ko | 47 ko |
| Modules ajoutés | — | `content/studium.ts`, `core/studium.ts`, `core/deadlines.ts`, `core/grades.ts` |

**Les défauts UI de mon rapport du 9 sont corrigés** : `.week-item` passe à 78 px,
`.preview-row` à 72 px, avec `white-space: nowrap` sur les deux. Plus de retour à la ligne
dans les colonnes d'heure.

---

## 2. Bloquants — à régler avant de soumettre

### B1. Aucune justification pour l'autorisation d'hôte StudiUM

`docs/STORE.md` justifie `storage`, `alarms` et `https://*.synchro.umontreal.ca/*`. Il n'y a
**rien** pour `https://studium.umontreal.ca/*`, qui est pourtant la permission la plus large
et la plus sensible du lot. Le champ est obligatoire, un par autorisation.

### B2. Une justification est devenue fausse

La justification Synchro se termine par :

> « Aucun autre domaine n'est demandé et **aucune requête réseau n'est émise**. »

C'était vrai en 0.2.0. Ça ne l'est plus : `src/content/studium.ts` émet deux `fetch`
(lignes 471 et 483), vers `/lib/ajax/service.php` et `/grade/report/user/index.php`.

Une déclaration inexacte dans un champ de justification n'est pas une coquille — c'est un
motif de rejet, et de retrait après publication. **À corriger en priorité absolue.**

### B3. La phrase d'objectif unique ne décrit plus l'extension

Elle dit aujourd'hui :

> « Lire l'horaire de cours et d'examens affiché dans le Centre étudiant […] pour le
> convertir en fichier calendrier .ics et en signaler les conflits. »

Elle ne mentionne ni les échéances StudiUM, ni les notes. Un examinateur qui compare cette
phrase au comportement observé voit trois fonctions là où la fiche en annonce une.

**C'est le principal risque de rejet de tout le dossier** — voir §3.

### B4. La déclaration d'usage des données est incomplète

Le tableau reste défendable : « Contenu de sites web = Oui » couvre techniquement tout, et
le raisonnement cité (obligation de déclarer même le traitement purement local) est juste.

Mais la **note à joindre** ne parle que de l'horaire Synchro. Elle doit maintenant nommer :

- les échéances StudiUM (quiz, devoirs) et la liste des sites de cours ;
- **les notes, valeurs possibles, pourcentages et moyennes de groupe**, en précisant que
  c'est une option désactivée par défaut.

Omettre les notes dans une déclaration de données, c'est exactement le genre d'écart qui se
paie cher s'il est découvert après publication.

### B5. Les captures d'écran montrent la version d'avant

Les cinq PNG de `docs/store/` datent du 9 septembre en soirée ; le code StudiUM a été écrit
le 10 en après-midi. **Aucune ne montre les échéances ni les notes** — alors que la
description détaillée de `STORE.md` les met en avant sur deux puces.

Le format, lui, est bon : `1280 × 800`, PNG, 505–555 ko chacune. Conforme. Il faut juste les
refaire.

---

## 3. Le vrai risque : l'objectif unique

La règle de Google est qu'une extension doit avoir « un objectif unique, étroit et facile à
comprendre ». La tienne fait maintenant trois choses visibles : exporter un horaire en ICS,
afficher des échéances StudiUM, et afficher des notes.

**Ça reste défendable**, mais seulement si tu le formules comme un seul but plutôt que comme
un catalogue. Quelque chose comme : *rassembler en un seul endroit l'échéancier universitaire
d'un étudiant de l'UdeM — séances, examens, remises — à partir des pages qu'il a lui-même
ouvertes, et l'exporter en calendrier.* L'export ICS, les échéances et les notes deviennent
alors trois faces du même objet, pas trois produits.

Le maillon faible de cet argument, c'est **les notes** : un carnet de notes n'est pas un
échéancier. Si un examinateur tique quelque part, ce sera là.

Deux options honnêtes :

| Option | Pour | Contre |
|---|---|---|
| **Soumettre avec les notes** | fonctionnalité déjà écrite et testée | rallonge la revue, risque de retour |
| **Soumettre 0.3 sans les notes**, les livrer en 0.4 | objectif unique limpide, première revue rapide | il faut retirer proprement l'option |

Une première soumission qui passe du premier coup vaut cher : les suivantes sont revues plus
vite. À toi de voir, mais je pencherais pour la seconde.

---

## 4. Le nom de l'extension — angle mort

**« Synchro Calendrier UdeM »** met une marque d'université dans le nom, et « Synchro » est
le nom du système de l'UdeM. La politique du store interdit d'utiliser la marque d'un tiers
d'une manière qui suggère une affiliation ou un endossement.

Ta description dit bien « sans lien avec l'Université de Montréal », ce qui aide beaucoup.
Mais c'est le **nom** qui est lu en premier, et il n'a pas de mention.

Ce n'est pas un rejet automatique — beaucoup d'extensions non officielles nomment leur cible.
Mais c'est un risque réel, et c'est aussi le genre de chose qui attire une plainte de
l'université plus tard. Deux atténuations peu coûteuses :

- ajouter « non officiel » dans le résumé de 132 caractères, pas seulement dans le corps ;
- publier sous **ClientSide Labs** comme éditeur, ce qui éloigne visuellement la marque UdeM
  de l'identité de l'auteur.

---

## 5. Ce qui est propre — et c'est beaucoup

| Point | État |
|---|---|
| Manifest V3 | ✅ |
| **Aucun code distant** | ✅ zéro `eval`, `new Function`, `innerHTML`, `insertAdjacentHTML`, `document.write` — grep vide sur tout `src/` |
| Réseau | ✅ exactement 2 `fetch`, tous deux vers `studium.umontreal.ca`, aucun tiers, aucune télémétrie |
| Option Notes réellement optionnelle | ✅ vérifié dans le code : tout est verrouillé derrière `GRADES_OPT_IN_KEY`, la politique dit vrai |
| Nom | ✅ 23 / 75 caractères |
| Description manifest | ✅ 124 / 132 caractères |
| Résumé de la fiche | ✅ 123 / 132 |
| Icônes | ✅ 16, 32, 48, 128 |
| Captures | ✅ format 1280 × 800 conforme (contenu périmé, voir B5) |
| Dépôt | ✅ public, MIT, `PRIVACY.md` accessible (HTTP 200) |
| Paquet | ✅ script déterministe, `dist/` seul, manifest à la racine, aucun sourcemap |
| Permissions minimales | ✅ pas de `tabs`, ni `scripting`, ni `downloads` — et `STORE.md` explique déjà pourquoi |

L'absence totale de code distant et la minimalité des permissions sont les deux choses que
les examinateurs regardent en premier. Sur ces deux points, le dossier est solide.

---

## 6. Détails à corriger tant qu'on y est

- **Description du manifest périmée.** Elle ne parle que de Synchro alors que l'extension
  lit StudiUM. C'est ce texte qui s'affiche dans `chrome://extensions`, pas celui de la fiche.
  Il reste 8 caractères de marge sur 132 — donc il faut réécrire, pas rallonger.
- **URL de politique de confidentialité.** Le lien brut GitHub répond 200, mais c'est du
  markdown non rendu. `has_pages: false` sur le dépôt : soit tu actives GitHub Pages, soit tu
  pointes vers la page rendue (`/blob/main/docs/PRIVACY.md`), plus lisible pour un examinateur.
- **Pas de `default_locale`.** L'extension est monolingue française et l'assume ; pense juste
  à déclarer « français (Canada) » comme langue de la fiche.
- **La synchro des notes interroge le rapport de chaque site de cours** — donc plusieurs
  requêtes par synchronisation. À dire dans la justification StudiUM plutôt que de laisser
  l'examinateur le découvrir.
- **`npm test` et `npm run build` non rejoués** cette session. À faire avant `npm run package`.

---

## 7. Ordre de marche suggéré

1. Corriger **B2** (la phrase fausse) — non négociable.
2. Décider : avec ou sans les notes pour la première soumission (§3).
3. Réécrire l'objectif unique (**B3**) et la description du manifest selon cette décision.
4. Ajouter la justification StudiUM (**B1**) et compléter la note de données (**B4**).
5. Refaire les cinq captures sur la version réelle (**B5**), plus une sixième montrant les
   échéances si tu les gardes.
6. Ajouter « non officiel » au résumé (§4).
7. `npm test`, `npm run build`, `npm run package`, puis dépôt.

Les points 1 à 4 sont de l'écriture, pas du code. Le point 5 est une demi-heure.
