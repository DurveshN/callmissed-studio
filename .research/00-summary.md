# 00 - Executive summary

Research date: 2026-10-11. Details and sources are in files 01-08. **[Inference]** = my reasoning; **[Unverified]** = not confirmed.

## Recommended stack

| Layer | Choice | Version (checked) | Licence | Why | Alternative |
|---|---|---|---|---|---|
| Shell | Electron | 44.7.0 (EOL 2027-03-02; 45 due 2026-10-20) | MIT | Supported major; Chromium M152, Node 24.18.1 | Electron 45 after release |
| Build / package | electron-vite + electron-builder | 5.0.0 / 26.15.3 | MIT | NSIS + GitHub publish + electron-updater | Electron Forge 8.0.1 (Vite plugin was experimental) |
| Updates | electron-updater (GitHub Releases) | 6.8.9 | MIT | Pairs with electron-builder | update-electron-app 3.3.0 |
| Signing | SignPath Foundation (free, OSS) or Azure Artifact Signing ($9.99/mo; individuals US/Canada only) | - | - | Free route needs an all-OSI component set | OV/EV cert [Unverified] |
| UI / state | React 19 + TypeScript, Zustand | 19.3.0 / 5.0.15 | MIT | Spec | - |
| Canvas | Konva + react-konva | 10.7.1 / 19.3.0 | MIT | Layers, transforms | Fabric 7.4.0 (MIT); **not Polotno** |
| Tests | Vitest, Playwright (Electron, experimental) | 5.0.3 / 1.64.0 | MIT / Apache-2.0 | - | - |
| ML runtime | onnxruntime-node in a utilityProcess, DirectML opt-in with CPU fallback | 1.30.0 | MIT | Documented Windows DirectML in Node | onnxruntime-web WebGPU; transformers.js 4.3.1 |
| OCR | PaddleOCR PP-OCRv5 (v6 selectable) ONNX; wrapper `ppu-paddle-ocr` 6.6.1 if its box API fits | PaddleOCR 3.7.0 | Apache-2.0 / MIT wrapper | Det+rec polygons, tiny models | Fallbacks: Windows.Media.Ocr, tesseract.js 7.0.0 (Apache-2.0) |
| Object selection | SAM 2.1 tiny/small ONNX; MobileSAM / SlimSAM lite | - | Apache-2.0 | Encoder once + decoder per click | SAM 3 (SAM License - restrictive) |
| Text-prompt select (optional) | Grounding DINO tiny / OWLv2 -> SAM | - | Apache-2.0 | ~0.2B params | - |
| Background removal | BiRefNet_lite ONNX | - | MIT | Only high-quality permissive option verified | U2-Netp / silueta (Apache-2.0) |
| Inpainting | LaMa fp32 ONNX (512 crop + blend); MI-GAN fast path; OpenCV Telea instant path | - | Apache-2.0 / MIT / Apache-2.0 | Quality for large masks | IOPaint is archived (2025-08) |
| PDF render | pdfjs-dist | 6.4.299 | Apache-2.0 | Text layer, mature | PDFium WASM (`@hyzyla/pdfium` 3.0.0 MIT) |
| PDF write | @cantoo/pdf-lib + @pdf-lib/fontkit | 2.11.1 / 1.1.1 | MIT | Original pdf-lib last released 2022 | PDFium edit API in custom WASM |
| Secrets | safeStorage (DPAPI) | - | - | API key in main process only | - |
| Storage | Files in userData + better-sqlite3 (13.0.3) or node:sqlite for index | - | MIT | Generation history | - |
| Cloud generation | CallMissed `POST /v1/images/generations` | - | Pay per image | Sync, OpenAI-compatible, `reference_images` with `gpt-image-*` | - |

## Key risks

| # | Risk | Detail | Mitigation |
|---|---|---|---|
| 1 | **Copyleft / non-commercial** | AGPL-3.0: MuPDF.js 1.28.1, Ultralytics YOLO. GPL-3.0: YOLO-World. CC BY-NC: RMBG-1.4 / RMBG-2.0 (rembg default `bria-rmbg` too). Surya weights: modified OpenRAIL-M, restricted by revenue/funding. | Excluded from the stack |
| 2 | Custom licences to read | SAM 3 "SAM License" (field-of-use bans, non-OSI), EdgeSAM NTU S-Lab 1.0, RF-DETR PML 1.0 sizes, IS-Net weights terms, MI-GAN training-data terms | Avoid or review before bundling |
| 3 | Signing eligibility | SignPath free tier needs OSI licence for all components, so non-OSI weights bundled in the installer jeopardise it [Inference]. Azure individual signing is US/Canada only | Download restricted models separately; choose route early |
| 4 | Model size | LaMa fp32 ~208 MB; onnxruntime-node npm package 301 MB unpacked (all platforms); onnxruntime-web 145 MB; BiRefNet memory 3.5-4.8 GB (README) | First-run download with SHA-256; filter non-Windows binaries |
| 5 | Windows GPU | DirectML EP is in sustained engineering; Microsoft recommends WinML; DML needs sequential mode and no memory-pattern; opset <= 20 | CPU fallback; benchmark on iGPU/CPU-only machines |
| 6 | Native-PDF text editing | No permissive JS library edits existing text runs in place; embedded subset fonts lack glyphs | Overlay + erase approach; set expectations in UI |
| 7 | CallMissed API gaps | No documented mask parameter or async API; reference editing only on `gpt-image-*` ($0.26/image); free plan 50 images/month | Composite locally; show cost; confirm with CallMissed |
| 8 | Maturity | PP-OCRv6 is 4 months old; Electron Playwright support experimental; no independent OCR/segmentation benchmarks gathered | Ship v5 default; benchmark on own data |

## Open questions for the product owner

1. Which license for the app (MIT vs Apache-2.0), and is OSI-purity (needed for SignPath) a requirement? That decides whether SAM 3, EdgeSAM, or any non-OSI weights are allowed even as downloads.
2. Signing: owner's country/entity (Azure individual signing is US/Canada only) vs SignPath Foundation (free, needs manual release approval).
3. Native PDFs: is "overlay replace" acceptable, or is true in-place text editing required (would need PDFium custom build or commercial engine)?
4. Languages: which scripts must OCR support at launch (Latin only, or Indic/CJK)? Affects model and fonts.
5. Installer size budget and whether first-run downloads are acceptable; minimum hardware (CPU-only?).
6. Does CallMissed offer a documented mask / `/v1/images/edits` endpoint, an async job API, and sandbox keys for CI tests?
7. Should generation history be local-only, or also synced from `GET /v1/images/history`?
8. Cost UX: show per-image credit price before sending; default to a free model?

## Files
`01-how-it-works.md`, `02-ocr-engines.md`, `03-segmentation-and-detection.md`, `04-inpainting.md`, `05-runtime-ml-in-electron.md`, `06-pdf-stack.md`, `07-electron-stack.md`, `08-callmissed-image-api.md`
