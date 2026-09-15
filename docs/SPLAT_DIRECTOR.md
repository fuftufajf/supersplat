# Splat Director on SuperSplat 3

Splat Director animates how splat layers look over the timeline and exposes a
bridge for the external Director Board. Branch `splat-director-v3`, based on
upstream `v3.3.0` (WebGPU renderer). The 2.x implementation lives on branch
`splat-director` and is not merged here: v3 replaced the renderer, so the
director was rebuilt, not rebased.

## What is native in v3 (not re-implemented)

Tone mapping, SH bands, FOV and FOV dolly, grid planes, bound, camera poses,
background colours, ring/centre size, timeline loop, key copy/overwrite
gestures, `camera.loadPoses`, `render.offscreen` (GPU readback) and
`render.video` (mp4/webm/mov, transparent background, up to 8K, 360).
The board and bridge call these through editor events.

v3's Colors panel bakes a grade into the per-gaussian palette (Apply). The
director grade is separate: live uniforms applied after the palette, so it can
change every frame without touching saved gaussian data.

## Parameters (`src/display-params.ts`)

| Group | Params | Implementation |
|---|---|---|
| shape | gaussianScale, detailCull, pointCloud, pointSize | projector: covariance scale, per-layer min pixel size, footprint blend to a fixed disc |
| reveal | revealProgress, revealSoftness | projector: sweep along up (orient-tool normal, else world up in layer space) |
| pulse | pulse, pulseDepth, pulseFrequency, pulsePhase | CPU factor from the director playhead (`timeline.time`, so video renders animate) |
| color | transparency (log), tintR/G/B, saturation, brightness, blackPoint, whitePoint, temperature | projector: live grade rows after palette + preview |
| transform | positionX/Y/Z, rotationX/Y/Z (degrees), scaleX/Y/Z | entity transform; authored euler kept so keyed turns don't flip |
| visibility | visible | `splat.visible`, step interpolation |
| scene | exposure | `app.scene.exposure` before each frame (every tone mapping applies it) |

Reveal, pulse and the grade's transparency also apply to picks, so hidden
splats can't be selected; footprint params (size, point cloud, detail cull) don't.

## Keyframes (`src/display-track.ts`)

- Every layer owns `splat.display` (values) and `splat.displayTracks`; all layers
  animate together. Scene params live on one scene target.
- The director edits its **focus** layer: it follows the selection but keeps a
  layer after the selection drops it (hiding a layer deselects it).
- `displayTrack.setActiveParam(id)` puts that param's keys on the native
  timeline (`track-manager.ts`); `null` returns the timeline to the camera.
- Saved per layer as `splats[i].director = { values, tracks }` in `.ssproj`
  v1, plus top-level `sceneDirector` and opaque board metadata `director`.
  v1 has no extension slot, so these are explicit patches in `doc.ts` and
  `splat.ts`.

## Surfaces

- `src/ui/director-panel.ts`: native panel, shown with the timeline.
- `src/director-bridge.ts`: `window.__piScene` (schema
  `pi.scene.supersplat-director.v2`). File operations are async
  (`importFiles`, `openProjectFile`, `saveProjectToHandle`), the rest sync.
- `src/director-board.html/.js`: external board; `/` redirects to it unless
  `?embedded=1` (board iframe, editor chrome hidden except popups) or
  `?editor=1`.
- `src/splat-director-identity.json`: Frame Studio health check
  (`service: splat-director`, `version: 1`).

## Checks

```
npm run test:contracts   # registry, undo, keyframe sampling
npx tsc --noEmit -p .
npm run build
```

Rendering needs WebGPU. Headless Chrome works with
`--enable-unsafe-webgpu`; drive `window.scene.events` and measure with
`render.offscreen`. `render.video` needs a numeric `bitrate`: a string makes
`VideoEncoder.isConfigSupported` hang.

## Not carried over from 2.x

`capturePreview`, `getAgentContext`, `saveProject`, `saveProjectAs`,
`saveProjectToStream` (replaced by `saveProjectToHandle`), the old
points/rings view mode and point size (replaced by v3 Appearance). Old
per-splat director fields and top-level `displayTracks` from 2.x documents are
not migrated: no saved project used them.
