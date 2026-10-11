# 02 - OCR engines for a local Electron app on Windows

Research date: 2026-10-11. **[Inference]** = my reasoning. **[Unverified]** = not confirmed from a source. Version/date columns come from the GitHub API or npm registry queried on the research date (npm "modified" = last package publish time, not necessarily the upstream release).

## Comparison

| Engine | Latest (checked) | License (code / weights) | Runtime for Electron | Boxes? | Languages | Size / speed facts (sourced) | Source |
|---|---|---|---|---|---|---|---|
| **PaddleOCR PP-OCRv5 / v6** | PaddleOCR 3.7.0 (2026-06-11) introduces PP-OCRv6 | Apache-2.0 (repo and HF model cards) | Python natively; **ONNX** via conversion guide + ONNX Runtime; JS wrappers exist | Yes: detector outputs text boxes, recogniser per box | v5 multilingual: 109 languages (per README); v6: one model for Chinese, English, Japanese + 46 Latin-script languages ("50 languages") | v5 multilingual rec "only 2M parameters"; v6 tiers tiny 1.5M / small 7.7M / medium 34.5M params; v6 medium +4.6% det / +5.1% rec vs v5_server; "5.2x CPU speedup with OpenVINO" (medium); all vendor claims | https://github.com/PaddlePaddle/PaddleOCR , https://api.github.com/repos/PaddlePaddle/PaddleOCR/releases/latest , https://huggingface.co/PaddlePaddle/PP-OCRv5_server_det |
| **ppu-paddle-ocr** (npm, MIT) | 6.6.1 (npm modified 2026-10-08) | MIT wrapper; model licenses not stated on README | Node/Bun/Deno/browser; `onnxruntime-node` (Node) or `onnxruntime-web` (browser, WebGPU auto, WASM fallback) | README documents plain text + flatten/line grouping; box output format not described there ([Unverified] - read source before committing) | PP-OCRv6 small = 50+ languages | Default PP-OCRv6 small, det+rec ~5.1M + 19.9M params; models auto-downloaded and cached on first run; sample benchmark on Apple M1 (Bun), receipt: 96.61% char accuracy on 383 chars | https://cdn.jsdelivr.net/npm/ppu-paddle-ocr@6.0.0/README.md , `npm view ppu-paddle-ocr` |
| **RapidOCR** | v3.10.0 (2026-10-08) | Apache-2.0, bundled models also Apache-2.0 per README | Python package running PaddleOCR-derived models on ONNX Runtime / OpenVINO / MNN / TensorRT / PyTorch / Paddle. No JS package confirmed | Yes (det + cls + rec pipeline) [partly Unverified: README does not describe output format] | Chinese + English default; others in model list; v3.10 adds multilingual routing with licensing metadata | Model sizes not stated | https://github.com/RapidAI/RapidOCR , https://api.github.com/repos/RapidAI/RapidOCR/releases/latest |
| **Tesseract** (native) | 5.x stable (since 2021-11-30; exact latest not read) | Apache-2.0 (+ Leptonica BSD-2) | Native binary (child process) | TSV/hOCR/ALTO/PAGE outputs; hOCR/TSV box content not confirmed on README | 100+ languages | LSTM engine (v4+); can output invisible-text-only PDF | https://github.com/tesseract-ocr/tesseract |
| **tesseract.js** | 7.0.0 (npm 2025-12-15) | Apache-2.0 | WASM in Node (>=16) or browser/worker | Yes via `blocks` output (v6+ changed structure) ; hocr/tsv optional | 100+ | v6 fixed memory leak, lower runtime/memory; reuse one worker across images; "does not modify the recognition model", no PDF input | https://github.com/naptha/tesseract.js |
| **EasyOCR** | 1.7.2 (2024-09-24) - stale | Apache-2.0 | PyTorch only (Python sidecar; large) | Yes | 80+ | Sizes not stated | https://github.com/JaidedAI/EasyOCR |
| **docTR** (Mindee) | 1.1.0 (PyPI badge) | Apache-2.0 | PyTorch (Python sidecar); ONNX export not confirmed on README | Yes (word-level) [Inference from library design; README did not state] | Not listed on README | Not stated | https://github.com/mindee/doctr |
| **Surya** (datalab-to) | "Surya 2" (README; no version number) | Code Apache-2.0; **weights: modified AI Pubs Open RAIL-M** - free for research, personal use, and startups under $5M funding/revenue; otherwise paid licence | Python + torch / vLLM / llama.cpp; heavy | Text detection yes (torch) | 91-language internal benchmark: 87.2% overall pass rate | Benchmarks measured on RTX 5090 (5.35 pages/s with vLLM, 128 concurrency); Apple Silicon 0.108 pages/s; olmOCR-bench 83.3 (0.65B) | https://github.com/datalab-to/surya - **FLAG: weights not OSI open source** |
| **Florence-2** (base 0.23B) | HF model card | MIT | transformers.js/ONNX possible [Unverified for Electron perf] | `<OCR_WITH_REGION>` returns quad boxes + text | Mostly English-oriented [Inference - not stated on card] | 0.23B params (base) | https://huggingface.co/microsoft/Florence-2-base |
| **Windows.Media.Ocr** (OS API) | OS component, Windows 10+ | Part of Windows (no redistribution needed) | WinRT only; from Electron needs a native addon or helper exe ([Unverified] which npm bridge to use) | Yes: OcrResult -> Lines -> Words with position/size | Languages = OCR language packs installed on the device (`AvailableRecognizerLanguages`) | `MaxImageDimension` limit exists; no model to ship | https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine |
| **PaddleOCR-VL-0.9B** (newer, VLM) | v1.5 94.5% / v1.6 ">96.3%" OmniDocBench (vendor claim); 111 languages (v1.5) | Part of PaddleOCR repo (Apache-2.0 repo; check the specific weight card) | Needs GPU-class compute for comfort [Inference: 0.9B VLM] | Document parsing/layout | 111 | 0.9B params | https://github.com/PaddlePaddle/PaddleOCR |

Notes:
- No independent head-to-head benchmark of these engines on identical data was found in this session; all accuracy numbers above are vendor/project-reported on different datasets and must not be compared across rows.
- EasyOCR has not had a release since 2024-09 (stale); Surya's weights licence conflicts with a permissive OSS distribution.

## Recommendation

**Primary: PaddleOCR PP-OCRv5 (stable, widely exported) or PP-OCRv6 (newest, Jun 2026) ONNX models run with `onnxruntime-node` in a utilityProcess.**
Reasons:
1. Apache-2.0 code and model cards (PP-OCRv5_server_det card: Apache-2.0).
2. Detector+recogniser pipeline gives per-line polygons - exactly what the "edit text" flow needs (stage A/C in 01-how-it-works.md).
3. Tiny parameter counts (v6: 1.5M / 7.7M / 34.5M) fit a bundled or first-run-downloaded model.
4. ONNX Runtime has Windows DirectML (see 05) so no Python sidecar is required.
5. Implementation choice: use `ppu-paddle-ocr` (MIT) if its box output meets needs after reading its source; otherwise implement det -> crop -> rec directly (DB post-processing + CTC decode are small).
6. PP-OCRv6 is 4 months old at research date [Inference: less field-tested than v5]; ship v5 mobile as default and v6 as selectable until validated on your documents.

**Fallback 1: Windows.Media.Ocr** (zero model download, instant, per-word boxes) for first-run before models are downloaded and for Windows-installed languages. Needs a small native bridge ([Unverified] best npm bridge).
**Fallback 2: tesseract.js 7 (Apache-2.0, WASM)** - cross-platform, 100+ languages, no native deps; slower/lower accuracy on complex scenes [Inference - no sourced benchmark].

**Do not use:** Surya (weights licence), EasyOCR (stale, PyTorch), docTR (PyTorch sidecar, no confirmed ONNX path).
**Watch:** PaddleOCR-VL / VLM OCR for whole-page layout later (heavier; GPU).

## Open items
- Read `ppu-paddle-ocr` source to confirm bounding-box API and DirectML support (README does not mention DirectML).
- Confirm the licence on the exact ONNX files used (README for ppu-paddle-ocr does not state it).
- Benchmark on the product's own test set (receipts, scans, screenshots, Indic scripts) before locking the default.
