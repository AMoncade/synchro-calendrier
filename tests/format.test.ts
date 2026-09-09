// Tests du module de formatage (spec v2, phases 2 et 10).
// Tout est pur : aucun test ne lit l'horloge, chaque instant est écrit en clair.

import { describe, expect, it } from "vitest";
import {
  MONTHS_LONG,
  MONTHS_SHORT,
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  componentName,
  courseColor,
  courseColors,
  dayMonthShort,
  daysUntil,
  formatClock,
  formatDaysUntil,
  formatLocation,
  formatMinutes,
  formatRange,
  fullDateTime,
  fullLocation,
  hashCode,
  isoWeekday,
  longDate,
  minutesBetween,
  minutesOfDay,
  monthName,
  parseIsoDate,
  parseLocation,
  relativeTime,
  shortDate,
  sigle,
  slug,
  torontoCivil,
  torontoDate,
  weekdayName,
  HUE_COUNT,
  HUE_STEP,
  TIME_ZONE,
} from "../src/format";

// ===========================================================================
// date.ts
// ===========================================================================

describe("dates civiles", () => {
  it("découpe une date ISO et refuse ce qui n'en est pas une", () => {
    expect(parseIsoDate("2026-10-07")).toEqual({ year: 2026, month: 10, day: 7 });
    for (const bad of ["", "2026-10-7", "07/10/2026", "2026-13-01", "2026-02-30", "2026-10-07T08:00:00Z"]) {
      expect(() => parseIsoDate(bad)).toThrow(RangeError);
    }
  });

  it("donne le jour de semaine ISO sans glissement de fuseau", () => {
    // 31/08/2026 est un lundi (premier jour de cours FAS), 01/09 un mardi.
    expect(isoWeekday("2026-08-31")).toBe(1);
    expect(isoWeekday("2026-09-01")).toBe(2);
    expect(isoWeekday("2026-10-07")).toBe(3);
    expect(isoWeekday("2026-12-23")).toBe(3);
    // Un 1er janvier : le cas où une Date construite depuis une chaîne recule d'un jour.
    expect(isoWeekday("2027-01-01")).toBe(5);
  });

  it("nomme les jours et les mois", () => {
    expect(weekdayName(1, "short")).toBe("lun.");
    expect(weekdayName(1, "long")).toBe("lundi");
    expect(weekdayName(7, "short")).toBe("dim.");
    expect(weekdayName(3)).toBe("mercredi");
    expect(monthName(10, "short")).toBe("oct.");
    expect(monthName(9, "short")).toBe("sept.");
    expect(monthName(7, "short")).toBe("juill.");
    expect(monthName(2, "long")).toBe("février");
    for (const bad of [0, 8, -1, 1.5]) expect(() => weekdayName(bad)).toThrow(RangeError);
    for (const bad of [0, 13, -1]) expect(() => monthName(bad)).toThrow(RangeError);
  });

  it("écrit les dates courtes et longues", () => {
    expect(shortDate("2026-10-07")).toBe("mer. 7 oct.");
    expect(shortDate("2026-09-09")).toBe("mer. 9 sept.");
    expect(shortDate("2026-12-01")).toBe("mar. 1 déc.");
    expect(longDate("2026-09-09")).toBe("mercredi 9 septembre");
    expect(longDate("2027-01-01")).toBe("vendredi 1 janvier");
    expect(dayMonthShort("2026-09-09")).toBe("9 sept.");
  });

  // Garde-fou : la table de noms est écrite à la main pour que la chaîne
  // affichée ne dépende pas de la version d'ICU du navigateur. Ce test vérifie
  // qu'elle dit encore la même chose qu'`Intl` dans le moteur courant. S'il
  // devient rouge, c'est CLDR qui a bougé : décider alors laquelle des deux
  // formes est la bonne, ne pas aligner la table à l'aveugle.
  it("garde la table de noms en accord avec Intl (fr-CA, America/Toronto)", () => {
    const fmt = (options: Intl.DateTimeFormatOptions, date: Date): string =>
      new Intl.DateTimeFormat("fr-CA", { ...options, timeZone: TIME_ZONE }).format(date);
    for (let month = 0; month < 12; month++) {
      const day = new Date(Date.UTC(2026, month, 15, 12));
      expect(MONTHS_SHORT[month]).toBe(fmt({ month: "short" }, day));
      expect(MONTHS_LONG[month]).toBe(fmt({ month: "long" }, day));
    }
    // 5 janvier 2026 est un lundi.
    for (let i = 0; i < 7; i++) {
      const day = new Date(Date.UTC(2026, 0, 5 + i, 12));
      expect(WEEKDAYS_SHORT[i]).toBe(fmt({ weekday: "short" }, day));
      expect(WEEKDAYS_LONG[i]).toBe(fmt({ weekday: "long" }, day));
    }
    expect(shortDate("2026-10-07")).toBe(
      fmt({ weekday: "short", day: "numeric", month: "short" }, new Date(Date.UTC(2026, 9, 7, 12))),
    );
  });

  it("compte les jours civils, jamais les heures", () => {
    expect(daysUntil("2026-09-09", "2026-09-09")).toBe(0);
    expect(daysUntil("2026-09-10", "2026-09-09")).toBe(1);
    expect(daysUntil("2026-09-08", "2026-09-09")).toBe(-1);
    expect(daysUntil("2026-10-07", "2026-09-09")).toBe(28);
    // Passage d'année.
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
    expect(daysUntil("2026-12-31", "2027-01-01")).toBe(-1);
    // Année bissextile.
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
    // Le changement d'heure ne doit pas produire un 0,96 jour arrondi à 0.
    expect(daysUntil("2026-11-02", "2026-11-01")).toBe(1); // retour à l'heure normale
    expect(daysUntil("2026-03-09", "2026-03-08")).toBe(1); // passage à l'heure avancée
    expect(daysUntil("2026-12-23", "2026-08-31")).toBe(114);
  });

  it("met les jours en mots", () => {
    expect(formatDaysUntil(0)).toBe("aujourd'hui");
    expect(formatDaysUntil(1)).toBe("demain");
    expect(formatDaysUntil(2)).toBe("dans 2 j");
    expect(formatDaysUntil(28)).toBe("dans 28 j");
    expect(formatDaysUntil(-1)).toBe("il y a 1 j");
    expect(formatDaysUntil(-3)).toBe("il y a 3 j");
    expect(() => formatDaysUntil(1.5)).toThrow(RangeError);
  });
});

// ===========================================================================
// time.ts
// ===========================================================================

describe("instants en heure de Montréal", () => {
  it("ramène un instant UTC aux champs civils de Montréal", () => {
    // 22:16 UTC en septembre = 18:16 à Montréal (heure avancée, −4).
    expect(torontoCivil("2026-09-09T22:16:00.000Z")).toEqual({
      year: 2026, month: 9, day: 9, hour: 18, minute: 16,
    });
    // 05:00 UTC le 31 décembre = minuit à Montréal (heure normale, −5).
    expect(torontoCivil("2026-12-31T05:00:00.000Z")).toEqual({
      year: 2026, month: 12, day: 31, hour: 0, minute: 0,
    });
    // Le piège du brief : 01:00 UTC le 1er janvier, c'est encore le 31 décembre ici.
    expect(torontoDate("2027-01-01T01:00:00.000Z")).toBe("2026-12-31");
    expect(torontoDate("2027-01-01T05:00:00.000Z")).toBe("2027-01-01");
    // Dimanche du retour à l'heure normale : 05:30 UTC = 01:30 (première occurrence).
    expect(torontoCivil("2026-11-01T05:30:00.000Z")).toMatchObject({ day: 1, hour: 1, minute: 30 });
    expect(() => torontoCivil("pas une date")).toThrow(RangeError);
  });

  it("écrit l'heure à la québécoise", () => {
    expect(formatClock(18, 16)).toBe("18 h 16");
    expect(formatClock(8, 5)).toBe("8 h 05");
    expect(formatClock(0, 0)).toBe("0 h 00");
    expect(formatClock(23, 59)).toBe("23 h 59");
    for (const [h, m] of [[24, 0], [-1, 0], [12, 60], [12, -1]] as const) {
      expect(() => formatClock(h, m)).toThrow(RangeError);
    }
  });

  it("dit depuis combien de temps la capture date", () => {
    const now = "2026-09-09T22:16:00.000Z";
    expect(relativeTime("2026-09-09T22:16:00.000Z", now)).toBe("à l'instant");
    expect(relativeTime("2026-09-09T22:15:30.000Z", now)).toBe("à l'instant"); // 30 s
    expect(relativeTime("2026-09-09T22:15:00.000Z", now)).toBe("il y a 1 min");
    expect(relativeTime("2026-09-09T22:13:00.000Z", now)).toBe("il y a 3 min");
    expect(relativeTime("2026-09-09T21:17:00.000Z", now)).toBe("il y a 59 min");
    expect(relativeTime("2026-09-09T21:16:00.000Z", now)).toBe("il y a 1 h");
    expect(relativeTime("2026-09-08T23:00:00.000Z", now)).toBe("il y a 23 h");
    // Au-delà de 24 h : la date, dans le fuseau de Montréal.
    expect(relativeTime("2026-09-08T22:16:00.000Z", now)).toBe("le 8 sept.");
    expect(relativeTime("2026-07-01T15:00:00.000Z", now)).toBe("le 1 juill.");
    // Horloge en avance : jamais de durée négative.
    expect(relativeTime("2026-09-09T22:20:00.000Z", now)).toBe("à l'instant");
  });

  it("écrit la date complète pour l'infobulle", () => {
    expect(fullDateTime("2026-09-09T22:16:00.000Z")).toBe("mercredi 9 septembre 2026, 18 h 16");
    expect(fullDateTime("2026-12-31T05:00:00.000Z")).toBe("jeudi 31 décembre 2026, 0 h 00");
    // Même instant, écrit avec un décalage explicite : même sortie.
    expect(fullDateTime("2026-09-09T18:16:00.000-04:00")).toBe("mercredi 9 septembre 2026, 18 h 16");
  });
});

// ===========================================================================
// location.ts
// ===========================================================================

describe("locaux", () => {
  it("découpe les formes réelles de Synchro", () => {
    expect(parseLocation("B-0215 Pav. 3200 J.-Brillant")).toEqual({
      salle: "B-0215", pavillon: "J.-Brillant", pavillonId: "j-brillant",
    });
    expect(parseLocation("E-310 Pav. Roger-Gaudry")).toEqual({
      salle: "E-310", pavillon: "Roger-Gaudry", pavillonId: "roger-gaudry",
    });
    expect(parseLocation("N-515 Pav. Roger-Gaudry")).toEqual({
      salle: "N-515", pavillon: "Roger-Gaudry", pavillonId: "roger-gaudry",
    });
    expect(parseLocation("S1-151 Pav. Jean Coutu")).toEqual({
      salle: "S1-151", pavillon: "Jean Coutu", pavillonId: "jean-coutu",
    });
    expect(parseLocation("B-4275 Pav. 3200 J.-Brillant").pavillonId).toBe("j-brillant");
  });

  it("traite « En ligne » comme un pavillon sans salle", () => {
    expect(parseLocation("En ligne")).toEqual({ salle: "", pavillon: "En ligne", pavillonId: "en-ligne" });
    expect(parseLocation("en ligne").pavillonId).toBe("en-ligne");
    expect(parseLocation("En  ligne").pavillon).toBe("En ligne");
  });

  it("rend tel quel un texte sans marqueur de pavillon", () => {
    expect(parseLocation("À déterminer")).toEqual({ salle: "À déterminer", pavillon: "", pavillonId: "" });
    expect(parseLocation("Campus Laval")).toEqual({ salle: "Campus Laval", pavillon: "", pavillonId: "" });
    expect(parseLocation("")).toEqual({ salle: "", pavillon: "", pavillonId: "" });
    expect(parseLocation("   ")).toEqual({ salle: "", pavillon: "", pavillonId: "" });
  });

  it("normalise les espaces insécables de Synchro", () => {
    expect(parseLocation("B-0215 Pav. 3200 J.-Brillant")).toEqual({
      salle: "B-0215", pavillon: "J.-Brillant", pavillonId: "j-brillant",
    });
  });

  it("fabrique des identifiants stables et sans accent", () => {
    expect(slug("J.-Brillant")).toBe("j-brillant");
    expect(slug("Roger-Gaudry")).toBe("roger-gaudry");
    expect(slug("Jean Coutu")).toBe("jean-coutu");
    expect(slug("Marie-Victorin")).toBe("marie-victorin");
    expect(slug("André-Aisenstadt")).toBe("andre-aisenstadt");
    expect(slug("Éducation physique")).toBe("education-physique");
    expect(slug("")).toBe("");
  });

  it("écrit la forme compacte et la forme longue", () => {
    expect(formatLocation("B-0215 Pav. 3200 J.-Brillant")).toBe("B-0215 · J.-Brillant");
    expect(formatLocation("E-310 Pav. Roger-Gaudry")).toBe("E-310 · Roger-Gaudry");
    expect(formatLocation("En ligne")).toBe("En ligne");
    expect(formatLocation("À déterminer")).toBe("À déterminer");
    expect(formatLocation("")).toBe("");

    expect(fullLocation("B-0215 Pav. 3200 J.-Brillant")).toBe("B-0215, Pavillon J.-Brillant");
    expect(fullLocation("S1-151 Pav. Jean Coutu")).toBe("S1-151, Pavillon Jean Coutu");
    expect(fullLocation("En ligne")).toBe("En ligne");
    expect(fullLocation("À déterminer")).toBe("À déterminer");
    expect(fullLocation("Pav. Roger-Gaudry")).toBe("Pavillon Roger-Gaudry");
  });
});

// ===========================================================================
// course.ts
// ===========================================================================

describe("cours", () => {
  it("normalise le sigle", () => {
    expect(sigle("MAT 1400")).toBe("MAT1400");
    expect(sigle("MAT1400")).toBe("MAT1400");
    expect(sigle("  stt 1700 ")).toBe("STT1700");
    expect(sigle("MAT 1400")).toBe("MAT1400");
  });

  it("nomme les volets", () => {
    expect(componentName("TH")).toBe("Théorie");
    expect(componentName("TP")).toBe("Travaux pratiques");
    expect(componentName("LAB")).toBe("Laboratoire");
    expect(componentName("AUTRE")).toBe("Autre");
    expect(componentName("th")).toBe("Théorie");
    expect(componentName("EXI")).toBe("Autre"); // volet inconnu du popup
    expect(componentName("")).toBe("Autre");
  });

  it("hache de façon stable et indépendante de la plateforme", () => {
    expect(hashCode("")).toBe(2_166_136_261);
    expect(hashCode("MAT1400")).toBe(hashCode("MAT1400"));
    expect(hashCode("MAT1400")).not.toBe(hashCode("MAT1500"));
    expect(Number.isInteger(hashCode("STT1700"))).toBe(true);
    expect(hashCode("STT1700")).toBeGreaterThanOrEqual(0);
  });

  it("donne une couleur stable, sur la grille de teintes", () => {
    const a = courseColor("MAT1400");
    expect(a).toEqual(courseColor("MAT 1400")); // le sigle est normalisé d'abord
    expect(a.h % HUE_STEP).toBe(0);
    expect(a.h).toBeGreaterThanOrEqual(0);
    expect(a.h).toBeLessThan(360);
    expect(a.css).toBe(`hsl(${a.h} 55% 45%)`);
  });

  /** Écart circulaire entre deux teintes, en degrés (0–180). */
  const hueGap = (x: number, y: number): number => {
    const d = Math.abs(x - y) % 360;
    return Math.min(d, 360 - d);
  };

  it("sépare toujours deux teintes différentes d'au moins 40°", () => {
    // Propriété de construction : les teintes sont des multiples de 40 sur une
    // roue de 360, donc deux teintes distinctes sont à 40° au moins, y compris
    // la paire extrême 320° / 0°.
    expect(HUE_COUNT * HUE_STEP).toBe(360);
    expect(hueGap(320, 0)).toBe(40);
    const codes = ["MAT1400", "MAT1500", "MAT1600", "STT1700", "IFT1015", "PHY1620", "ACT2025", "BIO1153"];
    for (const x of codes) {
      for (const y of codes) {
        const gap = hueGap(courseColor(x).h, courseColor(y).h);
        expect(gap === 0 || gap >= 40).toBe(true);
      }
    }
    expect(hueGap(courseColor("MAT1400").h, courseColor("MAT1500").h)).toBeGreaterThanOrEqual(40);
  });

  it("documente la limite : neuf teintes, donc des collisions possibles", () => {
    // MAT1600 et STT1700 tombent sur la même teinte : `courseColor` seule ne
    // peut pas garantir des couleurs distinctes (principe des tiroirs).
    expect(courseColor("MAT1600").h).toBe(courseColor("STT1700").h);
  });

  it("attribue des couleurs distinctes à un horaire réel", () => {
    const codes = ["MAT1400", "MAT1500", "MAT1600", "STT1700"];
    const colors = courseColors(codes);
    expect([...colors.keys()].sort()).toEqual(codes);
    const hues = codes.map((c) => colors.get(c)!.h);
    expect(new Set(hues).size).toBe(4);
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        expect(hueGap(hues[i]!, hues[j]!)).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("rend le même résultat quel que soit l'ordre d'entrée", () => {
    const a = courseColors(["MAT1400", "MAT1500", "MAT1600", "STT1700"]);
    const b = courseColors(["STT1700", "MAT1600", "MAT 1500", "mat1400"]);
    expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
  });

  it("accepte plus de neuf cours sans planter", () => {
    const many = Array.from({ length: 14 }, (_, i) => `ABC${1000 + i}`);
    const colors = courseColors(many);
    expect(colors.size).toBe(14);
    for (const code of many) expect(colors.get(code)!.h % HUE_STEP).toBe(0);
    // Neuf teintes au plus : au-delà, des cours partagent forcément une couleur.
    expect(new Set([...colors.values()].map((c) => c.h)).size).toBe(HUE_COUNT);
  });

  it("ignore les doublons de sigle", () => {
    expect(courseColors(["MAT1400", "MAT 1400", "mat1400"]).size).toBe(1);
    expect(courseColors([]).size).toBe(0);
  });
});

// ===========================================================================
// duration.ts
// ===========================================================================

describe("durées", () => {
  it("convertit une heure en minutes depuis minuit", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("08:30")).toBe(510);
    expect(minutesOfDay("8:30")).toBe(510);
    expect(minutesOfDay("23:59")).toBe(1439);
    for (const bad of ["", "8h30", "24:00", "08:60", "08:5", "08:30:00"]) {
      expect(() => minutesOfDay(bad)).toThrow(RangeError);
    }
  });

  it("mesure une séance", () => {
    expect(minutesBetween("08:30", "10:30")).toBe(120);
    expect(minutesBetween("13:30", "15:30")).toBe(120);
    expect(minutesBetween("12:30", "13:30")).toBe(60);
    expect(minutesBetween("08:30", "11:30")).toBe(180); // examen final
    expect(minutesBetween("10:30", "10:30")).toBe(0); // plage vide
    expect(minutesBetween("10:30", "09:30")).toBe(-60); // données douteuses, visibles
  });

  it("met les durées en mots", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(42)).toBe("42 min");
    expect(formatMinutes(59)).toBe("59 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(65)).toBe("1 h 05");
    expect(formatMinutes(72)).toBe("1 h 12");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(185)).toBe("3 h 05");
    expect(() => formatMinutes(-1)).toThrow(RangeError);
    expect(() => formatMinutes(1.5)).toThrow(RangeError);
  });

  it("mesure et met en mots d'un coup", () => {
    expect(formatRange("08:30", "10:30")).toBe("2 h");
    expect(formatRange("12:30", "13:30")).toBe("1 h");
    expect(formatRange("08:30", "11:30")).toBe("3 h");
    expect(formatRange("10:30", "10:30")).toBe("0 min");
  });
});
