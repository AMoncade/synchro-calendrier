// Popup : lit l'état stocké, affiche cours / examens / conflits, exporte l'ICS,
// accepte un horaire collé. Tout le calcul vient de core/ ; ici il n'y a que
// du rendu et des messages. L'instant courant est lu une fois au chargement.

import { excludedDates } from "../core/calendar-udem";
import { findConflicts } from "../core/conflicts";
import { badgeText, nextExam } from "../core/countdown";
import { expandSchedule } from "../core/expand";
import { generateIcs } from "../core/ics";
import type { Conflict, Course, Exam, Schedule } from "../core/model";
import { parsePastedText } from "../core/parse";
import { currentTerm } from "../core/store";
import type { Message, StoredState } from "../lib/messages";

const SYNCHRO_URL = "https://academique-dmz.synchro.umontreal.ca/";
const REPORT_URL = "https://github.com/AMoncade/synchro-calendrier/issues/new";
const WEEKDAY_NAMES = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function localNow(): { iso: string; date: string; dateTime: string } {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { iso: d.toISOString(), date, dateTime: `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

async function send<T = unknown>(message: Message): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

function frDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function courseItem(c: Course): HTMLElement {
  const li = el("li", "");
  const head = el("div", "head");
  const code = c.code.replace(/^([A-Z]+)(\d)/, "$1 $2");
  head.append(el("span", "code", `${code}-${c.section} (${c.component})`), el("span", "sub", c.title));
  li.append(head);
  for (const m of c.meetings) {
    const range = m.dateStart === m.dateEnd ? frDate(m.dateStart) : `${frDate(m.dateStart)} → ${frDate(m.dateEnd)}`;
    li.append(el("div", "sub", `${WEEKDAY_NAMES[m.weekday]} ${m.start}–${m.end} · ${m.location || "local à confirmer"} · ${range}`));
  }
  for (const n of c.notes ?? []) li.append(el("div", "sub", `ℹ ${n}`));
  return li;
}

function examItem(e: Exam, today: string): HTMLElement {
  const li = el("li", e.date < today ? "past" : "");
  const head = el("div", "head");
  head.append(el("span", "code", `${e.courseCode.replace(/^([A-Z]+)(\d)/, "$1 $2")} — ${e.label}`), el("span", "sub", frDate(e.date)));
  li.append(head, el("div", "sub", `${e.start}–${e.end} · ${e.location || "local à confirmer"}`));
  return li;
}

function conflictItem(c: Conflict): HTMLElement {
  const li = el("li", "");
  li.append(el("div", "conflict", `${frDate(c.date)} ${c.start}–${c.end}`), el("div", "sub", `${c.a} ↔ ${c.b}`));
  return li;
}

function render(state: StoredState): void {
  const now = localNow();
  const schedule = currentTerm(state, now.date);
  $("empty").hidden = Boolean(schedule);
  $("content").hidden = !schedule;
  $("captured").textContent = state.lastCapturedAt ? `Capturé le ${new Date(state.lastCapturedAt).toLocaleString("fr-CA")}` : "";
  if (!schedule) {
    $("term").textContent = "";
    return;
  }

  $("term").textContent = schedule.term.label;
  const excluded = excludedDates(schedule.term.code);
  const notice = $("notice");
  const source = state.sources[schedule.term.code];
  if (excluded.length === 0) {
    notice.textContent = `Trimestre ${schedule.term.code} inconnu du calendrier universitaire : la relâche et les congés ne seront pas exclus.`;
    notice.hidden = false;
  } else if (source === "centre") {
    notice.textContent = "Horaire capturé depuis le Centre étudiant (sans dates ni examens). Ouvrez « Horaire hebdomadaire » puis « Liste » pour tout récupérer.";
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }

  const next = nextExam(schedule.exams, now.dateTime);
  $("next-exam").textContent = next
    ? `${next.exam.courseCode} — ${next.exam.label} le ${frDate(next.exam.date)} à ${next.exam.start} (${badgeText(next) === "0" ? "aujourd'hui" : `dans ${next.daysLeft} jour${next.daysLeft > 1 ? "s" : ""}`})`
    : schedule.exams.length ? "Tous les examens sont passés." : "Aucun examen dans l'horaire capturé.";

  const conflicts = findConflicts(expandSchedule(schedule, { excludedDates: excluded }));
  const ul = $("conflicts");
  ul.replaceChildren(...conflicts.map(conflictItem));
  $("conflicts-title").textContent = conflicts.length ? `Conflits (${conflicts.length})` : "Conflits";
  if (!conflicts.length) ul.append(el("li", "muted", "Aucun chevauchement détecté."));

  $("courses").replaceChildren(...schedule.courses.map(courseItem));
  $("exams").replaceChildren(...schedule.exams.map((e) => examItem(e, now.date)));
  if (!schedule.exams.length) $("exams").append(el("li", "muted", "Aucun examen."));

  wireExport(schedule, excluded, now.iso);
}

function wireExport(schedule: Schedule, excluded: string[], nowIso: string): void {
  const ics = () => generateIcs(schedule, { excludedDates: excluded, dtstamp: nowIso });
  const fileName = `horaire-udem-${schedule.term.code}.ics`;
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
  const schedule = parsePastedText(text, { capturedAt: localNow().iso });
  if (schedule.courses.length === 0) {
    err.textContent = "Aucun cours reconnu. Copiez tout le texte de la page « Votre horaire cours » (vue Liste).";
    err.hidden = false;
    return;
  }
  const source = schedule.exams.length || schedule.courses.some((c) => c.meetings.some((m) => m.dateStart)) ? "liste" : "centre";
  await send({ type: "SCHEDULE_CAPTURED", schedule, source });
  $<HTMLTextAreaElement>(textareaId).value = "";
  await refresh();
}

async function refresh(): Promise<void> {
  const state = await send<StoredState>({ type: "GET_STATE" });
  render(state);
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

document.addEventListener("DOMContentLoaded", () => {
  $("open-synchro").addEventListener("click", openSynchro);
  $("open-synchro-2").addEventListener("click", openSynchro);
  $("report").addEventListener("click", reportBug);
  $("clear").addEventListener("click", async (ev) => {
    ev.preventDefault();
    await send({ type: "CLEAR_ALL" });
    await refresh();
  });
  $("paste-btn").addEventListener("click", () => void importPasted("paste", "paste-error"));
  $("paste-btn-2").addEventListener("click", () => void importPasted("paste-2", "paste-error-2"));
  void refresh();
});
