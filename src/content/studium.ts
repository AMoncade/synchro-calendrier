// Content script : injecté sur https://studium.umontreal.ca (top frame seulement).
// StudiUM est un Moodle 4.x ; on interroge son API AJAX interne
// (`/lib/ajax/service.php`) avec le seul cookie de session, depuis la page —
// donc aucun jeton stocké, aucun onglet caché, aucun fetch depuis le service
// worker (docs/ARCHITECTURE.md §7).
//
// Formes vérifiées sur le source Moodle 4.5 (MOODLE_405_STABLE) :
//   - lib/ajax/service.php : corps = `[{ index, methodname, args }]`, réponse =
//     `json_encode($responses)` où `$responses[$index]` vient de
//     `external_api::call_external_function` → `{ error: false, data }` ou
//     `{ error: true, exception: { errorcode, message } }`.
//   - lib/db/services.php : les deux méthodes utilisées ont `'ajax' => true`.
//   - calendar/externallib.php : `get_calendar_monthly_view(year, month,
//     courseid = SITEID, categoryid, includenavigation, mini, day, view)`.
//   - calendar/classes/external/{month,week,day}_exporter.php : `data.weeks[]`
//     → `days[]` → `events[]` (les jours de bourrage sont des compteurs, pas
//     des entrées de `days`).
//   - course/externallib.php : `get_enrolled_courses_by_timeline_classification(
//     classification, limit, offset, sort, …)` → `{ courses[], nextoffset }`,
//     chaque cours exporté par course_summary_exporter (id, fullname,
//     shortname, idnumber).
//
// Ne journalise jamais la page, ni le `sesskey`, ni les données.

import type { Deadline, RawMoodleEvent, RawStudiumCapture, StudiumCourse } from "../core/model";
import { deadlinesFromStudium, studiumCourses } from "../core/studium";
import type { Message } from "../lib/messages";

const STUDIUM_HOST = "studium.umontreal.ca";
const AJAX_PATH = `https://${STUDIUM_HOST}/lib/ajax/service.php`;

const MONTHLY_VIEW = "core_calendar_get_calendar_monthly_view";
const TIMELINE_COURSES = "core_course_get_enrolled_courses_by_timeline_classification";

/** Mois courant + 4 suivants : l'horizon d'un trimestre, sans noyer le serveur. */
const MONTHS_AHEAD = 4;

/** Anti-rafale : une synchronisation par navigateur au plus toutes les 30 minutes. */
const MIN_INTERVAL_MS = 30 * 60 * 1000;
const LAST_RUN_KEY = "synchro-calendrier.studium-last-run";

/**
 * Message du popup qui force une synchronisation malgré l'anti-rafale.
 * Pas encore déclaré dans `Message` (src/lib/messages.ts appartient à
 * l'intégratrice) : l'ajout est proposé dans le rapport de fin.
 */
const FORCE_SYNC = "STUDIUM_SYNC_NOW";

// ---------------------------------------------------------------------------
// Logique pure — testable sans DOM ni API chrome.
// ---------------------------------------------------------------------------

export interface MonthRef {
  year: number;
  /** 1–12, comme l'attend Moodle (pas l'index de `Date`). */
  month: number;
}

/** Les cinq mois à interroger, à partir de celui de `now`. Passe l'année. */
export function monthsToFetch(now: Date): MonthRef[] {
  const out: MonthRef[] = [];
  for (let i = 0; i <= MONTHS_AHEAD; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return out;
}

/** "2026-12" — la forme attendue par `RawStudiumCapture.months`. */
export function monthKey({ year, month }: MonthRef): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Le `sesskey` de la session Moodle. Le content script est en monde isolé : il
 * ne voit pas `window.M`, il lit donc le DOM — d'abord le lien de déconnexion,
 * sinon la config inline que Moodle écrit dans un `<script>`.
 */
export function readSesskey(doc: Document): string | null {
  const link = doc.querySelector('a[href*="sesskey="]');
  if (link) {
    const fromHref = /[?&]sesskey=([A-Za-z0-9]+)/.exec(link.getAttribute("href") ?? "");
    if (fromHref?.[1]) return fromHref[1];
  }
  for (const script of doc.querySelectorAll("script")) {
    if (script.src) continue;
    const fromConfig = /"sesskey"\s*:\s*"([A-Za-z0-9]+)"/.exec(script.textContent ?? "");
    if (fromConfig?.[1]) return fromConfig[1];
  }
  return null;
}

export function ajaxUrl(sesskey: string, methodname: string): string {
  return `${AJAX_PATH}?sesskey=${encodeURIComponent(sesskey)}&info=${encodeURIComponent(methodname)}`;
}

export function ajaxBody(methodname: string, args: unknown): string {
  return JSON.stringify([{ index: 0, methodname, args }]);
}

export function monthlyViewArgs({ year, month }: MonthRef): Record<string, unknown> {
  return {
    year,
    month,
    courseid: 1, // SITEID : le calendrier de l'utilisateur, tous cours confondus.
    categoryid: 0,
    includenavigation: false,
    mini: false,
    day: 1,
  };
}

export const timelineCoursesArgs: Record<string, unknown> = {
  classification: "inprogress",
  limit: 0,
  offset: 0,
  sort: "fullname",
};

export type AjaxOutcome = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Démêle l'enveloppe de `service.php`. Un `error: true` porte le code Moodle
 * (`invalidsesskey`, …) ; on ne relance jamais, la cause est côté session.
 */
export function readAjaxPayload(payload: unknown): AjaxOutcome {
  const first = Array.isArray(payload) ? payload[0] : undefined;
  if (!first || typeof first !== "object") return { ok: false, error: "reponse-illisible" };
  const response = first as { error?: unknown; data?: unknown; exception?: { errorcode?: unknown } };
  if (response.error) {
    const code = response.exception?.errorcode;
    return { ok: false, error: typeof code === "string" && code !== "" ? code : "erreur-moodle" };
  }
  return { ok: true, data: response.data };
}

/** `data.weeks[].days[].events[]` → une liste plate, en ignorant tout ce qui détonne. */
export function flattenMonthlyEvents(data: unknown): RawMoodleEvent[] {
  const weeks = (data as { weeks?: unknown } | null | undefined)?.weeks;
  if (!Array.isArray(weeks)) return [];
  const out: RawMoodleEvent[] = [];
  for (const week of weeks) {
    const days = (week as { days?: unknown } | null)?.days;
    if (!Array.isArray(days)) continue;
    for (const day of days) {
      const events = (day as { events?: unknown } | null)?.events;
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        if (event && typeof event === "object") out.push(event as RawMoodleEvent);
      }
    }
  }
  return out;
}

/** Deux mois qui se recouvriraient ne doivent pas produire deux fois l'événement. */
export function dedupeEvents(events: RawMoodleEvent[]): RawMoodleEvent[] {
  const seen = new Set<number>();
  const out: RawMoodleEvent[] = [];
  for (const event of events) {
    if (typeof event.id === "number") {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
    }
    out.push(event);
  }
  return out;
}

export function readCourses(data: unknown): RawStudiumCapture["courses"] {
  const list = (data as { courses?: unknown } | null | undefined)?.courses;
  if (!Array.isArray(list)) return [];
  const out: RawStudiumCapture["courses"] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const course = entry as {
      id?: unknown;
      shortname?: unknown;
      fullname?: unknown;
      idnumber?: unknown;
    };
    if (typeof course.id !== "number") continue;
    if (typeof course.shortname !== "string" || typeof course.fullname !== "string") continue;
    out.push({
      id: course.id,
      shortname: course.shortname,
      fullname: course.fullname,
      idnumber: typeof course.idnumber === "string" ? course.idnumber : undefined,
    });
  }
  return out;
}

/** `true` tant que la dernière synchronisation date de moins de 30 minutes. */
export function isThrottled(lastRun: unknown, nowMs: number): boolean {
  if (typeof lastRun !== "number" || !Number.isFinite(lastRun)) return false;
  return nowMs - lastRun < MIN_INTERVAL_MS;
}

/**
 * Instant local "AAAA-MM-JJTHH:MM". Copie délibérée de `localNow()` de
 * background/index.ts : ce fichier appartient à l'intégratrice, un content
 * script ne l'importe pas.
 */
export function localNow(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Capture — la seule dépendance est un `fetch` injecté.
// ---------------------------------------------------------------------------

export interface StudiumResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type StudiumFetch = (url: string, init: RequestInit) => Promise<StudiumResponse>;

export type CaptureOutcome = { ok: true; capture: RawStudiumCapture } | { ok: false; error: string };

async function callMoodle(
  doFetch: StudiumFetch,
  sesskey: string,
  methodname: string,
  args: unknown,
): Promise<AjaxOutcome> {
  let response: StudiumResponse;
  try {
    response = await doFetch(ajaxUrl(sesskey, methodname), {
      method: "POST",
      // Même origine que la page : le cookie de session part tout seul.
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: ajaxBody(methodname, args),
    });
  } catch {
    return { ok: false, error: "reseau" };
  }
  if (!response.ok) return { ok: false, error: `http-${response.status}` };
  try {
    return readAjaxPayload(await response.json());
  } catch {
    return { ok: false, error: "reponse-illisible" };
  }
}

/**
 * Cinq vues mensuelles puis la liste des sites, **un appel à la fois**. Le
 * premier échec arrête tout : une session expirée ne se répare pas en insistant.
 */
export async function captureStudium(
  doFetch: StudiumFetch,
  sesskey: string,
  now: Date,
): Promise<CaptureOutcome> {
  const months = monthsToFetch(now);
  const events: RawMoodleEvent[] = [];
  for (const month of months) {
    const outcome = await callMoodle(doFetch, sesskey, MONTHLY_VIEW, monthlyViewArgs(month));
    if (!outcome.ok) return { ok: false, error: outcome.error };
    events.push(...flattenMonthlyEvents(outcome.data));
  }
  const courses = await callMoodle(doFetch, sesskey, TIMELINE_COURSES, timelineCoursesArgs);
  if (!courses.ok) return { ok: false, error: courses.error };
  return {
    ok: true,
    capture: {
      months: months.map(monthKey),
      events: dedupeEvents(events),
      courses: readCourses(courses.data),
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestration — testable par injection, sans DOM ni API chrome.
// ---------------------------------------------------------------------------

export interface SyncEnv {
  now(): Date;
  fetch: StudiumFetch;
  /** Le `sesskey` lu sur la page, ou `null` s'il est introuvable. */
  sesskey(): string | null;
  send(message: Message): void;
  readLastRun(): Promise<unknown>;
  writeLastRun(atMs: number): Promise<void>;
}

export function syncedMessage(
  deadlines: Deadline[],
  courses: StudiumCourse[],
  syncedAt: string,
): Message {
  return { type: "STUDIUM_SYNCED", deadlines, courses, syncedAt };
}

export function failedMessage(error: string, at: string): Message {
  return { type: "STUDIUM_FAILED", error, at };
}

export async function runSync(env: SyncEnv, options: { force: boolean }): Promise<void> {
  const sesskey = env.sesskey();
  if (sesskey === null) {
    env.send(failedMessage("sesskey-absent", localNow(env.now())));
    return;
  }

  const startedAt = env.now();
  if (!options.force && isThrottled(await env.readLastRun(), startedAt.getTime())) return;
  // Marqué avant les appels : un échec ne doit pas non plus repartir à chaque
  // page StudiUM ouverte. Le popup garde la main avec STUDIUM_SYNC_NOW.
  await env.writeLastRun(startedAt.getTime());

  const outcome = await captureStudium(env.fetch, sesskey, startedAt);
  if (!outcome.ok) {
    env.send(failedMessage(outcome.error, localNow(env.now())));
    return;
  }
  env.send(
    syncedMessage(
      deadlinesFromStudium(outcome.capture),
      studiumCourses(outcome.capture),
      localNow(env.now()),
    ),
  );
}

// ---------------------------------------------------------------------------
// main() — la seule partie qui touche le DOM, chrome.* et le réseau réel.
// ---------------------------------------------------------------------------

/** Top frame de StudiUM uniquement : rien à faire dans une iframe ni ailleurs. */
export function shouldRun(win: Window): boolean {
  return win.top === win && win.location.hostname === STUDIUM_HOST;
}

function browserEnv(): SyncEnv {
  return {
    now: () => new Date(),
    fetch: (url, init) => fetch(url, init),
    sesskey: () => readSesskey(document),
    send: (message) => {
      chrome.runtime.sendMessage(message).catch(() => {
        // Service worker indisponible (extension rechargée) : la prochaine
        // visite, ou un STUDIUM_SYNC_NOW, réessaiera.
      });
    },
    readLastRun: async () => (await chrome.storage.local.get(LAST_RUN_KEY))[LAST_RUN_KEY],
    writeLastRun: async (atMs) => chrome.storage.local.set({ [LAST_RUN_KEY]: atMs }),
  };
}

function main(): void {
  const env = browserEnv();
  let running = false;

  const sync = (force: boolean): void => {
    if (running) return;
    running = true;
    void runSync(env, { force }).finally(() => {
      running = false;
    });
  };

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if ((message as { type?: unknown } | null)?.type === FORCE_SYNC) sync(true);
  });

  sync(false);
}

if (shouldRun(window)) main();
