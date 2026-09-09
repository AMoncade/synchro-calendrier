// Content script : injecté dans toutes les frames de Synchro. Reconnaît la page
// Centre étudiant ou « Votre horaire cours », extrait puis parse l'horaire et
// l'envoie au service worker. PeopleSoft recharge le contenu par AJAX sans
// changer d'URL : on observe donc le DOM, avec un anti-rebond et une signature
// pour ne pas renvoyer deux fois la même capture.
//
// Ne journalise jamais l'URL (elle contient le matricule) ni les données.

import { parseCapture } from "../core/parse";
import type { Message } from "../lib/messages";
import { detectPage, extractCapture } from "./extract";

const DEBOUNCE_MS = 400;
let lastSignature = "";
let timer: ReturnType<typeof setTimeout> | undefined;

function captureNow(): void {
  const page = detectPage(document);
  if (!page) return;
  const raw = extractCapture(document);
  if (!raw || raw.blocks.length === 0) return;

  const signature = JSON.stringify(raw);
  if (signature === lastSignature) return;
  lastSignature = signature;

  const schedule = parseCapture(raw, { capturedAt: new Date().toISOString() });
  if (schedule.courses.length === 0) return;

  const message: Message = { type: "SCHEDULE_CAPTURED", schedule, source: raw.source };
  chrome.runtime.sendMessage(message).catch(() => {
    // Service worker indisponible (extension rechargée) : la prochaine mutation réessaiera.
    lastSignature = "";
  });
}

function scheduleCapture(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(captureNow, DEBOUNCE_MS);
}

scheduleCapture();
new MutationObserver(scheduleCapture).observe(document.documentElement, { childList: true, subtree: true });
