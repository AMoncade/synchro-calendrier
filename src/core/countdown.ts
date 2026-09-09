// Compte à rebours vers le prochain examen, pour le badge de l'extension.
// L'instant courant est toujours fourni par l'appelant (aucun Date.now() ici).

import type { Exam } from "./model";

export interface NextExam {
  exam: Exam;
  /** Jours civils entre aujourd'hui et la date de l'examen (aujourd'hui → 0, demain → 1). */
  daysLeft: number;
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Numéro de jour civil (jours écoulés depuis 1970-01-01), sans fuseau : Date.UTC est pure. */
function dayNumber(date: string): number {
  const m = LOCAL_DATE.exec(date);
  if (!m) throw new RangeError(`Date invalide (attendu AAAA-MM-JJ) : ${date}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

function compareStrings(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Ordre déterministe des examens : date, début, fin, cours, libellé. */
function compareExams(x: Exam, y: Exam): number {
  return (
    compareStrings(x.date, y.date) ||
    compareStrings(x.start, y.start) ||
    compareStrings(x.end, y.end) ||
    compareStrings(x.courseCode, y.courseCode) ||
    compareStrings(x.label, y.label)
  );
}

/**
 * Prochain examen non terminé à l'instant `now` (ISO local « AAAA-MM-JJTHH:MM »).
 * Un examen est terminé si sa date est passée, ou si c'est aujourd'hui et que `end` < heure
 * courante. Retourne `undefined` s'il n'en reste aucun.
 */
export function nextExam(exams: Exam[], now: string): NextExam | undefined {
  const m = LOCAL_DATETIME.exec(now);
  if (!m) throw new RangeError(`Instant invalide (attendu AAAA-MM-JJTHH:MM) : ${now}`);
  const today = `${m[1]}-${m[2]}-${m[3]}`;
  const time = `${m[4]}:${m[5]}`;

  let best: Exam | undefined;
  for (const exam of exams) {
    const over = exam.date < today || (exam.date === today && exam.end < time);
    if (over) continue;
    if (!best || compareExams(exam, best) < 0) best = exam;
  }
  if (!best) return undefined;
  return { exam: best, daysLeft: dayNumber(best.date) - dayNumber(today) };
}

/** Texte du badge Chrome (4 caractères max) : "" si aucun examen, "0"…"99", puis "99+". */
export function badgeText(result: NextExam | undefined): string {
  if (!result) return "";
  return result.daysLeft > 99 ? "99+" : String(result.daysLeft);
}
