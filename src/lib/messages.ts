// Messages runtime entre content scripts, service worker et popup, et forme de
// l'état persisté dans chrome.storage.local.

import type { Deadline, Schedule, StudiumCourse } from "../core/model";

export type CaptureSource = "liste" | "centre";

export type Message =
  | { type: "SCHEDULE_CAPTURED"; schedule: Schedule; source: CaptureSource }
  | { type: "GET_STATE" }
  | { type: "CLEAR_ALL" }
  // Phase 12 — échéances (docs/ARCHITECTURE.md §7)
  /** content/studium.ts → service worker : résultat d'une synchronisation StudiUM. */
  | { type: "STUDIUM_SYNCED"; deadlines: Deadline[]; courses: StudiumCourse[]; syncedAt: string }
  /** content/studium.ts → service worker : la synchronisation a échoué (sesskey absent, réseau, format). */
  | { type: "STUDIUM_FAILED"; error: string; at: string }
  /** popup → service worker : ajouter ou modifier une échéance manuelle. */
  | { type: "DEADLINE_UPSERT"; deadline: Deadline }
  /** popup → service worker : retirer une échéance (manuelle, ou masquer une StudiUM). */
  | { type: "DEADLINE_REMOVE"; id: string }
  /** popup → service worker : lier un site StudiUM à un sigle Synchro (`null` = ne pas lier). */
  | { type: "COURSE_LINK_SET"; studiumCourseId: number; courseCode: string | null };

export interface StudiumStatus {
  lastSyncAt: string | null;
  lastError: string | null;
  /** Sites vus à la dernière synchronisation, pour l'écran de liaison. */
  courses: StudiumCourse[];
}

export interface StoredState {
  /** Un horaire par trimestre, clé = `term.code` ("A26"). */
  schedules: Record<string, Schedule>;
  /** Provenance de chaque entrée : une capture « centre » ne remplace jamais une « liste ». */
  sources: Record<string, CaptureSource>;
  lastCapturedAt: string | null;
  lastSource: CaptureSource | null;
  /** Échéances, clé = `Deadline.id`. Absent dans les états antérieurs à la phase 12. */
  deadlines?: Record<string, Deadline>;
  /** Ids StudiUM que l'utilisateur a retirés ; une synchronisation ne les ramène pas. */
  hiddenDeadlines?: string[];
  studium?: StudiumStatus;
  /** Surcharge de liaison : `courseid` StudiUM → sigle Synchro, `null` = explicitement non lié. */
  courseLinks?: Record<string, string | null>;
}

export const STORAGE_KEY = "synchro-calendrier.v1";
