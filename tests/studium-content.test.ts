// Content script StudiUM : tout ce qui est testable hors DOM et hors chrome.*.
//
// Le module s'importe sans effet de bord : `main()` n'est appelé que si
// `shouldRun(window)` est vrai, et happy-dom sert la page sur localhost, pas sur
// studium.umontreal.ca. Le réseau passe par `vi.stubGlobal("fetch", …)` et par
// le même `(url, init) => fetch(url, init)` que `browserEnv()`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../src/lib/messages";
import {
  ajaxBody,
  ajaxUrl,
  captureGrades,
  captureStudium,
  dedupeEvents,
  flattenMonthlyEvents,
  gradeReportUrl,
  isThrottled,
  localNow,
  monthKey,
  monthlyViewArgs,
  monthsToFetch,
  readAjaxPayload,
  readCourses,
  readSesskey,
  runSync,
  shouldRun,
  takeForceNext,
  timelineCoursesArgs,
  type StudiumFetch,
  type SyncEnv,
} from "../src/content/studium";

const SESSKEY = "aBc123XyZ";
const MONTHLY = "core_calendar_get_calendar_monthly_view";
const TIMELINE = "core_course_get_enrolled_courses_by_timeline_classification";

/** Le même passe-plat que `browserEnv()` : ce qui est stubé globalement est utilisé. */
const doFetch: StudiumFetch = (url, init) => fetch(url, init);

function docFrom(html: string): Document {
  const doc = document.implementation.createHTMLDocument("test");
  doc.body.innerHTML = html;
  return doc;
}

/** Une vue mensuelle Moodle minimale : weeks → days → events. */
function monthlyView(events: Array<Record<string, unknown>>): unknown {
  return {
    weeks: [
      { days: [{ events: [] }, { events: events.slice(0, 1) }] },
      { days: [{ events: events.slice(1) }] },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("monthsToFetch", () => {
  it("rend le mois courant et les quatre suivants", () => {
    expect(monthsToFetch(new Date(2026, 8, 10))).toEqual([
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
  });

  it("passe à l'année suivante à partir de décembre", () => {
    expect(monthsToFetch(new Date(2026, 11, 31))).toEqual([
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
      { year: 2027, month: 3 },
      { year: 2027, month: 4 },
    ]);
  });

  it("ne dérape pas depuis le 31 d'un mois vers un mois plus court", () => {
    // Le 31 janvier + 1 mois donnerait le 2 ou 3 mars avec une addition naïve.
    expect(monthsToFetch(new Date(2027, 0, 31)).map(monthKey)).toEqual([
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
    ]);
  });
});

describe("readSesskey", () => {
  it("le lit dans le lien de déconnexion", () => {
    const doc = docFrom(`<a href="/login/logout.php?sesskey=${SESSKEY}">Déconnexion</a>`);
    expect(readSesskey(doc)).toBe(SESSKEY);
  });

  it("retombe sur la config inline quand aucun lien ne le porte", () => {
    const doc = docFrom(
      `<script>M.cfg = {"wwwroot":"https://studium.umontreal.ca","sesskey":"${SESSKEY}","contextid":2};</script>`,
    );
    expect(readSesskey(doc)).toBe(SESSKEY);
  });

  it("préfère le lien à la config inline", () => {
    const doc = docFrom(
      `<a href="/login/logout.php?sesskey=LIEN00000">Déconnexion</a>` +
        `<script>var cfg = {"sesskey":"SCRIPT0000"};</script>`,
    );
    expect(readSesskey(doc)).toBe("LIEN00000");
  });

  it("rend null quand la page n'en porte aucun", () => {
    expect(readSesskey(docFrom(`<div id="page">Bienvenue sur StudiUM</div>`))).toBeNull();
  });
});

describe("readAjaxPayload", () => {
  it("déballe une réponse normale", () => {
    expect(readAjaxPayload([{ error: false, data: { weeks: [] } }])).toEqual({
      ok: true,
      data: { weeks: [] },
    });
  });

  it("rend le code Moodle d'une session expirée", () => {
    const payload = [
      {
        error: true,
        exception: {
          message: "Invalid session key",
          errorcode: "invalidsesskey",
        },
      },
    ];
    expect(readAjaxPayload(payload)).toEqual({ ok: false, error: "invalidsesskey" });
  });

  it("se rabat sur un code générique si l'exception n'en porte pas", () => {
    expect(readAjaxPayload([{ error: true, exception: {} }])).toEqual({
      ok: false,
      error: "erreur-moodle",
    });
  });

  it("refuse une enveloppe qui n'est pas un tableau", () => {
    expect(readAjaxPayload({ error: false, data: {} })).toEqual({
      ok: false,
      error: "reponse-illisible",
    });
  });
});

describe("flattenMonthlyEvents", () => {
  it("aplatit weeks → days → events dans l'ordre", () => {
    const data = monthlyView([{ id: 1, name: "Quiz-tp1 se ferme" }, { id: 2 }, { id: 3 }]);
    expect(flattenMonthlyEvents(data).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("rend une liste vide sur une forme inattendue", () => {
    expect(flattenMonthlyEvents(undefined)).toEqual([]);
    expect(flattenMonthlyEvents({})).toEqual([]);
    expect(flattenMonthlyEvents({ weeks: [{}, { days: [{}, { events: "non" }] }] })).toEqual([]);
  });

  it("dédoublonne par id quand deux mois se recouvrent", () => {
    const events = [{ id: 7 }, { id: 8 }, { id: 7 }] as ReturnType<typeof flattenMonthlyEvents>;
    expect(dedupeEvents(events).map((e) => e.id)).toEqual([7, 8]);
  });
});

describe("readCourses", () => {
  it("garde les sites bien formés et l'idnumber vide des sites -AB", () => {
    const data = {
      courses: [
        { id: 349955, shortname: "MAT1400-A-A26", fullname: "Calcul 1", idnumber: "MAT1400-A-A26" },
        { id: 366020, shortname: "MAT1400-AB-A26", fullname: "Calcul 1 — TP" },
        { id: "nope", shortname: "X", fullname: "Y" },
      ],
      nextoffset: 3,
    };
    expect(readCourses(data)).toEqual([
      { id: 349955, shortname: "MAT1400-A-A26", fullname: "Calcul 1", idnumber: "MAT1400-A-A26" },
      { id: 366020, shortname: "MAT1400-AB-A26", fullname: "Calcul 1 — TP", idnumber: undefined },
    ]);
  });
});

describe("anti-rafale et instant local", () => {
  it("bloque sous 30 minutes, laisse passer au-delà", () => {
    const now = 1_800_000_000_000;
    expect(isThrottled(now - 29 * 60 * 1000, now)).toBe(true);
    expect(isThrottled(now - 31 * 60 * 1000, now)).toBe(false);
    expect(isThrottled(undefined, now)).toBe(false);
    expect(isThrottled("hier", now)).toBe(false);
  });

  it("formate l'instant local sans secondes ni fuseau", () => {
    expect(localNow(new Date(2026, 8, 10, 7, 5))).toBe("2026-09-10T07:05");
  });
});

describe("shouldRun", () => {
  /** `isTop` faux : `top` pointe ailleurs, comme dans une iframe. */
  const win = (hostname: string, isTop: boolean): Window => {
    const w = { location: { hostname } } as unknown as Window;
    (w as { top: unknown }).top = isTop ? w : ({} as Window);
    return w;
  };

  it("ne tourne que sur le top frame de StudiUM", () => {
    expect(shouldRun(win("studium.umontreal.ca", true))).toBe(true);
    expect(shouldRun(win("studium.umontreal.ca", false))).toBe(false);
    expect(shouldRun(win("exemple.com", true))).toBe(false);
  });

  it("laisse le module s'importer sans rien lancer sous happy-dom", () => {
    expect(shouldRun(window)).toBe(false);
  });
});

describe("captureStudium", () => {
  it("appelle cinq mois puis les sites, un à la fois, avec la bonne URL et le bon corps", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const stub = vi.fn(async (url: string, init: RequestInit) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push({ url, body: JSON.parse(String(init.body)) });
      await Promise.resolve();
      inFlight -= 1;
      const isCourses = url.includes(TIMELINE);
      return jsonResponse([
        {
          error: false,
          data: isCourses
            ? { courses: [{ id: 1, shortname: "MAT1400-A-A26", fullname: "Calcul 1" }] }
            : monthlyView([{ id: calls.length }]),
        },
      ]);
    });
    vi.stubGlobal("fetch", stub);

    const outcome = await captureStudium(doFetch, SESSKEY, new Date(2026, 8, 10));

    expect(stub).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBe(1); // séquentiel : jamais deux appels en vol.

    const monthly = calls.slice(0, 5);
    expect(monthly.map((c) => c.url)).toEqual(Array(5).fill(ajaxUrl(SESSKEY, MONTHLY)));
    expect(monthly.map((c) => (c.body as Array<{ args: unknown }>)[0]?.args)).toEqual([
      monthlyViewArgs({ year: 2026, month: 9 }),
      monthlyViewArgs({ year: 2026, month: 10 }),
      monthlyViewArgs({ year: 2026, month: 11 }),
      monthlyViewArgs({ year: 2026, month: 12 }),
      monthlyViewArgs({ year: 2027, month: 1 }),
    ]);
    expect(monthly[0]?.body).toEqual(
      JSON.parse(ajaxBody(MONTHLY, monthlyViewArgs({ year: 2026, month: 9 }))),
    );

    expect(calls[5]?.url).toBe(ajaxUrl(SESSKEY, TIMELINE));
    expect(calls[5]?.body).toEqual(JSON.parse(ajaxBody(TIMELINE, timelineCoursesArgs)));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.capture.months).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
    expect(outcome.capture.events.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    expect(outcome.capture.courses).toHaveLength(1);
  });

  it("s'arrête au premier mois en erreur, sans relancer ni appeler les sites", async () => {
    const stub = vi.fn(async (url: string) =>
      url.includes(TIMELINE)
        ? jsonResponse([{ error: false, data: { courses: [] } }])
        : jsonResponse([{ error: true, exception: { errorcode: "invalidsesskey" } }]),
    );
    vi.stubGlobal("fetch", stub);

    await expect(captureStudium(doFetch, SESSKEY, new Date(2026, 8, 10))).resolves.toEqual({
      ok: false,
      error: "invalidsesskey",
    });
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("rend http-<status> sur une réponse non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 403)));
    await expect(captureStudium(doFetch, SESSKEY, new Date(2026, 8, 10))).resolves.toEqual({
      ok: false,
      error: "http-403",
    });
  });

  it("rend « reseau » quand le fetch lui-même échoue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(captureStudium(doFetch, SESSKEY, new Date(2026, 8, 10))).resolves.toEqual({
      ok: false,
      error: "reseau (TypeError: Failed to fetch)",
    });
  });
});

describe("runSync", () => {
  function envWith(overrides: Partial<SyncEnv> = {}): { env: SyncEnv; sent: Message[]; runs: number[] } {
    const sent: Message[] = [];
    const runs: number[] = [];
    const env: SyncEnv = {
      now: () => new Date(2026, 8, 10, 7, 5),
      fetch: doFetch,
      sesskey: () => SESSKEY,
      send: (message) => sent.push(message),
      readLastRun: async () => undefined,
      writeLastRun: async (atMs) => void runs.push(atMs),
      readForceNext: async () => undefined,
      clearForceNext: async () => {},
      // Par défaut : pas d'opt-in, donc aucune requête vers les carnets. Un test
      // qui veut des notes doit le demander explicitement, comme l'utilisateur.
      readGradesOptIn: async () => undefined,
      fetchText: async () => ({ ok: false, status: 404, text: async () => "" }),
      ...overrides,
    };
    return { env, sent, runs };
  }

  it("envoie STUDIUM_FAILED sur HTTP 403", async () => {
    const stub = vi.fn(async () => jsonResponse({}, 403));
    vi.stubGlobal("fetch", stub);

    const { env, sent } = envWith();
    await runSync(env, { force: false });

    expect(sent).toEqual([
      { type: "STUDIUM_FAILED", error: "http-403", at: "2026-09-10T07:05" },
    ]);
  });

  it("envoie STUDIUM_FAILED { sesskey-absent } sans toucher au réseau", async () => {
    const stub = vi.fn();
    vi.stubGlobal("fetch", stub);

    const { env, sent, runs } = envWith({ sesskey: () => null });
    await runSync(env, { force: false });

    expect(sent).toEqual([
      { type: "STUDIUM_FAILED", error: "sesskey-absent", at: "2026-09-10T07:05" },
    ]);
    expect(stub).not.toHaveBeenCalled();
    expect(runs).toEqual([]); // rien à marquer : aucune synchronisation n'a eu lieu.
  });

  it("envoie STUDIUM_SYNCED avec l'heure locale quand tout passe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        jsonResponse([
          {
            error: false,
            data: url.includes(TIMELINE) ? { courses: [] } : monthlyView([{ id: 1 }]),
          },
        ]),
      ),
    );

    const { env, sent, runs } = envWith();
    await runSync(env, { force: false });

    expect(sent).toEqual([
      // `deadlines` et `courses` sont vides : core/studium.ts est un stub sur
      // cette branche, la session studium-parse fournit le vrai module.
      { type: "STUDIUM_SYNCED", deadlines: [], courses: [], syncedAt: "2026-09-10T07:05" },
    ]);
    expect(runs).toEqual([new Date(2026, 8, 10, 7, 5).getTime()]);
  });

  it("ne synchronise pas deux fois en moins de 30 minutes", async () => {
    const stub = vi.fn();
    vi.stubGlobal("fetch", stub);
    const recent = new Date(2026, 8, 10, 6, 50).getTime();

    const { env, sent } = envWith({ readLastRun: async () => recent });
    await runSync(env, { force: false });

    expect(stub).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("STUDIUM_SYNC_NOW force la synchronisation malgré l'anti-rafale", async () => {
    const stub = vi.fn(async (url: string) =>
      jsonResponse([
        { error: false, data: url.includes(TIMELINE) ? { courses: [] } : monthlyView([]) },
      ]),
    );
    vi.stubGlobal("fetch", stub);
    const recent = new Date(2026, 8, 10, 6, 50).getTime();

    const { env, sent } = envWith({ readLastRun: async () => recent });
    await runSync(env, { force: true });

    expect(stub).toHaveBeenCalledTimes(6);
    expect(sent[0]?.type).toBe("STUDIUM_SYNCED");
  });

  describe("drapeau studium-force-next", () => {
    /** Le popup meurt à `tabs.create` : il pose le drapeau au lieu d'envoyer un message. */
    it("consomme le drapeau et retire la clé", async () => {
      const cleared: string[] = [];
      const { env } = envWith({
        readForceNext: async () => true,
        clearForceNext: async () => void cleared.push("clear"),
      });

      await expect(takeForceNext(env)).resolves.toBe(true);
      expect(cleared).toEqual(["clear"]);
    });

    it("ne retire rien quand le drapeau est absent", async () => {
      const cleared: string[] = [];
      const { env } = envWith({
        readForceNext: async () => undefined,
        clearForceNext: async () => void cleared.push("clear"),
      });

      await expect(takeForceNext(env)).resolves.toBe(false);
      expect(cleared).toEqual([]);
    });

    it("n'accepte que le booléen true, pas une valeur qui lui ressemble", async () => {
      for (const value of ["true", 1, false, null, {}]) {
        const { env } = envWith({ readForceNext: async () => value });
        await expect(takeForceNext(env)).resolves.toBe(false);
      }
    });

    it("retire la clé AVANT de synchroniser, et contourne l'anti-rafale", async () => {
      const order: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          order.push("fetch");
          return jsonResponse([
            { error: false, data: url.includes(TIMELINE) ? { courses: [] } : monthlyView([]) },
          ]);
        }),
      );
      const recent = new Date(2026, 8, 10, 6, 50).getTime();
      const { env, sent } = envWith({
        readLastRun: async () => recent,
        readForceNext: async () => true,
        clearForceNext: async () => void order.push("clear"),
      });

      // Exactement l'enchaînement de `main()` : consommer, puis synchroniser.
      await runSync(env, { force: await takeForceNext(env) });

      expect(order[0]).toBe("clear");
      expect(order.filter((step) => step === "fetch")).toHaveLength(6);
      // Le tampon datait de 15 min : sans le drapeau, rien ne serait parti.
      expect(sent[0]?.type).toBe("STUDIUM_SYNCED");
    });

    it("laisse l'anti-rafale étouffer la synchro quand le drapeau manque", async () => {
      const stub = vi.fn();
      vi.stubGlobal("fetch", stub);
      const recent = new Date(2026, 8, 10, 6, 50).getTime();
      const { env, sent } = envWith({ readLastRun: async () => recent });

      await runSync(env, { force: await takeForceNext(env) });

      expect(stub).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    });
  });

  describe("moment où le tampon s'écrit", () => {
    const STARTED_AT = new Date(2026, 8, 10, 7, 5).getTime();
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    it("un run interrompu en plein fetch ne laisse aucun tampon", async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const stub = vi.fn(async (url: string) => {
        await held;
        return jsonResponse([
          { error: false, data: url.includes(TIMELINE) ? { courses: [] } : monthlyView([]) },
        ]);
      });
      vi.stubGlobal("fetch", stub);

      const { env, sent, runs } = envWith();
      const inFlight = runSync(env, { force: false });
      await tick();

      // C'est ici que la page navigue. Le contexte du content script est détruit :
      // aucun `catch`, aucun `finally`, plus une ligne ne s'exécute. Ce que le
      // storage contient à cet instant est tout ce que la page suivante verra —
      // et ce doit être rien, sinon elle est étouffée 30 min sans un message.
      expect(stub).toHaveBeenCalledTimes(1);
      expect(runs).toEqual([]);
      expect(sent).toEqual([]);

      // Sans navigation, le run va au bout et pose son tampon normalement.
      release();
      await inFlight;
      expect(runs).toEqual([STARTED_AT]);
    });

    it("pose le tampon à la fin d'un échec HTTP, qui ne se relance pas", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 403)));

      const { env, sent, runs } = envWith();
      await runSync(env, { force: false });

      // Un 403 n'est pas une erreur réseau : pas de relance, mais le run est
      // allé au bout, donc le tampon protège le serveur d'une rafale.
      expect(sent[0]).toEqual({
        type: "STUDIUM_FAILED",
        error: "http-403",
        at: "2026-09-10T07:05",
      });
      expect(runs).toEqual([STARTED_AT]);
    });

    it("pose un seul tampon après une relance réseau elle aussi infructueuse", async () => {
      const stub = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      vi.stubGlobal("fetch", stub);

      const { env, sent, runs } = envWith({ retryDelayMs: 0 });
      await runSync(env, { force: false });

      expect(stub).toHaveBeenCalledTimes(2); // premier essai + une relance, pas plus
      expect(runs).toEqual([STARTED_AT]); // un seul tampon, posé après la relance
      expect(sent[0]?.type).toBe("STUDIUM_FAILED");
    });

    it("DÉLIBÉRÉ : deux onglets ouverts ensemble synchronisent tous les deux", async () => {
      // Contrepartie assumée du tampon écrit en fin de run (WORKLOG 2026-09-10).
      // `chrome.storage` n'offre pas de lecture-écriture atomique, et la fenêtre
      // entre la lecture et l'écriture dure désormais toute la capture. Deux
      // onglets StudiUM restaurés ensemble font donc 12 requêtes au lieu de 6.
      //
      // Ce test FIGE ce comportement pour qu'il ne soit pas « corrigé » sans voir
      // qu'il est choisi : l'alternative — écrire le tampon avant les appels —
      // rouvrait une zone morte de 30 min, silencieuse et sans erreur, sur toute
      // page qui navigue pendant le fetch. Le doublon est en lecture seule et
      // rare ; la zone morte cassait la fonction. Si un marqueur « run en cours »
      // est ajouté un jour, c'est ce test-ci qui doit changer, délibérément.
      const stub = vi.fn(async (url: string) =>
        jsonResponse([
          { error: false, data: url.includes(TIMELINE) ? { courses: [] } : monthlyView([]) },
        ]),
      );
      vi.stubGlobal("fetch", stub);

      // Un seul storage pour les deux onglets, comme dans le vrai navigateur.
      let tampon: number | undefined;
      const shared = {
        readLastRun: async () => tampon,
        writeLastRun: async (atMs: number) => void (tampon = atMs),
      };
      const ongletA = envWith(shared);
      const ongletB = envWith(shared);

      await Promise.all([
        runSync(ongletA.env, { force: false }),
        runSync(ongletB.env, { force: false }),
      ]);

      expect(stub).toHaveBeenCalledTimes(12); // 6 + 6 : les deux ont lu avant que l'un écrive
      expect(ongletA.sent[0]?.type).toBe("STUDIUM_SYNCED");
      expect(ongletB.sent[0]?.type).toBe("STUDIUM_SYNCED");

      // La course tient à la simultanéité, pas à un tampon inopérant : un
      // troisième onglet qui arrive après coup est bien étouffé.
      const ongletC = envWith(shared);
      await runSync(ongletC.env, { force: false });
      expect(stub).toHaveBeenCalledTimes(12);
      expect(ongletC.sent).toEqual([]);
    });
  });

  describe("carnets de notes (opt-in)", () => {
    const COURSES = [
      { id: 349955, shortname: "MAT1400-A-A26", fullname: "Calcul 1", courseCode: "MAT1400" },
      { id: 366020, shortname: "MAT1400-AB-A26", fullname: "Calcul 1 — TP" },
      { id: 355495, shortname: "STT1700-A-A26", fullname: "Statistiques" },
    ];

    /** L'API AJAX rend les trois sites ; c'est `studiumCourses` qui est stubé à []. */
    function calendarOk(): ReturnType<typeof vi.fn> {
      return vi.fn(async (url: string) =>
        jsonResponse([
          {
            error: false,
            data: url.includes(TIMELINE) ? { courses: COURSES } : monthlyView([]),
          },
        ]),
      );
    }

    /** Un `fetchText` qui journalise les URL demandées et rend le statut voulu. */
    function textFetch(status: (id: string) => number = () => 200) {
      const urls: string[] = [];
      let inFlight = 0;
      let maxInFlight = 0;
      const fetchText = async (url: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        urls.push(url);
        await Promise.resolve();
        inFlight -= 1;
        const id = new URL(url).searchParams.get("id") ?? "";
        const code = status(id);
        return { ok: code >= 200 && code < 300, status: code, text: async () => `<html>${id}` };
      };
      return { fetchText, urls, maxInFlight: () => maxInFlight };
    }

    it("sans opt-in, aucune requête ne part vers /grade/", async () => {
      vi.stubGlobal("fetch", calendarOk());
      const grades = textFetch();
      const { env, sent } = envWith({ fetchText: grades.fetchText });

      await runSync(env, { force: false });

      expect(grades.urls).toEqual([]);
      expect(sent.map((m) => m.type)).toEqual(["STUDIUM_SYNCED"]);
    });

    it("la chaîne \"true\" ne vaut pas opt-in", async () => {
      vi.stubGlobal("fetch", calendarOk());
      const grades = textFetch();
      const { env, sent } = envWith({
        fetchText: grades.fetchText,
        readGradesOptIn: async () => "true",
      });

      await runSync(env, { force: false });

      expect(grades.urls).toEqual([]);
      expect(sent.map((m) => m.type)).toEqual(["STUDIUM_SYNCED"]);
    });

    it("un storage illisible vaut « pas d'opt-in », jamais l'inverse", async () => {
      vi.stubGlobal("fetch", calendarOk());
      const grades = textFetch();
      const { env, sent } = envWith({
        fetchText: grades.fetchText,
        readGradesOptIn: async () => {
          throw new Error("storage indisponible");
        },
      });

      await runSync(env, { force: false });

      expect(grades.urls).toEqual([]);
      expect(sent.map((m) => m.type)).toEqual(["STUDIUM_SYNCED"]);
    });

    it("avec opt-in : un GET par site, séquentiel, après le message calendrier", async () => {
      vi.stubGlobal("fetch", calendarOk());
      const grades = textFetch();
      const { env, sent } = envWith({
        fetchText: grades.fetchText,
        readGradesOptIn: async () => true,
      });

      await runSync(env, { force: false });

      expect(grades.urls).toEqual([
        gradeReportUrl(349955),
        gradeReportUrl(366020),
        gradeReportUrl(355495),
      ]);
      expect(grades.maxInFlight()).toBe(1); // un carnet à la fois, comme les mois
      // Le calendrier passe en premier : il ne doit jamais attendre les carnets.
      expect(sent.map((m) => m.type)).toEqual(["STUDIUM_SYNCED", "STUDIUM_GRADES_SYNCED"]);
    });

    it("aucune URL construite ne porte userid= ni sesskey=", async () => {
      // Le parseur de `core/grades` refuse déjà ces liens ; cette couche-ci ne doit
      // pas non plus en fabriquer. Seul le `courseid` a le droit d'y figurer.
      const url = gradeReportUrl(366020);
      expect(url).toBe("https://studium.umontreal.ca/grade/report/user/index.php?id=366020");
      expect(url).not.toMatch(/userid=|sesskey=|authtoken=/);
    });

    it("un site en 403 n'empêche pas les autres", async () => {
      vi.stubGlobal("fetch", calendarOk());
      const grades = textFetch((id) => (id === "366020" ? 403 : 200));
      const { env, sent } = envWith({
        fetchText: grades.fetchText,
        readGradesOptIn: async () => true,
      });

      await runSync(env, { force: false });

      expect(grades.urls).toHaveLength(3); // les trois sont bien tentés
      expect(sent.map((m) => m.type)).toEqual(["STUDIUM_SYNCED", "STUDIUM_GRADES_SYNCED"]);
    });

    it("un site qui jette sur le réseau n'empêche pas les autres", async () => {
      vi.stubGlobal("fetch", calendarOk());
      const seen: string[] = [];
      const { env, sent } = envWith({
        readGradesOptIn: async () => true,
        fetchText: async (url: string) => {
          seen.push(url);
          if (url.includes("366020")) throw new TypeError("Failed to fetch");
          return { ok: true, status: 200, text: async () => "<html>" };
        },
      });

      await runSync(env, { force: false });

      expect(seen).toHaveLength(3);
      expect(sent.map((m) => m.type)).toEqual(["STUDIUM_SYNCED", "STUDIUM_GRADES_SYNCED"]);
    });

    it("le message part même sans aucun carnet lisible, pour que le popup le dise", async () => {
      vi.stubGlobal("fetch", calendarOk());
      const grades = textFetch(() => 404);
      const { env, sent } = envWith({
        fetchText: grades.fetchText,
        readGradesOptIn: async () => true,
      });

      await runSync(env, { force: false });

      expect(sent[1]).toEqual({
        type: "STUDIUM_GRADES_SYNCED",
        reports: [],
        syncedAt: "2026-09-10T07:05",
      });
    });

    it("captureGrades saute un site dont le parseur jette", async () => {
      // `core/grades` est écrit par une autre session : une page inattendue ne doit
      // pas emporter les carnets déjà lus. Le stub local rend `undefined` partout,
      // donc on éprouve ici la tolérance de la boucle, pas le parseur.
      const seen: string[] = [];
      const reports = await captureGrades(async (url: string) => {
        seen.push(url);
        return { ok: true, status: 200, text: async () => "<html>" };
      }, COURSES);

      expect(seen).toHaveLength(3);
      expect(reports).toEqual([]); // stub : aucun carnet reconnu, aucune exception
    });

    it("aucune synchro calendrier échouée ne déclenche de lecture de carnets", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 403)));
      const grades = textFetch();
      const { env, sent } = envWith({
        fetchText: grades.fetchText,
        readGradesOptIn: async () => true,
      });

      await runSync(env, { force: false });

      expect(grades.urls).toEqual([]);
      expect(sent.map((m) => m.type)).toEqual(["STUDIUM_FAILED"]);
    });
  });
});
