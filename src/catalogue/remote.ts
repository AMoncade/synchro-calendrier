// Téléchargement et cache du catalogue de Plan ton bacc (onglet « Prochaine
// session »). Réseau et stockage sont INJECTÉS : le popup passe `fetch` et
// chrome.storage.local, les tests passent des faux.
//
// Ce qui part sur le réseau : des GET sur des fichiers publics
// (`version.json`, `programmes/<id>.json`, `cours/<SUJET>.json`), sans
// paramètre ni corps. Rien de l'étudiant — ni son horaire, ni ses cours, ni son
// programme — n'est transmis ; le programme choisi se devine au NOM du fichier
// demandé, comme pour n'importe quel visiteur du site. Pas de permission d'hôte :
// Vercel sert ces fichiers avec `Access-Control-Allow-Origin: *` (épinglé dans
// vercel.json de Plan ton bacc).

import type {
  CatalogueAssemble,
  CodeCours,
  Cours,
  Depot,
  IndexProgrammes,
  Programme,
} from "@clientside-labs/moteur";
import { assembler, lireCleParcours, normaliserCode } from "@clientside-labs/moteur";
import {
  DATA_BASE,
  dataDate,
  isCompatible,
  pageStillValid,
  parseDataVersion,
  neededCodes,
  subjectReusable,
  type CatalogueCache,
  type DataVersion,
} from "../core/catalogue";

import { CATALOGUE_CACHE_KEY } from "../lib/messages";

export { CATALOGUE_CACHE_KEY };

/** Le sous-ensemble de chrome.storage.local dont ce module a besoin. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** Lit un fichier JSON relatif à la racine des données. Rejette sur toute erreur. */
export type FetchJson = (path: string) => Promise<unknown>;

/**
 * `fetch` vers DATA_BASE. `cache: "no-cache"` revalide chaque lecture auprès du
 * serveur (ETag, 304 sans corps) : le navigateur pose lui-même l'en-tête
 * conditionnel, donc aucun en-tête maison, donc aucun préflight CORS. Un
 * `force-cache` servirait indéfiniment la première version lue.
 */
export function httpFetchJson(
  fetchImpl: typeof fetch = fetch,
  base: string = DATA_BASE,
  timeoutMs = 15_000,
): FetchJson {
  return async (path) => {
    const url = `${base}/${path}`;
    const response = await fetchImpl(url, {
      cache: "no-cache",
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${url} a répondu ${response.status}.`);
    return (await response.json()) as unknown;
  };
}

/** `version.json` lu mais de forme inconnue : ce n'est pas une panne réseau. */
export class VersionFormatError extends Error {}

export async function fetchVersion(fetchJson: FetchJson): Promise<DataVersion> {
  const version = parseDataVersion(await fetchJson("version.json"));
  if (version === null) throw new VersionFormatError("version.json n'a pas la forme attendue.");
  return version;
}

/** L'index des programmes, pour la recherche du premier lancement (≈ 650 ko). */
export async function fetchIndex(fetchJson: FetchJson): Promise<IndexProgrammes> {
  return (await fetchJson("index-programmes.json")) as IndexProgrammes;
}

/** Un fichier de sujet est une table code → Cours ; on accepte aussi un tableau. */
function coursesOf(raw: unknown, sujet: string): Cours[] {
  if (Array.isArray(raw)) return raw as Cours[];
  if (typeof raw === "object" && raw !== null) {
    const values = Object.values(raw as Record<string, unknown>);
    if (values.every((v) => typeof v === "object" && v !== null && "code" in v)) return values as Cours[];
  }
  throw new Error(`cours/${sujet}.json n'a pas une forme reconnue.`);
}

export interface LoadResult {
  assembled: CatalogueAssemble;
  /** "reseau" : au moins une partie a été lue en ligne à cette ouverture. */
  source: "reseau" | "cache";
  /** Hors ligne ou serveur injoignable : on montre le cache. */
  offline: boolean;
  /** Les données publiées ne sont pas lisibles par ce moteur : on montre le cache. */
  incompatible: boolean;
  /** Date des données affichées (« données du … »). */
  dataDate: string | null;
}

export class CatalogueUnavailable extends Error {
  constructor(
    message: string,
    readonly reason: "offline" | "incompatible" | "error",
  ) {
    super(message);
  }
}

interface LoadOptions {
  /** Clé de parcours de Plan ton bacc (`slug` ou `slug#orientation`). */
  cle: string;
  /**
   * Cours de l'étudiant (faits, en cours, inscrits) dont la fiche est GARDÉE si
   * elle se trouve dans un sujet déjà chargé pour le programme. Aucun sujet
   * n'est téléchargé à cause d'eux : le nom du fichier demandé révélerait au
   * serveur le sigle d'un cours que l'étudiant suit hors de son programme.
   */
  extraCodes?: readonly CodeCours[];
  storage: StorageArea;
  fetchJson: FetchJson;
  /** Instant courant, ISO. */
  now: string;
}

async function readCache(storage: StorageArea): Promise<CatalogueCache | null> {
  try {
    const value = (await storage.get(CATALOGUE_CACHE_KEY))[CATALOGUE_CACHE_KEY];
    return (value as CatalogueCache | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Assemble le parcours : les sujets cités par ses blocs SEULEMENT (un tour,
 * voir `OptionsAssemblage.toursMax` dans le moteur), puis ne garde que les
 * fiches utiles. Le même tri en ligne et depuis le cache : l'écran ne doit pas
 * changer selon d'où viennent les données.
 */
async function assembleWith(depot: Depot, cle: string, extra: readonly CodeCours[]) {
  const assembled = await assembler(depot, cle, { toursMax: 1 });
  const needed = neededCodes(assembled.programme, assembled.catalogue.cours, extra);
  for (const code of Object.keys(assembled.catalogue.cours)) {
    if (!needed.has(code)) delete assembled.catalogue.cours[code];
  }
  return { assembled, needed };
}

/** Assemble le parcours en ne lisant QUE le cache. */
async function assembleFromCache(cache: CatalogueCache, cle: string, extra: readonly CodeCours[]) {
  const depot: Depot = {
    origine: "cache local",
    estFactice: false,
    chargerIndex: () => Promise.reject(new Error("index absent du cache")),
    chargerProgramme: async () => cache.page,
    chargerSujet: async (sujet) => cache.subjects[sujet]?.courses ?? [],
  };
  return (await assembleWith(depot, cle, extra)).assembled;
}

/**
 * Le catalogue du parcours, à jour si le réseau répond, sinon depuis le cache.
 *
 * 1. `version.json` dit si les données ont bougé et si ce moteur sait les lire.
 * 2. Le programme et chaque sujet ne sont retéléchargés que si leur empreinte a
 *    changé ; le reste vient du cache.
 * 3. Le cache est réécrit. S'il ne tient pas dans le stockage, l'onglet marche
 *    quand même — en ligne — et le dit dans la console.
 *
 * Rejette avec `CatalogueUnavailable` quand ni le réseau ni le cache ne
 * permettent d'afficher ce parcours.
 */
export async function loadCatalogue(options: LoadOptions): Promise<LoadResult> {
  const { cle, storage, fetchJson, now } = options;
  const extra = options.extraCodes ?? [];
  // Un cache écrit sous un autre contrat n'est pas lisible par CE moteur (mise à
  // jour de l'extension) : il ne sert jamais de repli.
  const stored = await readCache(storage);
  const cache = stored !== null && isCompatible(stored.version) ? stored : null;
  const usable = cache !== null && cache.cle === cle ? cache : null;

  let version: DataVersion;
  try {
    version = await fetchVersion(fetchJson);
  } catch (cause) {
    if (cause instanceof VersionFormatError) {
      // Le serveur a répondu, dans une forme que ce moteur ne connaît pas : même
      // traitement qu'un contrat incompatible, pas « hors ligne ».
      if (usable === null) {
        throw new CatalogueUnavailable(
          "Les données de Plan ton bacc ont changé de format. Mets à jour l'extension pour les lire.",
          "incompatible",
        );
      }
      return {
        assembled: await assembleFromCache(usable, cle, extra),
        source: "cache",
        offline: false,
        incompatible: true,
        dataDate: dataDate(usable.version),
      };
    }
    if (usable === null) {
      throw new CatalogueUnavailable(
        "Le catalogue de Plan ton bacc est injoignable et rien n'est en cache. Réessaie une fois en ligne.",
        "offline",
      );
    }
    return {
      assembled: await assembleFromCache(usable, cle, extra),
      source: "cache",
      offline: true,
      incompatible: false,
      dataDate: dataDate(usable.version),
    };
  }

  if (!isCompatible(version)) {
    if (usable === null) {
      throw new CatalogueUnavailable(
        "Les données de Plan ton bacc ont changé de format. Mets à jour l'extension pour les lire.",
        "incompatible",
      );
    }
    return {
      assembled: await assembleFromCache(usable, cle, extra),
      source: "cache",
      offline: false,
      incompatible: true,
      dataDate: dataDate(usable.version),
    };
  }

  const id = lireCleParcours(cle)?.id;
  if (id === undefined) throw new CatalogueUnavailable(`Programme mal formé : « ${cle} ».`, "error");

  // Un objet plutôt que des `let` : ces valeurs sont écrites depuis les
  // fermetures du dépôt, que l'analyse de flux de TypeScript ne suit pas.
  const loaded: { page: Programme | null; network: boolean } = { page: null, network: false };
  const subjects: CatalogueCache["subjects"] = {};

  const depot: Depot = {
    origine: "Plan ton bacc",
    estFactice: false,
    chargerIndex: () => fetchIndex(fetchJson),
    async chargerProgramme(programmeId) {
      let page: Programme;
      if (cache !== null && programmeId === id && pageStillValid(cache, cle, version)) {
        page = cache.page;
      } else {
        page = (await fetchJson(`programmes/${programmeId}.json`)) as Programme;
        loaded.network = true;
      }
      loaded.page = page;
      return page;
    },
    async chargerSujet(sujet) {
      const hash = version.sujets[sujet];
      // Absent de version.json : le scrape n'a aucune fiche de ce sujet. Cas
      // normal du catalogue, pas une panne.
      if (hash === undefined) return [];
      const already = subjects[sujet];
      if (already !== undefined) return already.courses;
      let courses: Cours[];
      if (subjectReusable(cache, cle, sujet, version, extra)) {
        courses = cache?.subjects[sujet]?.courses ?? [];
      } else {
        courses = coursesOf(await fetchJson(`cours/${sujet}.json`), sujet);
        loaded.network = true;
      }
      subjects[sujet] = { hash, courses };
      return courses;
    },
  };

  let assembled: CatalogueAssemble;
  let needed: Set<CodeCours>;
  try {
    ({ assembled, needed } = await assembleWith(depot, cle, extra));
  } catch (cause) {
    // Panne en cours de route (un sujet injoignable) : le cache, s'il y en a un,
    // vaut mieux qu'un écran d'erreur.
    if (usable !== null) {
      return {
        assembled: await assembleFromCache(usable, cle, extra),
        source: "cache",
        offline: true,
        incompatible: false,
        dataDate: dataDate(usable.version),
      };
    }
    throw new CatalogueUnavailable(`Lecture du catalogue impossible : ${String(cause)}`, "error");
  }

  const page = loaded.page;
  if (page !== null) {
    const next: CatalogueCache = {
      cle,
      version: {
        contrat: version.contrat,
        scrapeISO: version.scrapeISO,
        horairesISO: version.horairesISO,
        programmes: version.programmes,
      },
      page,
      subjects: Object.fromEntries(
        Object.entries(subjects).map(([sujet, { hash, courses }]) => [
          sujet,
          { hash, courses: courses.filter((c) => needed.has(normaliserCode(c.code) ?? c.code)) },
        ]),
      ),
      extra: [...extra].sort(),
      savedAt: now,
    };
    try {
      await storage.set({ [CATALOGUE_CACHE_KEY]: next });
    } catch (cause) {
      console.warn("ClientSide Horaire : catalogue non mis en cache", cause);
    }
  }

  return {
    assembled,
    source: loaded.network ? "reseau" : "cache",
    offline: false,
    incompatible: false,
    dataDate: dataDate(version),
  };
}
