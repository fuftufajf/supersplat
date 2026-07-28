# Splat Director Migration Notes

This document tracks local Splat Director changes made during the repo migration,
while Task Board is not the reliable handoff surface.

## 2026-07-04 - End-of-day migration snapshot

Active source repo:

- `D:\GITHUB\fuftufajf\supersplat`

Active browser surface:

- `http://127.0.0.1:3000/director-board.html`
- This is the SuperSplat single-splat Director Board, not the older map/orbit
  Director Board from `D:\GITHUB\fuftufajf\3DGS\modules\playcanvas-story-slides`.

Runtime used today:

- Static server: `node node_modules/.bin/serve dist -C -l 3000`
- Working directory: `D:\GITHUB\fuftufajf\supersplat`
- Map Director Board server on port `8766` was stopped to avoid confusing the
  two tools.

Current migration candidate surface:

- `src/director-board.html` - external operator board for SuperSplat.
- `src/director-board.js` - board-side UI logic for loading splats/projects,
  reading scene state, controlling timeline/orbit/view settings, and saving
  director metadata.
- `src/iframe-api.ts` - embedded-scene bridge exposed as `window.__piScene`;
  includes scene state, selection, project load/save, display parameters,
  preview capture, and camera orbit construction.
- `src/display-params.ts` - director-facing display parameter registry grouped
  into shape, reveal, color/light, axis scale, and pulse.
- `src/display-track.ts`, `src/track-manager.ts` - display parameter keyframe
  track support.
- `src/doc.ts` - director metadata serialization/deserialization hook.
- `src/main.ts`, `src/index.html` - embedded mode and bridge registration.
- `src/splat.ts`, `src/shaders/splat-shader.ts` - render-side display controls
  such as reveal/pulse/scale/color behavior.
- `src/ui/director-panel.ts`, `src/ui/scss/director-panel.scss`,
  `src/ui/scss/style.scss`, `src/ui/editor.ts`, `src/editor.ts` - native
  SuperSplat UI integration for the Director panel/display controls.
- `rollup.config.mjs` - copies `director-board.html` and `director-board.js`
  into `dist`.

Generated output:

- `dist/` was rebuilt with `npm run build` after the camera pitch change.
- `dist/` is the served runtime output and is not the migration source of
  truth; migrate source files, then rebuild.

Verification done today:

- `npm run build` completed successfully.
- Served `http://127.0.0.1:3000/director-board.html` returned HTTP 200.
- Served HTML contains `Load splat` and does not contain the old map route
  marker `poland-orbit`.
- Headless smoke with system Chrome confirmed the iframe bridge is ready and
  `buildCameraOrbit({ lookPitchDegrees: -20 })` returns
  `lookPitchDegrees: -20`.

Known current worktree state:

- Modified tracked files:
  `rollup.config.mjs`, `src/display-params.ts`, `src/display-track.ts`,
  `src/doc.ts`, `src/editor.ts`, `src/iframe-api.ts`, `src/index.html`,
  `src/main.ts`, `src/shaders/splat-shader.ts`, `src/splat.ts`,
  `src/track-manager.ts`, `src/ui/director-panel.ts`, `src/ui/editor.ts`,
  `src/ui/scss/style.scss`.
- Untracked source files:
  `docs/SPLAT_DIRECTOR_MIGRATION_NOTES.md`, `src/director-board.html`,
  `src/director-board.js`, `src/ui/scss/director-panel.scss`.
- The worktree was already dirty before the orbit-pitch patch. Do not assume
  every changed file was authored in the final pitch pass; treat the whole
  listed set as the local Splat Director migration candidate.

Resume next time:

1. Open `D:\GITHUB\fuftufajf\supersplat`.
2. Run `npm run build`.
3. Run `node node_modules/.bin/serve dist -C -l 3000`.
4. Open `http://127.0.0.1:3000/director-board.html`.
5. Load a splat and verify the camera orbit plus director display controls.

## 2026-07-04 - Origin orbit camera pitch

Goal: make the SuperSplat Director usable for rendering a single splat orbit
without the camera staying locked to a flat horizontal look.

Changed files:

- `src/director-board.html` - added `Look pitch deg` to the Camera orbit panel.
- `src/director-board.js` - saves/restores the orbit pitch and passes it to the
  iframe scene bridge when building an origin orbit.
- `src/iframe-api.ts` - `buildCameraOrbit()` now derives or accepts a look pitch
  and writes camera pose targets with that pitch instead of always targeting
  `(0, 0, 0)`.

Operator note:

- Leave `Look pitch deg` blank to reuse the current camera pitch.
- Use `0` for a horizontal look.
- Use a negative value, for example `-20`, to look downward during the orbit.

Verification target:

- Rebuild `dist`, reload `http://127.0.0.1:3000/director-board.html`, load a
  splat, set `Look pitch deg`, then run `Build origin orbit`.
