# 09 - Model verification on real hardware

Date: 2026-10-11. Measured by the app itself (Settings → AI models → Test), Electron 44.7.0, `onnxruntime-node` 1.30.0.
Machine: Windows 11, Intel Iris Xe Graphics (driver 31.0.101.5186), DirectML execution provider.

## Sources (pinned commits, SHA-256 verified by the downloader)

| Pack | Repository @ commit | Licence | Size |
|---|---|---|---|
| Text detection | `PaddlePaddle/PP-OCRv5_mobile_det_onnx` @ e6f4fa85 + `PaddlePaddle/PP-OCRv5_mobile_rec_onnx` @ ed152b8b | Apache-2.0 | 21.5 MB |
| Object selection | `onnx-community/sam2.1-hiera-tiny-ONNX` @ 814a0666 (weights: `facebook/sam2.1-hiera-tiny`, Apache-2.0) | Apache-2.0 [Inference: conversion inherits the weights' licence; repo has no licence tag] | 155.6 MB |
| High-quality eraser | `Carve/LaMa-ONNX` @ c3c0c9e4 (`lama_fp32.onnx`) | Apache-2.0 | 208.0 MB |
| Background removal | `onnx-community/BiRefNet_lite-ONNX` @ de15b22b (`onnx/model.onnx`, fp32) | MIT | 224.0 MB |

Note: the English-only PP-OCRv5 recognizer (`en_PP-OCRv5_mobile_rec`) is published only in Paddle format. The official ONNX recognizer is the multilingual `PP-OCRv5_mobile_rec` (18,385-class output), which also reads English; it is used so no self-converted weights are shipped.

## Results

| Pack | Download (this connection) | First load on DirectML |
|---|---|---|
| Text detection | 7.0 s | 0.73 s |
| Object selection | 54.7 s | 0.82 s |
| Eraser + Background removal | 97.6 s together | 8.25 s / 25.2 s |

Earlier CLI probe (same machine, 640×640 det / 48×320 rec input, one run each): DirectML det 199 ms / rec 73 ms; CPU det 93 ms / rec 11 ms. Small models are not faster on this iGPU on the first run [Inference: DirectML first-run includes shader compilation].

## Implications

- All four packs load on DirectML; the research item "does LaMa/SAM 2 run on DML" is resolved for this hardware (other GPUs remain untested).
- LaMa and BiRefNet first loads are slow on DirectML. M4 should warm these sessions in the background when the tool is first selected and consider ONNX Runtime's `optimizedModelFilePath` cache. Speed must be re-measured on a CPU-only machine.
