# Repérage — importer les échéances StudiUM (et les notes)

**Date :** 2026-09-10 · **Portée :** reconnaissance seulement, aucun code, aucune modification
de l'extension. Tout ci-dessous a été lu en direct dans ta session StudiUM.

---

## 1. Résumé en cinq lignes

- L'export ICS de StudiUM **existe et fonctionne** — c'est bien le meilleur ratio effort/gain.
- Mais il te livrera **50 événements pour toute la session A26, tous des quiz, et de 2 cours
  seulement** (MAT1400-AB et MAT1600-AB).
- Il **double chaque quiz** : un événement « s'ouvre » + un événement « se termine ».
- L'abonnement dynamique est **plafonné à 60 jours**.
- Pour les **notes**, il n'y a aucun export : ni ICS, ni CSV côté étudiant. C'est du scraping HTML,
  mais sur des tableaux propres.

---

## 2. La plateforme

| Élément | Valeur |
|---|---|
| Site | `https://studium.umontreal.ca` |
| Moteur | Moodle 4.x (thème `boost`, tiroirs, index de cours) |
| Ton `userid` Moodle | `823466` |
| Session | authentifiée par cookie SSO ; `M.cfg.sesskey` disponible côté page |

### Tes sites de cours A2026

| Sigle StudiUM | `courseid` | `idnumber` | Contenu |
|---|---|---|---|
| MAT1400-A-A26 | 349955 | `MAT1400-A-A26` | 10 modules — forums, liens, 1 dossier |
| MAT1400-AB-A26 | 366020 | *(vide)* | **44 modules — 16 quiz, 11 H5P, 1 devoir** |
| MAT1500-A-A26 | 349970 | `MAT1500-A-A26` | 3 modules — 1 dossier, 1 forum |
| MAT1600-A-A26 | 349974 | `MAT1600-A-A26` | 3 modules — 1 forum, 2 liens |
| MAT1600-AB-A26 | 366018 | *(vide)* | **138 modules — 14 quiz, 36 ressources** |
| STT1700-A-A26 | 355495 | `STT1700-A-A26` | 20 modules — 11 dossiers, 6 ressources |

**Le détail à retenir :** l'`idnumber` vaut `SIGLE-SECTION-TRIMESTRE`, exactement le format que
tu tires déjà de Synchro. C'est ta clé de jointure gratuite entre les deux sources — pas besoin
de parser le nom affiché. Attention : les sites **-AB** (les TP, ceux qui portent tout le travail
évalué) ont un `idnumber` **vide**. Il faudra retomber sur le `shortname`.

---

## 3. L'export ICS — mécanique exacte

**Page :** `/calendar/export.php` — formulaire POST avec deux groupes de radios et deux boutons.

| Paramètre | Valeurs possibles |
|---|---|
| `events[exportevents]` | `all` · `categories` · `courses` · `groups` · `user` |
| `period[timeperiod]` | `weeknow` · `monthnow` · `recentupcoming` · `custom` |
| bouton `generateurl` | affiche l'URL d'abonnement dynamique |
| bouton `export` | télécharge le `.ics` figé |

L'URL d'abonnement est de la forme
`…/calendar/export_execute.php?userid=<id>&authtoken=<jeton>&preset_what=all&preset_time=recentupcoming`.

### Trois pièges

1. **`recentupcoming` = 60 jours glissants.** Le lien dynamique ne propose pas l'intervalle
   personnalisé. Tu n'auras donc jamais toute la session d'un coup par abonnement — seulement les
   60 prochains jours, rafraîchis. Pour le tableau complet il faut l'export figé en mode `custom`
   (l'intervalle proposé va du 4 sept. 26 au 9 sept. 27).
2. **Le `authtoken` est un secret permanent.** Il ne change pas quand tu changes de mot de passe,
   et quiconque l'a lit ton calendrier. Il ne doit jamais finir dans le dépôt, dans une capture,
   ni dans un fichier de config versionné. Je ne l'ai volontairement pas généré.
3. **Pas de `authtoken` = pas d'ICS.** L'endpoint n'accepte pas le cookie de session : impossible
   pour l'extension de récupérer l'ICS toute seule. Il faudra que tu colles l'URL une fois.

---

## 4. Ce qu'il y a réellement dedans

J'ai interrogé le calendrier mois par mois de septembre à décembre 2026.

| Mesure | Valeur |
|---|---|
| Événements sur toute la session | **50** |
| Type de module | **quiz — 100 %** (aucun devoir, aucun autre type) |
| Répartition `open` / `close` | 23 / 27 |
| Cours concernés | MAT1400-AB (28) · MAT1600-AB (22) |
| Cours sans aucun événement | MAT1400-A · MAT1500-A · MAT1600-A · STT1700-A |
| Par mois | sept. 18 · oct. 10 · nov. 18 · déc. 4 |
| Durée des événements | `timeduration = 0` — ponctuels, pas de plage |

Exemples réels :

| Événement | Type | Quand (local) |
|---|---|---|
| Quiz obligatoire-Thème 1 **se termine** | `close` | 10 sept. 23:59 |
| Quiz-tp3 **s'ouvre** | `open` | 14 sept. 10:30 |
| Quiz-tp3 **se termine** | `close` | 17 sept. 23:59 |
| Quiz obligatoire récapitulatif Thèmes 7-11 **se termine** | `close` | 10 déc. 23:59 |

### Les deux conséquences de design

**a) Il faut filtrer.** Un import naïf te donne deux lignes par quiz, dont une (« s'ouvre ») qui
n'est pas une échéance. Le champ `eventtype` (`open` / `close`) tranche proprement. Le nom
contient déjà « s'ouvre » / « se termine », mais filtrer sur le libellé serait fragile.

**b) Le calendrier n'est pas incomplet — il n'y a simplement rien ailleurs.** J'ai vérifié le
contenu des quatre autres sites : MAT1500 et STT1700 sont des dépôts de fichiers (dossiers,
ressources, un forum), **zéro activité évaluée**. Donc pas de scraping à prévoir pour les
rattraper : il n'y a rien à rattraper. Tes intras et finaux de ces cours viennent de Synchro et
du plan de cours, pas de StudiUM.

**Une exception :** MAT1400-AB contient un devoir, *« Final numérisé »*
(`/mod/assign/view.php?id=6624079`), **sans date d'échéance configurée** — c'est pour ça qu'il
n'apparaît nulle part dans le calendrier. Un devoir sans `duedate` est invisible à l'ICS. Si un
prof en ajoute une en cours de session, elle apparaîtra ; si un autre n'en met jamais, tu ne la
verras jamais. C'est la limite structurelle de l'approche ICS.

---

## 5. L'alternative que je n'attendais pas : l'API interne de Moodle

C'est par là que j'ai obtenu tous les chiffres ci-dessus. Moodle expose ses propres appels AJAX
sur `/lib/ajax/service.php?sesskey=…&info=<méthode>`, utilisables avec le simple cookie de session
(aucun token à gérer) :

| Méthode | Ce qu'elle donne |
|---|---|
| `core_calendar_get_calendar_upcoming_view` | prochains événements, complets |
| `core_calendar_get_calendar_monthly_view` | un mois entier, jour par jour |
| `core_course_get_enrolled_courses_by_timeline_classification` | tes cours, `id` + `idnumber` + dates |

Elle est **strictement plus riche que l'ICS** : `eventtype` (`open`/`close`), `modulename`,
`component`, `courseid`, `activityname` **et l'URL directe de l'activité** — tout ce que l'ICS
aplatit dans un `SUMMARY` texte.

| | ICS | API AJAX |
|---|---|---|
| Secret à gérer | jeton permanent | aucun (cookie de session) |
| Métadonnées | `SUMMARY`, `DTSTART`, `DESCRIPTION` | structurées, typées |
| Distinguer ouverture/échéance | par le libellé | champ `eventtype` |
| Lien vers l'activité | non | oui |
| Horizon | 60 j (abonnement) | arbitraire, mois par mois |
| Fragilité | format stable depuis 10 ans | interne, peut bouger entre versions |
| Marche hors navigateur | oui | non — exige une session active |

Comme ton extension **vit déjà dans le navigateur**, elle a la session. Le désavantage principal
de l'API (« il faut être connecté ») ne s'applique pas à toi. À mon avis, c'est la piste à
considérer sérieusement avant de te rabattre sur l'ICS — même si l'ICS reste le plan B robuste.

---

## 6. Les notes

### Sur StudiUM

| Page | Ce qu'elle donne |
|---|---|
| `/grade/report/overview/index.php` — « Calepin » | une ligne par cours + note globale. **Tout à « - » actuellement** (rien de publié encore) |
| `/grade/report/user/index.php?id=<courseid>` | le détail : `Élément d'évaluation`, `Pondération calculée`, `Note`, `Valeurs possibles`, `Pourcentage`, `Moyenne`, `Rétroaction` |

Exemple lu dans MAT1600-AB : *Test de connaissances préliminaires — barème 0–10 — moyenne du
groupe 1,8 (43 répondants)*. La **moyenne du groupe** est exposée : c'est une donnée que tu ne
retrouveras nulle part ailleurs, et probablement la plus intéressante pour un tableau de bord.

**Aucun export natif** : pas d'ICS, pas de CSV côté étudiant (l'export CSV du carnet est réservé
aux enseignants). C'est du parsing de tableau HTML, mais la structure est régulière et stable.

### Sur Synchro (relevé officiel) — **non vérifié**

Je n'ai pas pu y accéder : l'extension Chrome s'est déconnectée en cours de route, et le
navigateur intégré a échoué au chargement de `academique-dmz.synchro.umontreal.ca`. C'est le trou
de ce repérage. À vérifier au prochain passage :

- où vit le relevé de notes dans le Centre étudiant, et s'il est en HTML ou en PDF généré ;
- s'il est dans le même arbre PeopleSoft que l'horaire (donc atteignable par le content script que
  tu as déjà) ou derrière une autre application ;
- si les notes finales y apparaissent avant ou après StudiUM.

---

## 7. Ce que je recommanderais

| Priorité | Source | Pourquoi |
|---|---|---|
| 1 | **API AJAX du calendrier Moodle** | tu as déjà la session ; données typées ; pas de secret à stocker |
| 2 | **ICS en repli** | si l'API bouge, ou pour un usage hors navigateur ; demande un collage manuel de l'URL |
| 3 | **Carnet de notes par cours** | seul endroit avec la moyenne du groupe ; scraping simple |
| 4 | Relevé Synchro | à repérer d'abord |

Et trois choses à décider avant d'écrire une ligne :

1. **Que fait-on des événements `open` ?** Les jeter, ou les afficher comme « disponible à partir
   de » ? Ça change le modèle de données.
2. **Comment relier un site StudiUM à un cours Synchro** quand l'`idnumber` est vide (les -AB, qui
   sont justement ceux qui comptent) ?
3. **Où s'arrête le périmètre ?** 50 quiz sur 2 cours, c'est un vrai gain — mais ça ne couvre pas
   tes intras et finaux, qui restent la donnée la plus importante de la session et qui viennent
   déjà de Synchro. L'import StudiUM est un complément, pas une deuxième source d'échéances.

---

*Reconnaissance faite en lecture seule : aucune donnée modifiée, aucun formulaire soumis, aucun
jeton généré, aucun fichier téléchargé.*
