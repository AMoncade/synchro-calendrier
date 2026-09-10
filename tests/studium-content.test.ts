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
  captureStudium,
  dedupeEvents,
  flattenMonthlyEvents,
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
      error: "reseau",
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
});
