# Debug Session: Cubism 5 Startup Failure

Status: [OPEN]
Session ID: cubism5-startup-failure

## Symptom
- App still reports: `failed to start up cubism 5 framework`.
- Live2D model cannot load.

## Initial Constraints
- No business logic modification before evidence/research.
- First codebase change must be instrumentation if runtime evidence is needed.

## Hypotheses
1. The Cubism 5 core script/WASM is not loaded or not initialized before framework startup.
2. The project uses a Cubism 2/4 runtime wrapper that is incompatible with Cubism 5 model assets.
3. The model JSON references Cubism 5 assets/features that the current loader package does not support.
4. The bundler serves the Cubism core file with an incorrect path/MIME/order, causing initialization to fail.
5. Multiple Live2D core versions are loaded together, creating a global runtime conflict.

## Research Notes
- `@naari3/pixi-live2d-display` explicitly requires PixiJS 8.x and Cubism Core 5 for Cubism 5 model support.
- Live2D official SDK page provides Cubism Core for Web; production should ship the local Cubism 5 core instead of relying on remote direct links.
- Project dependency state matches PixiJS 8 and `@naari3/pixi-live2d-display/cubism5`, but `index.html` was still preloading `/vendor/live2dcubismcore.min.js`.
- Because `ensureCubismCore()` skipped loading when any `window.Live2DCubismCore` existed, the old preloaded core prevented `/vendor/live2dcubismcore-v5.min.js` from being used.

## Evidence Log
- Confirmed `index.html` preloaded old `/vendor/live2dcubismcore.min.js` before app startup.
- Confirmed app code imports `@naari3/pixi-live2d-display/cubism5` and PixiJS v8-compatible initialization.
- Fix applied: `index.html` now preloads `/vendor/live2dcubismcore-v5.min.js`.
- Fix applied: `ensureCubismCore()` now checks Cubism Core major version and refuses to continue unless major version is 5.
- Verification: `npm run build` completed successfully after the fix.
- User retest: Cubism 5 startup error moved forward; Haru became transparent and Aquarius failed with `_a.map is not a function`.
- Confirmed Aquarius `model3.json` has no `HitAreas`, while `@naari3/pixi-live2d-display/cubism5` later calls `settings.hitAreas.map(...)`; when `HitAreas` is absent, its Cubism framework mixin can expose the request key as a string instead of an array.
- Fix applied: `modelController.ts` now loads and normalizes `model3.json` before handing it to the Cubism 5 runtime, setting missing `HitAreas` to `[]`, missing `Expressions` to `[]`, and missing `Motions` to `{}`.
- Confirmed Haru has valid `HitAreas`, `Motions`, `Expressions`, and texture references, so transparency points to rendering hookup rather than asset validation.
- Fix applied: `modelController.ts` now explicitly calls `setRenderer(app.renderer)` on loaded Live2D models, because the runtime's Pixi v8 render callback otherwise falls back to `window.app` and can return before drawing.
- Verification: `npm run build` completed successfully after both post-startup fixes.
- User clarified the watermark is intentional copyright text owned by the project/user and should briefly show like in VTube Studio, not be removed from the texture.
- Confirmed Aquarius package has no motion files, no hotkeys, and empty `IdleAnimation` in `.vtube.json`; therefore the one-second disappearance is not a motion file playback in this web runtime.
- Confirmed `.cdi3.json` exposes suspicious internal parameters `ParamSite` and `ParamTrans` under the model parameter group; these align with the copyright/source/translation notice behavior.
- Fix applied: `modelController.ts` now schedules an Aquarius-only startup timer. After 1000ms it sets `ParamTrans` and `ParamSite` to `1`, restoring the intended brief copyright notice behavior without modifying any texture image.
- Verification: `npm run build` completed successfully after the Aquarius copyright-notice parameter fix.
