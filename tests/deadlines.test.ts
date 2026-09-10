import { describe, expect, it } from "vitest";
import type { StoredState } from "../src/lib/messages";
import type { Deadline, DeadlineKind, StudiumCourse } from "../src/core/model";
import {
  allDeadlines,
  deadlineStatus,
  deadlinesOn,
  markStudiumFailed,
  mergeStudium,
  removeDeadline,
  resolveCourseCode,
  setCourseLink,
  upcomingDeadlines,
  upsertDeadline,
  validateManual,
} from "../src/core/deadlines";

// --- fabriques -------------------------------------------------------------

function studium(id: string, due: string, extra: Partial<Deadline> = {}): Deadline {
  return { id: `studium:${id}`, source: "studium", title: `Quiz ${id}`, kind: "quiz", due, ...extra };
}

function manuel(id: string, due: string, extra: Partial<Deadline> = {}): Deadline {
  return { id: `manuel:${id}`, source: "manuel", title: `Événement ${id}`, kind: "evenement", due, ...extra };
}

function stateWith(deadlines: Deadline[], extra: Partial<StoredState> = {}): StoredState {
  const map: Record<string, Deadline> = {};
  for (const d of deadlines) map[d.id] = d;
  return {
    schedules: {},
    sources: {},
    lastCapturedAt: null,
    lastSource: null,
    deadlines: map,
    ...extra,
  };
}

const SITE: StudiumCourse = {
  id: 4242,
  shortname: "MAT1400-A-A26",
  fullname: "Calcul 1",
  courseCode: "MAT1400",
};

// --- mergeStudium ----------------------------------------------------------

describe("mergeStudium", () => {
  it("remplace toutes les entrées StudiUM et garde les manuelles", () => {
    const before = stateWith([
      studium("1", "2026-09-15T23:59"),
      studium("2", "2026-09-20T23:59"),
      manuel("a", "2026-09-18T14:00"),
    ]);
    const after = mergeStudium(before, [studium("2", "2026-09-21T23:59"), studium("3", "2026-10-01T23:59")], [SITE], "2026-09-10T10:00");

    expect(Object.keys(after.deadlines ?? {}).sort()).toEqual(["manuel:a", "studium:2", "studium:3"]);
    // « studium:1 » a disparu de StudiUM, donc d'ici : une synchro est une vue complète.
    expect(after.deadlines?.["studium:1"]).toBeUndefined();
    expect(after.deadlines?.["studium:2"]?.due).toBe("2026-09-21T23:59");
    expect(after.deadlines?.["manuel:a"]).toEqual(before.deadlines?.["manuel:a"]);
  });

  it("écrit le statut StudiUM et efface l'erreur précédente", () => {
    const before = stateWith([], { studium: { lastSyncAt: "2026-09-01T08:00", lastError: "sesskey absent", courses: [] } });
    const after = mergeStudium(before, [], [SITE], "2026-09-10T10:00");

    expect(after.studium).toEqual({ lastSyncAt: "2026-09-10T10:00", lastError: null, courses: [SITE] });
  });

  it("n'installe pas une échéance masquée par l'utilisateur", () => {
    const before = stateWith([], { hiddenDeadlines: ["studium:1"] });
    const after = mergeStudium(before, [studium("1", "2026-09-15T23:59"), studium("2", "2026-09-16T23:59")], [], "2026-09-10T10:00");

    expect(after.deadlines?.["studium:1"]).toBeUndefined();
    expect(after.deadlines?.["studium:2"]).toBeDefined();
    expect(after.hiddenDeadlines).toEqual(["studium:1"]);
  });

  it("ne mute pas l'état d'entrée", () => {
    const before = stateWith([studium("1", "2026-09-15T23:59")]);
    const snapshot = JSON.parse(JSON.stringify(before));
    mergeStudium(before, [studium("9", "2026-09-30T23:59")], [SITE], "2026-09-10T10:00");

    expect(before).toEqual(snapshot);
  });

  it("garde les autres champs de l'état intacts", () => {
    const before = stateWith([], { lastCapturedAt: "2026-09-09T12:00:00Z", lastSource: "liste" });
    const after = mergeStudium(before, [], [], "2026-09-10T10:00");

    expect(after.lastCapturedAt).toBe("2026-09-09T12:00:00Z");
    expect(after.lastSource).toBe("liste");
  });

  it("part d'un état antérieur à la phase 12 (aucune clé échéances)", () => {
    const before: StoredState = { schedules: {}, sources: {}, lastCapturedAt: null, lastSource: null };
    const after = mergeStudium(before, [studium("1", "2026-09-15T23:59")], [], "2026-09-10T10:00");

    expect(Object.keys(after.deadlines ?? {})).toEqual(["studium:1"]);
  });
});

// --- markStudiumFailed -----------------------------------------------------

describe("markStudiumFailed", () => {
  it("garde les échéances et la date de la dernière synchro réussie", () => {
    const before = stateWith([studium("1", "2026-09-15T23:59"), manuel("a", "2026-09-18T14:00")], {
      studium: { lastSyncAt: "2026-09-08T09:00", lastError: null, courses: [SITE] },
    });
    const after = markStudiumFailed(before, "invalidsesskey", "2026-09-10T10:05");

    expect(after.deadlines).toEqual(before.deadlines);
    expect(after.studium).toEqual({ lastSyncAt: "2026-09-08T09:00", lastError: "invalidsesskey", courses: [SITE] });
  });

  it("échoue avant toute synchro réussie : lastSyncAt reste null", () => {
    const after = markStudiumFailed(stateWith([]), "réseau", "2026-09-10T10:05");

    expect(after.studium).toEqual({ lastSyncAt: null, lastError: "réseau", courses: [] });
  });

  it("ne mute pas l'état d'entrée", () => {
    const before = stateWith([], { studium: { lastSyncAt: "2026-09-08T09:00", lastError: null, courses: [] } });
    const snapshot = JSON.parse(JSON.stringify(before));
    markStudiumFailed(before, "boum", "2026-09-10T10:05");

    expect(before).toEqual(snapshot);
  });
});

// --- upsertDeadline / removeDeadline ---------------------------------------

describe("upsertDeadline", () => {
  it("ajoute puis remplace par l'id", () => {
    const added = upsertDeadline(stateWith([]), manuel("a", "2026-09-18T14:00"));
    const edited = upsertDeadline(added, manuel("a", "2026-09-19T09:00", { title: "Rendez-vous TGDE" }));

    expect(Object.keys(edited.deadlines ?? {})).toEqual(["manuel:a"]);
    expect(edited.deadlines?.["manuel:a"]?.due).toBe("2026-09-19T09:00");
    expect(edited.deadlines?.["manuel:a"]?.title).toBe("Rendez-vous TGDE");
  });

  it("réinstaller une échéance masquée la démasque", () => {
    const before = stateWith([], { hiddenDeadlines: ["studium:1", "studium:2"] });
    const after = upsertDeadline(before, studium("1", "2026-09-15T23:59"));

    expect(after.hiddenDeadlines).toEqual(["studium:2"]);
    expect(after.deadlines?.["studium:1"]).toBeDefined();
  });

  it("ne mute pas l'état d'entrée", () => {
    const before = stateWith([manuel("a", "2026-09-18T14:00")]);
    const snapshot = JSON.parse(JSON.stringify(before));
    upsertDeadline(before, manuel("b", "2026-09-19T14:00"));

    expect(before).toEqual(snapshot);
  });
});

describe("removeDeadline", () => {
  it("retire une manuelle sans la masquer", () => {
    const before = stateWith([manuel("a", "2026-09-18T14:00")]);
    const after = removeDeadline(before, "manuel:a");

    expect(after.deadlines?.["manuel:a"]).toBeUndefined();
    expect(after.hiddenDeadlines ?? []).toEqual([]);
  });

  it("retire une StudiUM et la masque, sinon la synchro suivante la ramène", () => {
    const before = stateWith([studium("1", "2026-09-15T23:59")]);
    const after = removeDeadline(before, "studium:1");

    expect(after.deadlines?.["studium:1"]).toBeUndefined();
    expect(after.hiddenDeadlines).toEqual(["studium:1"]);

    const resynced = mergeStudium(after, [studium("1", "2026-09-15T23:59")], [], "2026-09-11T10:00");
    expect(resynced.deadlines?.["studium:1"]).toBeUndefined();
  });

  it("ne masque pas deux fois le même id", () => {
    const before = stateWith([studium("1", "2026-09-15T23:59")], { hiddenDeadlines: ["studium:1"] });
    const after = removeDeadline(before, "studium:1");

    expect(after.hiddenDeadlines).toEqual(["studium:1"]);
  });

  it("juge sur le préfixe un id absent de l'état", () => {
    const after = removeDeadline(stateWith([]), "studium:404");

    expect(after.hiddenDeadlines).toEqual(["studium:404"]);
  });

  it("un id inconnu et sans préfixe StudiUM ne masque rien", () => {
    const after = removeDeadline(stateWith([]), "manuel:404");

    expect(after.hiddenDeadlines ?? []).toEqual([]);
  });

  it("ne mute ni les échéances ni la liste masquée d'entrée", () => {
    const before = stateWith([studium("1", "2026-09-15T23:59")], { hiddenDeadlines: ["studium:9"] });
    const snapshot = JSON.parse(JSON.stringify(before));
    removeDeadline(before, "studium:1");

    expect(before).toEqual(snapshot);
  });
});

// --- courseLinks -----------------------------------------------------------

describe("setCourseLink", () => {
  it("enregistre un sigle normalisé sous le courseid en chaîne", () => {
    const after = setCourseLink(stateWith([]), 4242, "mat 1400");

    expect(after.courseLinks).toEqual({ "4242": "MAT1400" });
  });

  it("null enregistre « explicitement non lié »", () => {
    const after = setCourseLink(setCourseLink(stateWith([]), 4242, "MAT1400"), 4242, null);

    expect(after.courseLinks).toEqual({ "4242": null });
  });

  it("une chaîne vide vaut non lié", () => {
    const after = setCourseLink(stateWith([]), 4242, "   ");

    expect(after.courseLinks).toEqual({ "4242": null });
  });

  it("ne touche pas aux autres liaisons et ne mute pas l'entrée", () => {
    const before = stateWith([], { courseLinks: { "1": "PHY1620" } });
    const snapshot = JSON.parse(JSON.stringify(before));
    const after = setCourseLink(before, 4242, "MAT1400");

    expect(after.courseLinks).toEqual({ "1": "PHY1620", "4242": "MAT1400" });
    expect(before).toEqual(snapshot);
  });
});

describe("resolveCourseCode", () => {
  const lie = studium("1", "2026-09-15T23:59", { studiumCourseId: 4242, courseCode: "MAT1400" });

  it("sans surcharge, garde le sigle déduit", () => {
    expect(resolveCourseCode(lie, undefined)).toBe("MAT1400");
    expect(resolveCourseCode(lie, {})).toBe("MAT1400");
  });

  it("une surcharge remplace le sigle déduit", () => {
    expect(resolveCourseCode(lie, { "4242": "PHY1620" })).toBe("PHY1620");
  });

  it("une surcharge null efface le sigle déduit", () => {
    expect(resolveCourseCode(lie, { "4242": null })).toBeUndefined();
  });

  it("une surcharge d'un autre site est ignorée", () => {
    expect(resolveCourseCode(lie, { "9999": null })).toBe("MAT1400");
  });

  it("une échéance manuelle ignore les liaisons", () => {
    const d = manuel("a", "2026-09-18T14:00", { courseCode: "IFT1015" });

    expect(resolveCourseCode(d, { "4242": null })).toBe("IFT1015");
  });

  it("sans sigle déduit ni surcharge, rien", () => {
    const d = studium("2", "2026-09-15T23:59", { studiumCourseId: 4242 });

    expect(resolveCourseCode(d, {})).toBeUndefined();
  });
});

// --- allDeadlines ----------------------------------------------------------

describe("allDeadlines", () => {
  it("trie par échéance puis par titre", () => {
    const state = stateWith([
      studium("3", "2026-09-20T23:59", { title: "Quiz-tp4" }),
      studium("1", "2026-09-15T23:59", { title: "Quiz-tp2" }),
      studium("2", "2026-09-15T23:59", { title: "Quiz-tp1" }),
    ]);

    expect(allDeadlines(state).map((d) => d.title)).toEqual(["Quiz-tp1", "Quiz-tp2", "Quiz-tp4"]);
  });

  it("l'id départage deux échéances de même instant et même titre", () => {
    const state = stateWith([
      manuel("b", "2026-09-15T23:59", { title: "Remise" }),
      manuel("a", "2026-09-15T23:59", { title: "Remise" }),
    ]);

    expect(allDeadlines(state).map((d) => d.id)).toEqual(["manuel:a", "manuel:b"]);
  });

  it("un état sans échéances rend une liste vide", () => {
    const before: StoredState = { schedules: {}, sources: {}, lastCapturedAt: null, lastSource: null };

    expect(allDeadlines(before)).toEqual([]);
  });
});

// --- upcomingDeadlines / deadlinesOn ---------------------------------------

describe("upcomingDeadlines", () => {
  const now = "2026-09-10T10:00";
  const list = [
    studium("passe", "2026-09-10T09:59"),
    studium("pile", "2026-09-10T10:00"),
    studium("dans7j-1min", "2026-09-17T09:59"),
    studium("borne", "2026-09-17T10:00"),
    studium("apres", "2026-09-17T10:01"),
  ];

  it("inclut l'échéance qui tombe à `now` pile et exclut la borne haute", () => {
    expect(upcomingDeadlines(list, now, 7).map((d) => d.id)).toEqual([
      "studium:pile",
      "studium:dans7j-1min",
    ]);
  });

  it("un horizon nul ne rend rien", () => {
    expect(upcomingDeadlines(list, now, 0)).toEqual([]);
  });

  it("conserve l'ordre d'entrée", () => {
    const desordre = [studium("b", "2026-09-16T23:59"), studium("a", "2026-09-12T23:59")];

    expect(upcomingDeadlines(desordre, now, 30).map((d) => d.id)).toEqual(["studium:b", "studium:a"]);
  });

  it("l'horizon franchit un changement de mois", () => {
    const octobre = [studium("oct", "2026-10-02T23:59")];

    expect(upcomingDeadlines(octobre, "2026-09-28T10:00", 5).map((d) => d.id)).toEqual(["studium:oct"]);
    expect(upcomingDeadlines(octobre, "2026-09-28T10:00", 4)).toEqual([]);
  });

  it("refuse un instant mal formé plutôt que de filtrer de travers", () => {
    expect(() => upcomingDeadlines(list, "10 septembre", 7)).toThrow(RangeError);
  });
});

describe("deadlinesOn", () => {
  const list = [
    studium("veille", "2026-09-14T23:59"),
    studium("minuit", "2026-09-15T00:00"),
    studium("soir", "2026-09-15T23:59"),
    studium("lendemain", "2026-09-16T00:00"),
  ];

  it("prend tout le jour civil, de 00:00 à 23:59", () => {
    expect(deadlinesOn(list, "2026-09-15").map((d) => d.id)).toEqual(["studium:minuit", "studium:soir"]);
  });

  it("un jour sans échéance rend une liste vide", () => {
    expect(deadlinesOn(list, "2026-09-13")).toEqual([]);
  });
});

// --- deadlineStatus --------------------------------------------------------

describe("deadlineStatus", () => {
  it("échue dès que l'instant est passé", () => {
    const d = studium("1", "2026-09-10T09:59");

    expect(deadlineStatus(d, "2026-09-10T10:00")).toBe("overdue");
  });

  it("à l'instant pile, elle n'est pas encore échue", () => {
    const d = studium("1", "2026-09-10T10:00");

    expect(deadlineStatus(d, "2026-09-10T10:00")).toBe("due-today");
  });

  it("aujourd'hui prime sur la fenêtre ouverte", () => {
    const d = studium("1", "2026-09-10T23:59", { start: "2026-09-08T08:00" });

    expect(deadlineStatus(d, "2026-09-10T10:00")).toBe("due-today");
  });

  it("ouverte quand la fenêtre a commencé et que l'échéance est un autre jour", () => {
    const d = studium("1", "2026-09-12T23:59", { start: "2026-09-08T08:00" });

    expect(deadlineStatus(d, "2026-09-10T10:00")).toBe("open");
  });

  it("ouverte à la minute pile où la fenêtre s'ouvre", () => {
    const d = studium("1", "2026-09-12T23:59", { start: "2026-09-10T10:00" });

    expect(deadlineStatus(d, "2026-09-10T09:59")).toBe("upcoming");
    expect(deadlineStatus(d, "2026-09-10T10:00")).toBe("open");
  });

  it("à venir sans fenêtre déclarée", () => {
    const d = studium("1", "2026-09-12T23:59");

    expect(deadlineStatus(d, "2026-09-10T10:00")).toBe("upcoming");
  });

  it("bascule à minuit : upcoming → due-today → overdue", () => {
    const d = studium("1", "2026-09-11T23:59");

    expect(deadlineStatus(d, "2026-09-10T23:59")).toBe("upcoming");
    expect(deadlineStatus(d, "2026-09-11T00:00")).toBe("due-today");
    expect(deadlineStatus(d, "2026-09-11T23:59")).toBe("due-today");
    expect(deadlineStatus(d, "2026-09-12T00:00")).toBe("overdue");
  });

  it("une échéance déjà passée aujourd'hui est échue, pas due-today", () => {
    const d = studium("1", "2026-09-10T08:00");

    expect(deadlineStatus(d, "2026-09-10T10:00")).toBe("overdue");
  });

  it("refuse un instant mal formé", () => {
    expect(() => deadlineStatus(studium("1", "2026-09-12T23:59"), "hier")).toThrow(RangeError);
  });
});

// --- validateManual --------------------------------------------------------

describe("validateManual", () => {
  const UUID = "8f3d-1";

  it("le minimum : un titre et une date", () => {
    const r = validateManual({ title: "  Rendez-vous TGDE  ", date: "2026-09-18" }, UUID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deadline).toEqual({
      id: "manuel:8f3d-1",
      source: "manuel",
      title: "Rendez-vous TGDE",
      kind: "evenement",
      due: "2026-09-18T23:59",
    });
  });

  it("remplit tous les champs optionnels", () => {
    const r = validateManual(
      {
        title: "Remise du TP2",
        date: "2026-09-18",
        time: "16:30",
        courseCode: "ift1015",
        kind: "devoir",
        location: "  Z-317 ",
        note: " version papier ",
        startDate: "2026-09-11",
        startTime: "08:00",
      },
      UUID,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deadline).toEqual({
      id: "manuel:8f3d-1",
      source: "manuel",
      title: "Remise du TP2",
      kind: "devoir",
      due: "2026-09-18T16:30",
      start: "2026-09-11T08:00",
      courseCode: "IFT1015",
      location: "Z-317",
      note: "version papier",
    });
  });

  it("normalise « mat 1400 » en MAT1400", () => {
    const r = validateManual({ title: "Quiz", date: "2026-09-18", courseCode: "mat 1400" }, UUID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deadline.courseCode).toBe("MAT1400");
  });

  it("refuse un sigle qui n'en est pas un", () => {
    const r = validateManual({ title: "Quiz", date: "2026-09-18", courseCode: "MAT14" }, UUID);

    expect(r).toEqual({ ok: false, errors: ["Le sigle doit ressembler à MAT1400."] });
  });

  it("refuse le 31 février", () => {
    const r = validateManual({ title: "Quiz", date: "2026-02-31" }, UUID);

    expect(r).toEqual({ ok: false, errors: ["La date doit être au format AAAA-MM-JJ et exister."] });
  });

  it("accepte le 29 février d'une année bissextile", () => {
    const r = validateManual({ title: "Quiz", date: "2028-02-29" }, UUID);

    expect(r.ok).toBe(true);
  });

  it("refuse le 29 février d'une année commune", () => {
    const r = validateManual({ title: "Quiz", date: "2027-02-29" }, UUID);

    expect(r.ok).toBe(false);
  });

  it("refuse une date au format québécois", () => {
    const r = validateManual({ title: "Quiz", date: "18/09/2026" }, UUID);

    expect(r.ok).toBe(false);
  });

  it("refuse un titre vide ou blanc", () => {
    expect(validateManual({ title: "   ", date: "2026-09-18" }, UUID)).toEqual({
      ok: false,
      errors: ["Donne un titre à l'échéance."],
    });
  });

  it("refuse un titre de plus de 120 caractères, accepte 120 pile", () => {
    const date = "2026-09-18";

    expect(validateManual({ title: "a".repeat(120), date }, UUID).ok).toBe(true);
    expect(validateManual({ title: "a".repeat(121), date }, UUID)).toEqual({
      ok: false,
      errors: ["Le titre ne doit pas dépasser 120 caractères."],
    });
  });

  it("refuse une heure impossible", () => {
    const r = validateManual({ title: "Quiz", date: "2026-09-18", time: "25:00" }, UUID);

    expect(r).toEqual({ ok: false, errors: ["L'heure doit être au format HH:MM, par exemple 23:59."] });
  });

  it("une heure vide retombe sur 23:59", () => {
    const r = validateManual({ title: "Quiz", date: "2026-09-18", time: "   " }, UUID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deadline.due).toBe("2026-09-18T23:59");
  });

  it("une date d'ouverture sans heure s'ouvre à minuit", () => {
    const r = validateManual({ title: "Quiz", date: "2026-09-18", startDate: "2026-09-11" }, UUID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deadline.start).toBe("2026-09-11T00:00");
  });

  it("refuse une heure d'ouverture sans date", () => {
    const r = validateManual({ title: "Quiz", date: "2026-09-18", startTime: "08:00" }, UUID);

    expect(r).toEqual({ ok: false, errors: ["Indique aussi la date d'ouverture, pas seulement l'heure."] });
  });

  it("refuse une ouverture postérieure à l'échéance", () => {
    const r = validateManual(
      { title: "Quiz", date: "2026-09-18", time: "16:30", startDate: "2026-09-19", startTime: "08:00" },
      UUID,
    );

    expect(r).toEqual({ ok: false, errors: ["L'ouverture doit précéder l'échéance."] });
  });

  it("refuse une ouverture au même instant que l'échéance", () => {
    const r = validateManual(
      { title: "Quiz", date: "2026-09-18", time: "16:30", startDate: "2026-09-18", startTime: "16:30" },
      UUID,
    );

    expect(r.ok).toBe(false);
  });

  it("accepte une ouverture une minute avant l'échéance", () => {
    const r = validateManual(
      { title: "Quiz", date: "2026-09-18", time: "16:30", startDate: "2026-09-18", startTime: "16:29" },
      UUID,
    );

    expect(r.ok).toBe(true);
  });

  it("ne compare pas les instants si la date d'échéance est déjà fautive", () => {
    const r = validateManual({ title: "Quiz", date: "2026-02-31", startDate: "2026-09-19" }, UUID);

    expect(r).toEqual({ ok: false, errors: ["La date doit être au format AAAA-MM-JJ et exister."] });
  });

  it("refuse une nature inconnue (valeur brute d'un <select>)", () => {
    const r = validateManual({ title: "Quiz", date: "2026-09-18", kind: "examen" as DeadlineKind }, UUID);

    expect(r).toEqual({ ok: false, errors: ["Cette nature d'échéance n'existe pas."] });
  });

  it("rapporte toutes les erreurs d'un coup", () => {
    const r = validateManual({ title: "", date: "2026-13-01", time: "99:99", courseCode: "x" }, UUID);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(4);
  });

  it("les champs optionnels blancs ne sont pas écrits", () => {
    const r = validateManual({ title: "Quiz", date: "2026-09-18", location: "  ", note: "", courseCode: " " }, UUID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("location" in r.deadline).toBe(false);
    expect("note" in r.deadline).toBe(false);
    expect("courseCode" in r.deadline).toBe(false);
  });

  it("l'échéance validée traverse l'état et ressort telle quelle", () => {
    const r = validateManual({ title: "Rendez-vous TGDE", date: "2026-09-18", time: "14:00" }, UUID);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const state = upsertDeadline(stateWith([]), r.deadline);
    expect(allDeadlines(state)).toEqual([r.deadline]);
    expect(deadlineStatus(r.deadline, "2026-09-18T10:00")).toBe("due-today");
  });
});
