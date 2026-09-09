// Service worker : persiste les captures, répond au popup, tient le badge à jour.
// Toute la logique de fusion est dans core/store.ts (testée) ; ici, uniquement
// le pont avec les API chrome.*. Seul endroit (hors popup) où new Date() est permis.

import { classesRemainingToday } from "../core/alerts";
import { excludedDates } from "../core/calendar-udem";
import { expandSchedule } from "../core/expand";
import { currentTerm, emptyState, mergeCapture } from "../core/store";
import { STORAGE_KEY, type Message, type StoredState } from "../lib/messages";

const ALARM = "badge-refresh";
const BADGE_COLOR = "#0f56a9";

async function loadState(): Promise<StoredState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as StoredState | undefined;
  return value && typeof value === "object" && value.schedules ? { ...emptyState(), ...value } : emptyState();
}

async function saveState(state: StoredState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Badge = nombre de cours restants aujourd'hui (spec v2 §10.3), vide si zéro. */
async function refreshBadge(state?: StoredState): Promise<void> {
  const s = state ?? (await loadState());
  const now = localNow();
  const schedule = currentTerm(s, now.slice(0, 10));
  let text = "";
  if (schedule) {
    const occurrences = expandSchedule(schedule, { excludedDates: excludedDates(schedule.term.code) });
    const remaining = classesRemainingToday(occurrences, now);
    text = remaining > 0 ? String(remaining) : "";
  }
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text });
}

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case "SCHEDULE_CAPTURED": {
      const state = mergeCapture(await loadState(), message.schedule, message.source);
      await saveState(state);
      await refreshBadge(state);
      return { ok: true };
    }
    case "GET_STATE":
      return loadState();
    case "CLEAR_ALL": {
      await chrome.storage.local.remove(STORAGE_KEY);
      await chrome.action.setBadgeText({ text: "" });
      return { ok: true };
    }
    default:
      return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message).then(sendResponse, () => sendResponse({ ok: false }));
  return true; // réponse asynchrone
});

function ensureAlarm(): void {
  void chrome.alarms.create(ALARM, { periodInMinutes: 15 });
  void refreshBadge();
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void refreshBadge();
});
