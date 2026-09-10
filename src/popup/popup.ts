// Popup v2 : trois onglets (Aujourd'hui, Semaine, Examens), pied de page fixe,
// menu, repli « coller un horaire » visible seulement quand la capture manque.
// Tout le calcul vient de core/ et format/ ; ici il n'y a que du rendu, des
// messages et un peu d'état d'interface (onglet courant, sections dépliées).
// Aucun symbole Unicode décoratif : la police du popup ne les rend pas (voir icons.ts).

import { excludedDates, getTermCalendar } from "../core/calendar-udem";
import { classesRemainingToday, examClusters, minutesOfTime } from "../core/alerts";
import { findConflicts } from "../core/conflicts";
import { allDeadlines, deadlineStatus, deadlinesOn, isDone, resolveCourseCode, upcomingDeadlines, validateManual } from "../core/deadlines";
import { addDays, expandSchedule } from "../core/expand";
import { googleCalendarUrl } from "../core/gcal";
import { generateIcs } from "../core/ics";
import type { Deadline, DeadlineKind, Exam, Occurrence, Schedule } from "../core/model";
import { parsePasted } from "../core/parse";
import { currentTerm } from "../core/store";
import { buildTodayView, type TodayItem, type TodayView } from "../core/today";
import {
  componentName,
  dayMonthShort,
  daysUntil,
  formatDaysUntil,
  formatLocation,
  formatMinutes,
  fullDateTime,
  fullLocation,
  isoWeekday,
  longDate,
  parseLocation,
  relativeTime,
  shortDate,
  sigle,
  weekdayName,
} from "../format";
import { GRADES_OPT_IN_KEY, type Message, type StoredState } from "../lib/messages";
import type { GradeItem, GradeReport } from "../core/model";
import { bullet, icon } from "./icons";

const SYNCHRO_URL = "https://academique-dmz.synchro.umontreal.ca/";
const REPORT_URL = "https://github.com/AMoncade/synchro-calendrier/issues/new";
const CAMPUS_MAP_URL = "https://plancampus.umontreal.ca/montreal/";
const STUDIUM_URL = "https://studium.umontreal.ca/my/";
/** Lu par content/studium.ts au démarrage : force la synchro malgré l'anti-rafale (contrat adrie-07, 2026-09-10). */
const STUDIUM_FORCE_KEY = "synchro-calendrier.studium-force-next";
/** Échéances annoncées sous Aujourd'hui : les N prochains jours. */
const DEADLINE_HORIZON_DAYS = 7;
const UI_KEY = "synchro-calendrier.ui";
const TAB_RESET_MS = 4 * 3600 * 1000;
const REFRESH_MS = 30_000;
/** « dans N j » n'est affiché que sous cet horizon ; au-delà, la date suffit. */
const DAYS_LEFT_HORIZON = 45;
/** Aperçu « le reste de la semaine » sous l'onglet Aujourd'hui. */
const PREVIEW_MAX = 4;

/**
 * Palette fixe, huit couleurs bien séparées, attribuées aux sigles triés :
 * la même couleur pour un cours dans les trois onglets, et deux cours voisins
 * (MAT1500 / MAT1600) ne tombent jamais sur deux bleus.
 */
const PALETTE = ["#2f7de1", "#e0603c", "#2ba36b", "#c8449b", "#e6a417", "#7b5cd6", "#1fa8b9", "#8a6d3b"];

type Tab = "today" | "week" | "exams" | "grades";
interface UiState {
  tab: Tab;
  openedAt: number;
  /** Ligne dépliée dans Semaine. */
  expanded: string | null;
  /** Ligne dépliée dans Examens (slot séparé : déplier ici ne referme pas là-bas). */
  expandedExam: string | null;
  hidePastExams: boolean;
  courseAlarms: boolean;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const el = (tag: string, className = "", text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};
const withIcon = (name: Parameters<typeof icon>[0], text: string, className = "inline"): HTMLElement => {
  const e = el("span", className);
  e.append(icon(name), document.createTextNode(text));
  return e;
};

function localNow(): { iso: string; date: string; dateTime: string; minutes: number } {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { iso: d.toISOString(), date, dateTime: `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`, minutes: d.getHours() * 60 + d.getMinutes() };
}
type Now = ReturnType<typeof localNow>;

async function send<T = unknown>(message: Message): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

/**
 * `relativeTime` attend un ISO 8601 avec fuseau. Les instants du content script StudiUM
 * (`syncedAt`, `at`) sont des locaux nus « AAAA-MM-JJTHH:MM » : on les relit comme heure
 * locale du navigateur (la seule que le popup connaisse) avant de les comparer.
 */
function toIso(localOrIso: string): string {
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(localOrIso)) return localOrIso;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localOrIso);
  if (!m) return localOrIso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).toISOString();
}

function mondayOf(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

// ---------------------------------------------------------------------------
// État d'interface persistant (onglet, section dépliée, préférences)

let ui: UiState = { tab: "today", openedAt: 0, expanded: null, expandedExam: null, hidePastExams: false, courseAlarms: false };
/** Décalage de semaine dans l'onglet Semaine (0 = semaine courante), non persisté. */
let weekOffset = 0;

async function loadUi(): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(UI_KEY))[UI_KEY] as Partial<UiState> | undefined;
    if (stored) ui = { ...ui, ...stored };
  } catch {
    /* stockage indisponible : valeurs par défaut */
  }
  if (Date.now() - ui.openedAt > TAB_RESET_MS) ui.tab = "today";
  ui.openedAt = Date.now();
  void saveUi();
}

function saveUi(): Promise<void> {
  return chrome.storage.local.set({ [UI_KEY]: ui }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Modèle de rendu

interface View {
  state: StoredState;
  schedule: Schedule;
  occurrences: Occurrence[];
  excluded: string[];
  /** Échéances (StudiUM + manuelles), toutes sources, triées par `due`. */
  deadlines: Deadline[];
}

const KIND_LABEL: Record<DeadlineKind, string> = { quiz: "Quiz", devoir: "Remise", evenement: "Événement", autre: "Autre" };
const SOURCE_LABEL: Record<Deadline["source"], string> = { studium: "StudiUM", manuel: "Ajouté à la main" };

let palette = new Map<string, string>();
const colorOf = (code: string): string => palette.get(code) ?? "var(--muted)";

/** « MAT 1400-A Calcul 1 (TH) » → morceaux affichables. */
function describe(o: Occurrence): { sigle: string; section: string; component: string; title: string } {
  const m = /^([A-Z]{2,4} ?\d{4}[A-Z]?)(?:-(\S+))? (.*) \((TH|TP|LAB|AUTRE)\)$/.exec(o.label);
  if (!m) return { sigle: sigle(o.courseCode), section: "", component: "", title: o.label };
  return { sigle: sigle(m[1] as string), section: m[2] ?? "", component: componentName(m[4] as "TH"), title: m[3] as string };
}

function shortLabel(o: Occurrence): string {
  if (o.kind === "examen") return o.label.replace(/^([A-Z]+) (\d)/, "$1$2");
  const d = describe(o);
  return `${d.sigle}${d.section ? `-${d.section}` : ""} · ${d.component}`;
}

/** Libellé compact pour les listes denses : « MAT1400-A · TH » (volet abrégé). */
function denseLabel(o: Occurrence): string {
  if (o.kind === "examen") return shortLabel(o);
  const m = /\((TH|TP|LAB|AUTRE)\)$/.exec(o.label);
  const d = describe(o);
  return `${d.sigle}${d.section ? `-${d.section}` : ""} · ${m?.[1] ?? d.component}`;
}

/** « Congé — Fête du Travail », « Relâche », ou undefined si la date n'est pas un jour sans cours. */
function dayOffLabel(view: View, date: string): string | undefined {
  const cal = getTermCalendar(view.schedule.term.code);
  if (!cal) return undefined;
  const holiday = cal.holidays.find((h) => h.date === date);
  if (holiday) return `Congé — ${holiday.label.replace(/\s*\(.*\)$/, "")}`;
  if (cal.breakStart && cal.breakEnd && date >= cal.breakStart && date <= cal.breakEnd) return "Relâche";
  return undefined;
}

function swatch(code: string): HTMLElement {
  const s = el("span", "swatch");
  s.style.background = colorOf(code);
  return s;
}

// ---------------------------------------------------------------------------
// Onglet AUJOURD'HUI

function renderToday(view: View, now: Now): void {
  const panel = $("panel-today");
  const today: TodayView = buildTodayView(view.occurrences, view.schedule.exams, now.dateTime);
  panel.replaceChildren();

  const heading =
    today.kind === "tomorrow" ? `Demain — ${longDate(today.date)}`
    : today.kind === "term-over" ? "Aucun cours au calendrier"
    : longDate(today.date);
  panel.append(el("h2", "", heading.charAt(0).toUpperCase() + heading.slice(1)));

  const isToday = today.kind === "today";
  if (today.kind === "term-over") {
    panel.append(el("p", "empty", "Le trimestre est terminé. Ouvrez Synchro pour capturer le suivant."));
  } else if (today.kind === "nothing" && today.items.length === 0) {
    panel.append(el("p", "empty", dayOffLabel(view, now.date) ?? "Rien aujourd'hui."));
  } else {
    if (today.kind === "nothing") {
      const why = dayOffLabel(view, now.date);
      panel.append(el("p", "dim", `${why ?? "Rien aujourd'hui"}. Prochain jour de cours :`));
    }
    const list = el("div");
    const dayDiff = daysUntil(today.date, now.date);
    for (const item of today.items) list.append(todayItem(item, isToday, dayDiff, now));
    if (today.hiddenCount > 0) list.append(el("p", "dim", `+ ${today.hiddenCount} autres`));
    panel.append(list);
  }

  const clusters = examClusters(view.schedule.exams).filter((c) => daysUntil(c.start, now.date) <= 14 && daysUntil(c.end, now.date) >= 0);
  const first = clusters[0];
  if (first) panel.append(withIcon("warning", `${first.exams.length} examens entre le ${shortDate(first.start)} et le ${shortDate(first.end)}`, "warn"));
  if (today.busy) panel.append(el("p", "dim", "Journée chargée."));
  if (today.nextExam) {
    const { exam, daysLeft } = today.nextExam;
    panel.append(withIcon("clock", `${sigle(exam.courseCode)} — ${exam.label} ${daysLeft === 0 ? "aujourd'hui" : `dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`}`, "inline sub"));
  }
  const conflicts = findConflicts(view.occurrences).filter((c) => c.date >= now.date);
  if (conflicts.length) panel.append(withIcon("warning", `${conflicts.length} chevauchement${conflicts.length > 1 ? "s" : ""} à venir — voir l'onglet Semaine.`, "warn"));

  const soon = upcomingDeadlines(view.deadlines, now.dateTime, DEADLINE_HORIZON_DAYS);
  const openNow = view.deadlines.filter((d) => deadlineStatus(d, now.dateTime) === "open" && !soon.includes(d));
  const shown = [...soon, ...openNow];
  if (shown.length) {
    const box = el("div", "deadlines");
    box.append(el("h3", "", "Échéances"));
    for (const d of shown) {
      const key = `dl|${d.id}`;
      box.append(deadlineRow(d, view, now, key));
      if (ui.expanded === key) box.append(deadlineDetails(d, view));
    }
    panel.append(box);
  }

  // Aperçu : le reste de la semaine civile du jour affiché (jusqu'au dimanche),
  // seulement quand la journée est creuse — sinon il tomberait sous le pli.
  const sunday = addDays(mondayOf(today.date), 6);
  const after = today.items.length <= 2
    ? view.occurrences.filter((o) => o.date > today.date && o.date <= sunday).slice(0, PREVIEW_MAX)
    : [];
  if (after.length) {
    const box = el("div", "preview");
    box.append(el("h3", "", "Le reste de la semaine"));
    for (const o of after) {
      const row = el("div", "preview-row");
      row.append(el("span", "when", `${weekdayName(isoWeekday(o.date), "short")} ${o.start}`));
      const label = el("span");
      label.append(swatch(o.courseCode), document.createTextNode(shortLabel(o)));
      row.append(label);
      box.append(row);
    }
    panel.append(box);
  }
}

function todayItem(item: TodayItem, isToday: boolean, dayDiff: number, now: Now): HTMLElement {
  const o = item.occurrence;
  const d = describe(o);
  const root = el("div", `item ${isToday ? item.status : "later"}`);
  const b = el("span", "bullet");
  b.append(bullet(isToday && item.status === "now"));
  const body = el("div", "lines");
  if (isToday && item.status === "now") body.append(el("div", "status-label", "MAINTENANT"));
  else if (isToday && item.status === "next") body.append(el("div", "status-label", "ENSUITE"));
  const title = el("div", "title");
  title.append(swatch(o.courseCode), document.createTextNode(o.kind === "examen" ? shortLabel(o) : `${d.sigle}${d.section ? `-${d.section}` : ""} `));
  if (o.kind === "cours" && d.component) title.append(el("span", "comp", `· ${d.component}`));
  body.append(title);

  let timing = `${o.start}–${o.end}`;
  if (isToday) {
    if (item.status === "now" && item.minutesToEnd !== undefined) timing += ` · fini dans ${formatMinutes(item.minutesToEnd)}`;
    else if (item.minutesToStart !== undefined && item.status !== "done") timing += ` · dans ${formatMinutes(item.minutesToStart)}`;
  } else if (dayDiff > 0) {
    const minutes = dayDiff * 1440 + minutesOfTime(o.start) - now.minutes;
    if (minutes > 0) timing += ` · dans ${formatMinutes(minutes)}`;
  }
  body.append(el("div", "sub", timing));
  body.append(el("div", "sub", formatLocation(o.location)));
  if (item.sameBuildingAsPrevious) body.append(withIcon("turn", "même pavillon", "inline dim"));
  root.append(b, body);
  return root;
}

// ---------------------------------------------------------------------------
// Onglet SEMAINE (liste groupée par jour, navigation entre semaines)

function renderWeek(view: View, now: Now): void {
  const panel = $("panel-week");
  panel.replaceChildren();
  const monday = addDays(mondayOf(now.date), weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const inWeek = view.occurrences.filter((o) => o.date >= days[0]! && o.date <= days[6]!);
  const byDay = new Map<string, Occurrence[]>();
  for (const o of inWeek) byDay.set(o.date, [...(byDay.get(o.date) ?? []), o]);

  const nav = el("div", "week-nav");
  const prev = el("button", "ghost iconic") as HTMLButtonElement;
  prev.append(icon("left"));
  prev.title = "Semaine précédente";
  prev.addEventListener("click", () => {
    weekOffset--;
    renderWeek(view, now);
  });
  const next = el("button", "ghost iconic") as HTMLButtonElement;
  next.append(icon("right"));
  next.title = "Semaine suivante";
  next.addEventListener("click", () => {
    weekOffset++;
    renderWeek(view, now);
  });
  nav.append(prev, el("h2", "", `Semaine du ${shortDate(monday)}`), next);
  if (weekOffset !== 0) {
    const back = el("button", "ghost", "Aujourd'hui");
    back.addEventListener("click", () => {
      weekOffset = 0;
      renderWeek(view, now);
    });
    nav.append(back);
  }
  panel.append(nav);

  const conflicts = findConflicts(inWeek);
  if (conflicts.length) panel.append(withIcon("warning", conflicts.map((c) => `${shortDate(c.date)} ${c.start}–${c.end} : ${c.a} et ${c.b}`).join(" · "), "warn"));

  let any = false;
  days.forEach((date, i) => {
    const items = byDay.get(date) ?? [];
    const dayDeadlines = deadlinesOn(view.deadlines, date);
    if (items.length === 0 && dayDeadlines.length === 0 && i >= 5) return; // samedi/dimanche seulement s'il y a quelque chose
    any = any || items.length > 0;
    const cls = date === now.date ? " today" : date < now.date ? " past" : "";
    const day = el("div", `day${cls}`);
    day.append(el("div", "dayname", `${weekdayName((i + 1) as 1, "long")} ${dayMonthShort(date)}`));
    if (items.length === 0 && dayDeadlines.length === 0) day.append(el("div", "holiday", dayOffLabel(view, date) ?? "Aucun cours"));
    else if (items.length === 0) { const off = dayOffLabel(view, date); if (off) day.append(el("div", "holiday", off)); }
    for (const o of items) {
      const key = `${o.date}|${o.start}|${o.label}`;
      const open = ui.expanded === key;
      const row = el("div", `week-item${o.kind === "examen" ? " exam" : ""}${open ? " open" : ""}`);
      const chevron = el("span", "chevron");
      chevron.append(icon("right", 12));
      row.append(swatch(o.courseCode), el("span", "when", `${o.start}–${o.end}`), el("span", "label", denseLabel(o)), el("span", "where", parseLocation(o.location).salle || formatLocation(o.location)), chevron);
      row.addEventListener("click", () => toggleExpanded(key, view));
      day.append(row);
      if (ui.expanded === key) day.append(detailsPanel(o, view));
    }
    for (const d of dayDeadlines) {
      const key = `dl|${d.id}`;
      const open = ui.expanded === key;
      const code = resolveCourseCode(d, view.state.courseLinks);
      const row = el("div", `week-item deadline${open ? " open" : ""}${isDone(view.state, d.id) ? " done" : ""}`);
      const chevron = el("span", "chevron");
      chevron.append(icon("right", 12));
      const label = el("span", "label");
      if (code) label.append(swatch(code));
      label.append(document.createTextNode(`${code ? `${sigle(code)} · ` : ""}${d.title}`));
      row.append(doneCheckbox(d, view), el("span", "when", d.due.slice(11)), label, el("span", "where", KIND_LABEL[d.kind]), chevron);
      row.addEventListener("click", () => toggleExpanded(key, view));
      day.append(row);
      if (open) day.append(deadlineDetails(d, view));
      any = true;
    }
    panel.append(day);
  });
  if (!any) panel.append(el("p", "empty", "Aucun cours cette semaine."));
}

function detailsPanel(o: Occurrence, view: View): HTMLElement {
  const box = el("div", "details");
  const d = describe(o);
  if (o.kind === "cours") {
    // Si le libellé n'a pas pu être découpé, on retombe sur le sigle seul plutôt que de
    // rendre un panneau vide (titre, séances et plages valent mieux qu'une devinette ratée).
    const course =
      view.schedule.courses.find((c) => c.code === o.courseCode && (d.section === "" || c.section === d.section) && (d.component === "" || componentName(c.component) === d.component)) ??
      view.schedule.courses.find((c) => c.code === o.courseCode);
    if (course) {
      box.append(el("div", "sub", course.title));
      // Une même séance hebdomadaire apparaît une fois par plage de dates : on la
      // montre une seule fois, les plages sont listées en dessous.
      const seen = new Set<string>();
      for (const m of course.meetings) {
        const line = `${weekdayName(m.weekday, "short")} ${m.start}–${m.end} · ${formatLocation(m.location)}`;
        if (seen.has(line)) continue;
        seen.add(line);
        box.append(el("div", "sub", line));
      }
      const ranges = [...new Set(course.meetings.map((m) => `${dayMonthShort(m.dateStart)} → ${dayMonthShort(m.dateEnd)}`))];
      box.append(el("div", "dim", ranges.join("  ·  ")));
      for (const n of course.notes ?? []) box.append(withIcon("info", n, "inline dim"));
    }
  } else {
    box.append(el("div", "sub", `${o.start}–${o.end} · ${formatLocation(o.location)}`));
  }
  const row = el("div", "row");
  const copyBtn = el("button", "secondary") as HTMLButtonElement;
  copyBtn.append(icon("copy"), document.createTextNode("Copier le local"));
  copyBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await navigator.clipboard.writeText(fullLocation(o.location));
    copyBtn.replaceChildren(icon("copy"), document.createTextNode("Copié !"));
    setTimeout(() => copyBtn.replaceChildren(icon("copy"), document.createTextNode("Copier le local")), 2000);
  });
  row.append(copyBtn);
  const loc = parseLocation(o.location);
  if (loc.pavillonId && loc.pavillonId !== "en-ligne") {
    const map = el("button", "secondary");
    map.append(icon("map"), document.createTextNode("Carte du campus"));
    map.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void chrome.tabs.create({ url: CAMPUS_MAP_URL });
    });
    row.append(map);
  }
  if (o.kind === "examen") {
    const g = el("button", "secondary");
    g.append(icon("calendarPlus"), document.createTextNode("Google Agenda"));
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void chrome.tabs.create({ url: googleCalendarUrl({ title: o.label, date: o.date, start: o.start, end: o.end, location: fullLocation(o.location) }) });
    });
    row.append(g);
  }
  box.append(row);
  return box;
}

// ---------------------------------------------------------------------------
// Échéances (StudiUM + manuelles) — ligne compacte et panneau de détail

/** « ouvre dans 4 j · avant ven. 23:59 », « avant aujourd'hui 23:59 », « passé · 10 sept. ». */
function dueLabel(d: Deadline, now: Now): string {
  const status = deadlineStatus(d, now.dateTime);
  const date = d.due.slice(0, 10);
  const time = d.due.slice(11);
  const left = daysUntil(date, now.date);
  const when = left === 0 ? `aujourd'hui ${time}` : left > 0 && left <= 6 ? `${weekdayName(isoWeekday(date), "short")} ${time}` : `${shortDate(date)} ${time}`;
  if (status === "overdue") return `passé · ${shortDate(date)}`;
  if (d.start && d.start > now.dateTime) {
    const opens = daysUntil(d.start.slice(0, 10), now.date);
    return `ouvre ${opens === 0 ? "aujourd'hui" : `dans ${opens} j`} · avant ${when}`;
  }
  return `avant ${when}`;
}


/** Case « fait » : un clic ne déplie pas la ligne, il bascule l'état et redessine. */
function doneCheckbox(d: Deadline, view: View): HTMLInputElement {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "check";
  box.checked = isDone(view.state, d.id);
  box.title = box.checked ? "Marquer à refaire" : "Marquer comme fait";
  box.setAttribute("aria-label", `${d.title} : fait`);
  box.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await send({ type: "DEADLINE_DONE_SET", id: d.id, done: box.checked });
    await refresh();
  });
  return box;
}

function deadlineRow(d: Deadline, view: View, now: Now, key: string): HTMLElement {
  const done = isDone(view.state, d.id);
  const status = deadlineStatus(d, now.dateTime, done);
  const code = resolveCourseCode(d, view.state.courseLinks);
  const row = el("div", `dl-row status-${status}${ui.expanded === key ? " open" : ""}`);
  const title = el("span", "title");
  if (code) title.append(swatch(code), document.createTextNode(`${sigle(code)} · `));
  title.append(document.createTextNode(d.title), el("span", "kind", ` · ${KIND_LABEL[d.kind]}`));
  const chevron = el("span", "chevron");
  chevron.append(icon("right", 12));
  row.append(doneCheckbox(d, view), title, el("span", "when", done ? "fait" : dueLabel(d, now)), chevron);
  row.addEventListener("click", () => toggleExpanded(key, view));
  return row;
}

function deadlineDetails(d: Deadline, view: View): HTMLElement {
  const box = el("div", "details");
  const dateTime = (v: string) => `${longDate(v.slice(0, 10))} ${v.slice(11)}`;
  if (d.start) box.append(el("div", "sub", `Ouvert du ${dateTime(d.start)} au ${dateTime(d.due)}`));
  else box.append(el("div", "sub", `À faire avant le ${dateTime(d.due)}`));
  if (d.location) box.append(el("div", "sub", formatLocation(d.location)));
  if (d.note) box.append(withIcon("info", d.note, "inline dim"));
  box.append(el("div", "source", `Source : ${SOURCE_LABEL[d.source]}`));
  const row = el("div", "row");
  if (d.url) {
    const url = d.url;
    const open = el("button", "secondary");
    open.append(icon("right"), document.createTextNode("Ouvrir sur StudiUM"));
    open.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void chrome.tabs.create({ url });
    });
    row.append(open);
  }
  const g = el("button", "secondary");
  g.append(icon("calendarPlus"), document.createTextNode("Google Agenda"));
  g.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const code = resolveCourseCode(d, view.state.courseLinks);
    const dueDate = d.due.slice(0, 10);
    const sameDayStart = d.start && d.start.slice(0, 10) === dueDate ? d.start.slice(11) : undefined;
    void chrome.tabs.create({
      url: googleCalendarUrl({
        title: `${code ? `${sigle(code)} — ` : ""}${d.title}`,
        date: dueDate,
        start: sameDayStart ?? d.due.slice(11),
        end: d.due.slice(11),
        location: d.location ? fullLocation(d.location) : "",
      }),
    });
  });
  row.append(g);
  const rm = el("button", "secondary danger", d.source === "manuel" ? "Supprimer" : "Retirer");
  rm.title = d.source === "manuel" ? "Supprimer cet événement" : "Masquer cette échéance ; elle ne reviendra pas à la prochaine synchronisation";
  rm.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await send({ type: "DEADLINE_REMOVE", id: d.id });
    ui.expanded = null;
    await refresh();
  });
  row.append(rm);
  box.append(row);
  return box;
}

function toggleExpanded(key: string, view: View): void {
  const now = localNow();
  if (key.startsWith("exam|")) {
    ui.expandedExam = ui.expandedExam === key ? null : key;
    void saveUi();
    renderExams(view, now);
  } else {
    ui.expanded = ui.expanded === key ? null : key;
    void saveUi();
    renderWeek(view, now);
    if (key.startsWith("dl|")) renderToday(view, now);
  }
}

// ---------------------------------------------------------------------------
// Onglet EXAMENS

function renderExams(view: View, now: Now): void {
  const panel = $("panel-exams");
  panel.replaceChildren();
  const exams = view.schedule.exams;
  if (exams.length === 0) {
    panel.append(el("p", "empty", "Aucun examen dans l'horaire capturé."));
    return;
  }
  const past = exams.filter((e) => e.date < now.date).length;
  if (past > 0) {
    const toggle = el("button", "linkish", ui.hidePastExams ? `Afficher les ${past} examens passés` : "Masquer les examens passés");
    toggle.addEventListener("click", () => {
      ui.hidePastExams = !ui.hidePastExams;
      void saveUi();
      renderExams(view, now);
    });
    panel.append(toggle);
  }

  // Une seule grappe signalée, et seulement si elle commence dans les 30 jours.
  const cluster = examClusters(exams).find((c) => daysUntil(c.end, now.date) >= 0 && daysUntil(c.start, now.date) <= 30);
  if (cluster) {
    panel.append(withIcon("warning", `${cluster.exams.length} examens en ${daysUntil(cluster.end, cluster.start) + 1} jours (${shortDate(cluster.start)} → ${shortDate(cluster.end)})`, "warn"));
  }

  const groups: [string, Exam[]][] = [
    ["Intras", exams.filter((e) => e.kind === "intra")],
    ["Finaux", exams.filter((e) => e.kind === "final")],
    ["Autres", exams.filter((e) => e.kind === "autre")],
  ];
  for (const [title, list] of groups) {
    const visible = ui.hidePastExams ? list.filter((e) => e.date >= now.date) : list;
    if (visible.length === 0) continue;
    const sec = el("div");
    sec.append(el("h3", "", title));
    for (const e of visible) {
      const left = daysUntil(e.date, now.date);
      const key = `exam|${e.courseCode}|${e.date}`;
      const open = ui.expandedExam === key;
      const row = el("div", `exam-row${left < 0 ? " past" : left <= 7 ? " soon" : ""}${open ? " open" : ""}`);
      const name = el("span", "");
      name.append(swatch(e.courseCode), document.createTextNode(sigle(e.courseCode)));
      const leftText = left >= 0 && left <= DAYS_LEFT_HORIZON ? formatDaysUntil(left) : "";
      const chevron = el("span", "chevron");
      chevron.append(icon("right", 12));
      row.append(name, el("span", "when", shortDate(e.date)), el("span", "left", leftText), chevron);
      row.addEventListener("click", () => toggleExpanded(key, view));
      sec.append(row);
      if (open) {
        const occ: Occurrence = { kind: "examen", courseCode: e.courseCode, label: `${sigle(e.courseCode)} — ${e.label}`, date: e.date, start: e.start, end: e.end, location: e.location };
        sec.append(detailsPanel(occ, view));
      }
    }
    panel.append(sec);
  }
}

// ---------------------------------------------------------------------------
// Onglets, menu, pied de page

function selectTab(tab: Tab, focus = false): void {
  ui.tab = tab;
  void saveUi();
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#tabs [role=tab]")) {
    const on = btn.dataset["tab"] === tab;
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
    if (on && focus) btn.focus();
  }
  $("panel-today").hidden = tab !== "today";
  $("panel-week").hidden = tab !== "week";
  $("panel-exams").hidden = tab !== "exams";
  $("panel-grades").hidden = tab !== "grades";
  $("paste-panel").hidden = true;
  $("deadline-panel").hidden = true;
  $("link-panel").hidden = true;
  if (tab === "grades" && currentView) void renderGrades(currentView);
  // Revenir sur Aujourd'hui après un moment ailleurs : recalculer « dans X min ».
  if (tab === "today" && currentView) renderToday(currentView, localNow());
}

function wireTabs(): void {
  const order: Tab[] = ["today", "week", "exams", "grades"];
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#tabs [role=tab]")) {
    btn.addEventListener("click", () => selectTab(btn.dataset["tab"] as Tab));
    btn.addEventListener("keydown", (ev) => {
      const i = order.indexOf(ui.tab);
      if (ev.key === "ArrowRight") selectTab(order[(i + 1) % order.length]!, true);
      if (ev.key === "ArrowLeft") selectTab(order[(i + order.length - 1) % order.length]!, true);
    });
  }
}

function wireMenu(): void {
  const btn = $<HTMLButtonElement>("menu-btn");
  const menu = $("menu");
  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", close);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });
  $("menu-paste").addEventListener("click", () => {
    for (const p of ["panel-today", "panel-week", "panel-exams", "panel-grades", "deadline-panel", "link-panel"]) $(p).hidden = true;
    $("paste-panel").hidden = false;
    $<HTMLTextAreaElement>("paste-2").focus();
  });
  $("paste-cancel").addEventListener("click", () => selectTab(ui.tab));
  const showPanel = (id: string) => {
    for (const p of ["panel-today", "panel-week", "panel-exams", "panel-grades", "paste-panel", "deadline-panel", "link-panel"]) $(p).hidden = p !== id;
  };
  $("grades-optin").addEventListener("change", () => void setGradesOptIn($<HTMLInputElement>("grades-optin").checked));
  $("menu-deadline").addEventListener("click", () => {
    showPanel("deadline-panel");
    $("dl-error").hidden = true;
    if (!$<HTMLInputElement>("dl-date").value) $<HTMLInputElement>("dl-date").value = localNow().date;
    $<HTMLInputElement>("dl-title").focus();
  });
  $("dl-cancel").addEventListener("click", () => selectTab(ui.tab));
  $("dl-save").addEventListener("click", () => void saveManualDeadline());
  $("dl-title").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") void saveManualDeadline();
  });
  $("menu-studium").addEventListener("click", () => void syncStudium());
  $("menu-links").addEventListener("click", () => {
    if (currentView) renderLinks(currentView);
    showPanel("link-panel");
  });
  $("link-close").addEventListener("click", () => selectTab(ui.tab));
  $("menu-alarms").addEventListener("click", () => {
    ui.courseAlarms = !ui.courseAlarms;
    void saveUi();
    $("menu-alarms").textContent = `Rappels pour les cours : ${ui.courseAlarms ? "oui" : "non"}`;
  });
  $("clear").addEventListener("click", async () => {
    await send({ type: "CLEAR_ALL" });
    await refresh();
  });
}

function mountIcons(): void {
  for (const holder of document.querySelectorAll<HTMLElement>(".btn-icon[data-icon]")) {
    holder.replaceChildren(icon(holder.dataset["icon"] as Parameters<typeof icon>[0]));
  }
}

function openSynchro(ev: Event): void {
  ev.preventDefault();
  void chrome.tabs.create({ url: SYNCHRO_URL });
}

function reportBug(ev: Event): void {
  ev.preventDefault();
  const version = chrome.runtime.getManifest().version;
  const term = $("term").textContent || "inconnu";
  const body = encodeURIComponent(`Version : ${version}\nTrimestre : ${term}\nNavigateur : ${navigator.userAgent}\n\nCe qui s'est passé :\n\n(Aucune donnée d'horaire n'est jointe automatiquement.)`);
  void chrome.tabs.create({ url: `${REPORT_URL}?title=${encodeURIComponent("Bug : ")}&body=${body}` });
}

function wireExport(view: View, nowIso: string): void {
  const ics = () =>
    generateIcs(view.schedule, {
      excludedDates: view.excluded,
      dtstamp: nowIso,
      alarms: { exams: true, courses: ui.courseAlarms },
      // Sigle résolu ici (surcharges de liaison), l'ICS ne connaît pas courseLinks.
      deadlines: view.deadlines.map((d) => ({ ...d, courseCode: resolveCourseCode(d, view.state.courseLinks) })),
    });
  const fileName = `horaire-udem-${view.schedule.term.code}.ics`;
  $("export").onclick = () => {
    const url = URL.createObjectURL(new Blob([ics()], { type: "text/calendar;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("copy").onclick = async () => {
    await navigator.clipboard.writeText(ics());
    const btn = $<HTMLButtonElement>("copy");
    btn.replaceChildren(icon("copy"), document.createTextNode("Copié !"));
    setTimeout(() => btn.replaceChildren(icon("copy"), document.createTextNode("Copier")), 1500);
  };
}

async function importPasted(textareaId: string, errorId: string): Promise<void> {
  const text = $<HTMLTextAreaElement>(textareaId).value;
  const err = $(errorId);
  err.hidden = true;
  const now = localNow();
  const { schedule, source } = parsePasted(text, { capturedAt: now.iso, localDate: now.date });
  if (schedule.courses.length === 0) {
    err.textContent = "Aucun cours reconnu. Copiez tout le texte de la page « Votre horaire cours » (vue Liste).";
    err.hidden = false;
    return;
  }
  await send({ type: "SCHEDULE_CAPTURED", schedule, source });
  $<HTMLTextAreaElement>(textareaId).value = "";
  await refresh();
}

// ---------------------------------------------------------------------------
// Événement manuel et écran de liaison StudiUM

async function saveManualDeadline(): Promise<void> {
  const err = $("dl-error");
  err.hidden = true;
  const result = validateManual(
    {
      title: $<HTMLInputElement>("dl-title").value,
      date: $<HTMLInputElement>("dl-date").value,
      time: $<HTMLInputElement>("dl-time").value || undefined,
      courseCode: $<HTMLSelectElement>("dl-course").value || undefined,
      kind: ($<HTMLSelectElement>("dl-kind").value || "evenement") as DeadlineKind,
      location: $<HTMLInputElement>("dl-location").value || undefined,
    },
    crypto.randomUUID(),
  );
  if (!result.ok) {
    err.textContent = result.errors.join(" ");
    err.hidden = false;
    return;
  }
  await send({ type: "DEADLINE_UPSERT", deadline: result.deadline });
  $<HTMLInputElement>("dl-title").value = "";
  $<HTMLInputElement>("dl-location").value = "";
  await refresh();
  selectTab(ui.tab);
}

/** Remplit un sélecteur avec les sigles du trimestre affiché, précédés d'une option vide. */
function fillCourseSelect(view: View, select: HTMLSelectElement, current: string | null | undefined, noneLabel: string): void {
  const codes = [...new Set(view.schedule.courses.map((c) => c.code))].sort();
  select.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = noneLabel;
  select.append(none);
  for (const code of codes) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = sigle(code);
    if (code === current) opt.selected = true;
    select.append(opt);
  }
}

function renderLinks(view: View): void {
  const rows = $("link-rows");
  rows.replaceChildren();
  const sites = view.state.studium?.courses ?? [];
  if (sites.length === 0) {
    rows.append(el("p", "empty", "Aucun site StudiUM vu pour l'instant. Ouvrez StudiUM une fois."));
    return;
  }
  for (const site of [...sites].sort((a, b) => a.shortname.localeCompare(b.shortname))) {
    const row = el("div", "link-row");
    const name = el("span", "name", site.shortname || site.fullname);
    name.title = site.fullname;
    const select = document.createElement("select");
    const override = view.state.courseLinks?.[String(site.id)];
    const current = override === undefined ? site.courseCode : override;
    fillCourseSelect(view, select, current, "— ne pas lier —");
    select.addEventListener("change", async () => {
      await send({ type: "COURSE_LINK_SET", studiumCourseId: site.id, courseCode: select.value || null });
      const state = await send<StoredState>({ type: "GET_STATE" });
      if (currentView) currentView.state = state;
    });
    row.append(name, select);
    rows.append(row);
  }
}

/**
 * Un onglet StudiUM est ouvert → on lui demande une synchro immédiate (le content
 * script écoute STUDIUM_SYNC_NOW). Sinon on pose un drapeau puis on ouvre StudiUM :
 * le popup se ferme dès que le nouvel onglet prend le focus, donc aucun message
 * différé ne partirait d'ici ; le content script lit le drapeau au démarrage et
 * force la synchro malgré l'anti-rafale.
 */
async function syncStudium(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "https://studium.umontreal.ca/*" }).catch(() => [] as chrome.tabs.Tab[]);
  const target = tabs.find((t) => t.id !== undefined);
  // Le drapeau est posé dans tous les cas : si l'onglet doit être (re)chargé, le content
  // script le lira au démarrage ; sinon le prochain démarrage le consommera sans mal.
  await chrome.storage.local.set({ [STUDIUM_FORCE_KEY]: true }).catch(() => undefined);
  if (target?.id !== undefined) {
    const tabId = target.id;
    const message: Message = { type: "STUDIUM_SYNC_NOW" };
    try {
      await chrome.tabs.sendMessage(tabId, message);
      $("studium-status").textContent = "StudiUM : synchronisation demandée, rouvrez le popup dans quelques secondes.";
    } catch {
      // Personne n'écoute dans cet onglet : content script orphelin après un rechargement
      // de l'extension (vu le 2026-09-10), ou page ouverte avant l'installation. On
      // recharge l'onglet : le script réinjecté lit le drapeau et force la synchro.
      await chrome.tabs.reload(tabId).catch(() => undefined);
      $("studium-status").textContent = "StudiUM : onglet rechargé pour synchroniser, rouvrez le popup dans quelques secondes.";
    }
    return;
  }
  void chrome.tabs.create({ url: STUDIUM_URL });
}

// ---------------------------------------------------------------------------
// Notes (opt-in) : carnets StudiUM tels que lus, jamais recalculés

async function readGradesOptIn(): Promise<boolean> {
  try {
    return (await chrome.storage.local.get(GRADES_OPT_IN_KEY))[GRADES_OPT_IN_KEY] === true;
  } catch {
    return false;
  }
}

/** Activer pose la clé lue par le content script ; désactiver efface aussi les notes gardées. */
async function setGradesOptIn(on: boolean): Promise<void> {
  if (on) await chrome.storage.local.set({ [GRADES_OPT_IN_KEY]: true }).catch(() => undefined);
  else {
    await chrome.storage.local.remove(GRADES_OPT_IN_KEY).catch(() => undefined);
    await send({ type: "STUDIUM_GRADES_SYNCED", reports: [], syncedAt: localNow().dateTime });
  }
  const state = await send<StoredState>({ type: "GET_STATE" });
  if (currentView) currentView.state = state;
  if (currentView) await renderGrades(currentView);
}

function gradeRow(item: GradeItem, cls = ""): HTMLElement {
  const row = el("div", `grade-row${cls ? ` ${cls}` : ""}`);
  const name = el("span", "name", item.name);
  name.title = item.name;
  if (item.depth) name.style.paddingLeft = `${item.depth * 10}px`;
  row.append(name, el("span", "num grade", item.grade || "—"), el("span", "num", item.range ? `/ ${item.range.replace(/^0[–-]/, "")}` : ""), el("span", "num", item.average || ""));
  return row;
}

async function renderGrades(view: View): Promise<void> {
  const on = await readGradesOptIn();
  $<HTMLInputElement>("grades-optin").checked = on;
  const status = $("grades-status");
  const list = $("grades-list");
  list.replaceChildren();
  const grades = view.state.grades;
  if (!on) {
    status.textContent = "";
    return;
  }
  if (!grades || grades.reports.length === 0) {
    status.textContent = grades
      ? "Aucun carnet de notes trouvé sur vos sites StudiUM."
      : "Ouvrez StudiUM une fois (ou menu ⋯ → Synchroniser StudiUM) : les notes sont lues avec le calendrier.";
    return;
  }
  status.textContent = `Lu ${relativeTime(toIso(grades.syncedAt), localNow().iso)} · moyenne du groupe entre parenthèses : nombre de répondants.`;
  const reports = [...grades.reports].sort((a, b) => (a.courseCode ?? a.shortname).localeCompare(b.courseCode ?? b.shortname));
  for (const r of reports) list.append(gradesBlock(r, view));
}

function gradesBlock(r: GradeReport, view: View): HTMLElement {
  const code = view.state.courseLinks?.[String(r.studiumCourseId)] ?? r.courseCode;
  const box = el("div", "grades-course");
  const h = el("h3");
  if (code) h.append(swatch(code), document.createTextNode(sigle(code)));
  h.append(el("span", "dim", code ? r.shortname : r.shortname));
  box.append(h);
  const head = el("div", "grade-row head");
  head.append(el("span", "name", "Élément"), el("span", "num", "Note"), el("span", "num", "Sur"), el("span", "num", "Moyenne"));
  box.append(head);
  if (r.items.length === 0) box.append(el("p", "dim", "Rien de publié pour l'instant."));
  // `depth` = crans d'indentation (catégorie racine 0) ; une ligne de catégorie est un item sans note.
  for (const item of r.items) box.append(gradeRow(item, item.depth === 0 ? "cat" : ""));
  if (r.total) box.append(gradeRow({ ...r.total, name: "Total du cours" }, "total"));
  return box;
}

/** Ligne d'état StudiUM sous « Mis à jour … ». */
function studiumStatusText(state: StoredState, nowIso: string): string {
  const st = state.studium;
  // Une erreur se montre même si aucune synchro n'a jamais réussi : sinon le premier
  // échec resterait caché derrière « ouvrez StudiUM » (défaut vu à la première vraie visite).
  const failedAt = st?.lastErrorAt ? ` ${relativeTime(toIso(st.lastErrorAt), nowIso)}` : "";
  const when = st?.lastSyncAt ? `StudiUM synchronisé ${relativeTime(toIso(st.lastSyncAt), nowIso)}` : "StudiUM jamais synchronisé";
  if (st?.lastError === "sesskey-absent") return `${when} · clé de session introuvable sur la page StudiUM${failedAt}. Signalez le bug.`;
  if (st?.lastError === "invalidsesskey") return `${when} · session expirée${failedAt}, reconnectez-vous à StudiUM.`;
  if (st?.lastError) return `${when} · tentative échouée${failedAt} (${st.lastError}).`;
  if (!st?.lastSyncAt) return "StudiUM : ouvrez StudiUM une fois pour synchroniser vos échéances.";
  return when;
}

// ---------------------------------------------------------------------------
// Rendu principal

let currentView: View | null = null;
/** Date civile du dernier rendu complet : sert à détecter le passage à minuit. */
let renderedDate = "";

function render(state: StoredState): void {
  const now = localNow();
  renderedDate = now.date;
  const schedule = currentTerm(state, now.date);
  const captured = $("captured");
  if (state.lastCapturedAt) {
    captured.textContent = `Mis à jour ${relativeTime(state.lastCapturedAt, now.iso)}`;
    captured.title = fullDateTime(state.lastCapturedAt);
  } else {
    captured.textContent = "";
  }
  $("studium-status").textContent = "";
  $("menu-alarms").textContent = `Rappels pour les cours : ${ui.courseAlarms ? "oui" : "non"}`;

  const has = Boolean(schedule);
  $("fallback").hidden = has;
  $("tabs").hidden = !has;
  $<HTMLButtonElement>("export").disabled = !has;
  $<HTMLButtonElement>("copy").disabled = !has;
  if (!schedule) {
    $("term").textContent = "";
    currentView = null;
    for (const p of ["panel-today", "panel-week", "panel-exams", "panel-grades", "paste-panel", "deadline-panel", "link-panel"]) $(p).hidden = true;
    return;
  }

  $("term").textContent = schedule.term.label;
  const excluded = excludedDates(schedule.term.code);
  const occurrences = expandSchedule(schedule, { excludedDates: excluded });
  const view: View = { state, schedule, occurrences, excluded, deadlines: allDeadlines(state) };
  currentView = view;
  const courseSelect = $<HTMLSelectElement>("dl-course");
  fillCourseSelect(view, courseSelect, courseSelect.value, "— aucun —");
  $("menu-links").hidden = (state.studium?.courses.length ?? 0) === 0;
  $("studium-status").textContent = studiumStatusText(state, now.iso);
  const codes = [...new Set([...schedule.courses.map((c) => c.code), ...schedule.exams.map((e) => e.courseCode)])].sort();
  palette = new Map(codes.map((code, i) => [code, PALETTE[i % PALETTE.length]!]));

  renderToday(view, now);
  renderWeek(view, now);
  renderExams(view, now);
  const notices: string[] = [];
  if (excluded.length === 0) notices.push(`Trimestre ${schedule.term.code} inconnu du calendrier universitaire : relâche et congés non exclus.`);
  if (state.sources[schedule.term.code] === "centre") notices.push("Horaire capturé depuis le Centre étudiant (sans dates ni examens). Ouvrez « Horaire hebdomadaire » puis « Liste ».");
  for (const n of notices) $("panel-today").prepend(el("p", "notice", n));

  wireExport(view, now.iso);
  selectTab(ui.tab);
  void chrome.action.setBadgeText({ text: String(classesRemainingToday(occurrences, now.dateTime) || "") });
}

async function refresh(): Promise<void> {
  const state = await send<StoredState>({ type: "GET_STATE" });
  render(state);
}

document.addEventListener("DOMContentLoaded", async () => {
  mountIcons();
  await loadUi();
  wireTabs();
  wireMenu();
  for (const a of document.querySelectorAll(".open-synchro")) a.addEventListener("click", openSynchro);
  for (const b of document.querySelectorAll(".report")) b.addEventListener("click", reportBug);
  $("paste-btn").addEventListener("click", () => void importPasted("paste", "paste-error"));
  $("paste-btn-2").addEventListener("click", () => void importPasted("paste-2", "paste-error-2"));
  await refresh();
  setInterval(() => {
    const now = localNow();
    // Minuit : tout re-rendre, sinon Semaine et Examens gardent la date d'ouverture.
    if (renderedDate && now.date !== renderedDate) {
      void refresh();
      return;
    }
    if (!currentView) return;
    if (ui.tab === "today") renderToday(currentView, now);
    if (currentView.state.lastCapturedAt) $("captured").textContent = `Mis à jour ${relativeTime(currentView.state.lastCapturedAt, now.iso)}`;
  }, REFRESH_MS);
});
