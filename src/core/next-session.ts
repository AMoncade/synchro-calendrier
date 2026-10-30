// Onglet « Prochaine session » : modèle de vue pur.
//
// Le moteur de Plan ton bacc fait les calculs : préalables, audit des blocs,
// offre par trimestre, suggestions, combinaisons d'horaire. Ce module les
// enchaîne pour l'étudiant de l'extension et les met en phrases. Il n'utilise
// aucune API navigateur, et la date du jour est un paramètre.
//
// Règles héritées de Plan ton bacc, à ne pas assouplir ici :
//  - rien n'est compté comme réussi sans que l'étudiant l'ait coché ; seuls les
//    cours EN COURS sont présumés réussis, et c'est affiché et désactivable ;
//  - un préalable illisible donne un avertissement et ne verrouille jamais ;
//  - un cours sans séance publiée est « horaire inconnu », jamais « sans conflit ».

import type {
  CatalogueAssemble,
  ChoixDeCours,
  CodeCours,
  Cours,
  FicheIndex,
  Grille,
  IndexPrepare,
  Motif,
  Programme,
  Suggestion,
  Trimestre,
} from "@clientside-labs/moteur";
import {
  FILTRES_VIDES,
  RESERVE_APERCU,
  aLaSaison,
  auditProgramme,
  chercher,
  combinaisons,
  composer,
  construireGrille,
  diagnostiquerCours,
  exigeUnCheminement,
  grillesDistinctes,
  libelleTrimestre,
  prochainTrimestre,
  seancesDeSection,
  suggererPourTrimestre,
} from "@clientside-labs/moteur";
import { WEB_APP, codeOfTrimestre, normalizeCodes } from "./catalogue";
import type { Schedule } from "./model";

/** Charge visée par la proposition : le temps plein usuel au premier cycle. */
export const DEFAULT_CREDITS = 15;
/** Grilles distinctes au plus, pour ◀ ▶ : au-delà, l'étudiant doit affiner. */
export const MAX_OPTIONS = 20;

// ---------------------------------------------------------------------------
// Parcours déclaré par l'étudiant (stocké sous PATHWAY_KEY)

export interface Pathway {
  /** Clé de parcours de Plan ton bacc : `slug` ou `slug#orientation`. */
  cle: string;
  /** Libellé affiché (« Baccalauréat en mathématiques — orientation statistique »). */
  label: string;
  /** Cheminement choisi quand le programme en exige un, sinon `null`. */
  cheminement: string | null;
  /** Cours déjà réussis, cochés par l'étudiant (sessions passées). */
  done: CodeCours[];
  /** Cours en cours que l'étudiant ne compte PAS réussir. */
  excludedInProgress: CodeCours[];
  /**
   * Le dernier horaire « en cours » vu (libellé du trimestre et cours). Sert à
   * détecter le changement de trimestre : sans lui, les cours de l'automne,
   * présumés réussis tout l'automne, disparaîtraient en janvier sans un mot.
   */
  inProgressSeen?: { label: string; codes: CodeCours[] };
  /**
   * Cours d'un trimestre TERMINÉ, présumés réussis jusqu'à ce que l'étudiant
   * confirme (ils passent alors dans `done`) ou les retire.
   */
  toConfirm?: CodeCours[];
  savedAt: string;
}

/** Valide un parcours relu du stockage ; `null` si la forme n'est pas reconnue. */
export function parsePathway(raw: unknown): Pathway | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");
  if (typeof v.cle !== "string" || v.cle === "" || typeof v.label !== "string") return null;
  if (v.cheminement !== null && typeof v.cheminement !== "string") return null;
  if (!strings(v.done) || !strings(v.excludedInProgress) || typeof v.savedAt !== "string") return null;
  const p: Pathway = {
    cle: v.cle,
    label: v.label,
    cheminement: v.cheminement,
    done: v.done,
    excludedInProgress: v.excludedInProgress,
    savedAt: v.savedAt,
  };
  const seen = v.inProgressSeen as { label?: unknown; codes?: unknown } | undefined;
  if (seen !== undefined) {
    if (typeof seen !== "object" || seen === null || typeof seen.label !== "string" || !strings(seen.codes)) return null;
    p.inProgressSeen = { label: seen.label, codes: seen.codes };
  }
  if (v.toConfirm !== undefined) {
    if (!strings(v.toConfirm)) return null;
    p.toConfirm = v.toConfirm;
  }
  return p;
}

/**
 * Le trimestre en cours a-t-il changé depuis la dernière ouverture ? Si oui, les
 * cours de l'ancien trimestre (sauf ceux que l'étudiant avait écartés ou déjà
 * cochés réussis) passent « à confirmer » : toujours présumés réussis, et
 * l'écran demande de confirmer. Rend le parcours à enregistrer, ou `null` si
 * rien ne change.
 */
export function rollOver(pathway: Pathway, courses: StudentCourses): Pathway | null {
  if (courses.inProgressLabel === null) return null;
  const seen = pathway.inProgressSeen;
  const current = { label: courses.inProgressLabel, codes: [...courses.inProgress] };
  if (seen !== undefined && seen.label === current.label && seen.codes.join() === current.codes.join()) return null;
  const toConfirm = [...(pathway.toConfirm ?? [])];
  if (seen !== undefined && seen.label !== current.label) {
    for (const c of seen.codes) {
      if (pathway.excludedInProgress.includes(c) || pathway.done.includes(c) || toConfirm.includes(c)) continue;
      if (current.codes.includes(c)) continue; // repris ce trimestre-ci : toujours en cours
      toConfirm.push(c);
    }
  }
  return {
    ...pathway,
    // Un écart ne vaut que pour le trimestre où il a été fait.
    excludedInProgress:
      seen !== undefined && seen.label !== current.label
        ? pathway.excludedInProgress.filter((c) => current.codes.includes(c))
        : pathway.excludedInProgress,
    inProgressSeen: current,
    toConfirm,
  };
}

/**
 * Cours cochés à l'ouverture : la sélection enregistrée s'il y en a une, sinon
 * la proposition du moteur — et TOUJOURS les cours déjà inscrits dans Synchro,
 * qui l'emportent sur une sélection faite avant l'inscription.
 */
export function initialSelection(
  model: NextSessionModel,
  saved: readonly CodeCours[] | null,
  registered: readonly CodeCours[],
): CodeCours[] {
  const offered = new Set([...model.proposals, ...model.withoutEffect].map((p) => p.code));
  const out: CodeCours[] = [...registered];
  for (const c of saved ?? model.initial) if (offered.has(c) && !out.includes(c)) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------
// Trimestre visé et cours de l'étudiant

/** "2026-10-30" → { Hiver, 2027 } : le premier trimestre pas encore commencé. */
export function targetTerm(today: string): Trimestre {
  const [y, m, d] = today.split("-").map(Number);
  return prochainTrimestre(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export interface StudentCourses {
  /** Cours de l'horaire en cours (normalisés), présumés réussis à la fin. */
  inProgress: CodeCours[];
  /** Libellé du trimestre en cours (« Automne 2026 »), ou `null`. */
  inProgressLabel: string | null;
  /** Cours déjà inscrits au trimestre visé, si l'étudiant en a capturé l'horaire. */
  registered: CodeCours[];
  /** Codes Synchro que la normalisation refuse, montrés plutôt qu'avalés. */
  rejected: string[];
}

export function studentCourses(
  schedules: Record<string, Schedule>,
  current: Schedule | undefined,
  target: Trimestre,
): StudentCourses {
  const targetCode = codeOfTrimestre(target);
  const ongoing = current !== undefined && current.term.code !== targetCode ? current : undefined;
  const a = normalizeCodes(ongoing?.courses.map((c) => c.code) ?? []);
  const b = normalizeCodes(schedules[targetCode]?.courses.map((c) => c.code) ?? []);
  return {
    inProgress: a.codes,
    inProgressLabel: ongoing?.term.label ?? null,
    registered: b.codes,
    rejected: [...a.rejected, ...b.rejected],
  };
}

/**
 * Ce qui compte comme acquis : cochés faits, plus en cours non exclus, plus les
 * cours d'un trimestre terminé encore à confirmer (présumés, et affichés comme
 * tels).
 */
export function factsOf(pathway: Pathway, inProgress: readonly CodeCours[]): Set<CodeCours> {
  const facts = new Set<CodeCours>([...pathway.done, ...(pathway.toConfirm ?? [])]);
  for (const c of inProgress) if (!pathway.excludedInProgress.includes(c)) facts.add(c);
  return facts;
}

// ---------------------------------------------------------------------------
// Premier lancement : programme, cheminement, cours faits

/** Programmes dont le nom ou l'orientation contient tous les mots tapés, sans accents. */
export function searchPrograms(prepared: IndexPrepare, text: string, limit = 12): FicheIndex[] {
  if (text.trim().length < 2) return [];
  return chercher(prepared, { ...FILTRES_VIDES, texte: text, masquerSansStructure: true }, limit).fiches;
}

/** Le programme exige-t-il un cheminement, et lesquels ? */
export function cheminementsOf(programme: Programme): string[] {
  return exigeUnCheminement(programme) ? [...(programme.cheminements ?? [])] : [];
}

export interface ChecklistCourse {
  code: CodeCours;
  title: string | null;
  credits: number | null;
  /** Dans l'horaire en cours : coché « en cours » à part, jamais « réussi ». */
  inProgress: boolean;
}

export interface ChecklistGroup {
  title: string;
  courses: ChecklistCourse[];
}

function ruleLabel(programme: Programme, cle: string): string {
  const bloc = programme.blocs.find((b) => b.cle === cle);
  if (bloc === undefined) return "";
  switch (bloc.regle.type) {
    case "obligatoire":
      return "obligatoire";
    case "option":
      return "à option";
    case "choix":
      return "au choix";
    default:
      return "";
  }
}

/**
 * Les cours du programme, groupés par bloc, pour l'écran « coche tes cours
 * déjà faits ». Un cours cité par deux blocs n'apparaît qu'au premier.
 */
export function doneChecklist(assembled: CatalogueAssemble, inProgress: readonly CodeCours[]): ChecklistGroup[] {
  const seen = new Set<CodeCours>();
  const groups: ChecklistGroup[] = [];
  for (const bloc of assembled.programme.blocs) {
    const courses: ChecklistCourse[] = [];
    for (const code of bloc.cours) {
      if (seen.has(code)) continue;
      seen.add(code);
      const fiche = assembled.catalogue.cours[code];
      courses.push({
        code,
        title: fiche?.titre ?? null,
        credits: fiche?.credits ?? null,
        inProgress: inProgress.includes(code),
      });
    }
    if (courses.length === 0) continue;
    const rule = ruleLabel(assembled.programme, bloc.cle);
    const name = bloc.nom.trim();
    groups.push({
      title: `Bloc ${bloc.id}${name ? ` · ${name}` : ""}${rule ? ` (${rule})` : ""}`,
      courses,
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Recommandations

export interface Proposal {
  code: CodeCours;
  title: string | null;
  credits: number | null;
  /** Raisons factuelles, dans l'ordre d'affichage. */
  reasons: string[];
  /** Ce que le moteur n'a pas pu vérifier (préalable illisible, fiche absente…). */
  warnings: string[];
  /** L'offre ne confirme pas ce trimestre (raison verbatim du moteur). */
  reserve: string | null;
  /** Déjà inscrit dans Synchro pour le trimestre visé. */
  registered: boolean;
}

export interface NextSessionModel {
  target: Trimestre;
  /** « Hiver 2027 ». */
  label: string;
  /** Cours qui rapprochent du diplôme, dans l'ordre du moteur (inscrits d'abord). */
  proposals: Proposal[];
  /** Permis, mais ne comblent aucun bloc : à part, jamais cochés d'avance. */
  withoutEffect: Proposal[];
  /** Cochés à l'ouverture : les cours déjà inscrits, sinon la proposition du moteur. */
  initial: CodeCours[];
  /** Le programme exige un cheminement que l'étudiant n'a pas choisi. */
  needsCheminement: boolean;
  /** Le parcours répond-il à toutes ses exigences (audit du moteur) ? */
  auditConforme: boolean;
}

const UNLOCK_SHOWN = 2;

function reasonsOf(programme: Programme, motifs: Motif[]): string[] {
  let mandatory = false;
  const unlock: string[] = [];
  const season: string[] = [];
  const blocs: string[] = [];
  for (const m of motifs) {
    switch (m.genre) {
      case "bloc-a-combler": {
        if (ruleLabel(programme, m.cleBloc) === "obligatoire") mandatory = true;
        else blocs.push(`bloc ${m.idBloc} : encore ${m.creditsManquants} cr.`);
        break;
      }
      case "debloque": {
        const shown = m.codes.slice(0, UNLOCK_SHOWN).join(", ");
        const more = m.codes.length - UNLOCK_SHOWN;
        unlock.push(`débloque ${shown}${more > 0 ? ` et ${more} autre${more > 1 ? "s" : ""}` : ""}`);
        break;
      }
      case "saison-unique":
        season.push(`offert seulement ${aLaSaison(m.saison)}`);
        break;
      default: {
        const never: never = m;
        throw new Error(`motif inconnu : ${JSON.stringify(never)}`);
      }
    }
  }
  return [...(mandatory ? ["obligatoire"] : []), ...unlock, ...season, ...blocs];
}

function proposalOf(programme: Programme, s: Suggestion, fiche: Cours | undefined, registered: boolean): Proposal {
  return {
    code: s.code,
    title: fiche?.titre ?? null,
    credits: s.credits,
    reasons: [...(registered ? ["déjà inscrit dans Synchro"] : []), ...reasonsOf(programme, s.motifs)],
    warnings: s.avertissements,
    reserve: s.reserve,
    registered,
  };
}

export function buildModel(options: {
  assembled: CatalogueAssemble;
  pathway: Pathway;
  courses: StudentCourses;
  target: Trimestre;
  credits?: number;
}): NextSessionModel {
  const { assembled, pathway, courses, target } = options;
  const { programme, catalogue } = assembled;
  const facts = factsOf(pathway, courses.inProgress);
  const diagnostics = diagnostiquerCours(catalogue, facts);
  const audit = auditProgramme(programme, catalogue, facts, pathway.cheminement);
  // Les cours déjà inscrits sont « placés » au trimestre visé : le moteur les
  // garde candidats à ce trimestre-là et à nul autre.
  const plan = Object.fromEntries(courses.registered.map((c) => [c, target]));
  const suggestions = suggererPourTrimestre(programme, catalogue, audit, diagnostics, facts, plan, target);

  const useful = suggestions.filter((s) => !s.sansEffet);
  const registered = new Set(courses.registered);
  const proposals: Proposal[] = [];
  // Inscrits d'abord, y compris un cours que le programme ne cite pas (cours au
  // choix) : l'étudiant le suit, l'horaire doit le montrer.
  for (const code of courses.registered) {
    const s = suggestions.find((x) => x.code === code);
    const fiche = catalogue.cours[code];
    proposals.push(
      s !== undefined
        ? proposalOf(programme, s, fiche, true)
        : {
            code,
            title: fiche?.titre ?? null,
            credits: fiche?.credits ?? null,
            reasons: ["déjà inscrit dans Synchro"],
            warnings: [],
            reserve: null,
            registered: true,
          },
    );
  }
  for (const s of useful) {
    if (!registered.has(s.code)) proposals.push(proposalOf(programme, s, catalogue.cours[s.code], false));
  }

  return {
    target,
    label: libelleTrimestre(target),
    proposals,
    withoutEffect: suggestions
      .filter((s) => s.sansEffet && !registered.has(s.code))
      .map((s) => proposalOf(programme, s, catalogue.cours[s.code], false)),
    initial: courses.registered.length > 0 ? [...courses.registered] : composer(useful, options.credits ?? DEFAULT_CREDITS).codes,
    needsCheminement: exigeUnCheminement(programme) && pathway.cheminement === null,
    auditConforme: audit.conforme,
  };
}

// ---------------------------------------------------------------------------
// Sélection : crédits, combinaisons, grille

export interface ScheduleOption {
  /** Sections à choisir dans Synchro, cours par cours. */
  choice: ChoixDeCours[];
  /** Autres choix de sections qui donnent exactement cette semaine. */
  equivalents: number;
  conflicts: number;
  grid: Grille;
  /**
   * Séances prises dans un conflit, pour les peindre en rouge : `conflictKey()`.
   * Par séance et non par section : la séance du jeudi d'une section dont seul
   * le mardi chevauche ne doit pas rougir.
   */
  conflicted: Set<string>;
}

export interface SelectionSummary {
  credits: number;
  /** Cours retenus dont les crédits sont inconnus : jamais comptés pour zéro. */
  unknownCredits: number;
  options: ScheduleOption[];
  /** Grilles distinctes sans conflit (elles ouvrent `options`). */
  conflictFree: number;
  /** Il existe plus de grilles que celles montrées. */
  truncated: boolean;
  /** Pas de séance publiée, séance non attribuée ou fiche absente. */
  unknownSchedule: CodeCours[];
  /** Structure de sections que le moteur ne sait pas lire. */
  undetermined: CodeCours[];
  /** « Sans conflit » veut dire « dans l'aperçu publié ». */
  reserve: string;
}

/** Clé d'une séance (ou d'une section entière, sans jour) dans `ScheduleOption.conflicted`. */
export function conflictKey(code: CodeCours, section: string, jour?: string, debutMin?: number): string {
  return jour === undefined ? `${code}|${section}` : `${code}|${section}|${jour}|${debutMin ?? ""}`;
}

export function summarizeSelection(
  coursesByCode: Record<CodeCours, Cours>,
  chosen: readonly CodeCours[],
  target: Trimestre,
  max = MAX_OPTIONS,
): SelectionSummary {
  const fiches: Cours[] = [];
  const missing: CodeCours[] = [];
  let credits = 0;
  let unknownCredits = 0;
  for (const code of chosen) {
    const fiche = coursesByCode[code];
    if (fiche === undefined) {
      missing.push(code);
      unknownCredits += 1;
      continue;
    }
    fiches.push(fiche);
    if (fiche.credits === null) unknownCredits += 1;
    else credits += fiche.credits;
  }

  const result = combinaisons(fiches, target);
  const grids = grillesDistinctes(result, fiches, target);
  const byCode = new Map(fiches.map((f) => [f.code, f]));
  const options = grids.grilles.slice(0, max).map((g): ScheduleOption => {
    const inscriptions = g.combinaison.choix.flatMap((choice) =>
      choice.sections.map((section) => ({
        code: choice.code,
        section,
        seances: seancesDeSection(byCode.get(choice.code)?.apercuHoraires, target, section),
      })),
    );
    const conflicted = new Set<string>();
    for (const c of g.combinaison.conflits) {
      for (const ref of [c.a, c.b]) {
        const cr = ref.seance.creneau;
        // Séance sans créneau lisible : on ne sait pas laquelle rougir, donc la
        // section entière.
        conflicted.add(cr.genre === "attribue" ? conflictKey(ref.code, ref.section, cr.jour, cr.debutMin) : conflictKey(ref.code, ref.section));
      }
    }
    return {
      choice: g.combinaison.choix,
      equivalents: g.equivalentes.length,
      conflicts: g.combinaison.conflits.length,
      grid: construireGrille(inscriptions),
      conflicted,
    };
  });

  return {
    credits,
    unknownCredits,
    options,
    conflictFree: Math.min(grids.sansConflit, options.length),
    truncated: result.tronque || grids.grilles.length > max,
    unknownSchedule: [...missing, ...result.horaireInconnu],
    undetermined: result.indetermines,
    reserve: RESERVE_APERCU,
  };
}

// ---------------------------------------------------------------------------
// Lien vers l'audit complet

/**
 * Lien vers Plan ton bacc avec le parcours et les cours acquis dans le
 * FRAGMENT (`#…`), qui n'est jamais envoyé au serveur. L'app web demande une
 * confirmation avant d'importer quoi que ce soit, puis nettoie l'adresse.
 *
 * Réussis et en cours voyagent SÉPARÉMENT : l'app web doit pouvoir dire à
 * l'étudiant que les seconds sont présumés réussis, comme le fait cet onglet.
 */
export function auditLink(pathway: Pathway, inProgress: readonly CodeCours[]): string {
  const payload = {
    v: 1,
    parcours: pathway.cle,
    cheminement: pathway.cheminement,
    faits: [...pathway.done].sort(),
    enCours: inProgress.filter((c) => !pathway.excludedInProgress.includes(c)).sort(),
  };
  return `${WEB_APP}/audit#import=${encodeURIComponent(JSON.stringify(payload))}`;
}
