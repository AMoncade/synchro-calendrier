# Politique de confidentialité — ClientSide Horaire

**Données lues.** L'extension lit, dans votre navigateur, le contenu de la page « Votre
horaire cours » (vue Liste) et du résumé d'horaire du Centre étudiant de l'Université de
Montréal (Synchro), uniquement lorsque vous les affichez : sigles de cours, sections, jours,
heures, locaux, dates de séances et d'examens (les examens figurent dans le même tableau
que les séances). Elle ne lit ni votre mot de passe ni aucune autre page. Vos notes ne sont
lues que si vous activez l'option « Notes » (voir plus bas).

**StudiUM (depuis la version 0.3).** Lorsque vous ouvrez StudiUM (studium.umontreal.ca),
l'extension demande au calendrier de StudiUM, avec votre session déjà ouverte, la liste de
vos échéances (quiz, devoirs) et la liste de vos sites de cours, au plus une fois par
demi-heure. Elle n'enregistre aucun jeton, aucun mot de passe, et ne lit ni vos forums ni le
contenu des cours ; vos notes seulement avec l'option « Notes » ci-dessous. Vous pouvez retirer une échéance depuis le popup ; elle
ne reviendra pas à la synchronisation suivante.

**Notes (option, désactivée par défaut).** Si vous activez « Notes » dans le menu du popup,
l'extension lit aussi, lors de la même synchronisation, le rapport de notes de chacun de vos
sites StudiUM (éléments d'évaluation, notes, valeurs possibles, pourcentages, moyennes du
groupe) et le garde dans le stockage local, sur votre ordinateur. Rien n'est recalculé ni
transmis. Désactiver l'option efface les notes conservées ; « Effacer les données » aussi.
Sans cette option, l'extension ne lit jamais vos notes.

**Prochaine session (depuis la version 0.4).** L'onglet « Prochaine session » propose les
cours du trimestre suivant à partir du catalogue public de Plan ton bacc
(udem-plan-ton-bacc.vercel.app), un site du même auteur qui reprend les pages publiques
d'admission.umontreal.ca. L'extension TÉLÉCHARGE ce catalogue par de simples requêtes de
lecture (GET) de fichiers publics : la liste des programmes, le programme que vous choisissez
et les fiches de ses cours. Aucune donnée vous concernant ne part avec ces requêtes, ni votre
horaire, ni vos cours, ni vos notes. Comme pour toute visite d'un site web, l'hébergeur
(Vercel) voit votre adresse IP et le nom du fichier demandé, donc le programme consulté.
Le programme que vous choisissez et les cours que vous cochez comme déjà faits restent dans
le stockage local.

Le lien « Voir l'audit complet » ouvre Plan ton bacc avec votre programme et vos cours dans la
partie de l'adresse qui suit le « # ». Le navigateur n'envoie jamais cette partie au serveur,
et Plan ton bacc vous demande de confirmer avant d'enregistrer quoi que ce soit.

**Événements ajoutés à la main.** Ce que vous saisissez dans le popup reste dans le stockage
local, comme le reste.

**Stockage.** L'horaire extrait est conservé dans le stockage local de l'extension, dans
votre navigateur (Chrome ou Firefox), sur votre ordinateur, avec, pour l'onglet « Prochaine
session », le programme choisi, les cours cochés et une copie des fiches de cours utiles. Vous pouvez l'effacer à tout
moment depuis le popup ou en désinstallant l'extension.

**Transmission.** Aucune donnée vous concernant n'est envoyée à un serveur, à l'auteur de
l'extension ni à un tiers. Les seules requêtes vers un serveur autre que l'UdeM sont les
téléchargements du catalogue public décrits plus haut. Le fichier de calendrier (.ics) est généré localement et vous seul décidez où
l'importer. Le bouton « Ajouter à Google Agenda » ouvre Google Agenda avec le titre, la
date et le local de l'événement, seulement quand vous cliquez dessus. Le bouton « Signaler
un bug » ouvre un formulaire GitHub pré-rempli avec la version de l'extension, le trimestre
et le nom de votre navigateur, jamais avec vos données d'horaire.
