// Passe de couture, phase 12 (2026-09-10) : ce que chaque module fait bien
// seul et qui se défait à la jointure. Les suites `deadlines`, `studium` et
// `studium-content` sont vertes ; les cas ci-dessous ne le sont que parce
// qu'ils décrivent le comportement ACTUEL, défauts compris.
//
// Convention : un `it("DÉFAUT CONNU — …")` assère ce que le code fait
// aujourd'hui et dit en commentaire ce qu'il devrait faire. Quand le défaut est
// corrigé, le test DOIT casser — c'est ce qui force à le basculer.
//
// État au 2026-09-10, après d7c57e1 : le routage des messages (axe 5) est réparé
// et ses cas sont devenus des non-régressions ; l'écart de format d'instant
// (axe 4) est compensé chez son consommateur et reste noté comme piège. Les
// « DÉFAUT CONNU » restants (axes 1 et 2, identité des ids et fenêtre
// open/close) sont confiés à la branche `studium-pipeline` ; ils basculeront à
// son merge.
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

  it("DÉFAUT CONNU — une URL qui apparaît d'une synchro à l'autre change l'id, et l'échéance masquée revient", () => {
    // Synchro 1 : Moodle ne donne pas l'URL. L'étudiant retire l'échéance.
    const [sansUrl] = deadlinesFromStudium(quizEvents({ openUrl: false, closeUrl: false }));
    const masque = removeDeadline(mergeStudium(stateWith([]), [sansUrl!], [], "2026-09-10T10:00"), sansUrl!.id);
    expect(masque.hiddenDeadlines).toEqual(["studium:4242:quiz-tp3"]);

    // Synchro 2 : même quiz, même nom, même site — mais Moodle donne l'URL cette fois.
    const [avecUrl] = deadlinesFromStudium(quizEvents({ openUrl: true, closeUrl: true }));
    const apres = mergeStudium(masque, [avecUrl!], [], "2026-09-11T10:00");

    // ATTENDU APRÈS CORRECTION : toujours masquée (aucune échéance).
    // ACTUEL : elle revient, parce que `studium:6624079` ≠ `studium:4242:quiz-tp3`.
    expect(allDeadlines(apres)).toHaveLength(1);
    expect(allDeadlines(apres)[0]?.id).toBe("studium:6624079");
    expect(masque.hiddenDeadlines).not.toContain("studium:6624079");
  });

  it("DÉFAUT CONNU — le même changement d'id produit un doublon dans l'agenda de l'étudiant", () => {
    const [sansUrl] = deadlinesFromStudium(quizEvents({ openUrl: false, closeUrl: false }));
    const [avecUrl] = deadlinesFromStudium(quizEvents({ openUrl: true, closeUrl: true }));

    // `deadlineUid` dérive de `deadline.id` : deux ids = deux VEVENT. Un client
    // iCalendar qui réimporte voit un ajout, pas une mise à jour.
    // ATTENDU APRÈS CORRECTION : même UID pour la même activité.
    expect(deadlineUid("A26", sansUrl!)).not.toBe(deadlineUid("A26", avecUrl!));
    expect(deadlineUid("A26", avecUrl!)).toContain("studium-6624079");
    expect(deadlineUid("A26", sansUrl!)).toContain("studium-4242-quiz-tp3");
  });
});

// ---------------------------------------------------------------------------
// Axe 2 — fenêtre open/close
// ---------------------------------------------------------------------------

describe("fenêtre open/close", () => {
  it("DÉFAUT CONNU — une URL sur un seul des deux événements sépare le couple et perd la fenêtre", () => {
    // `prepareEvent` calcule la clé de regroupement à partir du cmid *de chaque
    // événement*. Si « s'ouvre » porte l'URL et « se termine » non, les deux
    // partent dans deux groupes : l'open devient orphelin (jeté), le close donne
    // une échéance sans `start`.
    const deadlines = deadlinesFromStudium(quizEvents({ openUrl: true, closeUrl: false }));

    // ATTENDU APRÈS CORRECTION : une échéance avec `start` (le couple recollé
    // par site + nom quand un des deux n'a pas de cmid).
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]?.id).toBe("studium:4242:quiz-tp3");
    expect(deadlines[0]?.start).toBeUndefined(); // fenêtre perdue en silence
  });

  it("l'inverse aussi : URL sur « se termine » seulement", () => {
    const deadlines = deadlinesFromStudium(quizEvents({ openUrl: false, closeUrl: true }));

    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]?.id).toBe("studium:6624079");
    expect(deadlines[0]?.start).toBeUndefined();
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
