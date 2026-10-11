# CONTEXT

## Project

CallMissed Studio — open-source (MIT) Windows Electron app: local OCR/segmentation/inpainting editing of images and PDFs + CallMissed image-to-image generation. Full design: `docs/superpowers/specs/2026-10-11-callmissed-studio-design.md`. Research: `.research/`.

## Status (2026-10-11)

- M0 foundation done (tag `m0-foundation`).
- Branding: app icon chosen (`resources/branding/app-icon-source.png`, option B2). Rebuild derived icons with `python tools/branding/build_icons.py`.
- **M1 shell done** (tag `m1-shell`): start screen (open, drop, recents, crash recovery), Canva-style editor (top bar, canvas, Inspector/Layers/Pages tabs), Select/Hand/Text/Rect/Ellipse/Line/Insert image, transform + snapping + marquee, undo/redo (persisted), `.cmsp` save/open, autosave, export PNG/JPEG/WebP, unsaved-changes guards.
- Next: M2 ML foundation (utilityProcess worker, ONNX Runtime, ModelManager + setup screen).

## Pinned toolchain (compatibility-constrained)

- Electron 44.7.0, electron-vite 5.0.0 → Vite must stay ≤ 7 (7.3.7), so `@vitejs/plugin-react` 5.2.0 (v6 needs Vite 8).
- TypeScript 6.0.3 — typescript-eslint 8.71 supports `<6.1`; TS 7 not usable yet.
- No `"type": "module"` in package.json: main/preload build as CJS (sandboxed preload requires it). ESLint config is `.mjs`.
- Renderer-only packages (react, konva, pdfjs-dist, zustand, immer, lucide-react) are devDependencies because Vite bundles them; only main-process runtime deps (zod, fflate) are dependencies.

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

## Testing

- `npm test` — Vitest unit (37 tests): IPC contracts, CSP, protocol path guard, project zip, library DB, project service (open/save/recover), document store (undo/coalesce/order), snapping.
- `npm run test:e2e` — builds then Playwright drives Electron (13 tests). Helpers in `tests/e2e/helpers.ts`: isolated profile via `STUDIO_USER_DATA`, dialog stubs, generated PNG/PDF fixtures, `closeApp()` force-exits (native unsaved-changes modal would hang the run).

## Decisions log

See spec §1 "Decisions (fixed)". Branding images via CallMissed MCP `gpt-image-2`, cost approved per batch (4 images generated so far ≈ 100 credits).

## Open items

- Code-signing route (SignPath Foundation vs Azure Artifact Signing) — needed before v1.0.0.
- Verify exact CallMissed field names against raw docs before M6.
- GitHub repo URL not yet created (no `homepage`/`publish` config until it exists).
- Renderer bundle is ~2.7 MB (pdf.js + Konva); acceptable for desktop, code-split later if startup suffers.
