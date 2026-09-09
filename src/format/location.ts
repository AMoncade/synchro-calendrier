// Découpage des locaux tels que Synchro les affiche.
//
// Formes observées (docs/ARCHITECTURE.md §5, fixtures de tests) :
//   « B-0215 Pav. 3200 J.-Brillant »  → salle + pavillon avec numéro civique
//   « E-310 Pav. Roger-Gaudry »       → salle + pavillon
//   « S1-151 Pav. Jean Coutu »        → pavillon en deux mots
//   « En ligne »                      → aucune salle
// Tout ce qui ne porte pas le marqueur « Pav. » est rendu tel quel en salle :
// mieux vaut afficher un texte non découpé qu'inventer un pavillon.

const ONLINE = /^en\s+ligne$/i;
/** Le marqueur « Pav. » ou « Pav » ou « Pavillon », suivi d'un espace. */
const PAVILION_MARKER = /\s*\bPav(?:illon|\.)?\s+/i;
/** Numéro civique en tête d'un nom de pavillon : « 3200 J.-Brillant ». */
const CIVIC_NUMBER = /^\d+\s+/;

export interface Location {
  /** « B-0215 », ou "" quand il n'y a pas de salle (cours en ligne). */
  salle: string;
  /** « J.-Brillant », « Roger-Gaudry », « En ligne », ou "" si inconnu. */
  pavillon: string;
  /** Identifiant stable, sans accent ni ponctuation : « j-brillant ». "" si inconnu. */
  pavillonId: string;
}

function normalize(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Identifiant stable d'un pavillon : minuscules, accents retirés, tout ce qui
 * n'est pas alphanumérique replié en tirets. « J.-Brillant » → « j-brillant ».
 */
export function slug(text: string): string {
  return normalize(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Découpe « B-0215 Pav. 3200 J.-Brillant » en salle, pavillon et identifiant. */
export function parseLocation(text: string): Location {
  const clean = normalize(text);
  if (clean === "") return { salle: "", pavillon: "", pavillonId: "" };
  if (ONLINE.test(clean)) return { salle: "", pavillon: "En ligne", pavillonId: "en-ligne" };

  const marker = PAVILION_MARKER.exec(clean);
  if (!marker) {
    // Aucun marqueur « Pav. » : on ne devine pas, on rend le texte tel quel.
    return { salle: clean, pavillon: "", pavillonId: "" };
  }
  const salle = clean.slice(0, marker.index).trim();
  const pavillon = clean.slice(marker.index + (marker[0] ?? "").length).replace(CIVIC_NUMBER, "").trim();
  return { salle, pavillon, pavillonId: slug(pavillon) };
}

/** Forme compacte pour une liste : « B-0215 · J.-Brillant », « En ligne ». */
export function formatLocation(text: string): string {
  const { salle, pavillon } = parseLocation(text);
  if (salle && pavillon) return `${salle} · ${pavillon}`;
  return salle || pavillon;
}

/** Forme longue pour « Copier le local » et l'ICS : « B-0215, Pavillon J.-Brillant ». */
export function fullLocation(text: string): string {
  const { salle, pavillon } = parseLocation(text);
  if (!pavillon) return salle;
  if (pavillon === "En ligne") return pavillon;
  if (!salle) return `Pavillon ${pavillon}`;
  return `${salle}, Pavillon ${pavillon}`;
}
