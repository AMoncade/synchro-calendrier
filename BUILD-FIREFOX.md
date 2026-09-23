# Building the Firefox package (for addons.mozilla.org reviewers)

ClientSide Horaire is written in TypeScript and bundled with Vite. This file lists the exact
steps that produce the files of the submitted Firefox package from this source.

## Environment

- Any OS supported by Node.js (developed on Windows 11; no OS-specific step).
- Node.js 24 (built with 24.14.1) and the npm bundled with it (11.x).
- No other tool, no network access during the build beyond `npm ci`.

## Commands

```
npm ci
npm run build:firefox
```

The Firefox extension is written to `dist-firefox/`. Its contents are the contents of the
submitted package (`npm run package:firefox` only zips that folder).

## What the build does

1. `npm run build` — `tsc --noEmit` (type check) then `vite build`, which uses
   `@crxjs/vite-plugin` to produce the Chrome build in `dist/`.
2. `node scripts/firefox.mjs` — copies `dist/` to `dist-firefox/` and adapts it to Firefox:
   - `background.service_worker` becomes `background.scripts` (event page);
   - the two content scripts (`src/content/synchro.ts`, `src/content/studium.ts`) are rebuilt
     as self-contained IIFE files in `dist-firefox/content/` with Vite's `build()` API,
     because CRXJS's content-script loader relies on a dynamic `import()` that fails in
     Firefox MV3 content scripts (bug 1803950);
   - `browser_specific_settings` is added and `web_accessible_resources` (only used by that
     loader) is removed.

All dependencies are pinned by `package-lock.json`. None is loaded at run time from the
network; the extension makes requests only to `*.synchro.umontreal.ca` and
`studium.umontreal.ca` (content scripts, on the user's own logged-in session).
