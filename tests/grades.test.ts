// Tests de `src/core/grades.ts` — la page du carnet StudiUM → un `GradeReport`.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ FIXTURES SYNTHÉTIQUES — écrites le 2026-09-10, à remplacer.              │
// │                                                                         │
// │ `studium-grades-mat1600.html` n'est PAS une capture réelle : l'outil     │
// │ navigateur bloque les fetch, le HTML brut de la page n'a pas pu être     │
// │ tiré. Elle combine deux sources :                                        │
// │                                                                         │
// │  • la STRUCTURE, relevée dans moodle/moodle @ MOODLE_404_STABLE          │
// │    (`gradereport_user`) : table `generaltable boxaligncenter user-grade`,│
// │    cellules `column-itemname|weight|grade|range|percentage|average|      │
// │    feedback`, classes de ligne `level<N>`, `cat_<id>`, `item`, `category`,│
// │    `baggt`/`baggb`, `gradingerror`, `spacer`, attribut `data-hidden`,    │
// │    et une div `.rowtitle` autour du nom ;                               │
// │  • les VALEURS, lues en direct sur                                       │
// │    `/grade/report/user/index.php?id=366018` (MAT1600-AB-A26) :          │
// │    en-têtes exacts, « 2,0 », « 0–2 » (tiret demi-cadratin U+2013),      │
// │    « 100,0 % », « 1,8 (43) », « 1,8 (285) », « Erreur », « Total du     │
// │    cours », « 0–104 », et les cellules vides des notes non publiées.     │
// │                                                                         │
// │ CE QUI RESTE SUPPOSÉ : le balisage exact du nom. Il est établi qu'il y   │
// │ a un lien vers `/mod/<type>/view.php?id=<cmid>` et un préfixe de type    │
// │ (« Activité Test ») destiné aux lecteurs d'écran, mais la fonction qui   │
// │ le construit (`grade_helper::get_element_header`) n'a pas pu être lue :  │
// │ elle a changé de fichier en 4.4 et n'a pas été retrouvée. Le parseur ne  │
// │ dépend donc PAS d'une forme précise — il retire ce qui n'est pas         │
// │ visible, préfère `.rowtitle`, puis le lien, puis le texte restant — et   │
// │ les deux formes sont éprouvées ici.                                     │
// │                                                                         │
// │ Aucune donnée personnelle : le `userid=999999` du menu d'actions est     │
// │ fabriqué, précisément pour vérifier qu'il n'est jamais recopié.          │
// └─────────────────────────────────────────────────────────────────────────┘

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGradeReport } from "../src/core/grades";
import type { GradeItem } from "../src/core/model";

const fixture = (name: string): string => readFileSync(resolve(__dirname, "fixtures", name), "utf8");

const MAT1600 = fixture("studium-grades-mat1600.html");
const CONNEXION = fixture("studium-grades-connexion.html");

const COURSE = { id: 366018, shortname: "MAT1600-AB-A26", courseCode: "MAT1600" };

const item = (report: ReturnType<typeof parseGradeReport>, name: string): GradeItem | undefined =>
  report?.items.find((i) => i.name === name);

/** Un carnet minimal, pour éprouver une variation d'en-têtes sans tout réécrire. */
function table(headers: string[], rows: string[][]): string {
  const head = headers.map((h) => `<th scope="col">${h}</th>`).join("");
  const body = rows
    .map((cells) => `<tr>${cells.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`)
    .join("");
  return `<table class="user-grade"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---------------------------------------------------------------------------

describe("parseGradeReport — la page de MAT1600", () => {
  const report = parseGradeReport(MAT1600, COURSE);

  it("rend un rapport rattaché au site", () => {
    expect(report?.studiumCourseId).toBe(366018);
    expect(report?.shortname).toBe("MAT1600-AB-A26");
    expect(report?.courseCode).toBe("MAT1600");
  });

  it("garde les lignes dans l'ordre de la page, total mis à part", () => {
    expect(report?.items.map((i) => i.name)).toEqual([
      "MAT1600-AB-A26 - Algèbre linéaire",
      "Quiz-tp1",
      "Quiz obligatoire 1- 1 et 2 octobre",
      "Quiz-tps",
      "Intra",
      "Travaux pratiques",
      "Quiz-tp2",
    ]);
  });

  it("recopie les valeurs telles qu'affichées, sans rien convertir", () => {
    expect(item(report, "Quiz-tp1")).toEqual({
      name: "Quiz-tp1",
      grade: "2,0",
      range: "0–2", // tiret demi-cadratin, pas un trait d'union
      percentage: "100,0 %",
      weight: "2,00 %",
      average: "1,8 (43)",
      depth: 1,
      url: "https://studium.umontreal.ca/mod/quiz/view.php?id=6641349",
    });
  });

  it("garde la moyenne du groupe avec son nombre de répondants", () => {
    // C'est la donnée qu'on ne trouve nulle part ailleurs ; la découper en
    // « 1,8 » et « 285 » ferait deux champs à re-coller à l'affichage.
    expect(item(report, "Quiz obligatoire 1- 1 et 2 octobre")?.average).toBe("1,8 (285)");
  });

  it("garde « Erreur » tel quel quand Moodle n'arrive pas à calculer", () => {
    const calcule = item(report, "Quiz-tps");
    expect(calcule?.grade).toBe("Erreur");
    expect(calcule?.percentage).toBe("Erreur");
    expect(calcule?.average).toBe("Erreur");
  });

  it("laisse la note vide quand elle n'est pas publiée, sans inventer de tiret", () => {
    const intra = item(report, "Intra");
    expect(intra?.grade).toBe("");
    expect(intra?.percentage).toBeUndefined();
    expect(intra?.average).toBeUndefined();
    expect(intra?.range).toBe("0–25");
  });

  it("détecte le total du cours et le sort de la liste", () => {
    expect(report?.total?.name).toBe("Total du cours");
    expect(report?.total?.range).toBe("0–104");
    expect(report?.total?.grade).toBe("");
    expect(report?.items.some((i) => i.name === "Total du cours")).toBe(false);
  });

  it("rend la profondeur d'indentation des catégories", () => {
    expect(item(report, "MAT1600-AB-A26 - Algèbre linéaire")?.depth).toBe(0);
    expect(item(report, "Quiz-tp1")?.depth).toBe(1);
    expect(item(report, "Travaux pratiques")?.depth).toBe(1);
    expect(item(report, "Quiz-tp2")?.depth).toBe(2); // dans la sous-catégorie
    expect(report?.total?.depth).toBe(0);
  });

  it("recopie la rétroaction quand il y en a une", () => {
    expect(item(report, "Quiz-tp2")?.feedback).toBe("Revoir la question 3.");
    expect(item(report, "Quiz-tp1")?.feedback).toBeUndefined();
  });
});

describe("parseGradeReport — le nom de l'élément", () => {
  it("retire le préfixe de type destiné aux lecteurs d'écran", () => {
    // Le lien lu à l'écran dit « Activité Test Quiz-tp1 » ; l'étudiant, lui,
    // voit « Quiz-tp1 ».
    expect(item(parseGradeReport(MAT1600, COURSE), "Quiz-tp1")).toBeDefined();
  });

  it("lit aussi un nom en texte nu, sans lien", () => {
    const report = parseGradeReport(MAT1600, COURSE);
    expect(item(report, "Intra")?.url).toBeUndefined();
    expect(item(report, "Intra")?.name).toBe("Intra");
  });

  it("prend le lien même quand Moodle n'entoure pas le nom d'une div", () => {
    const html = table(
      ["Élément d’évaluation", "Note"],
      [
        [
          '<img alt="Test"><a href="https://studium.umontreal.ca/mod/quiz/view.php?id=42">' +
            '<span class="accesshide">Activité Test </span>Quiz-tp9</a>',
          "3,0",
        ],
      ],
    );
    const report = parseGradeReport(html, COURSE);
    expect(report?.items[0]?.name).toBe("Quiz-tp9");
    expect(report?.items[0]?.url).toBe("https://studium.umontreal.ca/mod/quiz/view.php?id=42");
  });

  it("écarte l'intitulé de type visible que Moodle affiche au-dessus du nom", () => {
    // Moodle 4.x pose un libellé de type en petites capitales dans la cellule,
    // en dehors de la div `.rowtitle`. Il est bien VISIBLE, donc le retirer avec
    // les contenus d'accessibilité ne suffit pas : c'est `.rowtitle` qui dit où
    // s'arrête le nom.
    const html = table(
      ["Élément d’évaluation", "Note"],
      [['<img alt="Test"><span class="gradeitemtype">TEST</span><div class="rowtitle">Quiz-tp5</div>', "4,0"]],
    );
    expect(parseGradeReport(html, COURSE)?.items[0]?.name).toBe("Quiz-tp5");
  });

  it("écarte l'icône, le bouton d'actions et son menu", () => {
    const html = table(
      ["Élément d’évaluation", "Note"],
      [
        [
          '<img alt="Élément manuel"><div class="rowtitle">Final</div>' +
            '<div class="action-menu"><button>Actions</button>' +
            '<div class="dropdown-menu" role="menu"><a href="/grade/report/singleview/index.php?userid=999999">Analyse</a></div></div>',
          "",
        ],
      ],
    );
    expect(parseGradeReport(html, COURSE)?.items[0]?.name).toBe("Final");
  });
});

describe("parseGradeReport — ce qui ne doit jamais être recopié", () => {
  it("ne recopie pas le lien d'analyse, qui porte l'identifiant de l'étudiant", () => {
    const report = parseGradeReport(MAT1600, COURSE);
    const manuel = item(report, "Quiz obligatoire 1- 1 et 2 octobre");
    expect(manuel?.url).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain("userid");
    expect(JSON.stringify(report)).not.toContain("999999");
  });

  it("refuse une URL de module qui porte un jeton de session", () => {
    const html = table(
      ["Élément d’évaluation", "Note"],
      [['<a href="https://studium.umontreal.ca/mod/quiz/view.php?id=42&sesskey=aBcD">Quiz</a>', "1,0"]],
    );
    const report = parseGradeReport(html, COURSE);
    expect(report?.items[0]?.name).toBe("Quiz"); // l'élément reste
    expect(report?.items[0]?.url).toBeUndefined(); // le lien, non
  });

  it("refuse un schéma autre que http(s)", () => {
    const html = table(
      ["Élément d’évaluation", "Note"],
      [['<a href="javascript:alert(1)//mod/quiz/view.php?id=9">Quiz</a>', "1,0"]],
    );
    expect(parseGradeReport(html, COURSE)?.items[0]?.url).toBeUndefined();
  });
});

describe("parseGradeReport — les colonnes", () => {
  it("suit le texte des en-têtes, pas leur ordre", () => {
    const html = table(
      ["Note", "Moyenne", "Élément d’évaluation", "Valeurs possibles"],
      [["8,0", "6,5 (12)", "Devoir 1", "0–10"]],
    );
    expect(parseGradeReport(html, COURSE)?.items[0]).toEqual({
      name: "Devoir 1",
      grade: "8,0",
      average: "6,5 (12)",
      range: "0–10",
    });
  });

  it("tolère un cours qui ne publie pas la moyenne", () => {
    const html = table(
      ["Élément d’évaluation", "Note", "Valeurs possibles"],
      [["Devoir 1", "8,0", "0–10"]],
    );
    const item0 = parseGradeReport(html, COURSE)?.items[0];
    expect(item0?.average).toBeUndefined();
    expect(item0?.grade).toBe("8,0");
  });

  it("reconnaît aussi une interface en anglais", () => {
    const html = table(["Grade item", "Grade", "Range"], [["Assignment 1", "8.0", "0–10"]]);
    expect(parseGradeReport(html, COURSE)?.items[0]?.name).toBe("Assignment 1");
  });

  it("tolère les accents et l'apostrophe droite dans les en-têtes", () => {
    const html = table(["Element d'evaluation", "Note"], [["Devoir 1", "8,0"]]);
    expect(parseGradeReport(html, COURSE)?.items[0]?.name).toBe("Devoir 1");
  });

  it("passe outre un tableau qui n'est pas le carnet et continue de chercher", () => {
    // La page porte d'autres tableaux — navigation, mise en page. Celui qui a
    // une colonne « Note » mais pas d'intitulé d'élément n'est pas le carnet :
    // s'arrêter au premier tableau venu rendrait un rapport vide.
    const leurre =
      '<table class="generaltable"><thead><tr><th>Note</th><th>Date</th></tr></thead>' +
      "<tbody><tr><td>A+</td><td>2026-09-01</td></tr></tbody></table>";
    const html = leurre + table(["Élément d’évaluation", "Note"], [["Devoir 1", "8,0"]]);
    const report = parseGradeReport(html, COURSE);
    expect(report?.items.map((i) => i.name)).toEqual(["Devoir 1"]);
  });

  it("ne prend pas la ligne d'en-têtes pour un élément quand il n'y a pas de thead", () => {
    const html =
      '<table class="user-grade"><tr><th>Élément d’évaluation</th><th>Note</th></tr>' +
      "<tr><th>Devoir 1</th><td>8,0</td></tr></table>";
    const report = parseGradeReport(html, COURSE);
    expect(report?.items.map((i) => i.name)).toEqual(["Devoir 1"]);
  });
});

describe("parseGradeReport — quand il n'y a rien à lire", () => {
  it("rend undefined sur la page de connexion", () => {
    // Le piège : StudiUM rend la page de connexion avec un statut 200 et elle
    // contient un `<table>`. Un rapport vide effacerait les notes stockées.
    expect(parseGradeReport(CONNEXION, COURSE)).toBeUndefined();
  });

  it("rend undefined sur une page sans aucun tableau", () => {
    expect(parseGradeReport("<p>Ce cours n’a pas de carnet de notes.</p>", COURSE)).toBeUndefined();
  });

  it("rend undefined sur un carnet dont le tableau est vide", () => {
    expect(parseGradeReport(table(["Élément d’évaluation", "Note"], []), COURSE)).toBeUndefined();
  });

  it("rend undefined sur une entrée vide ou qui n'est pas du texte", () => {
    expect(parseGradeReport("", COURSE)).toBeUndefined();
    expect(parseGradeReport("   ", COURSE)).toBeUndefined();
    expect(parseGradeReport(undefined as unknown as string, COURSE)).toBeUndefined();
  });

  it("laisse courseCode absent quand le site n'en a pas", () => {
    const report = parseGradeReport(MAT1600, { id: 412003, shortname: "BIB-SOUTIEN-2026" });
    expect(report?.courseCode).toBeUndefined();
    expect(report?.studiumCourseId).toBe(412003);
  });
});

describe("parseGradeReport — identité", () => {
  it("rend exactement la même chose sur la même page lue deux fois", () => {
    expect(parseGradeReport(MAT1600, COURSE)).toEqual(parseGradeReport(MAT1600, COURSE));
  });
});
