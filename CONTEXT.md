# CONTEXT

## Project

CallMissed Studio — open-source (MIT) Windows Electron app: local OCR/segmentation/inpainting editing of images and PDFs + CallMissed image-to-image generation. Full design: `docs/superpowers/specs/2026-10-11-callmissed-studio-design.md`. Research: `.research/`.

## Status (2026-10-11)

- M0 foundation done (tag `m0-foundation`).
- Branding: app icon chosen (`resources/branding/app-icon-source.png`, option B2). Rebuild derived icons with `python tools/branding/build_icons.py`.
- **M1 shell done** (tag `m1-shell`): start screen (open, drop, recents, crash recovery), Canva-style editor (top bar, canvas, Inspector/Layers/Pages tabs), Select/Hand/Text/Rect/Ellipse/Line/Insert image, transform + snapping + marquee, undo/redo (persisted), `.cmsp` save/open, autosave, export PNG/JPEG/WebP, unsaved-changes guards.
- Arrange (bring to front / forward / send backward / to back) via right-click menu on canvas + layer rows and Inspector "Arrange" section (`features/arrange/`). Background always stays bottom-most.
- **M2 ML foundation done** (tag `m2-ml-foundation`): model manifest (4 packs, pinned HF commits, SHA-256), resumable downloader, ML utilityProcess with ONNX Runtime (DirectML → CPU fallback), MessagePort bridge, first-run "Set up AI features" screen, Settings dialog (models download/test/remove, GPU toggle). All 4 real packs verified to download and load on DirectML (`.research/09-model-verification.md`).
- **M3 text done** (tag `m3-text`): Detect Text (toolbar / `D`) on the page or the selected image layer → outlined lines → click or Convert all → editable text with matched font, size, weight, color and rotation; original ink erased (LaMa if installed, else Telea); one undo step. Verified on `tests/fixtures/ocr-poster.png`: all 5 lines exact, Arial / Arial Bold identified, rotation −12°.
- Next: M4 objects (Magic Select with SAM 2.1, cut/delete with inpaint, eraser brush, remove background, adjust, crop/rotate/resize).

## Pinned toolchain (compatibility-constrained)

- Electron 44.7.0, electron-vite 5.0.0 → Vite must stay ≤ 7 (7.3.7), so `@vitejs/plugin-react` 5.2.0 (v6 needs Vite 8).
- TypeScript 6.0.3 — typescript-eslint 8.71 supports `<6.1`; TS 7 not usable yet.
- No `"type": "module"` in package.json: main/preload build as CJS (sandboxed preload requires it). ESLint config is `.mjs`.
- Renderer-only packages (react, konva, pdfjs-dist, zustand, immer, lucide-react) are devDependencies because Vite bundles them; only main/worker runtime deps (zod, fflate, onnxruntime-node 1.30.0) are dependencies.
- TypeScript projects: `tsconfig.node.json` (main, ml worker, shared), `tsconfig.preload.json` (DOM + node), `tsconfig.web.json` (renderer), `tsconfig.test.json` (tests import any layer).

## Architecture notes

- Renderer loads from `studio://app` (`src/main/app-protocol.ts`), not `file://`. `URL.origin` is `"null"` for custom schemes in Node → trusted-sender check compares protocol + host.
- IPC: channel list `src/shared/ipc/channels.ts` (zod-free; preload ~1.4 kB), schemas `contracts.ts`, handlers via `handle()` in `src/main/ipc/router.ts` (gets `{ window }` context). Main → renderer events: `app:open-path`, `app:save-and-close`.
- Storage: `WorkspaceStore` (`userData/workspaces/<docId>/`) holds assets + autosaved state; `ProjectService` packs/unpacks `.cmsp` (`project-file.ts`, fflate, entry whitelist + size limits); `LibraryDb` uses `node:sqlite` (verified working inside Electron 44; Node 22 test runner prints an ExperimentalWarning, harmless).
- Renderer reload/crash → main `releaseAll()` keeps workspaces so they show under "Recover unsaved work".
- Undo: Zustand store + Immer `produceWithPatches`, coalescing by key within 1 s (`features/document/store.ts`). Clone drafts with `current()` before `structuredClone`.
- Selectors returning new arrays must use `useShallow` (Zustand 5 + React 19 otherwise loops: React error #185).
- Canvas: Konva; viewport transform on the Stage; page content group registered in `stage-registry.ts` for export/thumbnail (`group.toCanvas` with pixelRatio = scale / stageScale).
- pdf.js 6: worker via `?url` import; cmaps/standard_fonts/wasm/iccs served from `/pdfjs/` by `tools/vite/pdfjs-assets.ts`; CSP allows `'wasm-unsafe-eval'`. Destroy via `pdf.loadingTask.destroy()`.
- Text tool click must `preventDefault()` the mousedown, otherwise the browser moves focus to `<body>` and the new text editor blurs instantly.
- Don't `stopPropagation()` keydown in fields: global shortcuts handle "typing" themselves; Ctrl+S/O/E work from fields (field is blurred first to commit).
- `tsconfig.web.json` disables `exactOptionalPropertyTypes` (Konva typings); node config keeps it.
- ML: `src/ml/worker.ts` is a second main-build entry (`out/main/ml-worker.js`) forked by `MlSupervisor` (`utilityProcess`, crash-loop limit 5/min). Renderer jobs go preload `ml-bridge.ts` → MessagePort → worker (port never exposed to the page; outcomes are values, not thrown, so error codes survive the context bridge). Main → worker control over `parentPort` (`configure`, `connect`, `release-models` with ack — Windows locks loaded model files, so release before delete).
- `SessionPool`: DML options need `enableMemPattern: false` + `executionMode: 'sequential'`; first DML failure switches the pool to CPU and emits `ml:gpu-failed`.
- `ModelManager`: `.part` files + HTTP Range resume, restarts if the server ignores Range, non-retryable on 4xx (except 429), state transitions emitted immediately, progress throttled to 150 ms. Uses Electron `net.fetch` (system proxy). Test-only env `STUDIO_MODEL_MANIFEST` (unpackaged builds only).
- DirectML first load is slow for big models (LaMa ~8 s, BiRefNet ~25 s on Iris Xe) — warm up in background in M4.
- OCR pipeline (`src/ml/pipelines/ocr/`): det (resize long side to 960–1920, BGR ImageNet norm, DB post-process thresh 0.3 / box 0.6 / unclip 1.5) → rec (48 px high, BGR [-1,1], CTC; class 0 blank, 1..18383 = rec.yml dict, last = space) → **words grouped into lines** (`lines.ts`; the detector returns words for large text) → **refine** (`refine.ts`: projection-profile deskew ±5° from ink inside the detected box, then refit at that angle scanning +12% while sampling background from the inner box) → style.
- Ink model (`src/ml/image/ink.ts`): background sampled per position along the box's top and bottom bands (handles lines crossing two backgrounds); ink = farther than Otsu from both; components touching the top/bottom band are dropped (panel borders, gradient edges). Used by refine, style and the erase mask — keep them on this one definition.
- LaMa (Carve ONNX): inputs RGB 0..1 + mask {0,1} at 512², output RGB 0..255 (verified against the repo's reference output). Letterboxed context crop, feathered blend inside the mask only.
- Font matching runs in a renderer web worker (`features/fonts/font-match.worker.ts`): renders recognized text per candidate (17 bundled OFL families + 12 Windows fonts, weights ~400/~700), fits ink width, scores IoU minus ink-height mismatch. Placement reproduces Konva 10's non-legacy layout: baseline at `(fontAscent − fontDescent)/2 + lineHeight·size/2` from the box top.
- Bundled fonts are variable TTFs from google/fonts @ bd8f81d (`src/renderer/public/fonts/`); M5 PDF export must instance variable fonts for specific weights.
- MessagePortMain cannot receive or send transferred ArrayBuffers: preload and worker post without transfer lists (a transfer list throws and, inside a promise, hung jobs silently — fixed).
- Renderer mounts only after bundled fonts load; main queues `app:open-path` until `window:renderer-ready` (otherwise "Open with" at startup was lost).
- **ML worker priority**: Chromium starts utility processes at background priority; on hybrid Intel CPUs Windows then runs them on efficiency cores (LaMa 20 s vs 3.4 s). `worker.ts` raises itself to `PRIORITY_NORMAL` at startup — keep this.
- **DirectML run-time failures**: some models load on DML but fail while running (LaMa's FFT MatMul on Intel Iris Xe: `80070057 The parameter is incorrect`). `SessionPool.run()` reloads that file on CPU and retries; the file is persisted in `settings.gpuIncompatible` (cleared when GPU is turned back on). Packs with `"gpu": false` in the manifest (LaMa) never try DML — a failed DML attempt cost ~25–50 s.
- **Inpainting plan** (`pipelines/inpaint/auto.ts`): mask split into clusters; each dimension stays ≤320 px or within the larger part (a long line can't absorb the lines below it), and oversized clusters are tiled to ≤320 px. Flat surroundings (ring std < 10) → Telea (exact, instant), textured → LaMa on a local crop. Never one page-sized LaMa crop. Both methods treat the **whole** mask as unknown and write back only their cluster (otherwise LaMa copies not-yet-erased neighbouring text from its context crop into the fill as ghost letters).
- **Erase mask** (`inpaint/text-mask.ts`): 0.5× Otsu (catches photo halos), `'rules'` ink filter (keeps thin table rules, erases glyphs touching them), dilation 12% of line height.
- **Handwriting** (`text-detect/classify.ts`): low recognition confidence, a handwriting-category best font, or a very poor font fit marks a line as handwritten — skipped by "Convert all" (dashed amber outline; still convertible by click). Signatures can't be reproduced as font text; M4 will offer lifting them as image layers.
- **Tuning discipline**: change OCR/erase constants only with a committed, non-personal fixture that shows the problem (diagram.png and ocr-poster.png are the regression set). Tuning against a single user photo regressed the diagram once (line-box padding 25%).
- **OCR text**: every line is re-recognized as a whole after grouping (spaces from pixels); recognized spaces with no empty ink columns nearby are dropped (`dropFalseSpaces`, fixes ligature splits like "fl ags"); text is NFKC-normalized.
- **Font choice is document-consistent** (`fonts/font-consensus.ts`): matcher returns top-8 candidates on soft ink coverage; lines grouped by color and by size measured in the best-supported reference family vote on a font; a line adopts it if within 15% of its own best score. Fixture `tests/fixtures/diagram.png`: all 32 lines Calibri Bold 26 / Calibri 22 exact.
- ML errors carry a `code`; toasts show their message (`ui/notify.ts`).
- GPU mode changes are acknowledged by the worker (`configure` + `ack`), `settings:update` awaits it, and `runJob` awaits any in-flight settings save.
- Packaging: `electron-builder.yml` unpacks `onnxruntime-node` from asar and drops non-win-x64 binaries (verify in M7).

## Testing

- `npm test` — Vitest unit (97 tests incl. opt-in LaMa test via `STUDIO_TEST_LAMA=1`; real OCR models are downloaded once into `.cache/models`, SHA-256 verified): IPC contracts, CSP, protocol path guard, project zip, library DB, project service, document store, snapping, arrange, model manager (local HTTP server: resume, bad checksum, 404, cancel, version bump), session pool fallback, job queue, manifest pinning/licences, ONNX fixture.
- `npm run test:e2e` — builds then Playwright drives Electron (27 tests, incl. Detect Text with real OCR models seeded via `seedModels`). Helpers in `tests/e2e/helpers.ts`: isolated profile via `STUDIO_USER_DATA`, `launchApp({ modelSetupDone })` seeds settings, dialog stubs, generated PNG/PDF fixtures, `closeApp()` force-exits (native unsaved-changes modal would hang the run). `tests/fixtures/onnx.ts` hand-encodes a tiny Identity ONNX model so model tests never hit the network.

## Decisions log

See spec §1 "Decisions (fixed)". Branding images via CallMissed MCP `gpt-image-2`, cost approved per batch (4 images generated so far ≈ 100 credits).

## Open items

- Code-signing route (SignPath Foundation vs Azure Artifact Signing) — needed before v1.0.0.
- Verify exact CallMissed field names against raw docs before M6.
- GitHub repo URL not yet created (no `homepage`/`publish` config until it exists).
- Renderer bundle is ~2.7 MB (pdf.js + Konva); acceptable for desktop, code-split later if startup suffers.
