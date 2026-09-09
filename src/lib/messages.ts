// Messages runtime entre content script, service worker et popup, et forme de
// l'état persisté dans chrome.storage.local.

import type { Schedule } from "../core/model";

export type CaptureSource = "liste" | "centre";

export type Message =
  | { type: "SCHEDULE_CAPTURED"; schedule: Schedule; source: CaptureSource }
  | { type: "GET_STATE" }
  | { type: "CLEAR_ALL" };

export interface StoredState {
  /** Un horaire par trimestre, clé = `term.code` ("A26"). */
  schedules: Record<string, Schedule>;
  /** Provenance de chaque entrée : une capture « centre » ne remplace jamais une « liste ». */
  sources: Record<string, CaptureSource>;
  lastCapturedAt: string | null;
  lastSource: CaptureSource | null;
}

export const STORAGE_KEY = "synchro-calendrier.v1";
