# CONTEXT

## Project

CallMissed Studio — open-source (MIT) Windows Electron app: local OCR/segmentation/inpainting editing of images and PDFs + CallMissed image-to-image generation. Full design: `docs/superpowers/specs/2026-10-11-callmissed-studio-design.md`. Research: `.research/`.

## Status (2026-10-11)

- M0 foundation done (tag `m0-foundation`).
- Branding: app icon chosen (`resources/branding/app-icon-source.png`, option B2). Rebuild derived icons with `python tools/branding/build_icons.py`.
- **M1 shell done** (tag `m1-shell`): start screen (open, drop, recents, crash recovery), Canva-style editor (top bar, canvas, Inspector/Layers/Pages tabs), Select/Hand/Text/Rect/Ellipse/Line/Insert image, transform + snapping + marquee, undo/redo (persisted), `.cmsp` save/open, autosave, export PNG/JPEG/WebP, unsaved-changes guards.
- Arrange (bring to front / forward / send backward / to back) via right-click menu on canvas + layer rows and Inspector "Arrange" section (`features/arrange/`). Background always stays bottom-most.
- **M2 ML foundation done** (tag `m2-ml-foundation`): model manifest (4 packs, pinned HF commits, SHA-256), resumable downloader, ML utilityProcess with ONNX Runtime (DirectML → CPU fallback), MessagePort bridge, first-run "Set up AI features" screen, Settings dialog (models download/test/remove, GPU toggle). All 4 real packs verified to download and load on DirectML (`.research/09-model-verification.md`).
- Next: M3 text (OCR pipeline, editable text layers, inpaint under text, style + font match, bundled OFL fonts).

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
- Packaging: `electron-builder.yml` unpacks `onnxruntime-node` from asar and drops non-win-x64 binaries (verify in M7).

## Testing

- `npm test` — Vitest unit (61 tests): IPC contracts, CSP, protocol path guard, project zip, library DB, project service, document store, snapping, arrange, model manager (local HTTP server: resume, bad checksum, 404, cancel, version bump), session pool fallback, job queue, manifest pinning/licences, ONNX fixture.
- `npm run test:e2e` — builds then Playwright drives Electron (20 tests). Helpers in `tests/e2e/helpers.ts`: isolated profile via `STUDIO_USER_DATA`, `launchApp({ modelSetupDone })` seeds settings, dialog stubs, generated PNG/PDF fixtures, `closeApp()` force-exits (native unsaved-changes modal would hang the run). `tests/fixtures/onnx.ts` hand-encodes a tiny Identity ONNX model so model tests never hit the network.

## Decisions log

See spec §1 "Decisions (fixed)". Branding images via CallMissed MCP `gpt-image-2`, cost approved per batch (4 images generated so far ≈ 100 credits).

## Open items

- Code-signing route (SignPath Foundation vs Azure Artifact Signing) — needed before v1.0.0.
- Verify exact CallMissed field names against raw docs before M6.
- GitHub repo URL not yet created (no `homepage`/`publish` config until it exists).
- Renderer bundle is ~2.7 MB (pdf.js + Konva); acceptable for desktop, code-split later if startup suffers.
