# 05 - Running the ML models inside Electron (Windows-first)

Research date: 2026-10-11. **[Inference]** = my reasoning. **[Unverified]** = not confirmed from a source.

## Current versions (npm registry / GitHub API, queried 2026-10-11)

| Package | Version | Licence | Notes |
|---|---|---|---|
| onnxruntime-node | 1.30.0 (npm `latest`; `dev` tag 1.31.0-dev) | MIT | npm unpacked size 301,068,136 bytes (all platforms' binaries) |
| onnxruntime-web | 1.30.0 | MIT | npm unpacked size 144,618,540 bytes |
| ONNX Runtime GitHub release | v1.31.0 (2026-10-09) | MIT | npm had not yet published 1.31.0 as `latest` at query time |
| @huggingface/transformers | 4.3.1 (2026-10-06) | Apache-2.0 | v4 released 2026-03-30 |
| @techstark/opencv-js | 5.0.0-release.1 | Apache-2.0 | 14.7 MB unpacked |
| sharp | 0.35.5 | Apache-2.0 | native image codec for main process |

Sources: `npm view <pkg>`; https://api.github.com/repos/microsoft/onnxruntime/releases/latest ; https://api.github.com/repos/huggingface/transformers.js/releases/latest

## Runtime options

| Option | What the docs say | Pros / cons [Inference unless cited] |
|---|---|---|
| **onnxruntime-node** (main process or utilityProcess) | Prebuilt binaries: CPU on Windows x64/arm64, Linux, macOS; **DirectML on Windows x64/arm64 only**; CUDA Linux x64 only (CUDA 11.8) - https://onnxruntime.ai/docs/get-started/with-javascript/node.html | Best CPU speed and native threads; DirectML GPU on Windows; native addon so needs asar-unpack; large install size |
| **onnxruntime-web** WASM (renderer / worker) | Multithreading only when `crossOriginIsolated`; `env.wasm.proxy` needs a Blob Worker and does not work in CSP-restricted environments and cannot be used with WebGPU EP - https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html | No native modules; slower than native CPU; cross-origin isolation headers need a custom protocol in Electron |
| **onnxruntime-web WebGPU** | Import `onnxruntime-web/webgpu`, `executionProviders: ['webgpu']`; available by default in latest Chrome and Edge on Windows - https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html | Uses Electron's Chromium (M152 in Electron 44, per release schedule); no DirectML install; operator coverage not stated on that page [Unverified] |
| **WebNN EP** | Behind "Enables WebNN API" flag in Chrome/Edge; unsupported ops fall back to WASM; needs `onnxruntime-web/all` build - https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html | Still flagged; skip for v1 |
| **transformers.js v4** | WebGPU runtime rewritten in C++ with the ONNX Runtime team; runs WebGPU-accelerated models in Node/Bun/Deno and desktop apps; dtype options fp32/fp16/q8/q4 - https://github.com/huggingface/transformers.js/releases/tag/4.0.0 , https://huggingface.co/docs/transformers.js/index | Fast to prototype (SAM-family `SamModel`, BiRefNet_lite, Florence-2, OWLv2/zero-shot detection); docs list `mask-generation` pipeline as unsupported; PP-OCR and LaMa are not in its task list so need raw ORT |
| **Python sidecar** (PyInstaller/embedded) | n/a | Access to PyTorch-only models (EasyOCR, docTR, Surya); adds 100s of MB, antivirus friction, process management. [Inference] Avoid unless a required model has no ONNX path |
| **Windows ML / DirectML** | DirectML EP is in **sustained engineering** (no new features); Microsoft recommends WinML for new Windows deployments; DirectML needs DX12 GPU, Windows 10 1903+, memory-pattern optimisations disabled, `ORT_SEQUENTIAL` execution, one thread calling `Run` per session, up to opset 20 - https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html . Windows ML: system-wide ONNX Runtime copy, EPs delivered via Windows Update, CPU/GPU(DirectML) on all supported Windows, vendor-optimised EPs need Windows 11 24H2 (build 26100)+; API languages listed there are C#/C++ style, JS binding not stated - https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/overview | [Inference] For an Electron/Node app, `onnxruntime-node` DirectML is the only documented JS path today; revisit WinML if a Node binding appears ([Unverified] whether one exists) |

## Process / threading architecture

| Mechanism | Facts | Use |
|---|---|---|
| `utilityProcess` | Launches a Node-enabled child via Chromium Services API, MessagePort communication (`process.parentPort`), configurable stdio, only after `app.ready` - https://www.electronjs.org/docs/latest/api/utility-process | One ML worker process hosts all ORT sessions so crashes/OOM do not take down the UI; main <-> worker via MessagePort, renderer <-> worker via transferred port |
| worker_threads | Node standard | Per-model parallelism inside the worker process [Inference] |
| DirectML session rule | One thread may call `Run` on a session at a time; different sessions can run on different threads (source above) | Serialize calls per session; use a queue |

## Packaging (electron-builder)

- Native `.node` files cannot load from inside ASAR; unpack them: `asar.unpack: ["**/*.node", ...]` (electron-builder troubleshooting docs via context7: https://github.com/electron-userland/electron-builder/blob/master/website/docs/troubleshooting.md).
- `extraResources` copies files outside the ASAR to `resources\`, read at runtime from `process.resourcesPath` (https://github.com/electron-userland/electron-builder/blob/master/website/docs/contents.md).
- onnxruntime-node ships binaries for all OSes in one 301 MB package [npm metadata]. [Inference] Exclude non-win32 binaries with `files` filters or install with the target platform only, otherwise the installer is bloated. Verify by inspecting `node_modules/onnxruntime-node/bin/napi-v*`.
- Electron Forge Vite plugin docs recommend listing native modules under `rollupOptions.external` (https://www.electronforge.io/config/plugins/vite).
- Enable ASAR integrity fuses (`EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`; Windows support since Electron 30) per https://www.electronjs.org/docs/latest/tutorial/asar-integrity .

## Model delivery

| Strategy | Pros | Cons |
|---|---|---|
| Bundle all models in the installer | Fully offline from first launch | Installer grows by hundreds of MB (LaMa fp32 alone is ~208 MB per the Carve listing; see 04) ; GitHub release asset limits [Unverified] |
| **Bundle a small "core" (OCR det/rec + OpenCV path) and download others on first use** (recommended) | Small installer, offline after download | Needs download UI, resume, integrity checking |
| Hugging Face on-demand via transformers.js cache | Zero code for download | Network dependency, cache location control |

Integrity [Inference]: ship a signed `models.json` manifest (name, URL, bytes, SHA-256, licence, version) inside the app; download to `app.getPath('userData')/models`, verify SHA-256 before use, write atomically. Example of hash publication: the sapienkit LaMa-ONNX card lists a SHA-256 for `lama_fp32.onnx` (https://huggingface.co/sapienkit/LaMa-ONNX). transformers.js (and ppu-paddle-ocr) auto-download and cache on first run (ppu-paddle-ocr caches in `~/.cache/ppu-paddle-ocr`, README) - disable or redirect to the manifest flow for hash control.

## Recommended architecture

```
Renderer (React, sandboxed, contextIsolation)  --typed IPC-->  Main (windows, files, safeStorage, updater, model manager)
                                                                    | MessagePort
                                                                    v
                                                    utilityProcess "ml-worker"
                                                    onnxruntime-node (CPU default, DirectML opt-in)
                                                    OCR (PP-OCR), SAM encoder/decoder, LaMa, BiRefNet_lite
```

1. All inference in `utilityProcess` with `onnxruntime-node`; execution provider order `['dml','cpu']` with fallback to CPU if DirectML session creation fails (DirectML needs sequential mode, no memory pattern).
2. Cache SAM image embeddings per image in the worker; decoder per click.
3. Use onnxruntime-web WebGPU only as an experiment path; transformers.js for quick-win models (BiRefNet_lite, Florence-2) if raw ORT wiring is too slow to build.
4. Models downloaded on first use with SHA-256 verification; OCR core model bundled.
5. Benchmark on integrated-graphics and CPU-only machines before enabling DirectML by default [Inference: GPU drivers vary].

## Open items
- Whether the npm `onnxruntime-node` win32 package currently includes DirectML for 1.30.0 (npm search result for 1.24.3 listed WebGPU + DML on Windows; official docs list DML only) - confirm by inspecting the tarball.
- Whether LaMa/SAM2 graphs run on the DirectML EP (opset limits) - run a smoke test.
- Electron 44 + onnxruntime-node ABI: ORT uses N-API (`napi-v*` folders) [Inference from folder naming; not read].
