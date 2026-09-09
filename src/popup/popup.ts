// Popup v2 : trois onglets (Aujourd'hui, Semaine, Examens), pied de page fixe,
// menu ⋯, repli « coller un horaire » visible seulement quand la capture manque.
// Tout le calcul vient de core/ et format/ ; ici il n'y a que du rendu, des
// messages et un peu d'état d'interface (onglet courant, sections dépliées).

import { excludedDates } from "../core/calendar-udem";
import { busyDay, classesRemainingToday, examClusters } from "../core/alerts";
import { findConflicts } from "../core/conflicts";
import { expandSchedule } from "../core/expand";
import { googleCalendarUrl } from "../core/gcal";
import { generateIcs } from "../core/ics";
import type { Exam, Occurrence, Schedule } from "../core/model";
import { parsePasted } from "../core/parse";
import { currentTerm } from "../core/store";
import { buildTodayView, type TodayItem, type TodayView } from "../core/today";
import {
  componentName,
  courseColors,
  dayMonthShort,
  daysUntil,
  formatDaysUntil,
  formatLocation,
  formatMinutes,
  fullDateTime,
  fullLocation,
  longDate,
  parseLocation,
  relativeTime,
  shortDate,
  sigle,
  weekdayName,
} from "../format";
import type { Message, StoredState } from "../lib/messages";

const SYNCHRO_URL = "https://academique-dmz.synchro.umontreal.ca/";
const REPORT_URL = "https://github.com/AMoncade/synchro-calendrier/issues/new";
const CAMPUS_MAP_URL = "https://plancampus.umontreal.ca/montreal/";
const UI_KEY = "synchro-calendrier.ui";
const TAB_RESET_MS = 4 * 3600 * 1000;
const REFRESH_MS = 30_000;

type Tab = "today" | "week" | "exams";
interface UiState {
  tab: Tab;
  openedAt: number;
  expanded: string | null;
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

function localNow(): { iso: string; date: string; dateTime: string; ms: number } {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { iso: d.toISOString(), date, dateTime: `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`, ms: d.getTime() };
}

async function send<T = unknown>(message: Message): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

// ---------------------------------------------------------------------------
// État d'interface persistant (onglet, section dépliée, préférences)

let ui: UiState = { tab: "today", openedAt: 0, expanded: null, hidePastExams: false, courseAlarms: false };

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
}

/** « MAT 1400-A Calcul 1 (TH) » → morceaux affichables. */
function describe(o: Occurrence): { sigle: string; section: string; component: string; title: string } {
  const m = /^([A-Z]{2,4} ?\d{4}[A-Z]?)(?:-(\S+))? (.*) \((TH|TP|LAB|AUTRE)\)$/.exec(o.label);
  if (!m) return { sigle: sigle(o.courseCode), section: "", component: "", title: o.label };
  return { sigle: sigle(m[1] as string), section: m[2] ?? "", component: componentName(m[4] as "TH"), title: m[3] as string };
}

/** Palette de l'horaire courant : couleurs distinctes jusqu'à neuf cours (format/course.ts). */
let palette = new Map<string, { h: number; css: string }>();
const colorOf = (code: string): string => palette.get(code)?.css ?? "var(--muted)";

function swatch(code: string): HTMLElement {
  const s = el("span", "swatch");
  s.style.background = colorOf(code);
  return s;
}

// ---------------------------------------------------------------------------
// Onglet AUJOURD'HUI

function renderToday(view: View, now: ReturnType<typeof localNow>): void {
  const panel = $("panel-today");
  const today: TodayView = buildTodayView(view.occurrences, view.schedule.exams, now.dateTime);
  panel.replaceChildren();

  const heading =
    today.kind === "tomorrow" ? `Demain — ${longDate(today.date)}`
    : today.kind === "next-day" || today.kind === "nothing" ? longDate(today.date)
    : today.kind === "term-over" ? "Aucun cours au calendrier"
    : longDate(today.date);
  panel.append(el("h2", "", heading.charAt(0).toUpperCase() + heading.slice(1)));

  if (today.kind === "term-over") {
    panel.append(el("p", "empty", "Le trimestre est terminé. Ouvrez Synchro pour capturer le suivant."));
  } else if (today.kind === "nothing" && today.items.length === 0) {
    panel.append(el("p", "empty", "Rien aujourd'hui."));
  } else {
    if (today.kind === "nothing") panel.append(el("p", "dim", "Rien aujourd'hui. Prochain jour de cours :"));
    const list = el("div");
    for (const item of today.items) list.append(todayItem(item));
    if (today.hiddenCount > 0) list.append(el("p", "dim", `+ ${today.hiddenCount} autres`));
    panel.append(list);
  }

  const clusters = examClusters(view.schedule.exams).filter((c) => daysUntil(c.start, now.date) <= 14 && daysUntil(c.end, now.date) >= 0);
  const first = clusters[0];
  if (first) panel.append(el("p", "warn", `⚠ ${first.exams.length} examens entre le ${shortDate(first.start)} et le ${shortDate(first.end)}`));
  if (today.busy) panel.append(el("p", "dim", "Journée chargée."));
  if (today.nextExam) {
    const { exam, daysLeft } = today.nextExam;
    panel.append(el("p", "sub", `⏱ ${sigle(exam.courseCode)} — ${exam.label} ${daysLeft === 0 ? "aujourd'hui" : `dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`}`));
  }
  const conflicts = findConflicts(view.occurrences).filter((c) => c.date >= now.date);
  if (conflicts.length) panel.append(el("p", "warn", `⚠ ${conflicts.length} chevauchement${conflicts.length > 1 ? "s" : ""} à venir — voir l'onglet Semaine.`));
}

function todayItem(item: TodayItem): HTMLElement {
  const o = item.occurrence;
  const d = describe(o);
  const root = el("div", `item ${item.status}`);
  const bullet = el("span", "bullet", item.status === "now" ? "●" : "○");
  const body = el("div", "lines");
  if (item.status === "now") body.append(el("div", "dim", "MAINTENANT"));
  else if (item.status === "next") body.append(el("div", "dim", "ENSUITE"));
  const title = el("div", "title");
  title.append(swatch(o.courseCode), document.createTextNode(o.kind === "examen" ? o.label.replace(/^[A-Z]+ /, (s) => s.trim()) : `${d.sigle}${d.section ? `-${d.section}` : ""} `));
  if (o.kind === "cours" && d.component) title.append(el("span", "comp", `· ${d.component}`));
  body.append(title);
  const when = el("div", "sub");
  let timing = `${o.start}–${o.end}`;
  if (item.status === "now" && item.minutesToEnd !== undefined) timing += ` · fini dans ${formatMinutes(item.minutesToEnd)}`;
  else if (item.minutesToStart !== undefined && item.status !== "done") timing += ` · dans ${formatMinutes(item.minutesToStart)}`;
  when.textContent = timing;
  body.append(when);
  body.append(el("div", "sub", formatLocation(o.location)));
  if (item.sameBuildingAsPrevious) body.append(el("div", "dim", "↳ même pavillon"));
  root.append(bullet, body);
  return root;
}

// ---------------------------------------------------------------------------
// Onglet SEMAINE (liste groupée par jour)

function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const dow = new Date(ms).getUTCDay() || 7;
  return new Date(ms - (dow - 1) * 86_400_000).toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

function renderWeek(view: View, now: ReturnType<typeof localNow>): void {
  const panel = $("panel-week");
  panel.replaceChildren();
  const monday = mondayOf(now.date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const byDay = new Map<string, Occurrence[]>();
  for (const o of view.occurrences) if (o.date >= days[0]! && o.date <= days[6]!) byDay.set(o.date, [...(byDay.get(o.date) ?? []), o]);
  panel.append(el("h2", "", `Semaine du ${shortDate(monday)}`));
  const conflicts = findConflicts(view.occurrences.filter((o) => o.date >= days[0]! && o.date <= days[6]!));
  if (conflicts.length) panel.append(el("p", "warn", `⚠ ${conflicts.map((c) => `${shortDate(c.date)} ${c.start}–${c.end} : ${c.a} ↔ ${c.b}`).join(" · ")}`));

  let any = false;
  days.forEach((date, i) => {
    const items = byDay.get(date) ?? [];
    if (items.length === 0 && i >= 5) return; // samedi/dimanche seulement s'il y a quelque chose
    any = any || items.length > 0;
    const day = el("div", `day${date === now.date ? " today" : ""}`);
    day.append(el("div", "dayname", `${weekdayName((i + 1) as 1, "long")} ${shortDate(date).replace(/^\S+\s/, "")}`));
    if (items.length === 0) day.append(el("div", "dim", "—"));
    for (const o of items) {
      const key = `${o.date}|${o.start}|${o.label}`;
      const row = el("div", `week-item${o.kind === "examen" ? " exam" : ""}`);
      row.style.borderLeftColor = colorOf(o.courseCode);
      const d = describe(o);
      row.append(el("span", "when", `${o.start}–${o.end}`));
      const label = el("span");
      label.textContent = o.kind === "examen" ? o.label.replace(/^([A-Z]+) /, "$1") : `${d.sigle}${d.section ? `-${d.section}` : ""} · ${d.component}`;
      row.append(label);
      row.addEventListener("click", () => toggleExpanded(key, view));
      day.append(row);
      if (ui.expanded === key) day.append(detailsPanel(o, view));
    }
    panel.append(day);
  });
  if (!any) panel.append(el("p", "empty", "Aucun cours cette semaine."));
}

function detailsPanel(o: Occurrence, view: View): HTMLElement {
  const box = el("div", "details");
  const d = describe(o);
  if (o.kind === "cours") {
    const course = view.schedule.courses.find((c) => c.code === o.courseCode && (d.section === "" || c.section === d.section) && componentName(c.component) === d.component);
    if (course) {
      box.append(el("div", "sub", course.title));
      for (const m of course.meetings) {
        box.append(el("div", "sub", `${weekdayName(m.weekday, "short")} ${m.start}–${m.end} · ${formatLocation(m.location)}`));
      }
      const ranges = [...new Set(course.meetings.map((m) => `${shortDate(m.dateStart)} → ${shortDate(m.dateEnd)}`))];
      box.append(el("div", "dim", ranges.join("  ·  ")));
      for (const n of course.notes ?? []) box.append(el("div", "dim", `Note : ${n}`));
    }
  } else {
    box.append(el("div", "sub", `${o.start}–${o.end} · ${formatLocation(o.location)}`));
  }
  const row = el("div", "row");
  const copyBtn = el("button", "secondary", "⧉ Copier le local") as HTMLButtonElement;
  copyBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await navigator.clipboard.writeText(fullLocation(o.location));
    copyBtn.textContent = "Copié !";
    setTimeout(() => (copyBtn.textContent = "⧉ Copier le local"), 2000);
  });
  row.append(copyBtn);
  if (parseLocation(o.location).pavillonId && parseLocation(o.location).pavillonId !== "en-ligne") {
    const map = el("button", "secondary", "🗺 Carte du campus");
    map.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void chrome.tabs.create({ url: CAMPUS_MAP_URL });
    });
    row.append(map);
  }
  if (o.kind === "examen") {
    const g = el("button", "secondary", "＋ Google Agenda");
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void chrome.tabs.create({ url: googleCalendarUrl({ title: o.label, date: o.date, start: o.start, end: o.end, location: fullLocation(o.location) }) });
    });
    row.append(g);
  }
  box.append(row);
  return box;
}

function toggleExpanded(key: string, view: View): void {
  ui.expanded = ui.expanded === key ? null : key;
  void saveUi();
  const now = localNow();
  renderWeek(view, now);
  renderExams(view, now);
}

// ---------------------------------------------------------------------------
// Onglet EXAMENS

function renderExams(view: View, now: ReturnType<typeof localNow>): void {
  const panel = $("panel-exams");
  panel.replaceChildren();
  const exams = view.schedule.exams;
  if (exams.length === 0) {
    panel.append(el("p", "empty", "Aucun examen dans l'horaire capturé."));
    return;
  }
  const head = el("div", "exams-head");
  head.append(el("h2", "", "Examens"));
  const past = exams.filter((e) => e.date < now.date).length;
  if (past > 0) {
    const toggle = el("button", "linkish", ui.hidePastExams ? `Afficher les ${past} passés` : "Masquer les examens passés");
    toggle.addEventListener("click", () => {
      ui.hidePastExams = !ui.hidePastExams;
      void saveUi();
      renderExams(view, now);
    });
    head.append(toggle);
  }
  panel.append(head);

  const clusters = examClusters(exams);
  for (const c of clusters) {
    if (daysUntil(c.end, now.date) < 0) continue;
    panel.append(el("p", "warn", `⚠ ${c.exams.length} examens en ${daysUntil(c.end, c.start) + 1} jours (${shortDate(c.start)} → ${shortDate(c.end)})`));
  }

  const groups: [string, Exam[]][] = [
    ["Intras", exams.filter((e) => e.kind === "intra")],
    ["Finals", exams.filter((e) => e.kind === "final")],
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
      const row = el("div", `exam-row${left < 0 ? " past" : left <= 7 ? " soon" : ""}`);
      const name = el("span", "");
      name.append(swatch(e.courseCode), document.createTextNode(sigle(e.courseCode)));
      row.append(name, el("span", "when", shortDate(e.date)), el("span", "left", left < 0 ? "" : formatDaysUntil(left)));
      row.addEventListener("click", () => toggleExpanded(key, view));
      sec.append(row);
      if (ui.expanded === key) {
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
  $("paste-panel").hidden = true;
}

function wireTabs(): void {
  const order: Tab[] = ["today", "week", "exams"];
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
    for (const p of ["panel-today", "panel-week", "panel-exams"]) $(p).hidden = true;
    $("paste-panel").hidden = false;
    $<HTMLTextAreaElement>("paste-2").focus();
  });
  $("paste-cancel").addEventListener("click", () => selectTab(ui.tab));
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
  const ics = () => generateIcs(view.schedule, { excludedDates: view.excluded, dtstamp: nowIso, alarms: { exams: true, courses: ui.courseAlarms } });
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
    const label = btn.textContent;
    btn.textContent = "Copié !";
    setTimeout(() => (btn.textContent = label), 1500);
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
// Rendu principal

let currentView: View | null = null;

function render(state: StoredState): void {
  const now = localNow();
  const schedule = currentTerm(state, now.date);
  const captured = $("captured");
  if (state.lastCapturedAt) {
    captured.textContent = `Mis à jour ${relativeTime(state.lastCapturedAt, now.iso)}`;
    captured.title = fullDateTime(state.lastCapturedAt);
  } else {
    captured.textContent = "";
  }
  $("menu-alarms").textContent = `Rappels pour les cours : ${ui.courseAlarms ? "oui" : "non"}`;

  const has = Boolean(schedule);
  $("fallback").hidden = has;
  $("tabs").hidden = !has;
  $<HTMLButtonElement>("export").disabled = !has;
  $<HTMLButtonElement>("copy").disabled = !has;
  if (!schedule) {
    $("term").textContent = "";
    currentView = null;
    for (const p of ["panel-today", "panel-week", "panel-exams", "paste-panel"]) $(p).hidden = true;
    return;
  }

  $("term").textContent = schedule.term.label;
  const excluded = excludedDates(schedule.term.code);
  const occurrences = expandSchedule(schedule, { excludedDates: excluded });
  const view: View = { state, schedule, occurrences, excluded };
  currentView = view;
  palette = courseColors([...new Set([...schedule.courses.map((c) => c.code), ...schedule.exams.map((e) => e.courseCode)])]);

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
  await loadUi();
  wireTabs();
  wireMenu();
  for (const a of document.querySelectorAll(".open-synchro")) a.addEventListener("click", openSynchro);
  for (const b of document.querySelectorAll(".report")) b.addEventListener("click", reportBug);
  $("paste-btn").addEventListener("click", () => void importPasted("paste", "paste-error"));
  $("paste-btn-2").addEventListener("click", () => void importPasted("paste-2", "paste-error-2"));
  await refresh();
  setInterval(() => {
    if (currentView && ui.tab === "today") renderToday(currentView, localNow());
  }, REFRESH_MS);
});
