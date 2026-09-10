// Service worker : persiste les captures, répond au popup, tient le badge à jour.
// Toute la logique de fusion est dans core/store.ts (testée) ; ici, uniquement
// le pont avec les API chrome.*. Seul endroit (hors popup) où new Date() est permis.

import { classesRemainingToday } from "../core/alerts";
import { excludedDates } from "../core/calendar-udem";
import { markStudiumFailed, mergeStudium, removeDeadline, setCourseLink, setDeadlineDone, upsertDeadline } from "../core/deadlines";
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
    // Phase 12 — échéances : toute la logique est dans core/deadlines.ts (pure, testée).
    // Réponse { ok: true } seulement : le content script n'attend rien, le popup relit
    // l'état par GET_STATE après chaque écriture.
    case "STUDIUM_SYNCED":
      await saveState(mergeStudium(await loadState(), message.deadlines, message.courses, message.syncedAt));
      return { ok: true };
    case "STUDIUM_FAILED":
      await saveState(markStudiumFailed(await loadState(), message.error, message.at));
      return { ok: true };
    case "DEADLINE_UPSERT":
      await saveState(upsertDeadline(await loadState(), message.deadline));
      return { ok: true };
    case "DEADLINE_REMOVE":
      await saveState(removeDeadline(await loadState(), message.id));
      return { ok: true };
    case "COURSE_LINK_SET":
      await saveState(setCourseLink(await loadState(), message.studiumCourseId, message.courseCode));
      return { ok: true };
    // Phase 13 — cochage (core/deadlines.ts) et carnet de notes (remplacé en bloc).
    case "DEADLINE_DONE_SET":
      await saveState(setDeadlineDone(await loadState(), message.id, message.done));
      return { ok: true };
    case "STUDIUM_GRADES_SYNCED": {
      const state = await loadState();
      await saveState({ ...state, grades: { reports: message.reports, syncedAt: message.syncedAt } });
      return { ok: true };
    }
    case "STUDIUM_SYNC_NOW":
      // Adressé au content script StudiUM par chrome.tabs.sendMessage, jamais au service worker.
      return { ok: false };
    case "CLEAR_ALL": {
      // Le tampon anti-rafale du content script StudiUM part aussi : « Effacer » doit
      // permettre une resynchronisation immédiate à la prochaine visite.
      await chrome.storage.local.remove([STORAGE_KEY, "synchro-calendrier.studium-last-run", "synchro-calendrier.studium-force-next"]);
      await chrome.action.setBadgeText({ text: "" });
      return { ok: true };
    }
    default: {
      // Garde d'exhaustivité : ajouter un type à l'union Message sans le router ne compile plus.
      const exhaustive: never = message;
      return { ok: false, unhandled: exhaustive };
    }
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
