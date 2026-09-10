// Échéances StudiUM (phase 12, 2026-09-10) : la capture brute de l'API AJAX de
// Moodle (`core_calendar_get_calendar_monthly_view`) → des `Deadline` propres.
// Voir docs/ARCHITECTURE.md §7 et docs/REPERAGE-STUDIUM-2026-09-10.md.
//
// Le point à comprendre : un quiz Moodle produit DEUX événements — « s'ouvre »
// (`eventtype: "open"`) et « se termine » (`"close"`) — qui sont une seule
// échéance avec une fenêtre. On les recolle par le `cmid` de l'URL du module,
// et seulement à défaut par `courseid + nom d'activité`.
//
// Pur et déterministe (règle `src/core/`) : aucune API navigateur, aucun
// `Date.now()`. `Intl.DateTimeFormat` sert au calcul de fuseau — les règles
// d'heure avancée, qu'on ne veut pas réécrire — jamais à produire du texte
// affiché ; même partage des rôles que `src/format/time.ts`.
//
// Tolérance : la forme exacte de la réponse Moodle n'a pas encore été capturée
// en vrai (voir l'en-tête de `tests/studium.test.ts`). Un événement auquel il
// manque un champ est ignoré, jamais une exception — une session StudiUM qui
// change de version ne doit pas casser la synchronisation entière.

import type {
  Deadline,
  DeadlineKind,
  LocalDateTime,
  RawMoodleEvent,
  RawStudiumCapture,
  StudiumCourse,
} from "./model";

/** `shortname` StudiUM : « MAT1400-AB-A26 » = sigle, section, trimestre. */
export const SHORTNAME_RE = /^([A-Z]{3}\d{4})-([A-Z0-9]+)-([AHE]\d{2})$/;

export interface ParsedShortname {
  /** « MAT1400 » — la seule partie qui existe aussi côté Synchro. */
  courseCode: string;
  /** « AB » pour un site de TP, « A » pour le site principal. */
  section: string;
  /** « A26 ». */
  termCode: string;
}

// Les seuls `eventtype` qui portent une échéance. Tout le reste (`user`,
// `course`, `category`, `site`, `gradingdue`, `expectcompletionon`…) est ignoré :
// ce sont des repères d'agenda, pas du travail à remettre.
const OPEN = "open";
const CLOSE = "close";
const DUE = "due";

// Suffixes que Moodle colle au nom de l'activité en français. On ne s'en sert
// qu'en repli, quand `activityname` manque : filtrer sur le libellé est fragile
// (il change avec la langue de l'interface), le champ typé prime toujours.
const NAME_SUFFIXES = ["s'ouvre", "se termine", "est à rendre"];

// URL d'un module : `…/mod/<type>/view.php?…id=<cmid>`. Le `cmid` identifie
// l'activité, donc il recolle « s'ouvre » et « se termine ». On exige `/mod/`
// pour ne pas confondre avec `/course/view.php?id=<courseid>`.
const MODULE_URL_RE = /\/mod\/[a-z0-9_]+\/view\.php\?(?:[^#]*&)?id=(\d+)/i;

const TIME_ZONE = "America/Toronto";

// Locale « en-CA » : on ne lit que des champs numériques, aucun nom de mois.
// `hourCycle: "h23"` évite le « 24 » que certaines versions d'ICU rendent pour
// minuit. Voir `src/format/time.ts`, même raisonnement.
const TORONTO_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function compareStrings(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Secondes Unix → instant local « AAAA-MM-JJTHH:MM » à Montréal.
 *
 * Jamais `toISOString()` : ça rend de l'UTC, donc 23:59 le 10 septembre
 * deviendrait 03:59 le 11. La conversion passe par `Intl`, qui connaît le
 * passage à l'heure normale (EDT en septembre, EST en décembre).
 */
export function toLocalDateTime(unixSeconds: number): LocalDateTime {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) {
    throw new RangeError(`Instant Unix invalide : ${String(unixSeconds)}`);
  }
  const found: Record<string, string> = {};
  for (const part of TORONTO_PARTS.formatToParts(new Date(unixSeconds * 1000))) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  const hour = String(Number(found["hour"]) % 24).padStart(2, "0");
  return `${found["year"]}-${found["month"]}-${found["day"]}T${hour}:${found["minute"]}`;
}

/** « MAT1400-AB-A26 » → sigle, section, trimestre ; `undefined` si le motif ne colle pas. */
export function parseShortname(shortname: string): ParsedShortname | undefined {
  if (typeof shortname !== "string") return undefined;
  const found = SHORTNAME_RE.exec(shortname.trim());
  if (!found) return undefined;
  const [, courseCode, section, termCode] = found;
  if (!courseCode || !section || !termCode) return undefined;
  return { courseCode, section, termCode };
}

/**
 * Les sites de cours vus lors de la synchronisation : union de `raw.courses`
 * (liste des inscriptions) et des sites portés par les événements, dédoublonnée
 * par `id`. Un site sans activité évaluée n'apparaît que dans le premier ; un
 * site dont l'inscription n'a pas été lue n'apparaît que dans le second —
 * l'écran de liaison du popup a besoin des deux.
 *
 * `idnumber` est ignoré à dessein : il est vide sur les sites -AB, ceux qui
 * portent justement tout le travail évalué. La jointure passe par `shortname`.
 */
export function studiumCourses(raw: RawStudiumCapture): StudiumCourse[] {
  const byId = new Map<number, StudiumCourse>();

  const add = (site: RawMoodleEvent["course"] | undefined): void => {
    if (!site || typeof site !== "object") return;
    const { id, shortname } = site;
    if (typeof id !== "number" || !Number.isFinite(id)) return;
    if (typeof shortname !== "string" || !shortname.trim()) return;
    if (byId.has(id)) return; // premier vu gagne : `raw.courses` avant les événements
    const trimmed = shortname.trim();
    const fullname = typeof site.fullname === "string" && site.fullname.trim() ? site.fullname.trim() : trimmed;
    const course: StudiumCourse = { id, shortname: trimmed, fullname };
    const parsed = parseShortname(trimmed);
    if (parsed) course.courseCode = parsed.courseCode;
    byId.set(id, course);
  };

  for (const site of asArray(raw?.courses)) add(site);
  for (const event of asArray(raw?.events)) add(event?.course ?? undefined);

  return [...byId.values()].sort((x, y) => compareStrings(x.shortname, y.shortname) || x.id - y.id);
}

/** Un événement retenu, réduit à ce qui sert à construire l'échéance. */
interface PreparedEvent {
  /** Panier de regroupement : `courseid + nom normalisé`, ou le cmid faute de site. */
  bucket: string;
  /** Id du module tiré de l'URL, quand cet événement-ci en porte une. */
  cmid?: string;
  slug: string;
  role: typeof OPEN | typeof CLOSE | typeof DUE;
  timestart: number;
  title: string;
  kind: DeadlineKind;
  courseId?: number;
  courseCode?: string;
  url?: string;
  location?: string;
}

/** Les trois rôles d'une même activité ; `open` seul ne donne rien. */
interface EventGroup {
  /** Cmid retenu pour le groupe, s'il en existe un. Décide de la forme de l'id. */
  cmid?: string;
  open?: PreparedEvent;
  close?: PreparedEvent;
  due?: PreparedEvent;
}

/**
 * Capture brute → échéances, triées par instant d'échéance puis par titre.
 *
 * Règles (docs/ARCHITECTURE.md §7) :
 * - `open` + `close` du même module = une échéance avec une fenêtre ;
 * - `close` seul = échéance sans `start` (quiz ouvert depuis toujours) ;
 * - `open` seul = ignoré — une ouverture n'est pas un travail à remettre ;
 * - `due` (devoirs) = échéance sans fenêtre ;
 * - tout autre `eventtype` = ignoré.
 *
 * Idempotent : deux mois qui se chevauchent renvoient les mêmes événements, et
 * la même entrée passée deux fois donne exactement la même sortie — une seule
 * échéance par `id`.
 */
export function deadlinesFromStudium(raw: RawStudiumCapture): Deadline[] {
  // Premier temps : les paniers. Le regroupement ne suit JAMAIS le cmid seul,
  // sinon une activité dont un des deux événements n'a pas d'URL se scinde en
  // deux — l'ouverture partirait comme orpheline et l'échéance perdrait sa
  // fenêtre, sans bruit (défaut relevé par la passe de couture, 2026-09-10).
  const buckets = new Map<string, PreparedEvent[]>();
  for (const event of asArray(raw?.events)) {
    const prepared = prepareEvent(event);
    if (!prepared) continue;
    const list = buckets.get(prepared.bucket);
    if (list) list.push(prepared);
    else buckets.set(prepared.bucket, [prepared]);
  }

  // Second temps : à l'intérieur d'un panier, deux cmids distincts sont deux
  // activités distinctes, même sous le même nom — Moodle autorise les
  // homonymes dans un cours. Les fusionner ferait DISPARAÎTRE une échéance,
  // ce qui est pire que le défaut qu'on corrige. Un événement sans cmid ne
  // rejoint donc le cmid du panier que si ce panier n'en a qu'un seul.
  const groups = new Map<string, EventGroup>();
  for (const [bucket, list] of buckets) {
    const cmids = new Set<string>();
    for (const prepared of list) if (prepared.cmid) cmids.add(prepared.cmid);
    const lone = cmids.size === 1 ? [...cmids][0] : undefined;
    for (const prepared of list) {
      const cmid = prepared.cmid ?? lone;
      const key = `${bucket}#${cmid ?? ""}`;
      let group = groups.get(key);
      if (!group) {
        group = cmid === undefined ? {} : { cmid };
        groups.set(key, group);
      }
      // Premier vu gagne : deux passages successifs portent les mêmes valeurs.
      if (!group[prepared.role]) group[prepared.role] = prepared;
    }
  }

  const byId = new Map<string, Deadline>();
  for (const group of groups.values()) {
    // `due` prime sur `close` : si un module porte les deux, c'est la remise qui compte.
    const main = group.due ?? group.close;
    if (!main) continue; // « open » orphelin

    // L'id se décide sur le GROUPE, pas sur l'événement : dès qu'un membre
    // porte un cmid, toute l'activité s'identifie par lui, même si l'autre
    // événement n'avait pas d'URL. Sans ça l'id changerait d'une synchro à
    // l'autre — l'échéance masquée reviendrait (`removeDeadline` masque par id)
    // et l'agenda verrait un ajout au lieu d'une mise à jour (`deadlineUid`).
    // Résidu assumé : une activité dont l'URL disparaît de TOUS ses événements
    // change d'id. `calendar_event_exporter` rend `url` systématiquement pour
    // un module, donc ce cas ne devrait pas exister.
    const courseIdForId = main.courseId ?? group.open?.courseId;
    const id = group.cmid
      ? `studium:${group.cmid}`
      : courseIdForId !== undefined
        ? `studium:${courseIdForId}:${main.slug}`
        : undefined;
    if (!id) continue; // ni cmid ni site : rien de stable à quoi accrocher l'échéance

    const deadline: Deadline = {
      id,
      source: "studium",
      title: main.title,
      kind: main.kind,
      due: toLocalDateTime(main.timestart),
    };

    // Une fenêtre qui se ferme avant de s'ouvrir n'en est pas une : on la laisse tomber.
    if (group.open && group.open.timestart < main.timestart) {
      deadline.start = toLocalDateTime(group.open.timestart);
    }

    const courseCode = main.courseCode ?? group.open?.courseCode;
    if (courseCode) deadline.courseCode = courseCode;
    const courseId = main.courseId ?? group.open?.courseId;
    if (courseId !== undefined) deadline.studiumCourseId = courseId;
    const url = main.url ?? group.open?.url;
    if (url) deadline.url = url;
    const location = main.location ?? group.open?.location;
    if (location) deadline.location = location;

    if (!byId.has(deadline.id)) byId.set(deadline.id, deadline);
  }

  return [...byId.values()].sort(
    (x, y) => compareStrings(x.due, y.due) || compareStrings(x.title, y.title) || compareStrings(x.id, y.id),
  );
}

// ---------------------------------------------------------------------------
// Détail
// ---------------------------------------------------------------------------

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

/** Un événement brut → sa forme retenue, ou `undefined` s'il n'y a rien à en tirer. */
function prepareEvent(event: RawMoodleEvent | undefined | null): PreparedEvent | undefined {
  if (!event || typeof event !== "object") return undefined;

  const role = roleOf(event.eventtype);
  if (!role) return undefined;

  const timestart = event.timestart;
  if (typeof timestart !== "number" || !Number.isFinite(timestart) || timestart <= 0) return undefined;

  const title = titleOf(event);
  if (!title) return undefined;

  const course = event.course && typeof event.course === "object" ? event.course : undefined;
  const courseId = typeof course?.id === "number" && Number.isFinite(course.id) ? course.id : undefined;

  // Panier de regroupement : site + nom normalisé, le seul couple que « s'ouvre »
  // et « se termine » partagent à coup sûr — le cmid, lui, dépend de la présence
  // d'une URL sur CET événement-là. À défaut de site, le cmid fait office de
  // panier (le nom seul ne dirait pas de quel cours il s'agit).
  const cmid = moduleIdOf(event.url);
  const slug = slugify(title);
  let bucket: string;
  if (courseId !== undefined && slug) {
    bucket = `course:${courseId}:${slug}`;
  } else if (cmid) {
    bucket = `cmid:${cmid}`;
  } else {
    return undefined; // ni site ni module : rien de stable à quoi accrocher l'échéance
  }

  const prepared: PreparedEvent = { bucket, slug, role, timestart, title, kind: kindOf(event, role) };
  if (cmid) prepared.cmid = cmid;
  if (courseId !== undefined) prepared.courseId = courseId;
  const parsed = course ? parseShortname(course.shortname) : undefined;
  if (parsed) prepared.courseCode = parsed.courseCode;
  const url = safeUrl(event.url);
  if (url) prepared.url = url;
  const location = readLocation(event.location);
  if (location) prepared.location = location;
  return prepared;
}

/**
 * Le lieu, quand Moodle en porte un. Le champ est `PARAM_RAW`, optionnel, et
 * vaut le plus souvent la chaîne vide — un quiz n'a pas de local. On refuse le
 * vide plutôt que d'écrire `location: ""` dans l'état : le popup afficherait
 * une ligne « Lieu : » sans lieu.
 */
function readLocation(location: unknown): string | undefined {
  if (typeof location !== "string") return undefined;
  const trimmed = location.trim();
  return trimmed ? trimmed : undefined;
}

function roleOf(eventtype: unknown): PreparedEvent["role"] | undefined {
  if (typeof eventtype !== "string") return undefined;
  const value = eventtype.trim().toLowerCase();
  return value === OPEN || value === CLOSE || value === DUE ? value : undefined;
}

/**
 * Genre de l'échéance. `modulename` prime — c'est le champ typé ; `eventtype:
 * "due"` sert de repli pour un module de remise dont le nom nous est inconnu.
 */
function kindOf(event: RawMoodleEvent, role: PreparedEvent["role"]): DeadlineKind {
  const modulename = typeof event.modulename === "string" ? event.modulename.trim().toLowerCase() : "";
  if (modulename === "quiz") return "quiz";
  if (modulename === "assign") return "devoir";
  if (role === DUE) return "devoir";
  return "autre";
}

/**
 * Nom affiché. `activityname` prime ; à défaut seulement, on retire du libellé
 * le suffixe que Moodle y ajoute (« Quiz-tp3 s'ouvre » → « Quiz-tp3 »).
 */
function titleOf(event: RawMoodleEvent): string {
  const activityname = typeof event.activityname === "string" ? event.activityname.trim() : "";
  if (activityname) return activityname;
  const name = typeof event.name === "string" ? event.name.trim() : "";
  return name ? stripEventSuffix(name) : "";
}

function stripEventSuffix(name: string): string {
  // Comparaison sur une copie : l'apostrophe typographique de Moodle (’) et
  // l'apostrophe droite doivent matcher toutes les deux, mais le titre rendu
  // garde la sienne. Les deux tiennent sur une unité UTF-16, donc les longueurs
  // restent alignées entre `name` et `lower`.
  const lower = name.toLowerCase().replace(/’/g, "'");
  for (const suffix of NAME_SUFFIXES) {
    const marker = ` ${suffix}`;
    if (lower.endsWith(marker)) return name.slice(0, name.length - marker.length).trim();
  }
  return name;
}

function moduleIdOf(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  // Volontairement lu sur l'URL brute : un `cmid` n'est pas un secret, et une
  // URL rejetée par `safeUrl` doit quand même pouvoir recoller open + close.
  const found = MODULE_URL_RE.exec(url);
  return found?.[1];
}

/**
 * L'URL de l'activité, ou `undefined`. Une URL qui porte un `authtoken` (jeton
 * permanent du calendrier Moodle) ou un `sesskey` n'est jamais conservée : elle
 * finirait dans `chrome.storage`, puis dans un export. Les schémas autres que
 * http(s) sont refusés aussi — le popup en fait un lien cliquable.
 */
function safeUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower.includes("authtoken=") || lower.includes("sesskey=")) return undefined;
  if (!lower.startsWith("https://") && !lower.startsWith("http://")) return undefined;
  return trimmed;
}

/** Nom d'activité → fragment d'identifiant stable : accents retirés, minuscules, tirets. */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "") // NFD détache les diacritiques, on les jette
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
