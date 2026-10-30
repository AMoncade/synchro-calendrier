// Onglet « Prochaine session » : rendu et interactions. Tout le calcul vient de
// core/next-session.ts (pur, testé) et du moteur de Plan ton bacc ; ici il n'y a
// que du DOM, du stockage et du réseau.
//
// Trois écrans successifs au premier lancement — programme, cheminement si le
// programme en exige un, cours déjà faits — puis l'écran principal :
// recommandations cochables, crédits, horaires possibles ◀ ▶ et grille.

import type { CatalogueAssemble, CodeCours, FicheIndex, IndexPrepare, JourSemaine } from "@clientside-labs/moteur";
import { JOURS, fenetreLisible, finArrondie, heure, libelleFiche, preparerIndex } from "@clientside-labs/moteur";
import {
  CatalogueUnavailable,
  fetchIndex,
  httpFetchJson,
  loadCatalogue,
  type LoadResult,
  type StorageArea,
} from "../catalogue/remote";
import { codeOfTrimestre } from "../core/catalogue";
import type { Schedule } from "../core/model";
import {
  auditLink,
  buildModel,
  cheminementsOf,
  conflictKey,
  doneChecklist,
  parsePathway,
  searchPrograms,
  studentCourses,
  summarizeSelection,
  targetTerm,
  type NextSessionModel,
  type Pathway,
  type Proposal,
  type ScheduleOption,
  type StudentCourses,
} from "../core/next-session";
import { NEXT_SELECTION_KEY, PATHWAY_KEY, type StoredState } from "../lib/messages";
import { icon } from "./icons";
import { PALETTE } from "./palette";

export interface NextSessionContext {
  state: StoredState;
  /** Horaire du trimestre en cours (`currentTerm`), s'il y en a un. */
  current: Schedule | undefined;
  /** Date locale "AAAA-MM-JJ" et instant ISO. */
  today: string;
  nowIso: string;
}

/** Cours recommandés montrés d'emblée ; les autres derrière « Voir plus ». */
const SHOWN_PROPOSALS = 8;

const storage = (): StorageArea => chrome.storage.local as unknown as StorageArea;

const el = (tag: string, className = "", text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

function button(text: string, onClick: () => void, className = ""): HTMLButtonElement {
  const b = el("button", className, text) as HTMLButtonElement;
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function link(text: string, url: string): HTMLAnchorElement {
  const a = el("a", "ns-link", text) as HTMLAnchorElement;
  a.href = url;
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    void chrome.tabs.create({ url });
  });
  return a;
}

function shortDate(iso: string | null): string {
  if (iso === null) return "date inconnue";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Stockage

async function readPathway(): Promise<Pathway | null> {
  try {
    return parsePathway((await chrome.storage.local.get(PATHWAY_KEY))[PATHWAY_KEY]);
  } catch {
    return null;
  }
}

async function savePathway(p: Pathway): Promise<void> {
  await chrome.storage.local.set({ [PATHWAY_KEY]: p });
}

interface SavedSelection {
  cle: string;
  term: string;
  codes: CodeCours[];
}

async function readSelection(cle: string, term: string): Promise<CodeCours[] | null> {
  try {
    const s = (await chrome.storage.local.get(NEXT_SELECTION_KEY))[NEXT_SELECTION_KEY] as SavedSelection | undefined;
    return s !== undefined && s.cle === cle && s.term === term && Array.isArray(s.codes) ? s.codes : null;
  } catch {
    return null;
  }
}

function saveSelection(selection: SavedSelection): void {
  void chrome.storage.local.set({ [NEXT_SELECTION_KEY]: selection }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// État du module (vit le temps d'une ouverture du popup)

let indexPromise: Promise<IndexPrepare> | null = null;
/** Brouillon du premier lancement, gardé entre les écrans. */
let draft: { fiche: FicheIndex; assembled: CatalogueAssemble; cheminement: string | null } | null = null;
let optionIndex = 0;

function prepared(): Promise<IndexPrepare> {
  indexPromise ??= fetchIndex(httpFetchJson()).then(preparerIndex);
  indexPromise.catch(() => {
    indexPromise = null;
  });
  return indexPromise;
}

/** Rend l'onglet dans `panel`. Rappelé à chaque sélection de l'onglet. */
export async function renderNextSession(panel: HTMLElement, ctx: NextSessionContext): Promise<void> {
  const target = targetTerm(ctx.today);
  const courses = studentCourses(ctx.state.schedules, ctx.current, target);
  const pathway = await readPathway();
  if (pathway === null) {
    if (draft !== null) showDone(panel, ctx, courses, null);
    else showProgramSearch(panel, ctx, courses);
    return;
  }
  await showMain(panel, ctx, pathway, courses);
}

/** Libellé de l'onglet : le trimestre visé (« Hiver 2027 »). */
export function nextSessionTabLabel(today: string): string {
  const t = targetTerm(today);
  return `${t.saison} ${t.annee}`;
}

function loading(panel: HTMLElement, text: string): void {
  panel.replaceChildren(el("p", "dim", text));
}

function failure(panel: HTMLElement, message: string, retry: () => void): void {
  const box = el("div", "notice");
  box.append(el("p", "", message), button("Réessayer", retry, "secondary"));
  panel.replaceChildren(box);
}

async function loadFor(cle: string, extra: CodeCours[], ctx: NextSessionContext): Promise<LoadResult> {
  return loadCatalogue({ cle, extraCodes: extra, storage: storage(), fetchJson: httpFetchJson(), now: ctx.nowIso });
}

// ---------------------------------------------------------------------------
// 1. Programme

function showProgramSearch(panel: HTMLElement, ctx: NextSessionContext, courses: StudentCourses): void {
  const intro = el("p", "", "Ton programme ?");
  intro.className = "fallback-title";
  const help = el(
    "p",
    "dim",
    "Une seule fois. Il reste sur cet ordinateur et sert à proposer tes cours de la prochaine session.",
  );
  const input = el("input") as HTMLInputElement;
  input.type = "search";
  input.className = "ns-search";
  input.placeholder = "ex. mathématiques statistique";
  input.setAttribute("aria-label", "Chercher un programme");
  const results = el("div", "ns-results");
  const status = el("p", "dim");
  panel.replaceChildren(intro, help, input, status, results);

  let prep: IndexPrepare | null = null;
  status.textContent = "Chargement de la liste des programmes…";
  prepared().then(
    (p) => {
      prep = p;
      status.textContent = "";
      update();
    },
    () => {
      status.textContent = "Liste des programmes injoignable. Vérifie ta connexion, puis rouvre l'onglet.";
    },
  );

  const update = (): void => {
    if (prep === null) return;
    const found = searchPrograms(prep, input.value);
    results.replaceChildren(
      ...found.map((fiche) =>
        button(libelleFiche(fiche), () => void chooseProgram(panel, ctx, courses, fiche), "ns-result secondary"),
      ),
    );
    if (input.value.trim().length >= 2 && found.length === 0) results.append(el("p", "dim", "Aucun programme ne correspond."));
  };
  input.addEventListener("input", update);
  input.focus();
}

async function chooseProgram(
  panel: HTMLElement,
  ctx: NextSessionContext,
  courses: StudentCourses,
  fiche: FicheIndex,
): Promise<void> {
  loading(panel, "Chargement du programme…");
  try {
    const r = await loadFor(fiche.cle, [...courses.inProgress, ...courses.registered], ctx);
    draft = { fiche, assembled: r.assembled, cheminement: null };
  } catch (e) {
    failure(panel, e instanceof Error ? e.message : String(e), () => showProgramSearch(panel, ctx, courses));
    return;
  }
  if (cheminementsOf(draft.assembled.programme).length > 0) showCheminement(panel, ctx, courses);
  else showDone(panel, ctx, courses, null);
}

// ---------------------------------------------------------------------------
// 2. Cheminement (seulement si le programme en exige un)

function showCheminement(
  panel: HTMLElement,
  ctx: NextSessionContext,
  courses: StudentCourses,
  editing: Pathway | null = null,
): void {
  if (draft === null) return showProgramSearch(panel, ctx, courses);
  const d = draft;
  const options = cheminementsOf(d.assembled.programme);
  const form = el("div", "ns-choices");
  for (const [i, name] of options.entries()) {
    const label = el("label", "optin");
    const radio = el("input") as HTMLInputElement;
    radio.type = "radio";
    radio.name = "ns-cheminement";
    radio.value = name;
    radio.checked = d.cheminement === null ? i === 0 : d.cheminement === name;
    label.append(radio, document.createTextNode(name));
    form.append(label);
  }
  const title = el("p", "fallback-title", "Ton cheminement ?");
  panel.replaceChildren(
    title,
    el("p", "dim", `${libelleFiche(d.fiche)} exige d'en choisir un : ses blocs n'en comptent qu'un seul.`),
    form,
    el("div", "row"),
  );
  (panel.lastElementChild as HTMLElement).append(
    button("Continuer", () => {
      const picked = form.querySelector<HTMLInputElement>("input:checked");
      d.cheminement = picked?.value ?? null;
      showDone(panel, ctx, courses, editing);
    }),
    button("Changer de programme", () => {
      draft = null;
      showProgramSearch(panel, ctx, courses);
    }, "secondary"),
  );
}

// ---------------------------------------------------------------------------
// 3. Cours déjà faits (une fois ; rien n'est coché d'avance)

function showDone(panel: HTMLElement, ctx: NextSessionContext, courses: StudentCourses, editing: Pathway | null): void {
  if (draft === null) return showProgramSearch(panel, ctx, courses);
  const d = draft;
  const doneBoxes = new Map<CodeCours, HTMLInputElement>();
  const progressBoxes = new Map<CodeCours, HTMLInputElement>();

  const title = el("p", "fallback-title", "Tes cours déjà faits");
  const help = el(
    "p",
    "dim",
    "Coche les cours réussis aux sessions passées. Rien n'est coché d'avance : Synchro ne montre que la session en cours.",
  );
  const parts: HTMLElement[] = [title, help];

  if (courses.inProgress.length > 0) {
    const box = el("fieldset", "ns-group");
    box.append(el("legend", "", `En cours (${courses.inProgressLabel ?? "session en cours"}) : comptés réussis à la fin`));
    for (const code of courses.inProgress) {
      const label = el("label", "ns-check");
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = !(editing?.excludedInProgress.includes(code) ?? false);
      progressBoxes.set(code, cb);
      const fiche = d.assembled.catalogue.cours[code];
      label.append(cb, document.createTextNode(`${code}${fiche?.titre ? ` · ${fiche.titre}` : ""}`));
      box.append(label);
    }
    box.append(el("p", "dim", "Décoche un cours que tu ne penses pas réussir."));
    parts.push(box);
  }

  for (const group of doneChecklist(d.assembled, courses.inProgress)) {
    const details = el("details", "ns-group") as HTMLDetailsElement;
    const summary = el("summary", "", group.title);
    const count = el("span", "dim");
    details.append(summary);
    let checked = 0;
    for (const c of group.courses) {
      if (c.inProgress) continue;
      const label = el("label", "ns-check");
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = editing?.done.includes(c.code) ?? false;
      if (cb.checked) checked += 1;
      doneBoxes.set(c.code, cb);
      label.append(cb, document.createTextNode(`${c.code}${c.title ? ` · ${c.title}` : ""}`));
      details.append(label);
    }
    count.textContent = checked > 0 ? ` (${checked} coché${checked > 1 ? "s" : ""})` : "";
    summary.append(count);
    if (details.childElementCount > 1) parts.push(details);
  }

  const row = el("div", "row");
  row.append(
    button("Enregistrer", () => {
      const p: Pathway = {
        cle: d.fiche.cle,
        label: libelleFiche(d.fiche),
        cheminement: d.cheminement,
        done: [...doneBoxes].filter(([, cb]) => cb.checked).map(([code]) => code),
        excludedInProgress: [...progressBoxes].filter(([, cb]) => !cb.checked).map(([code]) => code),
        savedAt: ctx.nowIso,
      };
      void savePathway(p).then(() => {
        draft = null;
        optionIndex = 0;
        void showMain(panel, ctx, p, courses);
      });
    }),
    button("Changer de programme", () => {
      draft = null;
      showProgramSearch(panel, ctx, courses);
    }, "secondary"),
  );
  parts.push(row);
  panel.replaceChildren(...parts);
}

// ---------------------------------------------------------------------------
// Écran principal

async function showMain(panel: HTMLElement, ctx: NextSessionContext, pathway: Pathway, courses: StudentCourses): Promise<void> {
  loading(panel, "Chargement des cours…");
  let result: LoadResult;
  try {
    result = await loadFor(pathway.cle, [...pathway.done, ...courses.inProgress, ...courses.registered], ctx);
  } catch (e) {
    const message = e instanceof CatalogueUnavailable || e instanceof Error ? e.message : String(e);
    failure(panel, message, () => void showMain(panel, ctx, pathway, courses));
    return;
  }

  const target = targetTerm(ctx.today);
  const model = buildModel({ assembled: result.assembled, pathway, courses, target });
  const termCode = codeOfTrimestre(target);
  const saved = await readSelection(pathway.cle, termCode);
  const offered = new Set([...model.proposals, ...model.withoutEffect].map((p) => p.code));
  const chosen = new Set<CodeCours>((saved ?? model.initial).filter((c) => offered.has(c)));

  // Couleurs : distinctes ENTRE COURS COCHÉS (ce sont eux qui partagent la
  // grille). Un cours garde sa couleur tant qu'aucun autre coché ne la porte ;
  // un cours non coché n'a qu'un point neutre.
  const colors = new Map<CodeCours, string>();
  const dots = new Map<CodeCours, HTMLElement[]>();
  const assignColors = (): void => {
    const used = new Set<string>();
    for (const code of chosen) {
      const kept = colors.get(code);
      if (kept !== undefined && !used.has(kept)) {
        used.add(kept);
        continue;
      }
      const free = PALETTE.find((c) => !used.has(c)) ?? PALETTE[used.size % PALETTE.length] ?? "#888";
      colors.set(code, free);
      used.add(free);
    }
    for (const [code, list] of dots) {
      for (const d of list) d.style.background = chosen.has(code) ? (colors.get(code) ?? "var(--line)") : "var(--line)";
    }
  };
  const colorOf = (code: CodeCours): string => colors.get(code) ?? "var(--muted)";
  const dotFor = (code: CodeCours): HTMLElement => {
    const d = el("span", "ns-dot");
    dots.set(code, [...(dots.get(code) ?? []), d]);
    return d;
  };

  const head = el("div", "ns-head");
  const headTitle = el("p", "fallback-title", `${model.label} · ce que tu peux prendre`);
  const headSub = el("p", "dim");
  headSub.append(
    document.createTextNode(`${pathway.label}${pathway.cheminement ? ` · ${pathway.cheminement}` : ""} · `),
    button("Modifier", () => {
      draft = {
        fiche: { cle: pathway.cle, nom: pathway.label, orientation: null } as FicheIndex,
        assembled: result.assembled,
        cheminement: pathway.cheminement,
      };
      // Les écrans rouvrent avec les choix déjà enregistrés.
      if (cheminementsOf(result.assembled.programme).length > 0) showCheminement(panel, ctx, courses, pathway);
      else showDone(panel, ctx, courses, pathway);
    }, "ns-inline"),
  );
  head.append(headTitle, headSub);

  const notices: HTMLElement[] = [];
  if (result.offline) notices.push(el("p", "notice", `Hors ligne : données du ${shortDate(result.dataDate)}.`));
  if (result.incompatible) {
    notices.push(el("p", "notice", "Plan ton bacc a changé le format de ses données : mets à jour l'extension. En attendant, les données gardées en cache sont affichées."));
  }
  if (model.needsCheminement) notices.push(el("p", "notice", "Ce programme exige un cheminement : choisis-le avec « Modifier »."));

  const list = el("div", "ns-list");
  const summaryBox = el("div", "ns-summary");
  const scheduleBox = el("div", "ns-schedule");

  const rerender = (): void => {
    assignColors();
    saveSelection({ cle: pathway.cle, term: termCode, codes: [...chosen] });
    const sel = summarizeSelection(result.assembled.catalogue.cours, [...chosen], target);
    summaryBox.replaceChildren(summaryLine(chosen.size, sel.credits, sel.unknownCredits));
    if (optionIndex >= sel.options.length) optionIndex = 0;
    scheduleBox.replaceChildren(...scheduleView(sel, colorOf, rerender, chosen.size));
  };

  const row = (p: Proposal): HTMLElement => proposalRow(p, chosen, rerender, dotFor);
  const shown = model.proposals.slice(0, SHOWN_PROPOSALS);
  const hidden = model.proposals.slice(SHOWN_PROPOSALS);
  list.append(...shown.map(row));
  if (model.proposals.length === 0) list.append(el("p", "dim", `Aucun cours de ton programme n'est disponible ${model.label.toLowerCase()} avec ce qui est coché comme fait.`));
  if (hidden.length > 0) list.append(collapsible(`Voir ${hidden.length} autre${hidden.length > 1 ? "s" : ""} cours possible${hidden.length > 1 ? "s" : ""}`, hidden.map(row)));
  if (model.withoutEffect.length > 0) {
    list.append(collapsible(`Permis, mais sans effet sur ton diplôme (${model.withoutEffect.length})`, model.withoutEffect.map(row)));
  }

  const footer = el("div", "ns-footer");
  footer.append(
    link("Voir l'audit complet →", auditLink(pathway, courses.inProgress)),
    el(
      "p",
      "dim",
      `Projet personnel, sans affiliation avec l'Université de Montréal. Cours et horaires : Plan ton bacc, d'après admission.umontreal.ca, données du ${shortDate(result.dataDate)}.`,
    ),
  );

  panel.replaceChildren(head, ...notices, list, summaryBox, scheduleBox, footer);
  rerender();
}

function collapsible(title: string, rows: HTMLElement[]): HTMLElement {
  const d = el("details", "ns-more");
  d.append(el("summary", "", title), ...rows);
  return d;
}

function summaryLine(count: number, credits: number, unknown: number): HTMLElement {
  const p = el("p", "ns-total");
  const extra = unknown > 0 ? `, plus ${unknown} cours de crédits inconnus` : "";
  p.textContent = `${count} cours · ${credits} crédits${extra}`;
  return p;
}

function proposalRow(
  p: Proposal,
  chosen: Set<CodeCours>,
  onChange: () => void,
  dotFor: (code: CodeCours) => HTMLElement,
): HTMLElement {
  const label = el("label", "ns-row");
  const cb = el("input") as HTMLInputElement;
  cb.type = "checkbox";
  cb.checked = chosen.has(p.code);
  cb.addEventListener("change", () => {
    if (cb.checked) chosen.add(p.code);
    else chosen.delete(p.code);
    onChange();
  });
  const body = el("span", "ns-row-body");
  const line = el("span", "ns-row-title");
  line.append(dotFor(p.code), el("strong", "", p.code), document.createTextNode(` ${p.title ?? "(fiche absente)"}`));
  if (p.credits !== null) line.append(el("span", "dim", ` · ${p.credits} cr.`));
  body.append(line);
  if (p.reasons.length > 0) body.append(el("span", "ns-reasons", p.reasons.join(" · ")));
  for (const w of p.warnings) body.append(el("span", "ns-warn", `Non vérifié : ${w}`));
  if (p.reserve !== null) body.append(el("span", "ns-warn", p.reserve));
  label.append(cb, body);
  return label;
}

// ---------------------------------------------------------------------------
// Horaires possibles et grille

function scheduleView(
  sel: ReturnType<typeof summarizeSelection>,
  colorOf: (code: CodeCours) => string,
  rerender: () => void,
  chosenCount: number,
): HTMLElement[] {
  const out: HTMLElement[] = [el("p", "fallback-title", "Horaires possibles")];
  if (chosenCount === 0) {
    out.push(el("p", "dim", "Coche des cours pour voir leurs horaires."));
    return out;
  }

  if (sel.options.length > 0) {
    const nav = el("div", "ns-nav");
    const count =
      sel.conflictFree > 0
        ? `${sel.conflictFree}${sel.truncated ? "+" : ""} horaire${sel.conflictFree > 1 ? "s" : ""} sans conflit`
        : "Aucun horaire sans conflit";
    const shown = sel.options[optionIndex];
    const conflicts = shown === undefined || shown.conflicts === 0 ? "" : ` · ${shown.conflicts} conflit${shown.conflicts > 1 ? "s" : ""}`;
    const prev = button("", () => {
      optionIndex = (optionIndex + sel.options.length - 1) % sel.options.length;
      rerender();
    }, "secondary ns-arrow");
    const next = button("", () => {
      optionIndex = (optionIndex + 1) % sel.options.length;
      rerender();
    }, "secondary ns-arrow");
    prev.append(icon("left", 14));
    next.append(icon("right", 14));
    prev.setAttribute("aria-label", "Horaire précédent");
    next.setAttribute("aria-label", "Horaire suivant");
    prev.disabled = next.disabled = sel.options.length < 2;
    nav.append(prev, el("span", "ns-nav-label", `${count} · ${optionIndex + 1}/${sel.options.length}${conflicts}`), next);
    out.push(nav);
    const option = sel.options[optionIndex];
    if (option !== undefined) out.push(gridView(option, colorOf), sectionsList(option));
  } else {
    out.push(el("p", "dim", "Aucun des cours cochés n'a d'horaire comparable pour ce trimestre."));
  }

  if (sel.unknownSchedule.length > 0) {
    out.push(el("p", "ns-warn", `Horaire inconnu (aucune séance publiée, ou non attribuée) : ${sel.unknownSchedule.join(", ")}. Non comparé aux autres.`));
  }
  if (sel.undetermined.length > 0) {
    out.push(el("p", "ns-warn", `Sections non combinées (structure ambiguë) : ${sel.undetermined.join(", ")}. Non comparé aux autres.`));
  }
  out.push(el("p", "dim", sel.reserve));
  return out;
}

function sectionsList(option: ScheduleOption): HTMLElement {
  const p = el("p", "dim");
  const parts = option.choice.map((c) => `${c.code} ${c.sections.join(" + ")}`);
  const eq = option.equivalents > 0 ? ` (et ${option.equivalents} autre${option.equivalents > 1 ? "s" : ""} choix de sections, même semaine)` : "";
  p.textContent = `Sections : ${parts.join(" · ")}${eq}`;
  return p;
}

const DAY_SHORT: Record<JourSemaine, string> = {
  Lundi: "Lun",
  Mardi: "Mar",
  Mercredi: "Mer",
  Jeudi: "Jeu",
  Vendredi: "Ven",
  Samedi: "Sam",
  Dimanche: "Dim",
};
const GRID_HEIGHT = 260;

function gridView(option: ScheduleOption, colorOf: (code: CodeCours) => string): HTMLElement {
  const { grid } = option;
  const wrap = el("div", "ns-grid");
  const days = grid.joursAffiches.length > 0 ? grid.joursAffiches : JOURS.slice(0, 5);
  const bounds = grid.bornes ?? { debutMin: 8 * 60 + 30, finMin: 17 * 60 + 30 };
  const start = Math.floor(bounds.debutMin / 60) * 60;
  const end = Math.ceil((bounds.finMin + 1) / 60) * 60;
  const scale = GRID_HEIGHT / Math.max(60, end - start);
  wrap.style.gridTemplateColumns = `30px repeat(${days.length}, 1fr)`;

  wrap.append(el("span", ""));
  for (const d of days) wrap.append(el("span", "ns-grid-day", DAY_SHORT[d]));

  const hours = el("div", "ns-grid-hours");
  hours.style.height = `${GRID_HEIGHT}px`;
  for (let m = start; m < end; m += 60) {
    const h = el("span", "", heure(m));
    h.style.top = `${(m - start) * scale}px`;
    hours.append(h);
  }
  wrap.append(hours);

  for (const day of days) {
    const col = el("div", "ns-grid-col");
    col.style.height = `${GRID_HEIGHT}px`;
    for (const c of grid.cases.filter((x) => x.jour === day)) {
      const box = el("div", "ns-case");
      box.style.top = `${(c.debutMin - start) * scale}px`;
      box.style.height = `${Math.max(14, (c.finMin + 1 - c.debutMin) * scale)}px`;
      box.style.borderLeftColor = colorOf(c.code);
      if (option.conflicted.has(conflictKey(c.code, c.section)) || option.conflicted.has(conflictKey(c.code, c.section, c.jour, c.debutMin))) {
        box.classList.add("ns-conflict");
      }
      box.textContent = `${c.code.replace(" ", "")} ${c.section}`;
      box.title = `${c.code} ${c.section}, ${heure(c.debutMin)} à ${finArrondie(c.finMin)}\n${c.fenetres.map((f) => fenetreLisible(f)).join("\n")}`;
      col.append(box);
    }
    wrap.append(col);
  }
  return wrap;
}
