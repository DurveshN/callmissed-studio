# CallMissed Studio — Design Spec

- **Date:** 2026-10-11
- **Status:** Approved in brainstorming (sections 1–5), pending written-spec review
- **License:** MIT
- **Research basis:** `.research/00-summary.md` … `08-callmissed-image-api.md` (claims there are sourced; items marked [Unverified] there remain unverified here)

## 1. Product

An open-source Windows desktop app that opens an image or PDF, **detects text and objects locally**, lets the user edit them (retype text, move/cut/delete objects, erase, remove background), and then — from a prompt bar below the canvas — sends the edited page to the **CallMissed image API** (user's own key) for AI image-to-image generation, keeping a full history.

### Decisions (fixed)

| Topic | Decision |
|---|---|
| v1.0 scope | All four subsystems: shell, image intelligence, PDF engine, AI panel |
| Platform | Windows 10/11 x64. CPU-only must work; DirectML GPU used when available, CPU fallback |
| Model delivery | Small installer; models downloaded on first launch (SHA-256 verified); offline afterwards |
| Font fidelity | Auto-estimate size/color/weight/rotation/alignment + closest-font match (bundled OFL fonts + installed fonts); user override in Inspector |
| AI mode | Image-to-image only: flattened page + prompt → new version in History |
| Persistence | `.cmsp` project file per document + local SQLite library + autosave |
| License | MIT → no AGPL/GPL/non-commercial dependencies or weights (excludes MuPDF.js, Ultralytics YOLO, YOLO-World, RMBG, Surya, Polotno, SAM 3) |
| Name | CallMissed Studio; project extension `.cmsp` |
| Layout | Canva-like minimal: top toolbar, single tabbed right panel, slim prompt bar under canvas |
| OCR languages | English only in v1.0 (engine supports adding recognition models later) |
| ML runtime | `onnxruntime-node` in an Electron `utilityProcess` |
| Branding images | Generated via CallMissed MCP `generate_image` with model `gpt-image-2`; cost confirmed with owner before each batch |

## 2. Tech stack

Versions are the research snapshot of 2026-10-11 and are re-verified at install time (`npm view <pkg> version`).

| Layer | Choice |
|---|---|
| Shell | Electron (current stable major at scaffold time; research: 44.x) |
| Build | electron-vite + electron-builder (NSIS) + electron-updater (GitHub Releases) |
| Language | TypeScript strict everywhere |
| UI | React 19, Zustand (+ Immer), CSS Modules with design tokens |
| Canvas | Konva + react-konva |
| Validation | zod (IPC payloads, settings, project files) |
| ML | onnxruntime-node (DirectML EP → CPU EP), `@techstark/opencv-js` (contours, Telea inpaint) |
| Models | PP-OCRv5 det + English rec, SAM 2.1 tiny (MobileSAM fallback), LaMa, BiRefNet_lite |
| PDF | `pdfjs-dist` (render, text content), `@cantoo/pdf-lib` + `@pdf-lib/fontkit` (write) |
| Storage | `node:sqlite` (built into Electron's Node 24; no native module), `fflate` (zip), Electron `safeStorage` |
| Logging | electron-log (API key scrubbed) |
| Tests | Vitest, Playwright (`_electron`) |
| CI | GitHub Actions `windows-latest` |

## 3. Architecture

### 3.1 Processes

```
Renderer (React, sandboxed)  ──IPC (zod-validated)──▶  Main process  ──spawns/supervises──▶  ML worker (utilityProcess)
        ▲                                                                                        ▲
        └──────────────────── MessagePort (transferable ArrayBuffers: pixels, masks) ───────────┘
```

- **Renderer**: UI only. No Node, no filesystem, never sees the API key. Talks via `window.studio.*` exposed by preload.
- **Main**: owns files, database, secrets, network, model downloads, PDF writing, updates.
- **ML worker**: owns ONNX sessions and image pipelines. No network, no Electron APIs inside pipeline code.
- Security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, navigation and `window.open` blocked, every IPC handler validates input with zod and checks sender frame.

### 3.2 Source layout

```
src/
  shared/            ipc contracts (zod), document model types, model-manifest types, error codes
  main/
    index.ts         app lifecycle, window creation
    ipc/router.ts    registers handlers; one file per domain under ipc/
    services/
      project-service.ts    .cmsp read/write, atomic save, autosave, recovery
      library-db.ts         node:sqlite + migrations (PRAGMA user_version)
      secret-store.ts       safeStorage key storage
      callmissed-client.ts  generations, models, history; error mapping; cancel
      model-manager.ts      manifest, download (resume), sha256, install state
      pdf-service.ts        PDF export via pdf-lib
      ml-supervisor.ts      spawns/restarts ML worker, job routing
      updater.ts            electron-updater
      settings-store.ts     settings.json (zod)
  preload/index.ts   typed bridge
  ml/
    worker.ts        entry: job queue, progress, cancel
    session-pool.ts  ORT sessions, EP selection + fallback
    pipelines/{ocr,segment,inpaint,bgremove}/   pure functions + their pre/post-processing
  renderer/
    app/             shell, layout, theme tokens
    features/{import,canvas,tools,layers,inspector,ai-prompt,history,usage,settings,model-setup,export}/
      each: components/, store slice, tests
    workers/font-match.worker.ts
tools/model-export/  Python scripts that export/verify ONNX models (dev only, not shipped)
resources/           icons, bundled OFL fonts, model manifest
```

Rule: one module = one responsibility; a feature imports only `shared/` and its own slice plus explicit public APIs of other features.

## 4. Document model and editing

```ts
Document { id, source: { kind: 'image' | 'pdf', path, sha256 }, pages: Page[] }
Page     { index, width, height, rotation, background: RasterRef, patches: Patch[], layers: Layer[] }
Patch    { id, bbox, bitmapId }                       // inpainted pixels over the original
Layer =
  | TextLayer  { id, text, bbox, rotation, font: { family, size, weight, italic }, color, align, lineHeight,
                 origin: 'ocr' | 'pdf-native' | 'user', sourceRef? }
  | ImageLayer { id, bitmapId, transform, opacity, origin: 'cutout' | 'import' | 'ai' }
  | ShapeLayer { id, kind: 'rect' | 'ellipse' | 'line', transform, stroke, fill }
```

- Non-destructive: the original source is never modified.
- Undo/redo: command pattern storing Immer patches; 200 steps; persisted in project.
- Common layer props: `name`, `visible`, `locked`, `opacity`, `adjustments` (brightness/contrast/saturation).

### 4.1 Tools (v1.0)

| Tool | Behavior |
|---|---|
| Select/Move | Transform, z-order, snapping guides, multi-select |
| Detect Text | OCR page → TextLayer per line; original pixels inpainted into a Patch; style + font estimated |
| Add Text | New TextLayer |
| Magic Select | Click points / box → SAM mask → Cut to layer (hole inpainted) / Delete (inpaint) / Copy |
| Erase | Brush mask → inpaint; Quality (LaMa) / Fast (Telea) toggle |
| Remove Background | BiRefNet_lite matte → subject on new ImageLayer |
| Insert Image, Shapes | Add ImageLayer / ShapeLayer |
| Crop / Rotate / Resize canvas | Page geometry ops |
| Adjust | Brightness / contrast / saturation on layer or page |

### 4.2 PDF

- Render each page with pdf.js at 2× device scale for editing.
- Native text (pdf.js `getTextContent`) → TextLayers `origin: 'pdf-native'`, no OCR needed.
- Pages with no text content → offered Detect Text (OCR).
- Page ops: reorder, delete, rotate.
- Export:
  - untouched pages copied unchanged (`copyPages`), keeping vectors;
  - edited pages: original page + erase patch over edited text regions + new text as real text with embedded subset font + added layers drawn on top;
  - optional **Make searchable**: invisible OCR text layer (text render mode 3) for scanned pages.
- Known limitation (documented in UI and README): native text is replaced by erase + overlay, not edited in place inside the content stream.

### 4.3 Export

PNG / JPEG / WebP at chosen scale for a page or a selected layer; PDF as above.

## 5. Storage

### 5.1 Project file `.cmsp` (zip)

```
manifest.json        { format: "cmsp", schemaVersion: 1, appVersion, createdAt, updatedAt }
document.json
history.json         undo/redo stacks (Immer patches)
assets/<id>.<ext>       original source file, imported images, patches, cutouts
generations/<id>.png
generations.json
thumbnail.png
```

- Atomic save: write `<file>.tmp` then rename.
- Each open document has a workspace folder `userData/workspaces/<docId>/` (assets written once on creation, `document.json` + `history.json` autosaved 2 s after the last change). Save zips the workspace into the `.cmsp`. Clean exit deletes workspaces; leftovers (crash, renderer reload) are offered for recovery on the start screen.
- `schemaVersion` + ordered migration functions on load.

### 5.2 App data (`%APPDATA%/CallMissed Studio/`)

| Path | Content |
|---|---|
| `settings.json` | theme, GPU enabled, export defaults, last model choice |
| `secrets.bin` | CallMissed API key encrypted with `safeStorage` |
| `library.db` | SQLite, tables below |
| `models/` | installed ONNX files + `installed.json` |
| `workspaces/` | per-document working copies (autosave / crash recovery) |
| `logs/` | rotating logs |

Tables: `schema_migrations`, `projects(id, path, name, thumbnail, last_opened_at)`, `generations(id, project_id, remote_id, model, prompt, size, n_index, seed, revised_prompt, credits, status, error_code, file_path, created_at)`, `api_calls(id, endpoint, model, http_status, error_code, credits, latency_ms, created_at)`.

## 6. AI generation (CallMissed)

Source: `.research/08-callmissed-image-api.md`. Exact field names are re-verified against `https://docs.callmissed.com/docs/image-generation.md` before implementing M6.

- Base URL `https://api.callmissed.com/v1`, header `Authorization: Bearer cm_…`, key needs `image` permission.
- Models dropdown: `GET /v1/models` filtered to `gpt-image-*` (only these accept `reference_images`).
- Generate: flatten current page → PNG (downscale until ≤ 10 MB) → `POST /v1/images/generations` `{ model, prompt, n (1–4), size, reference_images: [b64], response_format: 'b64_json' }`.
- Size: nearest supported size matching the canvas aspect ratio.
- Cost shown before sending (credits per image × n).
- Timeout 180 s; Cancel via AbortController.
- Errors mapped to messages: 400, 402 (insufficient credits / budget), 403 (permission / model), 404, 422, 429 (quota → no retry; rate/concurrency → honor `Retry-After`), 503 (safe retry).
- Results saved to project `generations/` and DB; History tab actions: Compare (slider), Use as page (becomes new page background; prior state preserved in history), Add as layer, Export.
- Usage tab: local `api_calls` + `generations` totals; Sync button imports `GET /v1/images/history`.
- Settings → CallMissed: set key, Test (calls `GET /v1/models`), Remove. Key only lives in main process.

## 7. ML pipelines and models

### 7.1 Model delivery

- `resources/models.manifest.json`: `{ id, version, files: [{ name, url, mirrorUrl, sha256, bytes }], license, group: 'essential' | 'optional' }`.
- Primary hosting: this repo's GitHub Release `models-v1`; mirror: pinned Hugging Face revision.
- ONNX files produced by `tools/model-export/` scripts (reproducible, auditable).
- First-launch setup screen: Essentials (OCR det+rec, SAM 2.1 tiny) and Optional (LaMa, BiRefNet_lite), all pre-checked, skippable; tools prompt to download a missing model on first use.
- Download: HTTP Range resume, 3 retries with exponential backoff, SHA-256 verify before activation, mismatch → delete + error.

### 7.2 Pipelines

| Pipeline | Steps |
|---|---|
| OCR | DB det → prob map → threshold → contours (opencv.js) → unclip + min-area rect → perspective crop → rec (English dict) → CTC decode → group words into lines/blocks |
| Style | per line: 2-cluster k-means for text/bg color, size from line height, rotation from box angle, weight from stroke width / height |
| Font match | renderer worker: render recognized text in candidates (≈20 bundled OFL fonts + installed fonts via Local Font Access), score pixel IoU against binarized crop, best wins |
| Segment | SAM 2.1 encoder once per page (cached by raster hash) → decoder per prompt → largest component + hole fill |
| Inpaint | dilate mask → LaMa on 512 crop with context → feathered blend; Telea for Fast mode |
| Remove BG | BiRefNet_lite matte → RGBA layer |

### 7.3 Failure handling

| Failure | Behavior |
|---|---|
| ML worker crash | supervisor restarts; in-flight jobs reject `WORKER_CRASHED`; UI offers Retry; document untouched |
| DirectML init failure | retry on CPU; persist per-device; Settings toggle |
| Out of memory | fall back to MobileSAM / Telea; notify user |
| Long job | progress events + cancel |
| Renderer crash | reload window, restore from autosave |

## 8. Branding

- App icon (`.ico` 16–256 px, `.png`), setup-screen illustration, empty-state illustrations generated with CallMissed MCP `generate_image`, model `gpt-image-2`.
- Before each generation batch the image list and credit cost (25 credits/image per research) are shown to the owner and approved.
- Generated assets stored in `resources/branding/` with a `PROMPTS.md` recording prompt, model and date.

## 9. Testing

- **Unit (Vitest):** pipelines on fixture images (OCR accuracy threshold on known-text fixtures), style estimation, project zip round-trip, migrations, IPC schemas, CallMissed client against mocked HTTP for every error code, ModelManager (resume, checksum mismatch).
- **E2E (Playwright `_electron`):** image → Detect Text → edit → export; PDF → edit → save → reopen; generation with mocked API.
- **CI:** typecheck, ESLint, unit, E2E on `windows-latest` for every PR and push to `main`.

## 10. Release

- electron-builder NSIS x64, per-user install, selectable directory, `.cmsp` file association, "Open with" for PNG/JPG/PDF.
- Tag `v*` → GitHub Actions builds and publishes to GitHub Releases; electron-updater checks on launch and asks before installing.
- Code signing wired but disabled until owner chooses SignPath Foundation or Azure Artifact Signing; README documents SmartScreen warning meanwhile.
- Repo docs: `LICENSE` (MIT), `THIRD_PARTY_LICENSES.md` (generated, includes model licenses), `README.md`, `CONTRIBUTING.md`, `CONTEXT.md` (updated each session), `.research/`.

## 11. Milestones

Each milestone is complete, tested, committed and tagged before the next starts. Conventional commits.

| # | Tag | Scope | Done when |
|---|---|---|---|
| M0 | `m0-foundation` | repo, tooling, lint/test, CI, spec + research | `npm run dev` opens secure empty window; CI green |
| M1 | `m1-shell` | layout B, open image/PDF (drop, dialog, Open with), canvas zoom/pan/snapping, Select/Move, Add Text, Shapes, Insert Image, layers panel, inspector, pages panel, undo/redo, `.cmsp` save/load, autosave + recovery, PNG/JPEG/WebP export, app icon | project round-trips losslessly |
| M2 | `m2-ml-foundation` | ML worker, session pool, ModelManager, setup screen, GPU/CPU fallback | models download, verify, load |
| M3 | `m3-text` | OCR, editable text layers, inpaint under text, style + font match, bundled OFL fonts | Detect Text + edit works on fixtures |
| M4 | `m4-objects` | Magic Select, Cut/Delete, Erase, Remove BG, adjust, crop/rotate/resize | all image tools work |
| M5 | `m5-pdf` | native text layers, scanned OCR, page ops, PDF export, searchable PDF | exported PDFs open correctly in Acrobat Reader and Chrome |
| M6 | `m6-ai` | key settings, prompt bar, generation, History/Compare, Usage, sync | end-to-end with real key (owner verifies) |
| M7 | `v1.0.0` | installer, auto-update, file associations, branding artwork, docs | clean Windows install works end to end |

## 12. Out of scope for v1.0

Non-English OCR, macOS/Linux builds, masked/region AI generation, text-to-image without reference, AI font recognition, in-place PDF content-stream text editing, cloud sync of projects.
