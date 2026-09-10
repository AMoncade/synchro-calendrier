// Passe de couture, phase 12 (2026-09-10) : ce que chaque module fait bien
// seul et qui se défait à la jointure. Les suites `deadlines`, `studium` et
// `studium-content` sont vertes ; les cas ci-dessous ne le sont que parce
// qu'ils décrivent le comportement ACTUEL, défauts compris.
//
// Convention : un `it("DÉFAUT CONNU — …")` assère ce que le code fait
// aujourd'hui et dit en commentaire ce qu'il devrait faire. Quand le défaut est
// corrigé, le test DOIT casser — c'est ce qui force à le basculer.
//
// État au 2026-09-10, après e992ede — les quatre axes du premier passage :
//   axe 5, routage des messages : réparé (d7c57e1), cas devenus non-régressions ;
//   axe 4, format d'instant     : compensé chez le consommateur, gardé en PIÈGE ;
//   axe 2, fenêtre open/close   : réparé (8622ebe, panier courseid + slug) ;
//   axe 1, identité des ids     : réduit à un RÉSIDU ACCEPTÉ, gardé pour dire
//                                 ce qui casserait si l'hypothèse tombait.
// Le second passage, en fin de fichier, n'examine que ce que 8622ebe a changé.
//
// Aucun test ne dépend de l'heure réelle ni du fuseau de la machine.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message, StoredState } from "../src/lib/messages";
import type { Deadline, RawStudiumCapture } from "../src/core/model";
import { deadlinesFromStudium } from "../src/core/studium";
import { localNow as studiumLocalNow } from "../src/content/studium";
import { allDeadlines, mergeStudium, removeDeadline } from "../src/core/deadlines";
import { deadlineUid } from "../src/core/ics";

const COURSE = { id: 4242, shortname: "MAT1400-AB-A26", fullname: "Calcul 1" };

/** Un couple « s'ouvre » / « se termine » du même quiz. `url` absente = pas de cmid. */
function quizEvents(options: { openUrl: boolean; closeUrl: boolean }): RawStudiumCapture {
  const base = { modulename: "quiz", activityname: "Quiz-tp3", timeduration: 0, course: COURSE };
  const url = "https://studium.umontreal.ca/mod/quiz/view.php?id=6624079";
  return {
    months: ["2026-09"],
    events: [
      {
        id: 1,
        name: "Quiz-tp3 s'ouvre",
        eventtype: "open",
        timestart: 1_757_500_000,
        ...base,
        ...(options.openUrl ? { url } : {}),
      },
      {
        id: 2,
        name: "Quiz-tp3 se termine",
        eventtype: "close",
        timestart: 1_757_900_000,
        ...base,
        ...(options.closeUrl ? { url } : {}),
      },
    ],
    courses: [COURSE],
  };
}

function stateWith(deadlines: Deadline[]): StoredState {
  const map: Record<string, Deadline> = {};
  for (const d of deadlines) map[d.id] = d;
  return { schedules: {}, sources: {}, lastCapturedAt: null, lastSource: null, deadlines: map };
}

// ---------------------------------------------------------------------------
// Axe 1 — identité des ids : parseur → fusion → masquage → UID iCalendar
// ---------------------------------------------------------------------------

describe("identité des ids d'une synchro à l'autre", () => {
  it("l'id vient du cmid quand l'URL du module est là", () => {
    const [d] = deadlinesFromStudium(quizEvents({ openUrl: true, closeUrl: true }));

    expect(d?.id).toBe("studium:6624079");
    expect(d?.start).toBeDefined(); // open + close recollés par le cmid
  });

  it("l'id retombe sur site + nom quand l'URL manque", () => {
    const [d] = deadlinesFromStudium(quizEvents({ openUrl: false, closeUrl: false }));

    expect(d?.id).toBe("studium:4242:quiz-tp3");
    expect(d?.start).toBeDefined(); // recollés par la clé de repli
  });

  // RÉSIDU ACCEPTÉ (2026-09-10, adrie-29 et adrie-aa, après le regroupement 8622ebe).
  //
  // Le regroupement par `courseid + slug` a fermé le cas où UN SEUL des deux
  // événements porte l'URL : le panier est le même, le cmid est choisi sur le
  // groupe. Reste le cas où l'URL manque sur TOUS les événements d'une activité à
  // une synchro et revient à la suivante — là, l'id bascule pour de bon.
  //
  // Accepté parce que le cas est théorique : d'après adrie-29, l'exporteur Moodle
  // `calendar_event_exporter` rend toujours `url` (relayé, non vérifié dans le
  // source Moodle). Vérifié ici, en revanche, sur la capture réelle
  // `tests/fixtures/studium-monthly-2026-09-brut.json` : les 5 événements porteurs
  // d'échéance ont tous une URL `/mod/<type>/view.php?id=<cmid>`, aucun n'en manque.
  //
  // Les deux cas restent pour dire ce qui casserait si l'hypothèse tombait.
  it("RÉSIDU ACCEPTÉ — une URL absente de TOUS les événements puis présente change l'id, et l'échéance masquée revient", () => {
    // Synchro 1 : Moodle ne donne l'URL sur aucun des deux. L'étudiant retire l'échéance.
    const [sansUrl] = deadlinesFromStudium(quizEvents({ openUrl: false, closeUrl: false }));
    const masque = removeDeadline(mergeStudium(stateWith([]), [sansUrl!], [], "2026-09-10T10:00"), sansUrl!.id);
    expect(masque.hiddenDeadlines).toEqual(["studium:4242:quiz-tp3"]);

    // Synchro 2 : même quiz, même nom, même site — mais Moodle donne l'URL cette fois.
    const [avecUrl] = deadlinesFromStudium(quizEvents({ openUrl: true, closeUrl: true }));
    const apres = mergeStudium(masque, [avecUrl!], [], "2026-09-11T10:00");

    // `studium:6624079` ≠ `studium:4242:quiz-tp3` : le masquage ne reconnaît plus l'échéance.
    expect(allDeadlines(apres)).toHaveLength(1);
    expect(allDeadlines(apres)[0]?.id).toBe("studium:6624079");
    expect(masque.hiddenDeadlines).not.toContain("studium:6624079");
  });

  it("RÉSIDU ACCEPTÉ — le même changement d'id produirait un doublon dans l'agenda de l'étudiant", () => {
    const [sansUrl] = deadlinesFromStudium(quizEvents({ openUrl: false, closeUrl: false }));
    const [avecUrl] = deadlinesFromStudium(quizEvents({ openUrl: true, closeUrl: true }));

    // `deadlineUid` dérive de `deadline.id` : deux ids = deux VEVENT. Un client
    // iCalendar qui réimporte voit un ajout, pas une mise à jour. C'est la
    // conséquence la plus visible du résidu, et celle qu'aucun des deux modules
    // ne peut voir seul.
    expect(deadlineUid("A26", sansUrl!)).not.toBe(deadlineUid("A26", avecUrl!));
    expect(deadlineUid("A26", avecUrl!)).toContain("studium-6624079");
    expect(deadlineUid("A26", sansUrl!)).toContain("studium-4242-quiz-tp3");
  });
});

// ---------------------------------------------------------------------------
// Axe 2 — fenêtre open/close
// ---------------------------------------------------------------------------

describe("fenêtre open/close", () => {
  // Corrigé le 2026-09-10 par adrie-29 (studium-pipeline 8622ebe) : panier courseid + slug,
  // cmid décidé sur le groupe. Les deux cas ci-dessous étaient « DÉFAUT CONNU ».
  it("une URL sur un seul des deux événements ne sépare plus le couple : fenêtre conservée", () => {
    // Jusqu'à 8622ebe, `prepareEvent` calculait la clé de regroupement à partir du
    // cmid *de chaque événement* : « s'ouvre » avec URL et « se termine » sans
    // partaient dans deux paniers, l'open devenait orphelin (jeté) et le close
    // donnait une échéance sans `start` — fenêtre perdue en silence.
    //
    // Depuis : panier par `courseid + slug`, toujours ; le cmid ne sert qu'à
    // fabriquer l'id une fois le groupe formé. C'est le correctif que le rapport
    // de couture proposait, et il ferme les deux sens.
    const deadlines = deadlinesFromStudium(quizEvents({ openUrl: true, closeUrl: false }));

    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]?.id).toBe("studium:6624079"); // le cmid du membre qui en a un
    expect(deadlines[0]?.start).toBeDefined();
  });

  it("l'inverse aussi : URL sur « se termine » seulement", () => {
    const deadlines = deadlinesFromStudium(quizEvents({ openUrl: false, closeUrl: true }));

    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]?.id).toBe("studium:6624079");
    expect(deadlines[0]?.start).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Axe 4 — fuseau : deux formats d'instant dans le même champ d'affichage
// ---------------------------------------------------------------------------

describe("format des instants passés à relativeTime", () => {
  it("PIÈGE — `syncedAt` est un instant local nu, `lastCapturedAt` un instant ISO avec fuseau", () => {
    // Deux champs de `StoredState` portent des formats différents : `studium.lastSyncAt`
    // et `lastErrorAt` viennent de `content/studium.ts:localNow()` et n'ont ni `Z` ni
    // décalage ; `lastCapturedAt` vient de `content/synchro.ts` et est un vrai ISO.
    //
    // `relativeTime` (format/time.ts) documente son paramètre comme « ISO 8601 avec
    // fuseau » et le lit avec `Date.parse`, qui interprète un instant nu en heure locale
    // *de la machine*. Le popup compense depuis d7c57e1 (2026-09-10) avec `toIso()`, donc
    // ce n'est plus un défaut vivant — mais l'écart de format demeure, et tout nouveau
    // consommateur de `lastSyncAt` retombera dedans. Ce cas est là pour l'en avertir.
    const syncedAt = studiumLocalNow(new Date(Date.UTC(2026, 8, 10, 11, 5)));
    const capturedAt = new Date(Date.UTC(2026, 8, 10, 11, 5)).toISOString();

    expect(syncedAt).not.toMatch(/(Z|[+-]\d{2}:\d{2})$/); // nu
    expect(capturedAt).toMatch(/Z$/); // avec fuseau
  });
});

// ---------------------------------------------------------------------------
// Axe 5 — routage des messages dans le service worker
// ---------------------------------------------------------------------------

/** Le minimum de `chrome.*` que `src/background/index.ts` touche à l'import. */
function fakeChrome() {
  const store: Record<string, unknown> = {};
  const listeners: Array<(m: Message, s: unknown, r: (v: unknown) => void) => boolean> = [];
  const setCalls: Array<Record<string, unknown>> = [];
  return {
    listeners,
    setCalls,
    api: {
      runtime: {
        onMessage: { addListener: (fn: (typeof listeners)[number]) => listeners.push(fn) },
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
      },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (patch: Record<string, unknown>) => {
            setCalls.push(patch);
            Object.assign(store, patch);
          },
          remove: async () => {},
        },
      },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    },
  };
}

describe("service worker : routage des messages de la phase 12", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function dispatch(message: Message): Promise<{ answer: unknown; writes: number }> {
    const fake = fakeChrome();
    vi.stubGlobal("chrome", fake.api);
    vi.resetModules();
    await import("../src/background/index");
    const listener = fake.listeners[0];
    expect(listener).toBeDefined();
    const answer = await new Promise<unknown>((resolve) => {
      listener!(message, null, resolve);
    });
    return { answer, writes: fake.setCalls.length };
  }

  it("SCHEDULE_CAPTURED est bien routé (le témoin : ce chemin-là écrit)", async () => {
    const schedule = {
      schemaVersion: 1 as const,
      capturedAt: "2026-09-10T12:00:00Z",
      term: { code: "A26", label: "Automne 2026", start: "2026-09-01", end: "2026-12-23" },
      courses: [],
      exams: [],
    };
    const { answer, writes } = await dispatch({ type: "SCHEDULE_CAPTURED", schedule, source: "liste" });

    expect(answer).toEqual({ ok: true });
    expect(writes).toBe(1);
  });

  // Histoire, pas un état courant. Jusqu'au 2026-09-10 (d7c57e1), `handle()` n'avait
  // de `case` que pour SCHEDULE_CAPTURED, GET_STATE et CLEAR_ALL : les cinq messages
  // ci-dessous tombaient dans `default: return { ok: false }` et les cinq fonctions
  // importées de core/deadlines n'étaient jamais appelées — fonctionnalité entièrement
  // débranchée, 409 tests verts. Cause : une édition par `replace` dont l'ancre
  // multi-lignes n'avait pas matché (fichier en CRLF), sans erreur.
  //
  // Depuis d7c57e1 : chacun est routé et écrit une fois, une garde d'exhaustivité
  // (`const exhaustive: never = message`) empêche qu'un type ajouté à l'union `Message`
  // reparte sans `case`. Ces cinq cas gardent leur valeur de non-régression.
  const routes: Array<[string, Message]> = [
    ["STUDIUM_SYNCED", { type: "STUDIUM_SYNCED", deadlines: [], courses: [], syncedAt: "2026-09-10T07:05" }],
    ["STUDIUM_FAILED", { type: "STUDIUM_FAILED", error: "sesskey-absent", at: "2026-09-10T07:05" }],
    [
      "DEADLINE_UPSERT",
      {
        type: "DEADLINE_UPSERT",
        deadline: { id: "manuel:x", source: "manuel", title: "Rendez-vous TGDE", kind: "evenement", due: "2026-09-18T14:00" },
      },
    ],
    ["DEADLINE_REMOVE", { type: "DEADLINE_REMOVE", id: "studium:6624079" }],
    ["COURSE_LINK_SET", { type: "COURSE_LINK_SET", studiumCourseId: 4242, courseCode: "MAT1400" }],
  ];

  // Corrigé le 2026-09-10 (défaut 1 du sweep) : les cinq cas étaient « DÉFAUT CONNU —
  // n'est pas routé » ; le service worker route maintenant chacun et écrit une fois.
  for (const [name, message] of routes) {
    it(`${name} est routé : une écriture, réponse ok`, async () => {
      const { answer, writes } = await dispatch(message);

      expect(answer).toEqual({ ok: true });
      expect(writes).toBe(1);
    });
  }
});

// ---------------------------------------------------------------------------
// Second passage (2026-09-10, après 8622ebe) : ce que le nouveau regroupement
// d'adrie-29 change à la jointure avec `removeDeadline` et `deadlineUid`.
// Le test de chaîne `tests/studium-pipeline.test.ts` couvre déjà la chaîne
// nominale ; on ne regarde ici que les cas qu'il ne prend pas.
// ---------------------------------------------------------------------------

const SITE = { id: 4242, shortname: "MAT1400-AB-A26", fullname: "Calcul 1" };
const QUIZ = { modulename: "quiz", activityname: "Quiz-tp3", timeduration: 0, course: SITE };
const modUrl = (cmid: number) => `https://studium.umontreal.ca/mod/quiz/view.php?id=${cmid}`;
const capture = (events: RawStudiumCapture["events"]): RawStudiumCapture => ({
  months: ["2026-09"],
  events,
  courses: [SITE],
});

describe("regroupement par panier : homonymes dans un même site", () => {
  // Le panier est `courseid + slug`. Un événement sans cmid ne rejoint le cmid du
  // panier que si ce panier n'en contient qu'un seul — choix d'adrie-29, pour ne
  // pas fusionner deux activités homonymes distinctes (Moodle les autorise).
  const ouvertureSansUrl = { id: 2, name: "Quiz-tp3 s'ouvre", eventtype: "open", timestart: 1_757_500_000, ...QUIZ };
  const fermeture111 = { id: 1, name: "Quiz-tp3 se termine", eventtype: "close", timestart: 1_757_900_000, ...QUIZ, url: modUrl(111) };
  const fermeture222 = { id: 3, name: "Quiz-tp3 se termine", eventtype: "close", timestart: 1_758_900_000, ...QUIZ, url: modUrl(222) };

  it("un seul cmid dans le panier : l'ouverture sans URL le rejoint et la fenêtre tient", () => {
    const deadlines = deadlinesFromStudium(capture([fermeture111, ouvertureSansUrl]));

    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]?.id).toBe("studium:111");
    expect(deadlines[0]?.start).toBeDefined();
  });

  it("DÉFAUT CONNU — l'arrivée d'un homonyme retire sa fenêtre à l'échéance qui l'avait", () => {
    // Même panier, deux cmids : `lone` devient indéfini, l'ouverture sans URL ne
    // rejoint plus personne et redevient un `open` orphelin — donc jetée. L'id de
    // l'échéance existante ne bouge pas (c'est l'acquis de 8622ebe), mais son
    // `start` disparaît d'une synchronisation à l'autre, sans bruit.
    //
    // ATTENDU APRÈS CORRECTION : `studium:111` garde `start`. Rattacher une
    // ouverture sans cmid au cmid le plus proche dans le temps (le seul dont la
    // fermeture suit l'ouverture) suffirait ; c'est une décision pour adrie-29.
    const avant = deadlinesFromStudium(capture([fermeture111, ouvertureSansUrl]));
    const apres = deadlinesFromStudium(capture([fermeture111, ouvertureSansUrl, fermeture222]));

    expect(avant[0]?.start).toBeDefined();
    expect(apres).toHaveLength(2);
    expect(apres.map((d) => d.id)).toEqual(["studium:111", "studium:222"]);
    expect(apres[0]?.start).toBeUndefined(); // fenêtre perdue
    expect(apres[1]?.start).toBeUndefined();
  });

  it("l'id reste stable malgré l'homonyme : le masquage tient toujours", () => {
    // L'acquis de 8622ebe, et la raison pour laquelle le cas ci-dessus est un
    // défaut mineur : ce qui casse est la fenêtre, plus l'identité.
    const [existante] = deadlinesFromStudium(capture([fermeture111, ouvertureSansUrl]));
    const masque = removeDeadline(mergeStudium(stateWith([]), [existante!], [], "2026-09-10T10:00"), existante!.id);

    const apres = mergeStudium(masque, deadlinesFromStudium(capture([fermeture111, ouvertureSansUrl, fermeture222])), [], "2026-09-11T10:00");

    expect(allDeadlines(apres).map((d) => d.id)).toEqual(["studium:222"]);
    expect(deadlineUid("A26", existante!)).toContain("studium-111");
  });
});

describe("aller-retour entre l'instant écrit et l'instant relu", () => {
  it("`localNow` et le `toIso` du popup sont exactement inverses", () => {
    // `content/studium.ts:localNow` écrit l'instant avec `getFullYear/getHours…`,
    // donc en heure **de la machine** ; `popup.ts:toIso` le relit avec
    // `new Date(y, m, j, h, min)`, qui lit en heure de la machine aussi. Le
    // couple est donc juste quel que soit le fuseau de la machine — c'est ce qui
    // ferme le défaut 4 du premier passage, et ce test le fige.
    const instant = new Date(2026, 8, 10, 7, 5);
    const ecrit = studiumLocalNow(instant);
    const relu = new Date(
      Number(ecrit.slice(0, 4)),
      Number(ecrit.slice(5, 7)) - 1,
      Number(ecrit.slice(8, 10)),
      Number(ecrit.slice(11, 13)),
      Number(ecrit.slice(14, 16)),
    );

    expect(relu.getTime()).toBe(new Date(2026, 8, 10, 7, 5).getTime());
  });
});
