# 04 - Local inpainting (remove text / objects)

Research date: 2026-10-11. **[Inference]** = my reasoning. **[Unverified]** = not confirmed from a source.

## Options

| Option | Type | Size (sourced) | Speed (sourced) | Licence | ONNX | Source |
|---|---|---|---|---|---|---|
| **LaMa / big-lama** | Fourier-conv GAN-style large-mask inpainter (WACV 2022) | `lama_fp32.onnx` 208 MB, `lama.onnx` 207 MB (per search summary of Carve listing; model card itself shows no size) | No latency figure found in any fetched source. Fixed 512x512 ONNX | **Apache-2.0** (repo LICENSE read directly); Places2 training data CC-BY 4.0 (attribution) | Yes. `Carve/LaMa-ONNX` (Apache-2.0): fixed 512x512, `lama_fp32.onnx` recommended (opset 17), `lama.onnx` opset 18 "not recommended" (slow). Dynamic shape possible via the author's notebook but needs `ffc.py` fixes. Alt port `sapienkit/LaMa-ONNX` (Apache-2.0, I/O: image float32 [1,3,512,512] /255, mask [1,1,512,512] 1=erase, output 0-255 RGB, SHA-256 on page) | https://github.com/advimman/lama , https://raw.githubusercontent.com/advimman/lama/main/LICENSE , https://huggingface.co/Carve/LaMa-ONNX , https://huggingface.co/sapienkit/LaMa-ONNX |
| LaMa quantised (OpenCV Zoo) | QDQ INT8 fixed-512 | 92,591,623 bytes | - | per OpenCV Zoo [Unverified] | opset-21 graph; reported not runnable by OpenCV 4.x, needs ORT >= 1.18 | search result summarising LibreLaMa listing: https://huggingface.co/LibreYOLO/LibreLaMab-restore |
| **MI-GAN** (Picsart, ICCV 2023) | Small, fast mobile-oriented inpainter, "one order of magnitude smaller and faster than recent SOTA approaches" (paper claim per README) | LiteRT fp16 conversion 16.3 MB (different format); MLX fp16: 7.37M params. Upstream ONNX size not found | Pixel 8a ~6 ms @512 for the LiteRT conversion (HF listing, not ONNX) | Code **MIT**; `LICENSE-WEIGHTS` file also reads MIT (copyright Picsart AI Research 2024). Training datasets (Places2/FFHQ) have own terms [Unverified] | Yes: `scripts/create_onnx_pipeline.py`; prebuilt `migan_pipeline_v2.onnx` (MI-GAN-512-Places2) takes uint8 RGB image + uint8 mask (255 = known) and includes pre/post-processing; supports arbitrary input resolutions in the pipeline, though README warns fixed-resolution ops in inference code | https://github.com/Picsart-AI-Research/MI-GAN , https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS , https://huggingface.co/litert-community/MI-GAN-512-Places2-LiteRT |
| **OpenCV `inpaint` Telea / Navier-Stokes** | Classical diffusion/fast-marching, no model | 0 MB model; `@techstark/opencv-js` 5.0.0-release.1 (Apache-2.0) on npm; OpenCV itself Apache-2.0 | Fast, but only suitable for thin/small masks and simple backgrounds [Inference] | Apache-2.0 | n/a | https://github.com/opencv/opencv/blob/4.x/LICENSE ; docs page (https://docs.opencv.org/4.x/df/d3d/tutorial_py_inpainting.html) returned 403, so algorithm details are **[Unverified]** from this session |
| IOPaint (formerly lama-cleaner) | App wrapping LaMa + diffusion inpainters (SD inpainting, BrushNet, PowerPaintV2, AnyText, Paint-by-Example) | - | - | Apache-2.0; **archived 2025-08-13** (read-only) | via Python | https://github.com/Sanster/IOPaint |
| Cloud generative fill (CallMissed `gpt-image-2.5-sunburst` "inpainting", reference-image editing) | Online | - | - | Pay-per-image | n/a | see 08-callmissed-image-api.md. Mask-parameter support is **not documented** |

## Recommendation

1. **Default: LaMa fp32 ONNX (Apache-2.0)** run through `onnxruntime-node` (DirectML optional), using a crop-and-paste strategy: take a padded crop around the mask (e.g. mask bbox + context), resize to 512x512, inpaint, resize back, and blend only inside the mask. [Inference - standard approach for fixed-size models; not a sourced benchmark]. This delivers quality for removing text on photos/textured backgrounds and larger objects. 208 MB download is acceptable as an on-demand model.
2. **Fast path / low-spec: MI-GAN 512 pipeline ONNX (MIT code and weights file)** - smaller; try first on small text masks. Verify file size and quality on real scans before shipping [Unverified].
3. **Instant path: OpenCV Telea** (opencv-js WASM, no download) for flat-colour backgrounds (typical scanned documents) and for live preview while the AI model runs [Inference].
4. For text on solid backgrounds, a cheaper heuristic is median-colour fill of the mask [Inference]; fall back to LaMa when background variance is high.
5. Offer "Generate" (cloud) only as the optional step in the prompt panel.

## Open items
- Benchmark LaMa fp32 vs MI-GAN on target CPUs and with DirectML (no sourced latency available).
- Confirm download sizes (`migan_pipeline_v2.onnx`) and Places2/FFHQ-derived weight terms for MI-GAN.
- Check that DirectML EP supports all LaMa ops (FFT-based layers) - [Unverified]; DirectML EP supports up to ONNX opset 20 per https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html, and LaMa-ONNX recommended file is opset 17.
