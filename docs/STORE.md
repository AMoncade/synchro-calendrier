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

• Aujourd'hui — le cours en cours, le suivant, le temps qu'il reste, le local et le pavillon. Le soir, la vue passe à demain ; le week-end, au prochain jour de cours.
• Semaine — vos séances jour par jour, congés et relâche nommés, navigation d'une semaine à l'autre, détails au clic (plages de dates, copier le local, carte du campus).
• Examens — intras et finaux séparés, jours restants, alerte quand plusieurs examens tombent en quelques jours, ajout d'un examen à Google Agenda en un clic.
• Export .ics — vos séances hebdomadaires deviennent des événements récurrents avec le local et le volet, vos examens des événements datés avec rappels 24 h et 1 h avant (rappel de 15 min avant chaque cours en option). Importez le fichier dans Google Agenda, Outlook ou Apple Calendrier.
• Semaine de relâche et jours fériés retirés — le calendrier universitaire de l'UdeM est intégré, trimestre par trimestre. Pas de cours fantôme un lundi férié.
• Conflits d'horaire — deux séances qui se chevauchent ou un cours pendant un examen : signalé.
• Badge — l'icône de la barre d'outils affiche le nombre de cours qu'il vous reste aujourd'hui.
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

• Le calendrier universitaire est codé trimestre par trimestre : Automne 2026 et Hiver 2027 sont couverts ; Été 2027 seulement en partie (fériés et bornes, sans dates de cours ni d'examens).
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
Réveille le service worker toutes les 15 minutes pour recalculer le nombre de cours restants dans la journée, affiché sur l'icône. Sans cette autorisation, le badge resterait figé à la valeur calculée lors de la dernière visite, un service worker MV3 étant arrêté quand il est inactif.
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
| Contenu de sites web | **Oui** — voir la note ci-dessous |

**Pourquoi « oui ».** La politique du store exige de déclarer toute donnée *traitée*, y
compris localement : « Extensions are required to disclose how they handle user data, even
when data is processed or stored locally on a user's device and is not transmitted to
external servers or third parties » (developer.chrome.com/docs/webstore/program-policies/
user-data-faq, consulté le 2026-09-09). L'extension lit et conserve le contenu des pages
d'horaire de Synchro (« website content »), donc la case se coche, et le champ de
justification explique le traitement local. Une case à « non » serait une déclaration
inexacte, motif de rejet ou de retrait.

**Note à joindre.** L'extension lit le contenu de la page « Votre horaire cours » (et du
résumé du Centre étudiant) de Synchro, ouverte par l'utilisateur lui-même : sigles, sections,
jours, heures, locaux, dates de séances et d'examens. Ce contenu est conservé uniquement dans
`chrome.storage.local`, sur l'appareil de l'utilisateur, pour l'affichage du popup et la
génération locale du fichier .ics. Rien n'est transmis à l'auteur ni à un tiers ; aucune
requête réseau n'est émise. L'utilisateur efface tout depuis le popup ou en désinstallant.

Les trois certifications demandées sont toutes vraies et doivent être cochées :

- les données ne sont pas vendues ni transmises à des tiers, hors cas d'usage approuvés ;
- elles ne servent à aucune fin étrangère à la fonction principale de l'extension ;
- elles ne servent ni à évaluer la solvabilité, ni à des fins de prêt.

**URL de la politique de confidentialité** : lien vers `docs/PRIVACY.md` sur le dépôt
public, à remplacer par une page hébergée si le dépôt devient privé.

## Captures d'écran

Captures **1280 × 800 px**, PNG, produites dans `docs/store/` par rendu du popup hors
extension sur l'horaire réel A2026 anonymisé (fixtures), sans matricule ni nom. Ordre de
téléversement, la première étant l'image mise en avant :

1. **Aujourd'hui** — cours en cours, suivant, temps restant, local et pavillon.
2. **Semaine** — liste par jour, congé nommé, locaux à droite.
3. **Examens** — intras et finaux, jours restants, alerte de grappe.
4. **Détail d'un cours** — plages de dates, copier le local, carte du campus.
5. **Demain** — bascule automatique en soirée.

À produire ensuite à la main si souhaité : le résultat dans Google Agenda après import du
`.ics` (vue semaine, un lundi férié vide).

**Icône promotionnelle** : 128 × 128, générée par `node scripts/make-icons.mjs`. Les
bandeaux promotionnels (440 × 280 et 1400 × 560) restent facultatifs tant que l'extension
ne vise pas la page d'accueil du store.
