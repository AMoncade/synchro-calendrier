import { describe, expect, it, vi } from "vitest";
import type { Cours, Programme } from "@clientside-labs/moteur";
import { VERSION_CONTRAT } from "@clientside-labs/moteur";
import {
  codeOfTrimestre,
  dataDate,
  isCompatible,
  normalizeCodes,
  parseDataVersion,
  trimestreOfCode,
  type DataVersion,
} from "../src/core/catalogue";
import {
  CATALOGUE_CACHE_KEY,
  CatalogueUnavailable,
  httpFetchJson,
  loadCatalogue,
  type FetchJson,
  type StorageArea,
} from "../src/catalogue/remote";

// --- fixtures minimales ------------------------------------------------------

function course(code: string, prealable: string | null = null): Cours {
  return {
    code,
    titre: `Titre ${code}`,
    credits: 3,
    prealables: prealable === null ? null : { genre: "cours", code: prealable },
    prealablesBrut: prealable,
    concomitantsBrut: null,
    restrictionsBrut: null,
    trimestres: [],
    apercuHoraires: [],
  } as unknown as Cours;
}

const PAGE = {
  id: "bacc-test",
  nom: "Baccalauréat de test",
  orientation: null,
  segments: ["01"],
  orientations: [],
  cycle: "1er cycle",
  faculte: null,
  typeProgramme: null,
  creditsTotal: 90,
  exigences: null,
  blocs: [
    {
      id: "01A",
      cle: "01|01A|Obligatoires",
      segment: "01",
      nom: "Obligatoires",
      regle: { genre: "obligatoire" },
      regleBrut: "Obligatoire",
      cours: ["MAT1400", "STT 1700"],
      contenuOuvert: false,
      notes: [],
    },
  ],
  notes: [],
  url: "https://example.invalid",
  scrapeISO: "2026-09-13T00:00:00Z",
} as unknown as Programme;

const SUBJECTS: Record<string, Record<string, Cours>> = {
  MAT: { "MAT 1400": course("MAT 1400", "ECN 1000"), "MAT 1600": course("MAT 1600") },
  STT: { "STT 1700": course("STT 1700", "MAT 1400") },
  PHI: { "PHI 1000": course("PHI 1000") },
  // Sujet d'un PRÉALABLE (MAT 1400 exige ECN 1000) que le programme ne cite pas.
  ECN: { "ECN 1000": course("ECN 1000") },
};

function version(over: Partial<DataVersion> = {}): DataVersion {
  return {
    contrat: VERSION_CONTRAT,
    scrapeISO: "2026-09-13T19:11:31Z",
    horairesISO: null,
    index: "i1",
    programmes: "p1",
    sujets: { MAT: "m1", STT: "s1", PHI: "f1", ECN: "e1" },
    ...over,
  };
}

/** Un serveur factice qui compte ce qu'on lui demande. */
function server(v: () => DataVersion | Error) {
  const asked: string[] = [];
  const fetchJson: FetchJson = async (path) => {
    asked.push(path);
    if (path === "version.json") {
      const value = v();
      if (value instanceof Error) throw value;
      return value;
    }
    if (path === "programmes/bacc-test.json") return PAGE;
    const m = /^cours\/([A-Z]+)\.json$/.exec(path);
    if (m && SUBJECTS[m[1] as string]) return SUBJECTS[m[1] as string];
    throw new Error(`404 ${path}`);
  };
  return { fetchJson, asked };
}

function memoryStorage(failOnSet = false): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(items) {
      if (failOnSet) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

const NOW = "2026-10-30T12:00:00Z";

// --- core -------------------------------------------------------------------

describe("core/catalogue", () => {
  it("lit version.json et refuse une forme inconnue", () => {
    expect(parseDataVersion(version())).toEqual(version());
    expect(parseDataVersion({ contrat: "2" })).toBeNull();
    expect(parseDataVersion(null)).toBeNull();
    expect(parseDataVersion({ ...version(), sujets: { MAT: 1 } })).toBeNull();
  });

  it("n'accepte que le contrat exact du moteur embarqué", () => {
    expect(isCompatible({ contrat: VERSION_CONTRAT })).toBe(true);
    expect(isCompatible({ contrat: VERSION_CONTRAT + 1 })).toBe(false);
    expect(isCompatible({ contrat: VERSION_CONTRAT - 1 })).toBe(false);
  });

  it("date les données par la passe la plus récente", () => {
    expect(dataDate({ scrapeISO: "2026-09-13T00:00:00Z", horairesISO: null })).toBe("2026-09-13T00:00:00Z");
    expect(dataDate({ scrapeISO: "2026-09-13T00:00:00Z", horairesISO: "2026-11-02T09:00:00Z" })).toBe(
      "2026-11-02T09:00:00Z",
    );
    expect(dataDate({ scrapeISO: null, horairesISO: null })).toBeNull();
  });

  it("convertit les codes de trimestre de l'extension vers le moteur et retour", () => {
    expect(trimestreOfCode("H27")).toEqual({ saison: "Hiver", annee: 2027 });
    expect(trimestreOfCode("A26")).toEqual({ saison: "Automne", annee: 2026 });
    expect(trimestreOfCode("E27")).toEqual({ saison: "Été", annee: 2027 });
    expect(trimestreOfCode("X27")).toBeNull();
    expect(codeOfTrimestre({ saison: "Hiver", annee: 2027 })).toBe("H27");
    expect(codeOfTrimestre({ saison: "Été", annee: 2030 })).toBe("E30");
  });

  it("normalise les codes Synchro (sans espace) vers ceux du catalogue", () => {
    expect(normalizeCodes(["MAT1400", "STT 1700", "mat-1400", "???"])).toEqual({
      codes: ["MAT 1400", "STT 1700"],
      rejected: ["???"],
    });
  });
});

// --- chargement ---------------------------------------------------------------

describe("loadCatalogue", () => {
  it("premier chargement : programme et sujets cités, puis mise en cache", async () => {
    const { fetchJson, asked } = server(() => version());
    const storage = memoryStorage();
    const r = await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    expect(r.source).toBe("reseau");
    expect(r.offline).toBe(false);
    expect(asked).toEqual(["version.json", "programmes/bacc-test.json", "cours/MAT.json", "cours/STT.json"]);
    // Le code « MAT1400 » du bloc est normalisé par assembler().
    expect(r.assembled.programme.blocs[0]?.cours).toEqual(["MAT 1400", "STT 1700"]);
    // Fiches utiles seulement : MAT 1600 n'est cité nulle part.
    expect(Object.keys(r.assembled.catalogue.cours).sort()).toEqual(["MAT 1400", "STT 1700"]);
    expect(storage.data[CATALOGUE_CACHE_KEY]).toMatchObject({ cle: "bacc-test", savedAt: NOW });
  });

  it("un seul tour : le sujet d'un préalable non cité n'est pas téléchargé", async () => {
    const { fetchJson, asked } = server(() => version());
    const r = await loadCatalogue({ cle: "bacc-test", storage: memoryStorage(), fetchJson, now: NOW });
    expect(asked).not.toContain("cours/ECN.json");
    // L'arbre de préalables reste entier : le diagnostic n'a pas besoin de la fiche.
    expect(r.assembled.catalogue.cours["MAT 1400"]?.prealables).toEqual({ genre: "cours", code: "ECN 1000" });
  });

  it("le cache ne garde que les fiches utiles", async () => {
    const { fetchJson } = server(() => version());
    const storage = memoryStorage();
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    const cache = storage.data[CATALOGUE_CACHE_KEY] as { subjects: Record<string, { courses: { code: string }[] }> };
    expect(cache.subjects.MAT?.courses.map((c) => c.code)).toEqual(["MAT 1400"]);
  });

  it("un cours hors programme ajouté plus tard fait relire son sujet, déjà trié", async () => {
    const { fetchJson, asked } = server(() => version());
    const storage = memoryStorage();
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    asked.length = 0;
    const r = await loadCatalogue({ cle: "bacc-test", extraCodes: ["MAT 1600"], storage, fetchJson, now: NOW });
    expect(asked).toEqual(["version.json", "cours/MAT.json"]);
    expect(r.assembled.catalogue.cours["MAT 1600"]).toBeDefined();
  });

  it("rien n'a bougé : seul version.json est relu", async () => {
    const { fetchJson, asked } = server(() => version());
    const storage = memoryStorage();
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    asked.length = 0;
    const r = await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    expect(asked).toEqual(["version.json"]);
    expect(r.source).toBe("cache");
    expect(r.assembled.catalogue.cours["STT 1700"]).toBeDefined();
  });

  it("un sujet a changé : seul ce sujet est retéléchargé", async () => {
    let v = version();
    const { fetchJson, asked } = server(() => v);
    const storage = memoryStorage();
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    asked.length = 0;
    v = version({ sujets: { MAT: "m1", STT: "s2", PHI: "f1", ECN: "e1" }, horairesISO: "2026-11-02T09:00:00Z" });
    const r = await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    expect(asked).toEqual(["version.json", "cours/STT.json"]);
    expect(r.source).toBe("reseau");
    expect(r.dataDate).toBe("2026-11-02T09:00:00Z");
  });

  it("le programme a changé : la page ET les sujets sont relus (le tri dépend du programme)", async () => {
    let v = version();
    const { fetchJson, asked } = server(() => v);
    const storage = memoryStorage();
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    asked.length = 0;
    v = version({ programmes: "p2" });
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    expect(asked).toEqual(["version.json", "programmes/bacc-test.json", "cours/MAT.json", "cours/STT.json"]);
  });

  it("hors ligne avec un cache : on montre le cache et on le dit", async () => {
    let online = true;
    const { fetchJson } = server(() => (online ? version() : new Error("Failed to fetch")));
    const storage = memoryStorage();
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    online = false;
    const r = await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    expect(r.offline).toBe(true);
    expect(r.source).toBe("cache");
    expect(r.dataDate).toBe("2026-09-13T19:11:31Z");
    expect(r.assembled.catalogue.cours["MAT 1400"]).toBeDefined();
  });

  it("hors ligne sans cache : erreur explicite, pas un écran vide", async () => {
    const { fetchJson } = server(() => new Error("Failed to fetch"));
    await expect(
      loadCatalogue({ cle: "bacc-test", storage: memoryStorage(), fetchJson, now: NOW }),
    ).rejects.toMatchObject({ reason: "offline" });
  });

  it("le cache d'un AUTRE programme ne sert pas hors ligne", async () => {
    let online = true;
    const { fetchJson } = server(() => (online ? version() : new Error("Failed to fetch")));
    const storage = memoryStorage();
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    online = false;
    await expect(
      loadCatalogue({ cle: "bacc-test#Statistique", storage, fetchJson, now: NOW }),
    ).rejects.toBeInstanceOf(CatalogueUnavailable);
  });

  it("contrat incompatible : le cache reste affiché, rien n'est relu", async () => {
    let v = version();
    const { fetchJson, asked } = server(() => v);
    const storage = memoryStorage();
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    asked.length = 0;
    v = version({ contrat: VERSION_CONTRAT + 1, programmes: "p9", sujets: { MAT: "x", STT: "y" } });
    const r = await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    expect(r.incompatible).toBe(true);
    expect(asked).toEqual(["version.json"]);
    expect(r.assembled.catalogue.cours["STT 1700"]).toBeDefined();
  });

  it("contrat incompatible sans cache : demande de mettre à jour l'extension", async () => {
    const { fetchJson } = server(() => version({ contrat: VERSION_CONTRAT + 1 }));
    await expect(
      loadCatalogue({ cle: "bacc-test", storage: memoryStorage(), fetchJson, now: NOW }),
    ).rejects.toMatchObject({ reason: "incompatible" });
  });

  it("un cours suivi HORS programme ne fait télécharger aucun sujet (confidentialité)", async () => {
    // Demander cours/PHI.json dirait au serveur que l'étudiant suit un cours PHI.
    const { fetchJson, asked } = server(() => version());
    const r = await loadCatalogue({
      cle: "bacc-test",
      extraCodes: ["PHI 1000", "MAT 1600", "ZZZ 1000"],
      storage: memoryStorage(),
      fetchJson,
      now: NOW,
    });
    expect(asked).toEqual(["version.json", "programmes/bacc-test.json", "cours/MAT.json", "cours/STT.json"]);
    expect(r.assembled.catalogue.cours["PHI 1000"]).toBeUndefined();
    // Dans un sujet déjà chargé pour le programme, la fiche est gardée.
    expect(r.assembled.catalogue.cours["MAT 1600"]).toBeDefined();
  });

  it("un cache écrit sous un autre contrat ne sert jamais de repli hors ligne", async () => {
    const storage = memoryStorage();
    let online = true;
    const { fetchJson } = server(() => (online ? version() : new Error("Failed to fetch")));
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    (storage.data[CATALOGUE_CACHE_KEY] as { version: { contrat: number } }).version.contrat = VERSION_CONTRAT - 1;
    online = false;
    await expect(loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW })).rejects.toMatchObject({
      reason: "offline",
    });
  });

  it("un version.json de forme inconnue = données incompatibles, pas « hors ligne »", async () => {
    const storage = memoryStorage();
    let shape: unknown = version();
    const fetchJson: FetchJson = async (path) => (path === "version.json" ? shape : server(() => version()).fetchJson(path));
    await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    shape = { format: "nouveau" };
    const r = await loadCatalogue({ cle: "bacc-test", storage, fetchJson, now: NOW });
    expect(r).toMatchObject({ incompatible: true, offline: false });
    await expect(
      loadCatalogue({ cle: "bacc-test", storage: memoryStorage(), fetchJson, now: NOW }),
    ).rejects.toMatchObject({ reason: "incompatible" });
  });

  it("un stockage plein n'empêche pas l'onglet de marcher en ligne", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchJson } = server(() => version());
    const r = await loadCatalogue({ cle: "bacc-test", storage: memoryStorage(true), fetchJson, now: NOW });
    expect(r.assembled.catalogue.cours["MAT 1400"]).toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("httpFetchJson", () => {
  it("GET sans identifiants ni en-tête maison, revalidé par le navigateur", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    const get = httpFetchJson(fake, "https://exemple.test/donnees");
    expect(await get("version.json")).toEqual({ ok: 1 });
    const [url, init] = calls[0] ?? ["", undefined];
    expect(url).toBe("https://exemple.test/donnees/version.json");
    expect(init?.cache).toBe("no-cache");
    expect(init?.credentials).toBe("omit");
    expect(init?.method).toBeUndefined();
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it("un statut d'erreur rejette au lieu de rendre un catalogue vide", async () => {
    const fake = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(httpFetchJson(fake, "https://exemple.test")("x.json")).rejects.toThrow(/404/);
  });
});
