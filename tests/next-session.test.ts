import { describe, expect, it } from "vitest";
import type { CatalogueAssemble, Cours, IndexProgrammes, JourSemaine, Seance, Trimestre } from "@clientside-labs/moteur";
import { preparerIndex } from "@clientside-labs/moteur";
import cacheFixture from "./fixtures/ptb-maths-statistique.cache.json";
import { CATALOGUE_CACHE_KEY, loadCatalogue, type StorageArea } from "../src/catalogue/remote";
import type { Schedule } from "../src/core/model";
import {
  auditLink,
  buildModel,
  doneChecklist,
  factsOf,
  parsePathway,
  searchPrograms,
  studentCourses,
  summarizeSelection,
  targetTerm,
  type Pathway,
} from "../src/core/next-session";

const H27: Trimestre = { saison: "Hiver", annee: 2027 };
const CLE = "baccalaureat-en-mathematiques#Statistique";
/** Les quatre cours réels de l'horaire A26 capturé (tests/fixtures/liste-A26.*). */
const A26 = ["MAT 1400", "MAT 1500", "MAT 1600", "STT 1700"];

/** Le catalogue réel, relu depuis la fixture par le vrai chemin hors ligne. */
async function realCatalogue(): Promise<CatalogueAssemble> {
  const data: Record<string, unknown> = { [CATALOGUE_CACHE_KEY]: structuredClone(cacheFixture) };
  const storage: StorageArea = {
    async get(k) {
      return { [k]: data[k] };
    },
    async set() {},
    async remove() {},
  };
  const r = await loadCatalogue({
    cle: CLE,
    extraCodes: A26,
    storage,
    fetchJson: () => Promise.reject(new Error("hors ligne")),
    now: "2026-10-30T12:00:00Z",
  });
  expect(r.offline).toBe(true);
  return r.assembled;
}

function pathway(over: Partial<Pathway> = {}): Pathway {
  return {
    cle: CLE,
    label: "Baccalauréat en mathématiques — orientation statistique",
    cheminement: null,
    done: [],
    excludedInProgress: [],
    savedAt: "2026-10-30T12:00:00Z",
    ...over,
  };
}

function schedule(code: string, label: string, courses: string[]): Schedule {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-09T12:00:00Z",
    term: { code, label, start: "2026-09-02", end: "2026-12-23" },
    courses: courses.map((c) => ({ code: c, title: c, section: "A", component: "TH", meetings: [] })),
    exams: [],
  };
}

const COURSES_A26 = studentCourses(
  { A26: schedule("A26", "Automne 2026", ["MAT1400", "MAT1500", "MAT1600", "STT1700"]) },
  schedule("A26", "Automne 2026", ["MAT1400", "MAT1500", "MAT1600", "STT1700"]),
  H27,
);

describe("trimestre visé et cours de l'étudiant", () => {
  it("le 30 octobre, on planifie l'hiver suivant ; en février, l'été", () => {
    expect(targetTerm("2026-10-30")).toEqual(H27);
    expect(targetTerm("2027-02-01")).toEqual({ saison: "Été", annee: 2027 });
    expect(targetTerm("2027-06-15")).toEqual({ saison: "Automne", annee: 2027 });
  });

  it("les codes Synchro sans espace deviennent ceux du catalogue", () => {
    expect(COURSES_A26.inProgress).toEqual(A26);
    expect(COURSES_A26.inProgressLabel).toBe("Automne 2026");
    expect(COURSES_A26.registered).toEqual([]);
  });

  it("un horaire déjà capturé pour le trimestre visé = cours déjà inscrits, pas « en cours »", () => {
    const h27 = schedule("H27", "Hiver 2027", ["MAT2600"]);
    const c = studentCourses({ H27: h27 }, h27, H27);
    expect(c.inProgress).toEqual([]);
    expect(c.registered).toEqual(["MAT 2600"]);
  });

  it("un cours en cours décoché n'est plus présumé réussi", () => {
    const facts = factsOf(pathway({ done: ["IFT 1015"], excludedInProgress: ["MAT 1600"] }), A26);
    expect([...facts].sort()).toEqual(["IFT 1015", "MAT 1400", "MAT 1500", "STT 1700"]);
  });

  it("relit un parcours stocké, et refuse une forme inconnue", () => {
    expect(parsePathway(pathway())).toEqual(pathway());
    expect(parsePathway({ ...pathway(), done: "MAT 1400" })).toBeNull();
    expect(parsePathway({ ...pathway(), cle: "" })).toBeNull();
    expect(parsePathway(null)).toBeNull();
  });
});

describe("premier lancement", () => {
  it("cherche un programme sans accents, tous les mots dans n'importe quel ordre", () => {
    const index = {
      programmes: [
        { cle: "bacc-maths#Statistique", id: "bacc-maths", nom: "Baccalauréat en mathématiques", orientation: "Statistique", cycle: "1er cycle", faculte: null, typeProgramme: null, creditsTotal: 90, nbBlocs: 10, structureLue: true },
        { cle: "bacc-droit", id: "bacc-droit", nom: "Baccalauréat en droit", orientation: null, cycle: "1er cycle", faculte: null, typeProgramme: null, creditsTotal: 90, nbBlocs: 10, structureLue: true },
      ],
      sujets: [],
      scrapeISO: "x",
    } as unknown as IndexProgrammes;
    const prepared = preparerIndex(index);
    expect(searchPrograms(prepared, "statistique mathematiques").map((f) => f.cle)).toEqual(["bacc-maths#Statistique"]);
    expect(searchPrograms(prepared, "d")).toEqual([]);
  });

  it("la liste « cours déjà faits » groupe par bloc et ne coche RIEN", async () => {
    const assembled = await realCatalogue();
    const groups = doneChecklist(assembled, A26);
    expect(groups.length).toBeGreaterThan(3);
    const all = groups.flatMap((g) => g.courses);
    // Chaque cours une seule fois, même cité par deux blocs.
    expect(new Set(all.map((c) => c.code)).size).toBe(all.length);
    expect(all.find((c) => c.code === "MAT 1400")).toMatchObject({ inProgress: true, title: "Calcul 1" });
    expect(all.filter((c) => c.inProgress).map((c) => c.code).sort()).toEqual(A26);
    expect(groups.some((g) => g.title.includes("(obligatoire)"))).toBe(true);
  });
});

describe("recommandations sur le vrai catalogue (bacc en mathématiques, Statistique)", () => {
  it("propose environ 5 cours pour 15 crédits, aucun déjà acquis, chacun avec sa raison", async () => {
    const assembled = await realCatalogue();
    const m = buildModel({ assembled, pathway: pathway(), courses: COURSES_A26, target: H27 });
    expect(m.label).toBe("Hiver 2027");
    expect(m.initial.length).toBeGreaterThanOrEqual(3);
    expect(m.initial.length).toBeLessThanOrEqual(6);
    for (const code of m.initial) {
      expect(A26).not.toContain(code);
      const p = m.proposals.find((x) => x.code === code);
      expect(p, code).toBeDefined();
      expect(p?.reasons.length, code).toBeGreaterThan(0);
    }
    const credits = m.initial.reduce((n, c) => n + (assembled.catalogue.cours[c]?.credits ?? 3), 0);
    expect(credits).toBeLessThanOrEqual(15);
  });

  it("« débloque » nomme les cours débloqués", async () => {
    const assembled = await realCatalogue();
    const m = buildModel({ assembled, pathway: pathway(), courses: COURSES_A26, target: H27 });
    const unlocking = m.proposals.flatMap((p) => p.reasons).filter((r) => r.startsWith("débloque "));
    expect(unlocking.length).toBeGreaterThan(0);
    for (const r of unlocking) expect(r).toMatch(/^débloque [A-Z]{3} \d{4}/);
  });

  it("décocher un cours en cours le remet dans les propositions s'il est offert", async () => {
    const assembled = await realCatalogue();
    const base = buildModel({ assembled, pathway: pathway(), courses: COURSES_A26, target: H27 });
    expect(base.proposals.map((p) => p.code)).not.toContain("MAT 1400");
    const m = buildModel({
      assembled,
      pathway: pathway({ excludedInProgress: ["MAT 1400"] }),
      courses: COURSES_A26,
      target: H27,
    });
    expect(m.proposals.map((p) => p.code)).toContain("MAT 1400");
  });

  it("un cours déjà inscrit pour l'hiver passe en tête et reste coché", async () => {
    const assembled = await realCatalogue();
    const courses = { ...COURSES_A26, registered: ["MAT 2600"] };
    const m = buildModel({ assembled, pathway: pathway(), courses, target: H27 });
    expect(m.proposals[0]).toMatchObject({ code: "MAT 2600", registered: true });
    expect(m.proposals[0]?.reasons[0]).toBe("déjà inscrit dans Synchro");
    expect(m.initial).toEqual(["MAT 2600"]);
  });
});

describe("sélection : crédits, combinaisons, grille", () => {
  const fiche = (code: string, credits: number | null, sections: Cours["apercuHoraires"]): Cours =>
    ({ code, titre: code, credits, prealables: null, trimestres: [H27], apercuHoraires: sections }) as unknown as Cours;
  const seance = (jour: JourSemaine, debutMin: number, finMin: number): Seance => ({
    creneau: { genre: "attribue", jour, debutMin, finMin },
    du: "2027-01-07",
    au: "2027-04-16",
  });
  const cours = {
    "AAA 1000": fiche("AAA 1000", 3, [{ trimestre: H27, sections: [{ nom: "A", seances: [seance("Lundi", 510, 629)] }, { nom: "B", seances: [seance("Mardi", 510, 629)] }] }]),
    "BBB 1000": fiche("BBB 1000", 3, [{ trimestre: H27, sections: [{ nom: "A", seances: [seance("Lundi", 510, 629)] }] }]),
    "CCC 1000": fiche("CCC 1000", null, [{ trimestre: H27, sections: [{ nom: "A", seances: [{ creneau: { genre: "nonAttribue" }, du: "2027-01-07", au: "2027-04-16" }] }] }]),
  } as unknown as Record<string, Cours>;

  it("compte les grilles distinctes, sans conflit d'abord, conflits marqués", () => {
    const s = summarizeSelection(cours, ["AAA 1000", "BBB 1000"], H27);
    expect(s.credits).toBe(6);
    expect(s.options).toHaveLength(2);
    expect(s.conflictFree).toBe(1);
    expect(s.options[0]?.choice.find((c) => c.code === "AAA 1000")?.sections).toEqual(["B"]);
    // Par séance : la séance du lundi 8 h 30 de chaque section en conflit.
    expect([...(s.options[1]?.conflicted ?? [])].sort()).toEqual(["AAA 1000|A|Lundi|510", "BBB 1000|A|Lundi|510"]);
  });

  it("horaire non attribué ou fiche absente : « horaire inconnu », jamais sans conflit", () => {
    const s = summarizeSelection(cours, ["AAA 1000", "CCC 1000", "ZZZ 9999"], H27);
    expect(s.unknownSchedule.sort()).toEqual(["CCC 1000", "ZZZ 9999"]);
    // Crédits inconnus : comptés à part, jamais pour zéro.
    expect(s.credits).toBe(3);
    expect(s.unknownCredits).toBe(2);
    expect(s.reserve).toMatch(/APERÇU/);
  });

  it("aucun cours choisi : aucune grille, pas « 1 horaire sans conflit »", () => {
    const s = summarizeSelection(cours, [], H27);
    expect(s.options).toEqual([]);
    expect(s.conflictFree).toBe(0);
  });

  it("sur le vrai catalogue : une sélection d'hiver donne au moins une grille", async () => {
    const assembled = await realCatalogue();
    const m = buildModel({ assembled, pathway: pathway(), courses: COURSES_A26, target: H27 });
    const s = summarizeSelection(assembled.catalogue.cours, m.initial, H27);
    expect(s.options.length + s.unknownSchedule.length + s.undetermined.length).toBeGreaterThan(0);
    for (const o of s.options) expect(o.grid.cases.length).toBeGreaterThan(0);
  });
});

describe("lien vers l'audit complet", () => {
  it("met le parcours dans le FRAGMENT, jamais dans la requête", () => {
    const url = auditLink(pathway({ done: ["MAT 1400"], excludedInProgress: ["STT 1700"] }), ["MAT 1600", "STT 1700"]);
    const u = new URL(url);
    expect(u.origin).toBe("https://udem-plan-ton-bacc.vercel.app");
    expect(u.search).toBe("");
    expect(u.hash.startsWith("#import=")).toBe(true);
    expect(JSON.parse(decodeURIComponent(u.hash.slice("#import=".length)))).toEqual({
      v: 1,
      parcours: CLE,
      cheminement: null,
      faits: ["MAT 1400"],
      // Un cours en cours décoché par l'étudiant ne part pas.
      enCours: ["MAT 1600"],
    });
  });
});
