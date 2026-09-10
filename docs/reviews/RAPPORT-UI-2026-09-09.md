# Rapport UI — popup v2 (build `dist/`, d53eccd)

**Pour :** Claude Code · **Rédigé le :** 2026-09-09 · **Auteur :** Claude (Cowork)

## Méthode (à lire avant de me croire)

Je n'ai **pas** pu ouvrir le popup dans le Chrome d'Adrien : l'automatisation du
navigateur refuse les URL `chrome://` et `chrome-extension://`, et l'accès
computer-use à Chrome est limité à la lecture d'écran. J'ai donc rendu le popup
**hors extension** :

- `dist/` servi tel quel en HTTP local, `src/popup/index.html` chargé dans Chromium
  headless, viewport **380 × 600** (les dimensions de `body`), `deviceScaleFactor: 2`,
  fuseau `America/Toronto`, thèmes clair **et** sombre ;
- `chrome.storage` / `chrome.runtime` / `chrome.action` / `chrome.tabs` stubbés,
  `Date` figée pour obtenir des vues déterministes ;
- données : l'horaire A2026 réel d'Adrien (MAT1400, MAT1500, MAT1600, STT1700,
  TH + TP, locaux Roger-Gaudry / 3200 J.-Brillant / Claire-McNicoll) et 9 examens
  (4 intras, 4 finaux + un 2e intra STT1700).

Conséquence : **aucune erreur console, aucun `pageerror`** sur les 10 rendus. Ce qui
suit porte sur la mise en page et la formulation, pas sur l'intégration réelle avec
le service worker.

## Vérification des six changements annoncés

| Annoncé | Constaté |
|---|---|
| Plus aucun glyphe Unicode, icônes SVG inline | ✅ Toutes les icônes (téléchargement, copie, menu `···`, « même pavillon » `↳`, avertissement, horloge, chevrons) rendent proprement dans les deux thèmes. |
| Palette fixe de huit teintes, attribuée aux sigles triés | ✅ Vérifié par `getComputedStyle` : MAT1400 `rgb(47,125,225)`, MAT1500 `rgb(224,96,60)`, MAT1600 `rgb(43,163,107)`, STT1700 `rgb(200,68,155)` — **identiques dans les trois onglets**. Bien séparées. |
| « MAT1500 et MAT1600 sont maintenant bleu et rose » | ⚠️ Avec le jeu de cours réel d'Adrien, MAT1500 est **orange** et MAT1600 **vert** (l'index vient du rang dans les sigles triés, qui commencent à MAT1400). Le résultat est bon, la description ne correspond pas — ne la reprends pas telle quelle dans `docs/STORE.md`. |
| Demain : plus de MAINTENANT / ENSUITE, « dans 14 h » | ✅ Sur la vue « Demain » : aucun label d'état, titres au même poids, « dans 14 h 20 ». ⚠️ Mais `MAINTENANT` / `ENSUITE` restent bien présents sur la vue **aujourd'hui** (`popup.ts:221-222`) — c'est cohérent avec le code, pas avec la formulation « plus de MAINTENANT / ENSUITE ». |
| Aujourd'hui : « Le reste de la semaine » remplit le vide du bas | ⚠️ Fonctionne, mais voir **D1** et **D3** : il ne remplit un vide que sur les journées creuses, et déborde sur la semaine suivante. |
| Semaine : jour courant surligné, jours passés atténués, local à droite, ‹ ›, bouton « Aujourd'hui » | ✅ Tout est là et lisible. |
| Examens : titre redondant parti, « dans N j » sous 45 jours | ✅ STT1700 « dans 28 j », MAT1500 « dans 37 j », le 2e intra du 11 nov (63 j) n'affiche rien. |

## Défauts trouvés, par ordre d'importance

### D1 — La colonne d'heure passe à la ligne, partout (mesuré)

`.week-item { grid-template-columns: 76px … }` mais `08:30–10:29` en 13 px
tabular-nums mesure **81,4 px** → *toutes* les lignes de l'onglet Semaine s'affichent
sur deux lignes (`.when` mesuré : 76 px de large, **35 px de haut**). C'est ce qui
fait gonfler la vue et paraître l'extension mal réglée.

Même problème dans l'aperçu : `.preview-row { grid-template-columns: 64px … }` et
`ven. 08:30` en 12 px mesure **64,3 px** — 0,3 px de trop, d'où le rendu
incohérent visible sur la capture 2 (« ven. » et l'heure sur deux lignes, « lun. 08:30 »
sur une seule).

**Correctif :** `.week-item` → `86px` ; `.preview-row` → `72px` ; ajouter
`white-space: nowrap` sur les deux `.when` pour que ça ne resurgisse pas avec une
autre police système.

### D2 — L'onglet Aujourd'hui déborde de ~170 px sur une journée normale

`main` mesure 454 px de haut utile. Contenu mesuré :

| Vue | `scrollHeight` / `clientHeight` |
|---|---|
| lundi 07:00 | 617 / 454 → **déborde de 163 px** |
| mardi 09:15 | 623 / 454 → **déborde de 169 px** |
| Semaine | 651 / 454 → **déborde de 197 px** |
| Demain (1 cours) | 454 / 454 → ok |

Sur la capture 1, « LE RESTE DE LA SEMAINE » est tranché en deux par la bordure du
pied de page, sans aucun indice qu'il y a de la suite. Le bloc ajouté pour remplir
le vide du bas est donc, les jours chargés, précisément ce qui tombe sous la ligne
de flottaison.

**Pistes :** n'afficher l'aperçu que si `today.items.length <= 2` (le vide n'existe
que là) ; ajouter un dégradé de masque en bas de `main` ; regrouper les trois
bandeaux (journée chargée / prochain examen / chevauchements) sur une seule ligne.

### D3 — « Le reste de la semaine » n'est pas la semaine

`popup.ts:193` prend une fenêtre glissante de 7 jours (`o.date > today.date && o.date <= addDays(today.date, 7)`).
Le mercredi soir, l'aperçu affiche donc **ven., ven., lun., lun.** sous un titre qui
annonce la semaine en cours. Soit couper au dimanche (`mondayOf(today.date) + 6`),
soit renommer le bloc **« Prochaines séances »**.

### D4 — « Aucun cours » un jour de congé

Onglet Semaine, lundi 7 septembre : « Aucun cours ». C'est la **fête du Travail**, et
`calendar-udem.ts` a déjà le libellé (`holidays[].label`). Afficher
« Congé — Fête du Travail » supprime le doute « est-ce que l'extension a raté quelque
chose ? », qui est exactement la question que l'utilisateur se pose. Idem pour la
relâche du 19 au 25 octobre. C'est, à mon avis, l'ajout au meilleur rapport
effort/valeur du lot.

### D5 — Deux bandeaux d'examens empilés, dont un à trois mois

L'onglet Examens affiche « 3 examens en 3 jours (14→16 oct.) » **et** « 4 examens en
7 jours (11→17 déc.) » en permanence, soit ~90 px de bandeaux orange avant le premier
examen. `renderExams` ne filtre que sur `daysUntil(c.end) >= 0`. Limiter au premier
cluster, ou à ceux à moins de ~30 jours (`renderToday` le fait déjà avec 14).

### D6 — Détails

- **« FINALS »** → **« FINAUX »** (`popup.ts:394`). Le pluriel de « final » (nom) est
  « finaux » ; « finals » sonne anglais sur une extension francophone.
- Les lignes de Semaine et d'Examens sont cliquables (dépliage) sans aucune
  affordance : ni chevron, ni changement d'état visible avant le survol. Un chevron
  discret à droite, pivotant quand la ligne est ouverte, réglerait ça.
- `.day.past { opacity: 0.55 }` atténue aussi la barre de couleur du cours : sur les
  jours passés le code couleur devient illisible. Atténuer le texte
  (`color: var(--muted)`) plutôt que le conteneur entier.
- « Travaux pratiques » passe sur deux lignes dans Semaine. `componentName` pourrait
  rendre « TP » / « TH » dans les listes denses et le nom complet dans le panneau de
  détail.
- Vérifié : le panneau de détail (titre du cours, séances hebdo, plage de dates,
  « Copier le local », « Carte du campus ») rend correctement, et « 31 août → 9 déc. »
  est juste.

## Verdict

Le fond est bon : palette cohérente sur les trois onglets, icônes propres, thème
sombre correct, aucune erreur console. Ce qui reste, c'est du réglage de gabarit —
et **D1 seul (deux valeurs de `grid-template-columns`) supprime la moitié de
l'impression de désordre**. Je ferais D1, D2, D4 avant les captures du Web Store ;
D3, D5, D6 peuvent suivre.

Captures dans `docs/captures/` (clair et sombre) :
`1-aujourdhui-en-cours`, `2-demain`, `3-semaine`, `4-examens`, `5-semaine-detail`.
