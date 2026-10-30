// Catalogue de Plan ton bacc vu par l'extension : version des données publiées,
// compatibilité avec le moteur embarqué, forme du cache. Logique pure — le
// réseau et chrome.storage vivent dans src/catalogue/.
//
// D'où viennent les données. Plan ton bacc publie son catalogue (scrapé sur
// admission.umontreal.ca) en fichiers JSON statiques sur Vercel. L'extension les
// TÉLÉCHARGE par de simples GET : aucune donnée de l'étudiant ne part avec la
// requête, ni en paramètre ni en corps.

import type { CodeCours, Cours, Programme, Saison, Trimestre } from "@clientside-labs/moteur";
import { VERSION_CONTRAT, codesDuNoeud, normaliserCode, sujetDeCode } from "@clientside-labs/moteur";
import type { Term } from "./model";

/** Racine des données publiques de Plan ton bacc. */
export const DATA_BASE = "https://udem-plan-ton-bacc.vercel.app/donnees";

/** Lien vers l'app web, pour « Voir l'audit complet ». */
export const WEB_APP = "https://udem-plan-ton-bacc.vercel.app";

/**
 * `/donnees/version.json`, écrit par `scripts/copier-donnees.mjs` de Plan ton
 * bacc. Lu à chaque ouverture de l'onglet : petit, il dit quels sujets ont
 * bougé depuis le cache, et si le moteur embarqué sait lire ces données.
 */
export interface DataVersion {
  contrat: number;
  scrapeISO: string | null;
  horairesISO: string | null;
  index: string | null;
  /** Empreinte de l'ensemble des fichiers de programmes. */
  programmes: string;
  /** Empreinte par fichier de sujet ("MAT" → "4a1f…"). */
  sujets: Record<string, string>;
}

/** Valide la forme de version.json ; `null` si elle n'est pas reconnue. */
export function parseDataVersion(raw: unknown): DataVersion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const str = (x: unknown): x is string => typeof x === "string";
  const strOrNull = (x: unknown): x is string | null => x === null || typeof x === "string";
  if (typeof v.contrat !== "number" || !str(v.programmes)) return null;
  if (!strOrNull(v.scrapeISO) || !strOrNull(v.horairesISO) || !strOrNull(v.index)) return null;
  if (typeof v.sujets !== "object" || v.sujets === null) return null;
  const sujets: Record<string, string> = {};
  for (const [k, h] of Object.entries(v.sujets as Record<string, unknown>)) {
    if (!str(h)) return null;
    sujets[k] = h;
  }
  return {
    contrat: v.contrat,
    scrapeISO: v.scrapeISO,
    horairesISO: v.horairesISO,
    index: v.index,
    programmes: v.programmes,
    sujets,
  };
}

/**
 * Le moteur embarqué sait-il lire ces données ? Égalité stricte : des données
 * PLUS récentes peuvent porter un champ dont le sens a changé, des données plus
 * VIEILLES peuvent manquer un champ que le moteur suppose. Dans les deux cas,
 * l'onglet garde son cache plutôt que de lire de travers.
 */
export function isCompatible(version: Pick<DataVersion, "contrat">, engine = VERSION_CONTRAT): boolean {
  return version.contrat === engine;
}

/** La date la plus récente des données : la dernière passe d'horaires si elle a
 *  eu lieu, sinon le scrape complet. `null` si les données n'en portent aucune. */
export function dataDate(version: Pick<DataVersion, "scrapeISO" | "horairesISO">): string | null {
  const dates = [version.scrapeISO, version.horairesISO].filter((d): d is string => d !== null);
  if (dates.length === 0) return null;
  return dates.sort()[dates.length - 1] ?? null;
}

/**
 * Ce qui est gardé dans chrome.storage.local entre deux ouvertures.
 *
 * Seulement les fiches UTILES (`neededCodes`), pas les fichiers de sujet
 * entiers. Mesuré sur le bacc en mathématiques, orientation Statistique
 * (données du 2026-09-13) : les 9 sujets cités pèsent 1,7 Mo pour 694 fiches,
 * alors que les 82 cours du parcours n'en pèsent que 167 ko. Le stockage d'une
 * extension est plafonné à 10 Mo.
 */
export interface CatalogueCache {
  /** Clé de parcours de Plan ton bacc : `slug` ou `slug#orientation`. */
  cle: string;
  version: Pick<DataVersion, "contrat" | "scrapeISO" | "horairesISO" | "programmes">;
  /** La page du programme telle que publiée (avant projection d'orientation). */
  page: Programme;
  /** Par sujet : l'empreinte du fichier lu, et les seules fiches utiles. */
  subjects: Record<string, { hash: string; courses: Cours[] }>;
  /** Les cours hors programme (faits, en cours) dont la fiche a été gardée. */
  extra: CodeCours[];
  savedAt: string;
}

/** Le cache décrit-il le même parcours, lu sous un programme encore à jour ? */
export function pageStillValid(cache: CatalogueCache, cle: string, version: DataVersion): boolean {
  return (
    cache.cle === cle &&
    cache.version.contrat === version.contrat &&
    cache.version.programmes === version.programmes
  );
}

/**
 * Les fiches d'un sujet en cache suffisent-elles ? Elles ont été TRIÉES pour un
 * parcours et une liste de cours hors programme : il faut le même parcours sous
 * le même programme, la même empreinte de sujet, et aucun cours hors programme
 * de ce sujet que le tri n'aurait pas gardé.
 */
export function subjectReusable(
  cache: CatalogueCache | null,
  cle: string,
  sujet: string,
  version: DataVersion,
  extra: readonly CodeCours[],
): boolean {
  if (cache === null || !pageStillValid(cache, cle, version)) return false;
  const entry = cache.subjects[sujet];
  if (entry === undefined || entry.hash !== version.sujets[sujet]) return false;
  return extra.filter((c) => sujetDeCode(c) === sujet).every((c) => cache.extra.includes(c));
}

/**
 * Les codes dont la fiche sert à l'onglet : ceux que citent les blocs du
 * parcours, leurs préalables (pour nommer ce qui manque), et les cours hors
 * programme passés en `extra` (pour que l'audit connaisse leurs crédits).
 */
export function neededCodes(
  programme: Programme,
  courses: Record<CodeCours, Cours>,
  extra: readonly CodeCours[],
): Set<CodeCours> {
  const needed = new Set<CodeCours>(extra);
  for (const bloc of programme.blocs) {
    for (const code of bloc.cours) {
      needed.add(code);
      const fiche = courses[code];
      if (fiche !== undefined) for (const p of codesDuNoeud(fiche.prealables)) needed.add(p);
    }
  }
  return needed;
}

/**
 * Codes Synchro ("MAT1400") → codes du catalogue ("MAT 1400"). Les codes que
 * `normaliserCode` refuse sont écartés et rendus à part : comparer deux formes
 * différentes ne lève aucune erreur, ça vide juste le résultat en silence.
 */
export function normalizeCodes(raw: readonly string[]): { codes: CodeCours[]; rejected: string[] } {
  const codes: CodeCours[] = [];
  const rejected: string[] = [];
  for (const r of raw) {
    const c = normaliserCode(r);
    if (c === null) rejected.push(r);
    else if (!codes.includes(c)) codes.push(c);
  }
  return { codes, rejected };
}

const SEASON_BY_LETTER: Record<string, Saison> = { A: "Automne", H: "Hiver", E: "Été" };
const LETTER_BY_SEASON: Record<Saison, string> = { Automne: "A", Hiver: "H", Été: "E" };

/** "H27" → { saison: "Hiver", annee: 2027 }. `null` si le code n'a pas cette forme. */
export function trimestreOfCode(code: string): Trimestre | null {
  const m = /^([AHE])(\d{2})$/.exec(code);
  if (!m) return null;
  const saison = SEASON_BY_LETTER[m[1] as string];
  if (saison === undefined) return null;
  return { saison, annee: 2000 + Number(m[2]) };
}

/** { saison: "Hiver", annee: 2027 } → "H27". */
export function codeOfTrimestre(t: Trimestre): string {
  return `${LETTER_BY_SEASON[t.saison]}${String(t.annee % 100).padStart(2, "0")}`;
}

/** Le trimestre d'un horaire capturé, au format du moteur. */
export function trimestreOfTerm(term: Term): Trimestre | null {
  return trimestreOfCode(term.code);
}
