// Icônes SVG inline : la police du popup ne contient pas les symboles Unicode
// (⬇ rendu « I », ↳ rendu « ⌐, »). Tout pictogramme passe par ici.

const PATHS: Record<string, string> = {
  download: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  copy: "M8 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zm8 0V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  turn: "M6 4v8a4 4 0 0 0 4 4h8m0 0l-4-4m4 4l-4 4",
  warning: "M12 4l9 16H3l9-16zm0 6v4m0 3v.5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v5l3 2",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  map: "M9 4l6 2 6-2v14l-6 2-6-2-6 2V6l6-2zm0 0v14m6-12v14",
  calendarPlus: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm0 4h16M8 2v4m8-4v4m-4 6v6m-3-3h6",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-10v5m0-8v.5",
};

const NS = "http://www.w3.org/2000/svg";

/** Icône 16 px en `currentColor`, décorative (aria-hidden). */
export function icon(name: keyof typeof PATHS, size = 16): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", PATHS[name] ?? "");
  svg.append(path);
  return svg;
}

/** Puce pleine ou vide (statut « en cours » / à venir). */
export function bullet(filled: boolean): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("bullet-icon");
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("cx", "6");
  c.setAttribute("cy", "6");
  c.setAttribute("r", "4");
  c.setAttribute("fill", filled ? "currentColor" : "none");
  c.setAttribute("stroke", "currentColor");
  c.setAttribute("stroke-width", "1.5");
  svg.append(c);
  return svg;
}
