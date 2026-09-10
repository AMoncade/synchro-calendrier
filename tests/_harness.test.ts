// TEMPORAIRE — non commité. Produit un StoredState réaliste pour le gabarit de rendu
// du popup (scratchpad), à partir des fixtures Synchro + échéances d'exemple.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "vitest";
import { parseCapture } from "../src/core/parse";
import { emptyState, mergeCapture } from "../src/core/store";
import { mergeStudium, upsertDeadline } from "../src/core/deadlines";
import { extractCapture } from "../src/content/extract";

const OUT = process.env["HARNESS_OUT"] ?? "";

it("écrit l'état du gabarit", () => {
  if (!OUT) return;
  const html = readFileSync(resolve(__dirname, "fixtures", "liste-A26.html"), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const capture = extractCapture(doc);
  const schedule = parseCapture(capture!, { capturedAt: "2026-09-09T12:00:00.000Z", localDate: "2026-09-09" });
  let state = mergeCapture(emptyState(), schedule, "liste");
  state = mergeStudium(
    state,
    [
      { id: "studium:6624079", source: "studium", courseCode: "MAT1400", studiumCourseId: 366020, title: "Quiz-tp3", kind: "quiz", start: "2026-09-08T10:30", due: "2026-09-11T23:59", url: "https://studium.umontreal.ca/mod/quiz/view.php?id=6624079" },
      { id: "studium:6624101", source: "studium", courseCode: "MAT1600", studiumCourseId: 366018, title: "Quiz obligatoire — Thème 2", kind: "quiz", start: "2026-09-14T10:30", due: "2026-09-17T23:59", url: "https://studium.umontreal.ca/mod/quiz/view.php?id=6624101" },
      { id: "studium:6624130", source: "studium", courseCode: "MAT1400", studiumCourseId: 366020, title: "Quiz-tp4", kind: "quiz", due: "2026-09-24T23:59", url: "https://studium.umontreal.ca/mod/quiz/view.php?id=6624130" },
    ],
    [
      { id: 366020, shortname: "MAT1400-AB-A26", fullname: "Calcul 1 — travaux pratiques", courseCode: "MAT1400" },
      { id: 366018, shortname: "MAT1600-AB-A26", fullname: "Algèbre linéaire — travaux pratiques", courseCode: "MAT1600" },
      { id: 355495, shortname: "STT1700-A-A26", fullname: "Introduction à la statistique", courseCode: "STT1700" },
    ],
    "2026-09-10T11:40",
  );
  state = upsertDeadline(state, { id: "manuel:1", source: "manuel", courseCode: "STT1700", title: "Remise du TP1", kind: "devoir", due: "2026-09-15T17:00" });
  writeFileSync(OUT, JSON.stringify(state));
});
