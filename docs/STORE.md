# Fiche Chrome Web Store — Synchro Calendrier UdeM

Textes prêts à coller dans la console développeur du Chrome Web Store. Les limites de
caractères imposées par le store sont indiquées entre parenthèses ; le compte réel est
donné après chaque champ concerné.

---

## Nom

```
Synchro Calendrier UdeM
```

_(limite 75 caractères — 23 utilisés)_

## Résumé (limite 132 caractères)

```
Exportez l'horaire du Centre étudiant UdeM en calendrier .ics, repérez les conflits et comptez les jours avant vos examens.
```

_(123 caractères)_

## Description détaillée

```
Synchro Calendrier transforme l'horaire du Centre étudiant de l'Université de Montréal en un vrai calendrier, en trois clics et sans quitter votre navigateur.

CE QU'ELLE FAIT

• Export .ics — vos séances hebdomadaires deviennent des événements récurrents, avec le local et le volet (théorie, travaux pratiques, laboratoire). Importez le fichier dans Google Agenda, Outlook ou Apple Calendrier.
• Semaine de relâche et jours fériés retirés — le calendrier universitaire de l'UdeM est intégré, trimestre par trimestre. Pas de cours fantôme un lundi férié.
• Examens — les examens intra et finaux de votre horaire sont exportés comme événements datés et listés à part.
• Conflits d'horaire — deux séances qui se chevauchent, un cours pendant un examen, deux examens la même journée : tout est signalé dans le popup.
• Compte à rebours — l'icône de la barre d'outils affiche le nombre de jours avant votre prochain examen.
• Repli manuel — si l'extraction automatique échoue, collez le texte de la page : le résultat est le même.

COMMENT L'UTILISER

1. Connectez-vous au Centre étudiant sur Synchro.
2. Ouvrez « Horaire hebdomadaire », puis basculez sur la vue « Liste ».
3. Cliquez sur l'icône de l'extension, puis sur « Exporter .ics ».

C'est la vue Liste qui contient tout : dates de début et de fin, locaux et examens. La page d'accueil du Centre étudiant seule ne donne qu'un résumé.

VIE PRIVÉE

Aucune donnée n'est transmise. L'extension lit la page Synchro que vous avez ouverte vous-même, garde le résultat dans le stockage local de Chrome, et ne communique avec aucun serveur. Pas de compte à créer, pas de clé, pas de statistiques d'usage. Vous effacez tout depuis le popup ou en désinstallant l'extension.

Elle ne lit ni votre mot de passe, ni vos notes, ni aucune page autre que votre horaire et vos examens.

LIMITES CONNUES

• Le calendrier universitaire est codé trimestre par trimestre : Automne 2026, Hiver 2027 et Été 2027 sont couverts.
• Les dates de début et de fin de cours proviennent du calendrier de la Faculté des arts et des sciences ; une autre faculté peut différer de quelques jours.
• L'export est une photo de votre horaire, pas une synchronisation continue : réexportez après un changement de section.
• Interface française de Synchro seulement.

Projet libre (licence MIT), sans lien avec l'Université de Montréal. Code source et signalement de bogues : https://github.com/AMoncade/synchro-calendrier
```

## Catégorie

**Outils de travail** (productivité), avec **Éducation** en second choix. La taxonomie
exacte du store évolue : à confirmer dans la console au moment de la soumission.

**Langue principale** : français (Canada).

## Objectif unique (« single purpose »)

Le store demande une phrase décrivant la fonction unique de l'extension :

```
Lire l'horaire de cours et d'examens affiché dans le Centre étudiant de l'Université de Montréal, sur la session de l'utilisateur, pour le convertir en fichier calendrier .ics et en signaler les conflits.
```

## Justification des autorisations

Un champ de justification est exigé pour chaque autorisation. Textes proposés :

### `storage`

```
Conserve l'horaire extrait (cours, examens, trimestre) dans le stockage local du navigateur, afin que le popup l'affiche sans redemander à l'utilisateur d'ouvrir Synchro à chaque consultation. Aucune donnée n'est synchronisée ni transmise : chrome.storage.local uniquement.
```

### `alarms`

```
Réveille le service worker une fois par heure pour recalculer le nombre de jours restants avant le prochain examen affiché sur l'icône. Sans cette autorisation, le compte à rebours resterait figé à la valeur calculée lors de la dernière visite, un service worker MV3 étant arrêté quand il est inactif.
```

### Autorisation d'hôte `https://*.synchro.umontreal.ca/*`

```
Seul domaine où l'horaire de l'étudiant est affiché. Le script de contenu s'y exécute pour lire le texte des pages « Centre étudiant » et « Votre horaire cours » déjà ouvertes par l'utilisateur, et en extraire les sigles, jours, heures, locaux et dates d'examen. Aucun autre domaine n'est demandé et aucune requête réseau n'est émise.
```

### Absence de `tabs`, `scripting` et `downloads`

À signaler si un examinateur pose la question : le popup ouvre un onglet avec
`chrome.tabs.create`, qui ne nécessite pas l'autorisation `tabs` (aucune lecture d'URL ni
de titre d'onglet). Le téléchargement du `.ics` passe par un lien `blob:` cliqué dans le
popup, sans l'API `downloads`.

## Déclaration d'usage des données

Onglet « Confidentialité » de la console développeur.

| Catégorie de données | Collectée ? |
| --- | --- |
| Informations permettant l'identification personnelle | Non |
| Informations sur la santé | Non |
| Informations financières et de paiement | Non |
| Informations d'authentification | Non |
| Communications personnelles | Non |
| Position | Non |
| Historique de navigation | Non |
| Activité de l'utilisateur | Non |
| Contenu de sites web | Non — voir la note ci-dessous |

**Note à joindre.** L'extension lit le contenu des pages d'horaire de Synchro, mais ne le
*collecte* pas au sens du store : rien n'est transmis à l'auteur ni à un tiers, tout reste
dans `chrome.storage.local` sur l'appareil de l'utilisateur. Le store définit la collecte
comme une transmission hors de l'appareil ; il faut donc répondre « non » et expliquer le
traitement local dans ce champ.

Les trois certifications demandées sont toutes vraies et doivent être cochées :

- les données ne sont pas vendues ni transmises à des tiers, hors cas d'usage approuvés ;
- elles ne servent à aucune fin étrangère à la fonction principale de l'extension ;
- elles ne servent ni à évaluer la solvabilité, ni à des fins de prêt.

**URL de la politique de confidentialité** : lien vers `docs/PRIVACY.md` sur le dépôt
public, à remplacer par une page hébergée si le dépôt devient privé.

## Captures d'écran à produire

Cinq captures, **1280 × 800 px**, PNG, sans matricule ni nom lisible (utiliser les données
anonymisées des fixtures ou un compte de démonstration). Ordre proposé, la première étant
l'image mise en avant :

1. **Le popup complet, horaire chargé.** Trimestre en en-tête, prochain examen, la liste
   des cours avec locaux et volets, les deux boutons d'action bien visibles. C'est la
   capture qui doit se comprendre sans légende.
2. **Un conflit détecté.** Le bloc « Conflits » en haut du popup, avec au moins deux
   entrées de genres différents : un chevauchement cours-cours et un cours pendant un
   examen. Montre la valeur ajoutée que le Centre étudiant n'offre pas.
3. **Le compte à rebours sur l'icône.** Gros plan sur la barre d'outils, badge affichant un
   nombre de jours, popup ouvert sur la section « Prochain examen ». Recadrer ou zoomer :
   un badge de 16 px est illisible sur une capture pleine largeur.
4. **Le résultat dans Google Agenda.** Vue semaine de l'agenda après import du `.ics` :
   séances récurrentes avec locaux, un examen, et un lundi férié sans cours. Prouve que
   l'export fonctionne réellement.
5. **Les trois étapes de capture.** La vue « Liste » de Synchro à gauche, l'écran d'accueil
   du popup avec ses trois étapes à droite. Sert de mode d'emploi pour qui hésite.

**Icône promotionnelle** : 128 × 128, générée par `node scripts/make-icons.mjs`. Les
bandeaux promotionnels (440 × 280 et 1400 × 560) restent facultatifs tant que l'extension
ne vise pas la page d'accueil du store.
