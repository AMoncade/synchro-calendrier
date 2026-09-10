// Échéances : état et sélection (docs/ARCHITECTURE.md §7).
//
// Deux sources se rejoignent ici — les quiz et devoirs lus sur StudiUM
// (`core/studium.ts`) et les événements ajoutés à la main dans le popup. Ce
// module est la logique pure appelée par le service worker (fusion d'une
// synchronisation, ajout, retrait) et par le popup (sélection, statut,
// validation du formulaire).
//
// Pur et déterministe comme le reste de `core/` : aucune API navigateur, aucun
// `Date.now()`, aucun `crypto.randomUUID()`. L'instant courant est toujours un
// paramètre « AAAA-MM-JJTHH:MM » (lu par `parseLocalNow`, comme `today.ts`) et
// l'uuid d'une échéance manuelle est fourni par l'appelant.
//
// Les instants zéro-remplis se comparent comme des chaînes : c'est voulu, même
// choix que `store.currentTerm`, et c'est ce qui garde le module sans `Date`.

import type { StoredState, StudiumStatus } from "../lib/messages";
import type { Deadline, DeadlineKind, StudiumCourse } from "./model";
import { parseLocalNow } from "./alerts";
import { addDays, dateToUtc } from "./expand";

/** Surcharge de liaison : `courseid` StudiUM (en chaîne) → sigle, `null` = non lié. */
export type CourseLinks = Record<string, string | null>;

/** Préfixe des identifiants venus de StudiUM (`studium:<cmid>`). */
const STUDIUM_PREFIX = "studium:";

/** Longueur maximale d'un titre saisi à la main, en caractères. */
export const MAX_TITLE_LENGTH = 120;
/** Heure d'échéance retenue quand le formulaire n'en donne aucune. */
export const DEFAULT_DUE_TIME = "23:59";
/** Heure d'ouverture retenue quand seule la date d'ouverture est donnée. */
export const DEFAULT_START_TIME = "00:00";
/** Nature retenue quand le formulaire n'en donne aucune. */
export const DEFAULT_KIND: DeadlineKind = "evenement";

const DEADLINE_KINDS: readonly DeadlineKind[] = ["quiz", "devoir", "evenement", "autre"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COURSE_CODE = /^[A-Z]{3}\d{4}$/;

// ---------------------------------------------------------------------------
// État : ce que le service worker écrit dans chrome.storage.local
// ---------------------------------------------------------------------------

/** Copie des échéances de l'état, indexées par id. Jamais l'objet stocké lui-même. */
function deadlineMap(state: StoredState): Record<string, Deadline> {
  return { ...(state.deadlines ?? {}) };
}

/**
 * Intègre une synchronisation StudiUM. Une synchronisation est une **vue
 * complète** du calendrier : toutes les entrées `source === "studium"` sont
 * remplacées par celles reçues (une activité retirée de StudiUM disparaît donc
 * d'ici), les entrées manuelles sont gardées telles quelles, et les ids que
 * l'utilisateur a masqués (`hiddenDeadlines`) ne sont pas réinstallés.
 *
 * Retourne toujours un nouvel objet ; l'entrée n'est pas mutée (même style que
 * `store.mergeCapture`).
 */
export function mergeStudium(
  state: StoredState,
  deadlines: Deadline[],
  courses: StudiumCourse[],
  syncedAt: string,
): StoredState {
  const hidden = new Set(state.hiddenDeadlines ?? []);
  const kept: Record<string, Deadline> = {};
  for (const [id, d] of Object.entries(state.deadlines ?? {})) {
    if (d.source !== "studium") kept[id] = d;
  }
  for (const d of deadlines) {
    if (hidden.has(d.id)) continue;
    kept[d.id] = d;
  }
  const studium: StudiumStatus = { lastSyncAt: syncedAt, lastError: null, courses };
  return { ...state, deadlines: kept, studium };
}

/**
 * Note l'échec d'une synchronisation. Les échéances déjà connues restent en
 * place — un StudiUM injoignable ne doit pas vider l'écran — et `lastSyncAt`
 * garde la date de la dernière synchronisation *réussie*, pour que le popup
 * puisse dire « dernière synchro il y a 3 jours » sous le message d'erreur.
 *
 * `at`, l'instant de l'échec, n'a pas encore de champ où aller : `StudiumStatus`
 * (`src/lib/messages.ts`, propriété de l'intégratrice) n'expose que
 * `lastSyncAt`, `lastError` et `courses`. Le paramètre est gardé parce que le
 * message `STUDIUM_FAILED` le transporte déjà ; patch proposé dans le rapport
 * de phase.
 */
export function markStudiumFailed(state: StoredState, error: string, at: string): StoredState {
  void at;
  const previous = state.studium;
  const studium: StudiumStatus = {
    lastSyncAt: previous?.lastSyncAt ?? null,
    lastError: error,
    courses: previous?.courses ?? [],
  };
  return { ...state, studium };
}

/**
 * Installe ou remplace une échéance. Si son id figurait dans `hiddenDeadlines`,
 * il en sort : la remettre tout en la gardant masquée serait un état
 * incohérent, que la prochaine synchronisation trancherait en la faisant
 * disparaître à nouveau.
 */
export function upsertDeadline(state: StoredState, d: Deadline): StoredState {
  const deadlines = deadlineMap(state);
  deadlines[d.id] = d;
  const next: StoredState = { ...state, deadlines };
  const hidden = state.hiddenDeadlines;
  if (hidden?.includes(d.id)) {
    next.hiddenDeadlines = hidden.filter((id) => id !== d.id);
  }
  return next;
}

/**
 * Retire une échéance. Une manuelle est simplement supprimée ; une StudiUM est
 * en plus consignée dans `hiddenDeadlines`, sans quoi la prochaine
 * synchronisation la ramènerait.
 *
 * L'id d'une échéance absente de l'état (popup en retard d'une synchro) est
 * jugé sur son préfixe : mieux vaut masquer une StudiUM déjà partie que de la
 * voir revenir.
 */
export function removeDeadline(state: StoredState, id: string): StoredState {
  const existing = state.deadlines?.[id];
  const fromStudium = existing ? existing.source === "studium" : id.startsWith(STUDIUM_PREFIX);
  const deadlines = deadlineMap(state);
  delete deadlines[id];
  const next: StoredState = { ...state, deadlines };
  if (fromStudium) {
    const hidden = state.hiddenDeadlines ?? [];
    if (!hidden.includes(id)) next.hiddenDeadlines = [...hidden, id];
  }
  return next;
}

/**
 * Lie un site StudiUM à un sigle Synchro, ou le déclare explicitement non lié
 * (`null`). Le sigle est normalisé comme dans le formulaire manuel
 * (« mat 1400 » → « MAT1400 ») et une chaîne vide vaut « non lié ». La valeur
 * n'est pas validée ici : l'écran de liaison ne propose que des sigles tirés de
 * l'horaire.
 */
export function setCourseLink(state: StoredState, studiumCourseId: number, courseCode: string | null): StoredState {
  const normalized = courseCode === null ? null : normalizeCourseCode(courseCode) || null;
  const courseLinks: CourseLinks = { ...(state.courseLinks ?? {}) };
  courseLinks[String(studiumCourseId)] = normalized;
  return { ...state, courseLinks };
}

/**
 * Sigle Synchro d'une échéance. Le choix fait dans l'écran de liaison prime sur
 * la déduction faite au parsing : une entrée `null` veut dire « ce site n'a pas
 * d'équivalent Synchro » et efface donc le sigle déduit.
 */
export function resolveCourseCode(d: Deadline, links: CourseLinks | undefined): string | undefined {
  if (links && d.studiumCourseId !== undefined) {
    const override = links[String(d.studiumCourseId)];
    if (override === null) return undefined;
    if (override !== undefined) return override;
  }
  return d.courseCode;
}

/**
 * Toutes les échéances de l'état, par `due` croissant puis `title`. L'id
 * départage les ex æquo, pour que deux appels sur le même état rendent
 * exactement la même liste.
 */
export function allDeadlines(state: StoredState): Deadline[] {
  return Object.values(state.deadlines ?? {}).sort((a, b) => {
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    const byTitle = a.title.localeCompare(b.title, "fr");
    return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Sélection : ce que le popup affiche
// ---------------------------------------------------------------------------

/**
 * Échéances dont l'instant tombe dans [now, now + horizonDays[ : celle qui
 * échoit à `now` pile compte encore, celle qui échoit à la borne haute est déjà
 * de la fenêtre suivante. L'ordre d'entrée est conservé — donc trié, si la
 * liste vient d'`allDeadlines`.
 */
export function upcomingDeadlines(deadlines: Deadline[], now: string, horizonDays: number): Deadline[] {
  const { date, time } = parseLocalNow(now);
  const from = `${date}T${time}`;
  const limit = `${addDays(date, horizonDays)}T${time}`;
  return deadlines.filter((d) => d.due >= from && d.due < limit);
}

/** Échéances qui tombent le jour « AAAA-MM-JJ » donné. L'ordre d'entrée est conservé. */
export function deadlinesOn(deadlines: Deadline[], date: string): Deadline[] {
  return deadlines.filter((d) => dayOf(d.due) === date);
}

export type DeadlineStatus = "upcoming" | "open" | "due-today" | "overdue";

/**
 * Où en est une échéance à l'instant `now`. Le popup en tire son libellé :
 * « ouvre dans 4 j » (upcoming), « ouvert, à faire avant vendredi 23:59 »
 * (open), « aujourd'hui 23:59 » (due-today), « échue » (overdue).
 *
 * L'ordre des tests compte : une échéance qui tombe aujourd'hui est annoncée
 * comme telle même si sa fenêtre est déjà ouverte, parce que c'est l'échéance
 * qui presse, pas l'ouverture.
 */
export function deadlineStatus(d: Deadline, now: string): DeadlineStatus {
  const { date, time } = parseLocalNow(now);
  const instant = `${date}T${time}`;
  if (d.due < instant) return "overdue";
  if (dayOf(d.due) === date) return "due-today";
  if (d.start !== undefined && d.start <= instant) return "open";
  return "upcoming";
}

/** Jour « AAAA-MM-JJ » d'un instant « AAAA-MM-JJTHH:MM ». */
function dayOf(instant: string): string {
  return instant.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Formulaire manuel : validation avant écriture
// ---------------------------------------------------------------------------

/** Champs du formulaire du popup, tels que saisis. */
export interface ManualDeadlineInput {
  title: string;
  date: string;
  time?: string;
  courseCode?: string;
  kind?: DeadlineKind;
  location?: string;
  note?: string;
  startDate?: string;
  startTime?: string;
}

export type ManualDeadlineResult = { ok: true; deadline: Deadline } | { ok: false; errors: string[] };

/**
 * Valide une saisie et en fait une `Deadline` manuelle. Toutes les erreurs sont
 * rapportées d'un coup, en français : elles vont à l'écran, sous le champ
 * fautif, et corriger un champ ne doit pas révéler l'erreur suivante.
 *
 * `uuid` vient de l'appelant (`crypto.randomUUID()` dans le popup) : `core/`
 * reste pur.
 */
export function validateManual(input: ManualDeadlineInput, uuid: string): ManualDeadlineResult {
  const errors: string[] = [];

  const title = input.title.trim();
  if (title === "") {
    errors.push("Donne un titre à l'échéance.");
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.push(`Le titre ne doit pas dépasser ${MAX_TITLE_LENGTH} caractères.`);
  }

  const date = input.date.trim();
  const dateOk = isRealDate(date);
  if (!dateOk) errors.push("La date doit être au format AAAA-MM-JJ et exister.");

  const time = (input.time ?? "").trim() || DEFAULT_DUE_TIME;
  const timeOk = CLOCK_TIME.test(time);
  if (!timeOk) errors.push("L'heure doit être au format HH:MM, par exemple 23:59.");

  const startDate = (input.startDate ?? "").trim();
  const startTime = (input.startTime ?? "").trim();
  let start: string | undefined;
  if (startDate === "" && startTime !== "") {
    errors.push("Indique aussi la date d'ouverture, pas seulement l'heure.");
  } else if (startDate !== "") {
    const at = startTime || DEFAULT_START_TIME;
    if (!isRealDate(startDate)) {
      errors.push("La date d'ouverture doit être au format AAAA-MM-JJ et exister.");
    } else if (!CLOCK_TIME.test(at)) {
      errors.push("L'heure d'ouverture doit être au format HH:MM, par exemple 08:00.");
    } else {
      start = `${startDate}T${at}`;
    }
  }

  let courseCode: string | undefined;
  const rawCode = (input.courseCode ?? "").trim();
  if (rawCode !== "") {
    const normalized = normalizeCourseCode(rawCode);
    if (!COURSE_CODE.test(normalized)) errors.push("Le sigle doit ressembler à MAT1400.");
    else courseCode = normalized;
  }

  const kind = input.kind ?? DEFAULT_KIND;
  if (!DEADLINE_KINDS.includes(kind)) errors.push("Cette nature d'échéance n'existe pas.");

  // Les deux instants ne se comparent que s'ils ont passé leur propre contrôle ;
  // sinon « 2026-13-40T99:99 » produirait une deuxième erreur, dérivée de la première.
  const due = `${date}T${time}`;
  if (start !== undefined && dateOk && timeOk && start >= due) {
    errors.push("L'ouverture doit précéder l'échéance.");
  }

  if (errors.length > 0) return { ok: false, errors };

  const deadline: Deadline = {
    id: `manuel:${uuid}`,
    source: "manuel",
    title,
    kind,
    due,
  };
  if (start !== undefined) deadline.start = start;
  if (courseCode !== undefined) deadline.courseCode = courseCode;
  const location = (input.location ?? "").trim();
  if (location !== "") deadline.location = location;
  const note = (input.note ?? "").trim();
  if (note !== "") deadline.note = note;
  return { ok: true, deadline };
}

/** « mat 1400 » → « MAT1400 ». Ne garantit pas que le résultat soit un sigle. */
function normalizeCourseCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Vrai si la date est au format « AAAA-MM-JJ » **et** existe (pas de 31 février). */
function isRealDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  try {
    dateToUtc(date); // lance sur une date que Date.UTC normaliserait en silence
    return true;
  } catch {
    return false;
  }
}
