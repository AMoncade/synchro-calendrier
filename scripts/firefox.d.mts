// Types de scripts/firefox.mjs, pour les tests (tsconfig n'active pas allowJs).
export declare const GECKO: {
  id: string;
  strict_min_version: string;
  data_collection_permissions: { required: string[] };
};
export declare const GECKO_ANDROID: { strict_min_version: string };
export declare function firefoxContentScriptPath(sourcePath: string): string;
export declare function toFirefoxManifest(
  built: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown>;
