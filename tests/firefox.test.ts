import { describe, expect, it } from "vitest";
import { GECKO, GECKO_ANDROID, firefoxContentScriptPath, toFirefoxManifest } from "../scripts/firefox.mjs";

// Manifeste source (réduit aux clés touchées).
const source = {
  manifest_version: 3,
  background: { service_worker: "src/background/index.ts", type: "module" },
  content_scripts: [
    { matches: ["https://*.synchro.umontreal.ca/*"], js: ["src/content/synchro.ts"], all_frames: true, run_at: "document_idle" },
    { matches: ["https://studium.umontreal.ca/*"], js: ["src/content/studium.ts"], all_frames: false, run_at: "document_idle" },
  ],
};

// Forme de dist/manifest.json telle que CRXJS l'émet à partir de `source`.
const built = {
  manifest_version: 3,
  name: "ClientSide Horaire",
  version: "0.3.0",
  permissions: ["storage", "alarms"],
  background: { service_worker: "service-worker-loader.js", type: "module" },
  content_scripts: [
    { js: ["assets/synchro.ts-loader-A.js"], matches: ["https://*.synchro.umontreal.ca/*"], all_frames: true, run_at: "document_idle" },
    { js: ["assets/studium.ts-loader-B.js"], matches: ["https://studium.umontreal.ca/*"], all_frames: false, run_at: "document_idle" },
  ],
  web_accessible_resources: [
    { matches: ["https://studium.umontreal.ca/*"], resources: ["assets/a.js"], use_dynamic_url: false },
  ],
};

describe("manifeste Firefox", () => {
  it("remplace le service worker par un script d'event page, module conservé", () => {
    expect(toFirefoxManifest(built, source).background).toEqual({
      scripts: ["service-worker-loader.js"],
      type: "module",
    });
  });

  it("ajoute les réglages Gecko exigés par AMO", () => {
    expect(toFirefoxManifest(built, source).browser_specific_settings).toEqual({
      gecko: GECKO,
      gecko_android: GECKO_ANDROID,
    });
    expect(GECKO.data_collection_permissions).toEqual({ required: ["none"] });
  });

  it("pointe les content scripts vers les IIFE, hôtes, cadres et moment d'injection repris de la source", () => {
    expect(toFirefoxManifest(built, source).content_scripts).toEqual([
      { matches: ["https://*.synchro.umontreal.ca/*"], js: ["content/synchro.js"], all_frames: true, run_at: "document_idle" },
      { matches: ["https://studium.umontreal.ca/*"], js: ["content/studium.js"], all_frames: false, run_at: "document_idle" },
    ]);
  });

  it("retire les ressources accessibles au web, qui ne servaient qu'aux chargeurs CRXJS", () => {
    expect(toFirefoxManifest(built, source)).not.toHaveProperty("web_accessible_resources");
  });

  it("garde des ressources accessibles au web déclarées dans la source", () => {
    const declared = [{ matches: ["https://studium.umontreal.ca/*"], resources: ["icons/icon16.png"] }];
    expect(
      toFirefoxManifest(built, { ...source, web_accessible_resources: declared }).web_accessible_resources,
    ).toEqual(declared);
  });

  it("ne change ni les permissions ni la version, et ne modifie pas ses entrées", () => {
    const before = JSON.stringify([built, source]);
    const out = toFirefoxManifest(built, source);
    expect(out.permissions).toEqual(["storage", "alarms"]);
    expect(out.version).toBe("0.3.0");
    expect(JSON.stringify([built, source])).toBe(before);
  });

  it("refuse une sortie CRXJS sans service worker plutôt que d'écrire un manifeste sans arrière-plan", () => {
    expect(() => toFirefoxManifest({ ...built, background: { scripts: ["x.js"] } }, source)).toThrow(
      /service_worker absent/,
    );
  });
});

describe("chemin des content scripts Firefox", () => {
  it("garde le nom du fichier source, en .js sous content/", () => {
    expect(firefoxContentScriptPath("src/content/synchro.ts")).toBe("content/synchro.js");
    expect(firefoxContentScriptPath("src/content/studium.ts")).toBe("content/studium.js");
  });
});
