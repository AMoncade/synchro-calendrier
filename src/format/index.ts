// Formatage de l'interface (spec v2, phases 2 et 10). Tout est pur et
// déterministe : aucun `Date.now()`, l'instant courant est toujours un
// paramètre. Les dates civiles ne passent jamais par `new Date("…")`, et les
// instants sont ramenés en heure de Montréal avec un fuseau explicite.

export {
  MONTHS_LONG,
  MONTHS_SHORT,
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  dayMonthShort,
  dayMonthYear,
  daysUntil,
  formatDaysUntil,
  isoWeekday,
  longDate,
  monthName,
  parseIsoDate,
  shortDate,
  weekdayName,
  type CivilDate,
  type NameStyle,
  type Weekday,
} from "./date";

export {
  TIME_ZONE,
  formatClock,
  fullDateTime,
  relativeTime,
  torontoCivil,
  torontoDate,
  type CivilDateTime,
} from "./time";

export {
  formatLocation,
  fullLocation,
  parseLocation,
  slug,
  type Location,
} from "./location";

export {
  HUE_COUNT,
  HUE_STEP,
  LIGHTNESS,
  SATURATION,
  componentName,
  courseColor,
  courseColors,
  hashCode,
  sigle,
  type CourseColor,
} from "./course";

export {
  formatMinutes,
  formatRange,
  minutesBetween,
  minutesOfDay,
} from "./duration";
