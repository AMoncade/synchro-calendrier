// Expansion d'un Schedule en occurrences datées.
//
// Aucune notion de calendrier universitaire ici : les dates à exclure (congés,
// semaine de relâche…) arrivent en paramètre. Les dates sont manipulées en UTC
// pur : `new Date("2026-09-01")` suivi de `getDay()` en heure locale décale d'un
// jour sous les fuseaux négatifs, on n'utilise donc que Date.UTC / getUTC*.
// Aucun appel à Date.now() : la sortie ne dépend que des entrées.

import type { Course, Exam, Meeting, Occurrence, Schedule, Weekday } from "./model";

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ExpandOptions {
  /** Dates "AAAA-MM-JJ" sur lesquelles aucune séance n'a lieu. */
  excludedDates: string[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "AAAA-MM-JJ" → millisecondes UTC à minuit. Lance si la date est invalide. */
export function dateToUtc(date: string): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Date invalide (attendu AAAA-MM-JJ) : ${date}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  // Date.UTC normalise silencieusement (2026-02-30 → 2 mars) : on vérifie.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`Date inexistante : ${date}`);
  }
  return ms;
}

/** Millisecondes UTC → "AAAA-MM-JJ". */
export function utcToDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Ajoute `days` jours (négatif accepté) à une date "AAAA-MM-JJ". */
export function addDays(date: string, days: number): string {
  return utcToDate(dateToUtc(date) + days * DAY_MS);
}

/** Jour de semaine ISO (1 = lundi … 7 = dimanche) d'une date "AAAA-MM-JJ". */
export function isoWeekday(date: string): Weekday {
  const dow = new Date(dateToUtc(date)).getUTCDay();
  return (dow === 0 ? 7 : dow) as Weekday;
}

/**
 * Toutes les dates d'une séance hebdomadaire entre dateStart et dateEnd inclus,
 * sans aucune exclusion, triées. Vide si dateEnd < dateStart.
 */
export function meetingDates(meeting: Meeting): string[] {
  const startMs = dateToUtc(meeting.dateStart);
  const endMs = dateToUtc(meeting.dateEnd);
  if (endMs < startMs) return [];
  const shift = (meeting.weekday - isoWeekday(meeting.dateStart) + 7) % 7;
  const dates: string[] = [];
  for (let ms = startMs + shift * DAY_MS; ms <= endMs; ms += 7 * DAY_MS) {
    dates.push(utcToDate(ms));
  }
  return dates;
}

/** "MAT1400" → "MAT 1400" (déjà espacé : inchangé). */
export function formatCourseCode(code: string): string {
  const m = /^([A-Za-z]+)\s*(\d.*)$/.exec(code.trim());
  return m ? `${m[1]} ${m[2]}` : code.trim();
}

/** "MAT 1400-A Calcul 1 (TH)". */
export function courseLabel(course: Course): string {
  const section = course.section ? `-${course.section}` : "";
  return `${formatCourseCode(course.code)}${section} ${course.title} (${course.component})`;
}

/** "MAT 1400 — Examen intra" / "… — Examen final" / "… — <label>". */
export function examLabel(exam: Exam): string {
  const kind =
    exam.kind === "intra" ? "Examen intra"
    : exam.kind === "final" ? "Examen final"
    : exam.label || "Examen";
  return `${formatCourseCode(exam.courseCode)} — ${kind}`;
}

/** Ordre canonique : date, heure de début, heure de fin, puis libellé. */
export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  return (
    a.date.localeCompare(b.date) ||
    a.start.localeCompare(b.start) ||
    a.end.localeCompare(b.end) ||
    a.label.localeCompare(b.label)
  );
}

/**
 * Ramène chaque séance hebdomadaire et chaque examen à des dates concrètes.
 * Les séances tombant sur une date exclue sont retirées ; les examens ne sont
 * jamais exclus (un examen annoncé un jour férié reste un examen).
 */
export function expandSchedule(schedule: Schedule, opts: ExpandOptions): Occurrence[] {
  const excluded = new Set(opts.excludedDates);
  const out: Occurrence[] = [];

  for (const course of schedule.courses) {
    const label = courseLabel(course);
    for (const meeting of course.meetings) {
      for (const date of meetingDates(meeting)) {
        if (excluded.has(date)) continue;
        out.push({
          kind: "cours",
          courseCode: course.code,
          label,
          date,
          start: meeting.start,
          end: meeting.end,
          location: meeting.location,
        });
      }
    }
  }

  for (const exam of schedule.exams) {
    out.push({
      kind: "examen",
      courseCode: exam.courseCode,
      label: examLabel(exam),
      date: exam.date,
      start: exam.start,
      end: exam.end,
      location: exam.location,
    });
  }

  return out.sort(compareOccurrences);
}
