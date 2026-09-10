# Installer et utiliser ClientSide Horaire

Ce guide s'adresse à l'étudiant qui veut exporter son horaire du Centre étudiant vers
Google Agenda, Outlook ou Calendrier (Apple). L'extension n'est pas encore publiée sur le
Chrome Web Store : elle s'installe en mode développeur, ce qui est normal et sans danger.

Rien ne sort de votre ordinateur. L'extension ne parle à aucun serveur, ne demande aucun
mot de passe et lit uniquement les pages Synchro que vous ouvrez vous-même.

---

## 1. Obtenir le dossier `dist/`

### Si vous avez reçu un fichier `synchro-calendrier-0.1.0.zip`

Décompressez-le où vous voulez, par exemple dans `Documents`. Vous obtenez un dossier
contenant `manifest.json` : c'est lui que vous chargerez à l'étape 2. Ne chargez pas le
`.zip` lui-même.

### Si vous partez du code source

Il faut [Node.js 24](https://nodejs.org) ou plus récent. Dans un terminal, à la racine du
projet :

```
npm ci
npm run build
```

Le dossier `dist/` apparaît à la racine. C'est lui que vous chargerez.

> Après chaque `git pull`, relancez `npm run build`, puis le bouton ⟳ de la carte de
> l'extension dans `chrome://extensions`.

---

## 2. Charger l'extension dans Chrome

1. Ouvrez `chrome://extensions` (tapez-le dans la barre d'adresse ; un lien ne fonctionne
   pas depuis une page web).
2. En haut à droite, activez **Mode développeur**.
3. Trois boutons apparaissent en haut à gauche. Cliquez **Charger l'extension non
   empaquetée**.
4. Sélectionnez le dossier `dist/` (ou le dossier décompressé) — celui qui **contient**
   `manifest.json`, pas le fichier lui-même. Cliquez **Sélectionner un dossier**.
5. La carte « ClientSide Horaire » apparaît. Vérifiez qu'elle est **activée** et
   qu'aucune erreur rouge n'est affichée.

Edge, Brave, Opera et Vivaldi acceptent la même procédure (`edge://extensions`,
`brave://extensions`, …). Pour Firefox, voir `FIREFOX.md` : le portage n'est pas encore
fait.

### Épingler l'icône

Par défaut Chrome cache les extensions derrière la pièce de casse-tête 🧩 de la barre
d'outils. Cliquez dessus, trouvez **ClientSide Horaire**, puis cliquez sur l'épingle à
droite de son nom. L'icône reste maintenant visible ; c'est elle qui affichera le compte à
rebours avant votre prochain examen.

---

## 3. Capturer votre horaire

L'extension ne va jamais chercher vos données toute seule. Elle lit la page pendant que
vous la regardez. Il faut donc l'ouvrir une fois par trimestre.

1. Cliquez sur l'icône de l'extension, puis sur **Centre étudiant** (ou allez à
   <https://academique-dmz.synchro.umontreal.ca/>). Connectez-vous avec votre code
   d'accès UdeM et l'authentification à deux facteurs.
2. Dans le **Centre étudiant**, repérez la section horaire et cliquez sur **Horaire
   hebdomadaire**.
3. Si vous êtes inscrit à plusieurs trimestres, une page de **sélection du trimestre**
   apparaît. Choisissez le trimestre voulu et **Continuer**.
4. En haut de la page « Votre horaire cours », choisissez le bouton radio **Liste**
   (et non « Calendrier hebdomadaire »).
5. Attendez que la liste de vos cours s'affiche complètement. La capture est automatique :
   il n'y a aucun bouton à cliquer sur la page.

**Pourquoi la vue Liste ?** Elle est la seule à contenir les dates de début et de fin de
chaque séance et les examens intra et final. Le résumé du Centre étudiant donne les
heures, mais ni les dates ni les examens — l'extension l'accepte quand même, en affichant
un avertissement, et une capture en vue Liste la remplacera dès que vous en ferez une.

---

## 4. Exporter et importer dans votre agenda

Cliquez sur l'icône de l'extension. Le popup affiche le trimestre, le prochain examen, les
conflits d'horaire détectés, vos cours et vos examens.

- **Exporter .ics** enregistre `horaire-udem-A26.ics` dans vos téléchargements.
- **Copier** met le même contenu dans le presse-papiers, pratique pour le coller dans un
  service qui accepte du texte.

Le fichier contient une série récurrente par séance, les congés et la semaine de relâche
déjà retirés, et un événement par examen. Le fuseau `America/Toronto` y est inscrit
explicitement : vos cours ne se décaleront pas au changement d'heure de novembre.

**Google Agenda** — sur ordinateur seulement : ⚙ Paramètres → *Importer et exporter* →
*Importer* → choisissez le fichier, choisissez l'agenda de destination, *Importer*. Créez
d'abord un agenda séparé (« UdeM A26 ») si vous voulez pouvoir tout supprimer d'un coup.

**Outlook** — *Fichier* → *Ouvrir et exporter* → *Importer/Exporter* → *Importer un
fichier iCalendar (.ics)* → *Ouvrir comme nouveau calendrier*. Sur Outlook web : *Ajouter
un calendrier* → *Charger à partir d'un fichier*.

**Calendrier (macOS, iOS)** — double-cliquez le fichier, ou *Fichier* → *Importer*.
Choisissez « Nouveau calendrier » à la question posée.

### Ré-importer après un changement d'horaire

Refaites la capture puis l'export, et ré-importez le nouveau fichier dans **le même**
agenda. Chaque événement porte un identifiant stable : votre agenda met à jour les
séances existantes au lieu de les dupliquer. Un cours abandonné, lui, ne disparaît pas
tout seul — supprimez sa série à la main.

---

## 5. Dépannage

### Le popup dit « Aucun horaire capturé pour l'instant »

L'extension n'a encore rien vu. Dans l'ordre :

- Avez-vous ouvert la page **« Votre horaire cours » en vue Liste** ? Le popup seul ne
  capture rien ; il faut avoir visité la page au moins une fois depuis l'installation.
- L'extension a-t-elle été chargée **avant** l'ouverture de la page ? Si vous venez de
  l'installer ou de la recharger, actualisez l'onglet Synchro (F5) : le script de lecture
  ne s'injecte que dans les pages ouvertes après son chargement.
- Êtes-vous bien sur `synchro.umontreal.ca` ? L'extension ne lit aucun autre site.
- La liste s'est-elle affichée en entier ? Sur une connexion lente, PeopleSoft dessine le
  tableau après coup. Attendez quelques secondes, la capture se refait à chaque
  modification de la page.

**Solution de repli qui marche toujours** : sur la page « Votre horaire cours » en vue
Liste, faites Ctrl+A puis Ctrl+C. Ouvrez le popup, dépliez **Ou collez votre horaire**,
collez dans la zone de texte et cliquez **Importer le texte**. C'est le même analyseur ; le
résultat est identique.

### Le badge de l'icône est vide

Le badge affiche le nombre de jours avant votre prochain examen. Il reste vide quand :

- aucun examen n'a été capturé — c'est le cas si votre seule capture vient du résumé du
  Centre étudiant, qui ne contient pas les examens. Refaites-la en vue **Liste** ;
- tous vos examens sont passés ;
- votre horaire ne comporte pas d'examen intra ni final (volets `EXI` / `EXF` absents).

Le badge se recalcule au démarrage de Chrome, à chaque capture, puis une fois par heure.
Si vous venez de capturer et qu'il n'a pas bougé, fermez et rouvrez le popup.

### « Trimestre A27 inconnu du calendrier universitaire »

L'extension connaît les dates de congé de l'automne 2026 et de l'hiver 2027, tirées du
calendrier facultaire officiel. Pour un trimestre plus récent, elle exporte quand même
votre horaire, mais **sans retirer les jours fériés ni la semaine de relâche** : vous
verrez des cours des jours où il n'y en a pas.

Deux options : supprimer ces séances à la main dans votre agenda après l'import, ou
ajouter le trimestre dans `src/core/calendar-udem.ts` (les dates viennent du calendrier
des études de votre faculté) et refaire un `npm run build`.

### « Horaire capturé depuis le Centre étudiant (sans dates ni examens) »

Vous avez visité le Centre étudiant mais pas la vue Liste. L'extension a gardé ce qu'elle
pouvait — les cours et leurs heures — mais l'export sera pauvre : pas de dates de début ni
de fin, pas d'examens. Suivez l'étape 3 jusqu'au bout ; la nouvelle capture remplacera
l'ancienne automatiquement.

### Une séance affiche « local à confirmer » ou « ℹ À communiquer »

C'est ce que Synchro annonce à ce moment-là. L'extension recopie l'information sans
l'inventer. Refaites une capture plus tard dans le trimestre.

### Les heures se terminent à la demie, pas à `:29`

C'est voulu. Synchro écrit `08:30 - 10:29` ; l'extension arrondit la fin à `10:30` pour
que les blocs soient propres dans l'agenda.

### Effacer toutes les données

En bas du popup, **Effacer** supprime tout ce qui est stocké localement. Cela ne touche ni
Synchro ni les événements déjà importés dans votre agenda. Désinstaller l'extension
supprime aussi tout son stockage.

### Signaler un problème

Le lien **Signaler un bug** en bas du popup ouvre un formulaire pré-rempli avec la version
et le trimestre. **Aucune donnée d'horaire n'y est jointe automatiquement.** Si vous
ajoutez une capture d'écran, masquez votre matricule.
