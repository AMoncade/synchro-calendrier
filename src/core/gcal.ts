// Lien « Ajouter à Google Agenda » pour un événement unique (spec v2 §9.4).
//
// Le formulaire TEMPLATE de Google ne crée qu'un événement à la fois : il est
// réservé aux examens, l'export ICS restant la voie de l'horaire complet.
//
// Rien ne part d'ici : la fonction fabrique une URL, c'est la personne qui
// choisit de l'ouvrir. Seuls les six champs reçus y figurent — aucun matricule,
// aucun trimestre, aucun identifiant de capture.
//
// Module pur : pas d'API navigateur, pas de `Date.now()`.

/** Fuseau déclaré à Google, pour que 13:30 reste 13:30 quel que soit le lecteur. */
export const GCAL_TZ = "America/Toronto";
export const GCAL_BASE = "https://calendar.google.com/calendar/render";

export interface GoogleCalendarEvent {
  /** Titre affiché, par ex. « MAT1400 — Examen intra ». */
  title: string;
  /** "AAAA-MM-JJ". */
  date: string;
  /** "HH:MM" (ou "HH:MM:SS"), heure locale de Montréal. */
  start: string;
  /** "HH:MM" (ou "HH:MM:SS"), heure locale de Montréal. */
  end: string;
  location?: string;
  details?: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** "2026-10-07" + "13:30" → "20261007T133000" (heure locale, jamais UTC). */
function stamp(date: string, time: string): string {
  const d = DATE.exec(date);
  if (!d) throw new Error(`Date invalide (attendu AAAA-MM-JJ) : ${date}`);
  const t = TIME.exec(time);
  if (!t) throw new Error(`Heure invalide (attendu HH:MM) : ${time}`);
  return `${d[1]}${d[2]}${d[3]}T${t[1]}${t[2]}${t[3] ?? "00"}`;
}

/**
 * URL du formulaire pré-rempli de Google Agenda.
 *
 * Les heures sont locales et accompagnées de `ctz` : convertir en UTC nous
 * ferait porter le calcul du changement d'heure, alors que Google le fait
 * correctement à partir du fuseau nommé.
 *
 * Le `/` qui sépare les deux horodatages de `dates` est laissé littéral : c'est
 * un caractère autorisé dans une chaîne de requête, et la forme attendue par
 * Google. Toutes les autres valeurs passent par `encodeURIComponent`.
 */
export function googleCalendarUrl(input: GoogleCalendarEvent): string {
  const dates = `${stamp(input.date, input.start)}/${stamp(input.date, input.end)}`;
  const params = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(input.title)}`,
    `dates=${dates}`,
    `ctz=${encodeURIComponent(GCAL_TZ)}`,
  ];
  if (input.location) params.push(`location=${encodeURIComponent(input.location)}`);
  if (input.details) params.push(`details=${encodeURIComponent(input.details)}`);
  return `${GCAL_BASE}?${params.join("&")}`;
}
