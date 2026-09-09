// Génération d'un fichier ICS (RFC 5545) à partir d'un Schedule.
//
// Un VEVENT récurrent (RRULE hebdomadaire + EXDATE) par Meeting, un VEVENT
// simple par Exam, un bloc VTIMEZONE America/Toronto complet : sans lui,
// Outlook décale les cours après le passage à l'heure d'hiver.
// La sortie est entièrement déterministe : DTSTAMP vient de l'appelant,
// les UID sont dérivés des données. Ré-importer remplace, ne duplique pas.

import type { Course, Exam, Meeting, Schedule } from "./model";
import { dateToUtc, meetingDates } from "./expand";

export const TZID = "America/Toronto";
export const PRODID = "-//synchro-calendrier//UdeM//FR";
export const UID_DOMAIN = "synchro-calendrier";
/** Longueur maximale d'une ligne physique, en octets, CRLF exclu (RFC 5545 §3.1). */
export const MAX_LINE_OCTETS = 75;

/** Rappels à poser sur les événements (spec v2 §9.2). */
export interface AlarmOptions {
  /** Deux rappels : 24 h puis 1 h avant. Activé par défaut. */
  exams: boolean;
  /** Un rappel 15 min avant chaque séance. Désactivé par défaut. */
  courses: boolean;
}

export const DEFAULT_ALARMS: AlarmOptions = { exams: true, courses: false };

export interface IcsOptions {
  /** Dates "AAAA-MM-JJ" sans séance (deviennent des EXDATE). */
  excludedDates: string[];
  /** Instant de génération : ISO 8601 ("2026-09-09T12:00:00Z") ou déjà "AAAAMMJJTHHMMSSZ". */
  dtstamp: string;
  /** Nom du calendrier (X-WR-CALNAME). Défaut : "UdeM — <term.label>". */
  calName?: string;
  /** Rappels. Défaut : `DEFAULT_ALARMS`. */
  alarms?: Partial<AlarmOptions>;
}

const COMPONENT_NAMES: Record<Course["component"], string> = {
  TH: "Théorie",
  TP: "Travaux pratiques",
  LAB: "Laboratoire",
  AUTRE: "Autre",
};

// ---------------------------------------------------------------------------
// Libellés v2
//
// Volontairement locaux à ce module, et non repris de `expand.ts` : les
// libellés d'`expand.ts` (« MAT 1400-A Calcul 1 (TH) ») servent au détecteur de
// conflits et à l'affichage du popup, où le titre du cours est utile. Dans un
// agenda, le titre encombre la tuile et le sigle sans espace se cherche mieux.
// Une autre session écrit un module `format/` avec la même règle de local :
// à dédoublonner ensuite, pas maintenant (aucune dépendance croisée).

/** "MAT 1400" → "MAT1400". Le modèle promet déjà la forme compacte ; on la garantit. */
export function compactCode(code: string): string {
  return code.replace(/\s+/g, "");
}

/** `MAT1400-A — Théorie`. */
export function courseSummary(course: Course): string {
  const code = compactCode(course.code);
  const head = course.section ? `${code}-${course.section}` : code;
  return `${head} — ${COMPONENT_NAMES[course.component]}`;
}

/** `MAT1400 — Examen intra` / `— Examen final` / le `label` sinon. */
export function examSummary(exam: Exam): string {
  const kind =
    exam.kind === "intra" ? "Examen intra"
    : exam.kind === "final" ? "Examen final"
    : exam.label || "Examen";
  return `${compactCode(exam.courseCode)} — ${kind}`;
}

/**
 * « B-0215  Pav. 3200 J.-Brillant » → « B-0215, Pavillon J.-Brillant ».
 * Le numéro civique (3200) est du bruit dans un agenda. « En ligne » et tout
 * texte qui ne suit pas ce motif passent inchangés : mieux vaut recopier ce que
 * Synchro affiche que deviner.
 */
export function formatLocation(location: string): string {
  const raw = location.trim();
  const m = /^(.+?)\s+Pav\.\s+(?:\d+\s+)?(.+)$/.exec(raw);
  if (!m) return raw;
  return `${m[1]!.trim()}, Pavillon ${m[2]!.trim()}`;
}

// ---------------------------------------------------------------------------
// Utilitaires texte

/** Échappe une valeur TEXT (RFC 5545 §3.3.11) : `\`, `;`, `,` et sauts de ligne. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * Plie une ligne logique en lignes physiques de MAX_LINE_OCTETS octets UTF-8
 * au plus (continuation = espace en tête, qui compte dans le quota). On ne
 * coupe jamais au milieu d'un caractère multi-octets.
 */
export function foldLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let currentOctets = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (currentOctets + size > MAX_LINE_OCTETS) {
      out.push(current);
      current = " ";
      currentOctets = 1;
    }
    current += ch;
    currentOctets += size;
  }
  out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// Dates et fuseau America/Toronto

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** "AAAA-MM-JJ" + "HH:MM" (ou "HH:MM:SS") → "AAAAMMJJTHHMMSS" (heure locale, sans Z). */
export function toIcsLocal(date: string, time: string): string {
  const m = TIME.exec(time);
  if (!m) throw new Error(`Heure invalide (attendu HH:MM) : ${time}`);
  dateToUtc(date); // valide le format de la date
  return `${date.replace(/-/g, "")}T${m[1]}${m[2]}${m[3] ?? "00"}`;
}

/** Date "AAAA-MM-JJ" du n-ième dimanche d'un mois (1 = janvier). */
function nthSunday(year: number, month: number, n: number): string {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((7 - firstDow) % 7) + 7 * (n - 1);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Décalage UTC (minutes) de America/Toronto pour une date-heure locale :
 * -240 en heure avancée (2e dimanche de mars 02:00 → 1er dimanche de novembre
 * 02:00), -300 en heure normale. L'heure fantôme 02:00–02:59 de mars est prise
 * en heure avancée, l'heure ambiguë 01:00–01:59 de novembre en heure avancée
 * (première occurrence).
 */
export function torontoUtcOffsetMinutes(date: string, time: string): number {
  const year = Number(date.slice(0, 4));
  const dstStart = nthSunday(year, 3, 2);
  const dstEnd = nthSunday(year, 11, 1);
  const hhmm = time.slice(0, 5);
  let dst: boolean;
  if (date === dstStart) dst = hhmm >= "02:00";
  else if (date === dstEnd) dst = hhmm < "02:00";
  else dst = date > dstStart && date < dstEnd;
  return dst ? -240 : -300;
}

function formatUtcBasic(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/** Date-heure locale Toronto → "AAAAMMJJTHHMMSSZ" (UTC). */
export function torontoLocalToUtc(date: string, time: string): string {
  const m = TIME.exec(time);
  if (!m) throw new Error(`Heure invalide (attendu HH:MM) : ${time}`);
  const localMs =
    dateToUtc(date) + (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? "0")) * 1000;
  return formatUtcBasic(localMs - torontoUtcOffsetMinutes(date, time) * 60_000);
}

/** Normalise `opts.dtstamp` en "AAAAMMJJTHHMMSSZ". */
export function formatDtstamp(input: string): string {
  if (/^\d{8}T\d{6}Z$/.test(input)) return input;
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) throw new Error(`dtstamp invalide : ${input}`);
  return formatUtcBasic(ms);
}

// ---------------------------------------------------------------------------
// Identifiants

/** Nettoie un fragment d'UID : ni espaces ni caractères hors ASCII sûr. */
function uidPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "");
}

/**
 * `<term>-<code>-<section>-<composante>-<jour ISO>-<HHMM>-<AAAAMMJJ début>@synchro-calendrier`.
 * La date de début fait partie de l'identité : Synchro coupe une même séance en
 * plusieurs plages (avant/après la relâche), qui sont des VEVENT distincts.
 */
export function meetingUid(termCode: string, course: Course, meeting: Meeting): string {
  const parts = [
    termCode,
    course.code,
    course.section,
    course.component,
    String(meeting.weekday),
    meeting.start.replace(":", ""),
    meeting.dateStart.replace(/-/g, ""),
  ];
  return `${parts.map(uidPart).join("-")}@${UID_DOMAIN}`;
}

/** `<term>-<code>-examen-<date>@synchro-calendrier`. */
export function examUid(termCode: string, exam: Exam): string {
  return `${[termCode, exam.courseCode, "examen", exam.date].map(uidPart).join("-")}@${UID_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Blocs

function vtimezone(): string[] {
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    `X-LIC-LOCATION:${TZID}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

/**
 * Titre du cours en première ligne ; le nº de classe et la remarque de séance,
 * s'ils existent, en deuxième. Le volet et la section sont déjà dans le SUMMARY,
 * les répéter ici n'apprendrait rien.
 */
function courseDescription(course: Course, meeting: Meeting): string {
  const extras: string[] = [];
  if (course.classNumber) extras.push(`classe nº ${course.classNumber}`);
  if (meeting.note) extras.push(meeting.note);
  return extras.length > 0 ? `${course.title}\n${extras.join(" — ")}` : course.title;
}

/**
 * Bloc VALARM d'affichage. `TRIGGER` est une durée négative relative au DTSTART
 * (RFC 5545 §3.8.6.3) ; `DESCRIPTION` reprend le SUMMARY, que les clients
 * affichent tel quel dans la notification.
 */
function valarm(trigger: string, description: string): string[] {
  return [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `TRIGGER:${trigger}`,
    `DESCRIPTION:${escapeText(description)}`,
    "END:VALARM",
  ];
}

/**
 * VEVENT récurrent d'une séance. DTSTART = première occurrence non exclue
 * (un DTSTART lui-même en EXDATE est mal toléré par certains clients) ; les
 * dates exclues postérieures deviennent des EXDATE à la même heure.
 * Retourne [] si toutes les occurrences sont exclues ou si la plage est vide.
 */
function meetingEvent(
  termCode: string,
  course: Course,
  meeting: Meeting,
  excluded: Set<string>,
  dtstamp: string,
  alarms: AlarmOptions,
): string[] {
  const dates = meetingDates(meeting);
  const firstIndex = dates.findIndex((d) => !excluded.has(d));
  if (firstIndex === -1) return [];
  const first = dates[firstIndex] as string;
  const exdates = dates.slice(firstIndex + 1).filter((d) => excluded.has(d));

  // UNTIL doit être en UTC quand DTSTART porte un TZID (RFC 5545 §3.3.10).
  // On prend 23:59:59 à la date de fin en heure de Toronto, converti en UTC :
  // « dateEnd 23:59:59Z » tronquerait un cours du soir (20:00 EDT = 00:00Z).
  const until = torontoLocalToUtc(meeting.dateEnd, "23:59:59");

  const lines = [
    "BEGIN:VEVENT",
    `UID:${meetingUid(termCode, course, meeting)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${TZID}:${toIcsLocal(first, meeting.start)}`,
    `DTEND;TZID=${TZID}:${toIcsLocal(first, meeting.end)}`,
    `RRULE:FREQ=WEEKLY;UNTIL=${until}`,
  ];
  if (exdates.length > 0) {
    lines.push(`EXDATE;TZID=${TZID}:${exdates.map((d) => toIcsLocal(d, meeting.start)).join(",")}`);
  }
  const summary = courseSummary(course);
  lines.push(
    `SUMMARY:${escapeText(summary)}`,
    `LOCATION:${escapeText(formatLocation(meeting.location))}`,
    `DESCRIPTION:${escapeText(courseDescription(course, meeting))}`,
    "CATEGORIES:Cours",
  );
  if (alarms.courses) lines.push(...valarm("-PT15M", summary));
  lines.push("END:VEVENT");
  return lines;
}

function examEvent(termCode: string, exam: Exam, dtstamp: string, alarms: AlarmOptions): string[] {
  const summary = examSummary(exam);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${examUid(termCode, exam)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${TZID}:${toIcsLocal(exam.date, exam.start)}`,
    `DTEND;TZID=${TZID}:${toIcsLocal(exam.date, exam.end)}`,
    `SUMMARY:${escapeText(summary)}`,
    `LOCATION:${escapeText(formatLocation(exam.location))}`,
  ];
  if (exam.label) lines.push(`DESCRIPTION:${escapeText(exam.label)}`);
  lines.push("CATEGORIES:Examen");
  // Deux rappels : la veille pour réviser, une heure avant pour partir.
  if (alarms.exams) lines.push(...valarm("-PT24H", summary), ...valarm("-PT1H", summary));
  lines.push("END:VEVENT");
  return lines;
}

// ---------------------------------------------------------------------------
// Point d'entrée

/** Produit le texte ICS complet : lignes CRLF, pliées à 75 octets. */
export function generateIcs(schedule: Schedule, opts: IcsOptions): string {
  const dtstamp = formatDtstamp(opts.dtstamp);
  const excluded = new Set(opts.excludedDates);
  const termCode = schedule.term.code;
  const calName = opts.calName ?? `UdeM — ${schedule.term.label}`;
  const alarms: AlarmOptions = { ...DEFAULT_ALARMS, ...opts.alarms };

  const logical: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName)}`,
    `X-WR-TIMEZONE:${TZID}`,
    ...vtimezone(),
  ];

  for (const course of schedule.courses) {
    for (const meeting of course.meetings) {
      logical.push(...meetingEvent(termCode, course, meeting, excluded, dtstamp, alarms));
    }
  }
  for (const exam of schedule.exams) {
    logical.push(...examEvent(termCode, exam, dtstamp, alarms));
  }
  logical.push("END:VCALENDAR");

  return logical.flatMap(foldLine).join("\r\n") + "\r\n";
}
