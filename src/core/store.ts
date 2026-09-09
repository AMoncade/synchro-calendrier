// Logique pure de l'état persisté : fusion des captures, choix du trimestre
// courant. Aucune API navigateur ; `today` est toujours un paramètre.

import type { CaptureSource, StoredState } from "../lib/messages";
import type { Exam, Schedule } from "./model";

export function emptyState(): StoredState {
  return { schedules: {}, sources: {}, lastCapturedAt: null, lastSource: null };
}

/**
 * Intègre une capture. Une capture « liste » (complète) remplace l'entrée de son
 * trimestre ; une capture « centre » (résumé sans dates ni examens) ne s'installe
 * que si le trimestre est absent ou lui-même issu du Centre étudiant.
 * Retourne toujours un nouvel objet ; l'entrée n'est pas mutée.
 */
export function mergeCapture(state: StoredState, schedule: Schedule, source: CaptureSource): StoredState {
  const code = schedule.term.code;
  const existing = state.sources[code];
  const accept = source === "liste" || existing === undefined || existing === "centre";
  const schedules = { ...state.schedules };
  const sources = { ...state.sources };
  if (accept) {
    schedules[code] = schedule;
    sources[code] = source;
  }
  return {
    schedules,
    sources,
    lastCapturedAt: schedule.capturedAt,
    lastSource: source,
  };
}

/**
 * Trimestre à afficher : celui qui contient `today`, sinon le prochain à venir,
 * sinon le plus récent.
 */
export function currentTerm(state: StoredState, today: string): Schedule | undefined {
  const all = Object.values(state.schedules).sort((a, b) => a.term.start.localeCompare(b.term.start));
  if (all.length === 0) return undefined;
  const ongoing = all.find((s) => s.term.start <= today && today <= s.term.end);
  if (ongoing) return ongoing;
  const upcoming = all.find((s) => s.term.start > today);
  return upcoming ?? all[all.length - 1];
}

/** Tous les examens de tous les trimestres, triés par date puis heure. */
export function allExams(state: StoredState): Exam[] {
  return Object.values(state.schedules)
    .flatMap((s) => s.exams)
    .sort((a, b) => (a.date + a.start + a.courseCode).localeCompare(b.date + b.start + b.courseCode));
}
