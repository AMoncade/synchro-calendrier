// Présentation d'un cours : sigle normalisé, nom de volet, couleur stable.

/** Volets connus du modèle (`src/core/model.ts`). */
const COMPONENT_NAMES: Record<string, string> = {
  TH: "Théorie",
  TP: "Travaux pratiques",
  LAB: "Laboratoire",
  AUTRE: "Autre",
};

/** Nombre de teintes distinctes. 9 × 40° : deux teintes différentes sont toujours
 *  séparées d'au moins 40° sur la roue, y compris entre 320° et 0°. */
export const HUE_COUNT = 9;
export const HUE_STEP = 360 / HUE_COUNT;
export const SATURATION = 55;
export const LIGHTNESS = 45;

export interface CourseColor {
  /** Teinte HSL, 0–359, toujours un multiple de 40. */
  h: number;
  /** Valeur CSS prête à poser : « hsl(40 55% 45%) ». */
  css: string;
}

/** « MAT 1400 » ou « mat1400 » → « MAT1400 ». Jamais d'espace, toujours en capitales. */
export function sigle(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase();
}

/** « TH » → « Théorie ». Un volet inconnu est rendu « Autre » plutôt que brut. */
export function componentName(component: string): string {
  return COMPONENT_NAMES[component.trim().toUpperCase()] ?? "Autre";
}

/** FNV-1a 32 bits, constantes standard. Déterministe, indépendant de la plateforme. */
export function hashCode(text: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < text.length; i++) {
    hash = (hash ^ text.charCodeAt(i)) >>> 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
}

function cssFor(hue: number): string {
  return `hsl(${hue} ${SATURATION}% ${LIGHTNESS}%)`;
}

/**
 * Couleur d'un cours, dérivée du seul sigle : même sigle → même teinte, dans
 * tous les onglets et d'une session à l'autre (spec v2 §10.1).
 *
 * Garantie : deux sigles donnent soit exactement la même teinte, soit des
 * teintes séparées d'au moins 40° — jamais deux bleus presque pareils.
 * En revanche, avec neuf teintes, deux sigles **peuvent** tomber sur la même
 * (principe des tiroirs dès dix cours). Pour un horaire réel, où l'on veut
 * toutes les couleurs distinctes, utiliser `courseColors` ci-dessous.
 */
export function courseColor(code: string): CourseColor {
  const h = (hashCode(sigle(code)) % HUE_COUNT) * HUE_STEP;
  return { h, css: cssFor(h) };
}

/**
 * Couleurs d'un ensemble de cours, sans collision tant qu'il y a au plus neuf
 * cours. Chaque sigle part de sa teinte `courseColor`, et si elle est déjà
 * prise, prend la suivante libre en tournant sur la roue.
 *
 * Déterministe : les sigles sont traités dans l'ordre alphabétique, donc le
 * résultat ne dépend pas de l'ordre d'affichage. Au-delà de neuf cours, les
 * derniers retombent sur leur teinte préférée et partagent une couleur.
 */
export function courseColors(codes: readonly string[]): Map<string, CourseColor> {
  const unique = [...new Set(codes.map(sigle))].sort();
  const taken = new Set<number>();
  const out = new Map<string, CourseColor>();
  for (const code of unique) {
    const preferred = hashCode(code) % HUE_COUNT;
    let bucket = preferred;
    for (let step = 0; step < HUE_COUNT; step++) {
      const candidate = (preferred + step) % HUE_COUNT;
      if (!taken.has(candidate)) {
        bucket = candidate;
        break;
      }
    }
    taken.add(bucket);
    const h = bucket * HUE_STEP;
    out.set(code, { h, css: cssFor(h) });
  }
  return out;
}
