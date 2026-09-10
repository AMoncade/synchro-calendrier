# Politique de confidentialité — Synchro Calendrier UdeM

**Données lues.** L'extension lit, dans votre navigateur, le contenu de la page « Votre
horaire cours » (vue Liste) et du résumé d'horaire du Centre étudiant de l'Université de
Montréal (Synchro), uniquement lorsque vous les affichez : sigles de cours, sections, jours,
heures, locaux, dates de séances et d'examens (les examens figurent dans le même tableau
que les séances). Elle ne lit ni votre mot de passe, ni vos notes, ni aucune autre page.

**StudiUM (depuis la version 0.3).** Lorsque vous ouvrez StudiUM (studium.umontreal.ca),
l'extension demande au calendrier de StudiUM, avec votre session déjà ouverte, la liste de
vos échéances (quiz, devoirs) et la liste de vos sites de cours, au plus une fois par
demi-heure. Elle n'enregistre aucun jeton, aucun mot de passe, et ne lit ni vos notes, ni
vos forums, ni le contenu des cours. Vous pouvez retirer une échéance depuis le popup ; elle
ne reviendra pas à la synchronisation suivante.

**Événements ajoutés à la main.** Ce que vous saisissez dans le popup reste dans le stockage
local, comme le reste.

**Stockage.** L'horaire extrait est conservé dans le stockage local de l'extension
(`chrome.storage.local`), sur votre ordinateur. Vous pouvez l'effacer à tout moment depuis
le popup ou en désinstallant l'extension.

**Transmission.** Aucune donnée n'est envoyée à un serveur, à l'auteur de l'extension ni
à un tiers. Le fichier de calendrier (.ics) est généré localement et vous seul décidez où
l'importer. Le bouton « Signaler un bug » ouvre un formulaire pré-rempli avec la version
de l'extension et le trimestre, jamais avec vos données d'horaire.
