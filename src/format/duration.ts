// Durées d'une séance, à partir des heures « HH:MM » du modèle.

const TIME = /^(\d{1,2}):(\d{2})$/;

/** « 08:30 » → 510 minutes depuis minuit. Lance si l'heure est mal formée. */
export function minutesOfDay(time: string): number {
  const m = TIME.exec(time.trim());
  if (!m) throw new RangeError(`Heure invalide (attendu HH:MM) : ${time}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new RangeError(`Heure inexistante : ${time}`);
  return hour * 60 + minute;
}

/**
 * Durée en minutes entre deux heures de la même journée : « 08:30 » → « 10:30 »
 * donne 120. Une plage vide donne 0. Le résultat est signé : une fin antérieure
 * au début donne un nombre négatif plutôt qu'une valeur corrigée en silence,
 * pour que des données douteuses restent visibles.
 */
export function minutesBetween(start: string, end: string): number {
  return minutesOfDay(end) - minutesOfDay(start);
}

/** 42 → « 42 min » ; 72 → « 1 h 12 » ; 120 → « 2 h » ; 0 → « 0 min ». */
export function formatMinutes(minutes: number): string {
  if (!Number.isInteger(minutes)) throw new RangeError(`Durée non entière : ${minutes}`);
  if (minutes < 0) throw new RangeError(`Durée négative : ${minutes}`);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

/** Durée d'une séance, prête à afficher : « 08:30 »–« 10:30 » → « 2 h ». */
export function formatRange(start: string, end: string): string {
  return formatMinutes(minutesBetween(start, end));
}
