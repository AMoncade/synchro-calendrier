# Portage Firefox — audit

État : **non porté**. Ce document liste ce qui bloque, lu dans le code de `a76293b`, avec
une source pour chaque verdict. Il ne modifie rien : `manifest.json` et le code restent
tels quels tant que le port n'est pas décidé (phase 6).

Résumé : **deux blocages réels**, le service worker d'arrière-plan et l'usage du namespace
`chrome.*` avec `await`. Le reste est mineur ou déjà conforme. Le port est faisable, mais
ce n'est pas une simple retouche de manifeste : il demande une seconde sortie de build.

| # | Point | Verdict |
|---|---|---|
| 1 | `background.service_worker` | **Bloquant** |
| 2 | `chrome.*` + `await` / `.catch()` | **Bloquant** |
| 3 | `runtime.onMessage` + `return true` | OK |
| 4 | `web_accessible_resources` (CRXJS) | À adapter |
| 5 | `action.setBadgeText` / `setBadgeBackgroundColor` | OK |
| 6 | `alarms.create` | OK |
| 7 | `navigator.clipboard.writeText()` | OK |
| 8 | `browser_specific_settings.gecko.id` | À ajouter |
| 9 | `host_permissions` MV3 | OK |
| 10 | `tabs.create`, `runtime.getManifest` | OK |
| 11 | Téléchargement Blob depuis le popup | **Non vérifié** |
| 12 | Chaîne de build CRXJS | À adapter |

---

## 1. `background.service_worker` — bloquant

Le manifeste déclare `"background": { "service_worker": "src/background/index.ts", "type": "module" }`,
et le build produit `"service_worker": "service-worker-loader.js"`.

> `background.service_worker` is not supported (see Firefox bug 1573659).
> — [MDN, manifest.json/background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)

Firefox n'a pas de service worker d'extension : en MV3 il utilise une *event page*, déclarée
avec `background.scripts` et implicitement non persistante.

> If omitted, this property [`persistent`] defaults to `true` in Manifest V2 and `false` in
> Manifest V3. Setting to `true` in Manifest V3 results in an error. — même page

**Bonne nouvelle : un seul manifeste suffit pour les deux navigateurs.** Depuis 2024, chaque
navigateur ignore la clé de l'autre.

> Before Firefox 120, Firefox did not start the background page if `service_worker` was
> present. From Firefox 121, the background page starts as expected, regardless of the
> presence of `service_worker`. — même page

> before Chrome 121, Chrome refuses to load a Manifest V3 extension with
> `background.scripts` or `background.page` present. From Chrome 121, their presence in a
> Manifest V3 extension is ignored. — même page

Il faut donc déclarer **les deux**, et fixer `strict_min_version` à `121.0` (§8) pour ne pas
tomber dans le trou de Firefox 120 et antérieurs.

Le code d'arrière-plan lui-même n'a pas besoin d'être réécrit : il n'enregistre que des
écouteurs au premier tour (`runtime.onMessage`, `runtime.onInstalled`, `runtime.onStartup`,
`alarms.onAlarm`) et ne garde aucun état en mémoire entre deux réveils — c'est exactement ce
qu'une event page exige. `background.type: "module"` s'applique aussi aux scripts d'event
page, supporté depuis Firefox 112 d'après les tables de compatibilité MDN.

## 2. `chrome.*` avec `await` et `.catch()` — bloquant

C'est le point le plus coûteux, et le moins visible.

> Firefox and Safari have always used the `browser` namespace (with promises). Originally,
> Chromium-based browsers (such as Chrome, Opera, and Microsoft Edge) used the `chrome`
> namespace (with callbacks).
>
> As a porting aid, the Firefox implementation of WebExtensions APIs supports `chrome` and
> callbacks as well as `browser` and Promises.
> — [MDN, WebExtensions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API)

L'appariement est strict : dans Firefox, `chrome.*` va avec les **callbacks**, `browser.*`
avec les **promesses**. Firefox accepte donc que notre code écrive `chrome.`, mais les
appels ne renvoient alors pas de promesse. Or tout notre code passe par `await` ou `.catch()`
sur le namespace `chrome` :

| Fichier | Appel | Effet dans Firefox |
|---|---|---|
| `src/background/index.ts:13` | `await chrome.storage.local.get(...)` | `stored` vaut `undefined`, la ligne suivante lève `TypeError` |
| `src/background/index.ts:19` | `await chrome.storage.local.set(...)` | l'écriture part, mais `saveState` ne l'attend pas |
| `src/background/index.ts:31-32` | `await chrome.action.setBadge*` | non attendu, sans conséquence directe |
| `src/background/index.ts:46-47` | `await chrome.storage.local.remove/setBadgeText` | idem |
| `src/content/synchro.ts:31` | `chrome.runtime.sendMessage(m).catch(...)` | `TypeError: …catch is not a function`, la capture ne part jamais |
| `src/popup/popup.ts:29` | `await chrome.runtime.sendMessage(...)` | renvoie `undefined`, le popup rend un état vide |

Le premier et le cinquième sont des pannes franches ; les autres échouent en silence, ce qui
est pire à diagnostiquer. Une extension qui « se charge sans erreur » mais n'affiche jamais
rien serait le symptôme.

Trois façons d'en sortir, par ordre de coût :

1. **Remplacer `chrome.` par `browser.`** partout et déclarer le global. Chrome expose aussi
   `browser` depuis Chrome 148 seulement, donc cela casserait les Chrome plus anciens : à
   écarter tant que la cible est Chrome stable large.
2. **Ajouter le polyfill officiel de Mozilla**, qui fournit `browser` + promesses sur Chrome.
   > If you're targeting older Chrome browser versions, Firefox offers a polyfill that
   > provides the `browser` namespace and promise support.
   > — [MDN, Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities)

   C'est la voie standard, mais elle ajoute une dépendance d'exécution — à justifier au
   WORKLOG selon la règle du `CLAUDE.md`.
3. **Un adaptateur maison** de quelques lignes (`const api = globalThis.browser ?? globalThis.chrome`)
   suffirait si l'on ne se sert que de `browser.*` quand il existe. C'est le choix le plus
   léger ici : nous n'utilisons que six API, toutes déjà promises dans les deux navigateurs
   dès lors qu'on prend le bon namespace.

Note : `void chrome.alarms.create(...)` (`background/index.ts:61`) et `void chrome.tabs.create(...)`
(`popup.ts:158`, `:166`) restent corrects dans les deux cas, `void undefined` étant valide.
`chrome.runtime.getManifest()` (`popup.ts:163`) est synchrone, donc sans problème.

## 3. `runtime.onMessage` avec `return true` — OK

`background/index.ts:55-58` répond de façon asynchrone en retournant `true`. Firefox le
supporte.

> return `true` from the event listener. This keeps the `sendResponse()` function valid
> after the listener returns, so you can call it later.
> — [MDN, runtime.onMessage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage)

Retourner une promesse est l'approche préférée côté Firefox, mais elle n'est pas portable
vers Chrome. Garder `return true` est le bon choix pour un code commun.

## 4. `web_accessible_resources` — à adapter (cosmétique)

CRXJS produit dans `dist/manifest.json` :

```json
"web_accessible_resources": [
  { "matches": ["https://*.synchro.umontreal.ca/*"],
    "resources": ["assets/parse-*.js", "assets/synchro.ts-*.js"],
    "use_dynamic_url": false }
]
```

Le format objet MV3 est supporté par Firefox, avec une contrainte plus souple que Chrome :

> In Firefox and Safari, any path can be included. In Chrome, the path must be set to `/*`.
> — [MDN, web_accessible_resources](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/web_accessible_resources)

Notre motif se termine par `/*` : conforme aux deux.

`use_dynamic_url`, en revanche :

> Firefox does not support the `use_dynamic_url` property.
> — [Extension Workshop, guide de migration MV3](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)

Sans portée pratique ici : CRXJS émet la valeur `false`, qui décrit précisément le
comportement par défaut. Qu'elle soit honorée ou ignorée, le résultat est le même. Reste à
savoir si Firefox émet un avertissement de validation à l'installation ou au dépôt sur AMO —
**je n'ai pas trouvé de source explicite là-dessus, c'est non vérifié.** Si un avertissement
apparaît, le retrait de la clé se fait dans l'étape de post-build du §12.

## 5. Badge — OK, avec une différence de rendu

`background/index.ts:31-32` appelle `setBadgeBackgroundColor` puis `setBadgeText`. Les deux
existent dans Firefox MV3 (depuis Firefox 109 d'après les tables MDN) et sont accessibles
sous le nom `chrome.action.*` comme sous `browser.action.*` — aucun renommage à faire, sous
réserve du §2.

Une différence de rendu, sans gravité :

> unless the badge text color is explicitly set […] the badge text color will automatically
> be set to black or white to maximize contrast […] Other browsers always use a white text
> color.
> — [MDN, action.setBadgeBackgroundColor](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/setBadgeBackgroundColor)

Notre `#0f56a9` est foncé : Firefox choisira du blanc, comme Chrome. Rien à changer.

## 6. `alarms.create` — OK

`background/index.ts:61` crée une alarme à `periodInMinutes: 60`. La seule limite documentée
est côté Chrome, et elle est très en dessous :

> In Chrome, unless the extension is loaded unpackaged, alarms do not fire more than once
> every 30 seconds […] Before Chrome 120, this limit was one minute.
> — [MDN, alarms.create](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms/create)

Aucune limite équivalente n'est documentée pour Firefox sur cette page. Une heure passe
partout.

## 7. Presse-papiers dans le popup — OK

`popup.ts:127` appelle `navigator.clipboard.writeText(ics())` depuis un `onclick`.

> The methods are available from a secure context but only function after the extension's
> user performs transient activation. However, with the `"clipboardWrite"` permission,
> transient activation isn't required.
> — [MDN, Interact with the clipboard](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard)

Le clic sur « Copier » **est** l'activation transitoire requise. La permission
`clipboardWrite` n'est donc pas nécessaire, ce qui préserve la règle des permissions
minimales du `CLAUDE.md`. Ne pas l'ajouter.

## 8. `browser_specific_settings.gecko` — à ajouter

Sans cette clé, l'extension ne peut pas être signée ni distribuée.

> Manifest V3: Mandatory for signing extensions, i.e., distribution through
> addons.mozilla.org (AMO) or self-distribution, to provide an extension ID.
> — [MDN, browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

L'`id` prend la forme d'une adresse (`^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$`, 80 caractères au
plus) ou d'un GUID. `strict_min_version` refuse l'installation sous la version indiquée :

> Minimum version of Gecko to support. If the Firefox version on which the extension is
> being installed or run is below this version, the extension is not installed or not run.
> — même page

Ne pas choisir un identifiant en `@umontreal.ca` : l'extension n'est pas un produit de
l'Université.

## 9. `host_permissions` en MV3 — OK

`host_permissions: ["https://*.synchro.umontreal.ca/*"]`.

> From Firefox 127, host permissions listed in `host_permissions` and `content_scripts` are
> displayed in the install prompt and granted on installation.
> — [Extension Workshop, guide de migration MV3](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)

Avec `strict_min_version: "121.0"`, les versions 121 à 126 n'accorderaient pas l'hôte
automatiquement et l'utilisateur devrait l'activer à la main dans le gestionnaire de modules.
Si l'on veut éviter ce cas, monter `strict_min_version` à `127.0` : les deux blocages du §1 et
du §2 sont réglés bien avant, et 127 date de 2024.

## 10. `tabs.create`, `runtime.getManifest` — OK

`popup.ts:158` et `:166` ouvrent `https://academique-dmz.synchro.umontreal.ca/` et une URL
`https://github.com/…`. Firefox refuse les URL privilégiées, pas celles-ci :

> For security reasons, in Firefox, this may not be a privileged URL. So passing any of the
> following URLs will fail: `chrome:` URLs, `javascript:` URLs, `data:` URLs, `file:` URLs…
> — [MDN, tabs.create](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create)

`runtime.getManifest()` renvoie un objet reconstruit, pas le fichier tel quel : ne jamais le
comparer à un `JSON.parse` du manifeste. Nous n'en lisons que `.version` (`popup.ts:163`),
donc rien à faire.

## 11. Téléchargement du `.ics` depuis le popup — non vérifié

`popup.ts:118-125` crée un Blob, un `<a download>`, le clique et le retire. Ce chemin est le
bouton principal de l'extension : s'il ne marche pas dans Firefox, le port n'a aucun intérêt.

**Je n'ai pas trouvé de source à jour disant si la fermeture du popup interrompt un
téléchargement lancé ainsi.** La documentation des popups n'aborde pas le sujet, et les
rapports Bugzilla trouvés sont anciens (2016-2019) et portent sur d'autres contextes. Le seul
point adjacent documenté concerne le moment de la révocation :

> If you use `URL.createObjectURL()` to download data created in JavaScript and you want to
> revoke the object URL […] you need to do that after the download has been completed.
> — [MDN, downloads.download](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download)

Notre `setTimeout(…, 1000)` de `popup.ts:124` révoque au bout d'une seconde, ce qui est
justement le motif signalé comme fragile.

**À faire avant toute autre chose si le port est décidé : tester ce bouton à la main dans
Firefox.** Le repli, en cas d'échec, est `downloads.download()`, qui coûte la permission
`downloads` — un compromis à trancher contre la règle des permissions minimales, et à
consigner.

## 12. Chaîne de build — à adapter

Le port ne se règle pas dans `manifest.json` seul. `vite.config.ts` passe le manifeste à
`@crxjs/vite-plugin`, qui cible Chrome : c'est lui qui réécrit `background` en
`service-worker-loader.js`, transforme le content script en chargeur + ressources
accessibles, et ajoute `use_dynamic_url`. La sortie de `dist/` est donc du Chrome par
construction.

Deux voies :

- **une étape de post-build** qui relit `dist/manifest.json`, y ajoute `background.scripts`
  et `browser_specific_settings`, retire `use_dynamic_url`, et écrit un `dist-firefox/`. Peu
  de code, mais il faut vérifier que le chargeur de content script émis par CRXJS fonctionne
  tel quel dans Firefox — non vérifié à ce jour ;
- **une seconde configuration Vite** produisant une sortie Firefox distincte.

Dans les deux cas, `scripts/package.mjs` accepte déjà `--source` et `--out` : `node
scripts/package.mjs --source dist-firefox` produira le zip Firefox sans modification.

---

## Changements de manifeste, liste exacte

À appliquer **quand le port sera décidé**, dans `manifest.json` à la racine (source), ou dans
l'étape de post-build du §12. Rien de tout ceci n'est fait aujourd'hui.

1. Ajouter la clé `browser_specific_settings`, à côté de `manifest_version` :

```json
"browser_specific_settings": {
  "gecko": {
    "id": "synchro-calendrier@moncade.com",
    "strict_min_version": "127.0"
  }
}
```

L'identifiant est une suggestion : n'importe quelle adresse sur un domaine contrôlé fait
l'affaire, mais il est **définitif** une fois publié sur AMO. `127.0` couvre le §1, le §2 et
l'octroi automatique des permissions d'hôte du §9 ; descendre à `121.0` reste possible au
prix du §9.

2. Déclarer les deux formes d'arrière-plan, Chrome ignorant `scripts` et Firefox ignorant
   `service_worker` :

```json
"background": {
  "service_worker": "src/background/index.ts",
  "scripts": ["src/background/index.ts"],
  "type": "module"
}
```

3. Retirer `use_dynamic_url` de `web_accessible_resources` dans la sortie Firefox — seulement
   si un avertissement de validation le réclame (§4). Cette clé est générée par CRXJS, pas
   écrite à la main : elle se retire au post-build.

4. Ne rien changer d'autre. `permissions`, `host_permissions`, `action`, `content_scripts`,
   `icons` sont valides tels quels en MV3 Firefox.

Et hors manifeste, dans le code : le §2 (namespace) et le §11 (téléchargement) sont les deux
seuls chantiers réels.
