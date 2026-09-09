# Synchro Calendrier UdeM

Extension Chrome qui transforme l'horaire du Centre étudiant de l'Université de Montréal
(Synchro) en un vrai calendrier : un fichier `.ics` à importer dans Google Agenda, Outlook
ou Apple Calendrier, la liste de vos conflits d'horaire, et un compte à rebours des
examens directement sur l'icône de la barre d'outils.

**Tout se passe dans votre navigateur.** Aucun serveur, aucun compte, aucune clé d'API :
l'extension lit la page Synchro que vous avez vous-même ouverte, garde le résultat dans le
stockage local de Chrome, et n'envoie rien nulle part. Voir
[docs/PRIVACY.md](docs/PRIVACY.md).

![Capture d'écran du popup de l'extension](docs/screenshots/popup.png)

> _Capture à venir — voir la liste des captures à produire dans_
> [`docs/STORE.md`](docs/STORE.md).

## Ce qu'elle fait

- **Export `.ics`** — les séances hebdomadaires deviennent des événements récurrents, avec
  local et volet (théorie, travaux pratiques, laboratoire). La semaine de relâche et les
  jours fériés sont retirés automatiquement.
- **Examens** — les examens intra et finaux repérés dans votre horaire sont exportés comme
  événements datés, et listés à part dans le popup.
- **Conflits** — deux séances qui se chevauchent, un cours pendant un examen, deux examens
  la même journée : la liste apparaît en haut du popup.
- **Compte à rebours** — l'icône affiche le nombre de jours avant votre prochain examen.
- **Repli « coller mon horaire »** — si l'extraction automatique échoue, vous pouvez
  copier-coller le texte de la page ; le résultat est le même.

## Installation

L'extension n'est pas encore publiée sur le Chrome Web Store. Pour l'installer à partir
des sources :

```bash
git clone https://github.com/AMoncade/synchro-calendrier.git
cd synchro-calendrier
npm ci
npm run build
```

Puis dans Chrome :

1. Ouvrez `chrome://extensions`.
2. Activez le **mode développeur** (interrupteur en haut à droite).
3. Cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier `dist/`
   créé par `npm run build`.

L'icône du calendrier apparaît dans la barre d'outils. Épinglez-la pour voir le compte à
rebours des examens.

## Utilisation

1. Connectez-vous au **Centre étudiant** sur Synchro.
2. Ouvrez **Horaire hebdomadaire** (choisissez le trimestre si on vous le demande).
3. Basculez sur la vue **Liste**. L'extension capture l'horaire au passage.

Cliquez ensuite sur l'icône de l'extension : vos cours, vos examens et vos conflits sont
là. Le bouton **Exporter .ics** télécharge un fichier `horaire-udem-A26.ics`.

La page Centre étudiant seule donne un horaire partiel, sans dates de début et de fin ni
examens. C'est la vue **Liste** qui contient tout : passez toujours par elle.

### Importer le fichier `.ics`

- **Google Agenda** — [Paramètres → Importer et exporter](https://calendar.google.com/calendar/r/settings/export),
  sélectionnez le fichier, choisissez l'agenda de destination, puis **Importer**. Créez au
  besoin un agenda dédié « UdeM » d'abord : vous pourrez le masquer ou le supprimer d'un
  coup.
- **Outlook** (web) — **Calendrier → Ajouter un calendrier → Charger à partir d'un
  fichier**. Dans Outlook pour Windows : **Fichier → Ouvrir et exporter → Importer/Exporter
  → Importer un fichier iCalendar (.ics)**, puis **Importer**.
- **Apple Calendrier** (macOS, iOS) — double-cliquez le fichier, ou **Fichier → Importer**,
  et choisissez le calendrier de destination.

Les événements portent le fuseau `America/Toronto`. Un réimport après une modification
d'horaire crée des doublons : videz d'abord le calendrier de destination, d'où l'intérêt
d'un agenda dédié.

## Limites connues

- **Le calendrier universitaire est codé en dur, trimestre par trimestre.** Les trimestres
  couverts sont Automne 2026, Hiver 2027 et Été 2027. Au-delà, les dates de relâche et de
  congés doivent être ajoutées dans `src/core/calendar-udem.ts`, chaque date étant vérifiée
  sur le site du Bureau du registraire.
- **Les dates de début et de fin de cours viennent du calendrier de la FAS** (Faculté des
  arts et des sciences) pour l'automne 2026 et l'hiver 2027. Le registraire ne publie ni le
  dernier jour de cours ni la période d'examens : une autre faculté peut différer de
  quelques jours. Vérifiez les bornes de trimestre si vous n'êtes pas à la FAS.
- **Heures arrondies.** Synchro affiche les fins de séance en `:29` (par exemple
  `08:30 - 10:29`) ; l'extension les arrondit à `:30` pour éviter des blocs de calendrier
  décalés d'une minute.
- **Séances sans jour fixe.** Une séance « À communiquer » n'a pas de créneau : elle est
  gardée comme note sur le cours, jamais placée dans le `.ics`.
- **Export ponctuel, pas une synchronisation.** Le fichier est une photo de votre horaire
  au moment de l'export. Un changement de section ou d'examen demande un nouvel export.
- **Interface française de Synchro seulement**, et pages du premier cycle telles
  qu'observées à l'automne 2026. Un changement de gabarit PeopleSoft peut casser
  l'extraction ; le mode « coller mon horaire » sert alors de repli.

## Développement

```bash
npm ci                      # installer les dépendances (Node 24)
npx vitest run              # tests unitaires
npm run build               # tsc --noEmit + build Vite → dist/
npm run icons               # régénérer les PNG depuis assets/icon.svg
```

`src/core/` est pur et déterministe : aucune API navigateur, aucun `Date.now()` caché.
L'instant courant est toujours passé en paramètre, ce qui rend les tests reproductibles.
La structure du projet, le contrat de données et ce qui a été observé sur Synchro sont
documentés dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Les bogues se signalent sur la
[page des issues](https://github.com/AMoncade/synchro-calendrier/issues), ou depuis le lien
« Signaler un bug » du popup, qui pré-remplit la version et le trimestre sans joindre
aucune donnée d'horaire.

## Licence

MIT.

Projet indépendant, sans lien avec l'Université de Montréal. « Synchro », « Centre
étudiant » et le nom de l'Université de Montréal appartiennent à leurs titulaires.
