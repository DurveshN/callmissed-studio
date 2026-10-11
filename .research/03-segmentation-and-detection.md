# 03 - Segmentation, detection and background removal (local)

Research date: 2026-10-11. **[Inference]** = my reasoning. **[Unverified]** = not confirmed from a source. Licence flags: **OK** = permissive (MIT/Apache/BSD); **CAUTION** = custom or restrictive; **BLOCK** = AGPL/GPL/non-commercial for an MIT/Apache app.

## A. Promptable segmentation (click / box -> mask)

| Model | Params / size (sourced) | Licence | ONNX availability | Flag | Source |
|---|---|---|---|---|---|
| SAM (v1, ViT-H/L/B) | encoder ~611-632M (README is inconsistent), full pipeline 615M | Apache-2.0 | ONNX decoder export is the official path; encoder export is community | OK | https://github.com/facebookresearch/segment-anything (licence file), https://github.com/ChaoningZhang/MobileSAM (encoder figures) |
| **MobileSAM** | encoder 5M, decoder 3.876M, whole 9.66M; ~12 ms/image on a single GPU (8 ms enc + 4 ms dec) vs original SAM encoder 452 ms | Apache-2.0 | Yes: `scripts/export_onnx_model.py`, tested with onnx 1.12.0 / onnxruntime 1.13.1 | OK | https://github.com/ChaoningZhang/MobileSAM |
| **EfficientSAM** (Ti / S) | sizes not given on README | Apache-2.0 | Yes: `export_to_onnx.py`; ONNX with separate encoder/decoder on HF Space (Jan 2024) | OK | https://github.com/yformer/EfficientSAM |
| EdgeSAM | 9.6M params, 22.1 GFLOPs @1024; claims 40x faster than SAM; 38.7 FPS iPhone 14; 164.3 FPS on 2080 Ti | **NTU S-Lab License 1.0** (terms not read) | Yes: pre-exported ONNX encoder/decoder + CoreML | **CAUTION** (read licence text before use) | https://github.com/chongzhou96/EdgeSAM |
| SlimSAM (Xenova/slimsam-77-uniform) | size not on card | Apache-2.0 | ONNX weights with 2 quantised variants; works with transformers.js `SamModel` + `AutoProcessor` | OK | https://huggingface.co/Xenova/slimsam-77-uniform |
| **SAM 2 / 2.1** (Hiera) | 2.1 tiny 38.9M / small 46M / base+ 80.8M / large 224.4M ("Size (M)", unit undefined on page); FPS on A100: 91.2 / 84.8 / 64.1 / 39.5 | Apache-2.0 (checkpoints + code) | Community exports: `onnx-community/sam2.1-hiera-tiny-ONNX` (HF page has no model card/licence text); `ibaiGorordo/ONNX-SAM2-Segment-Anything` (MIT code, 1024x1024 only, image only, "still in development") | OK for weights (Apache); community ONNX exports [Unverified] licence inheritance | https://github.com/facebookresearch/sam2 , https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX , https://github.com/ibaiGorordo/ONNX-SAM2-Segment-Anything |
| **SAM 3 / 3.1** | 848M params; open-vocabulary text/exemplar prompts + points/boxes/masks; SAM 3.1 released 2026-03-27 | **"SAM License"** (updated 2025-11-19): royalty-free, worldwide, non-exclusive, non-transferable *limited* licence; use/modify/distribute allowed; bans ITAR/military/warfare/nuclear/espionage end uses; no reverse-engineering; licence travels with redistributed copies; licence terminates if you sue Meta over IP; indemnity to Meta. Not described as OSI open source | No ONNX mentioned in README; [Unverified] community exports | **CAUTION** (not Apache/MIT; field-of-use restrictions; also 848M is large) | https://github.com/facebookresearch/sam3 , https://raw.githubusercontent.com/facebookresearch/sam3/main/LICENSE |
| transformers.js `mask-generation` pipeline | Docs list `mask-generation` among *unsupported* tasks; SAM works through lower-level `SamModel` per the SlimSAM card | Apache-2.0 | n/a | OK | https://huggingface.co/docs/transformers.js/index |

## B. Open-vocabulary detection ("find the 'cup'", text-prompted selection)

| Model | Size | Licence | ONNX / runtime notes | Flag | Source |
|---|---|---|---|---|---|
| **Grounding DINO tiny** (IDEA-Research, HF) | ~0.2B params | Apache-2.0 | Safetensors on card; ONNX via export [Unverified] | OK | https://huggingface.co/IDEA-Research/grounding-dino-tiny |
| **OWLv2 base** (Google) | 0.2B params, F32 | Apache-2.0 | Card does not mention ONNX; transformers.js lists `zero-shot-object-detection` task | OK | https://huggingface.co/google/owlv2-base-patch16-ensemble , https://huggingface.co/docs/transformers.js/index |
| **YOLO-World** | n/a | **GPL-3.0** ("supported for commercial usage" per README; commercial licence on request: yixiaoge@tencent.com). Latest update on README 2025-02-08 | ONNX export documented | **BLOCK for MIT/Apache distribution** (GPL-3 copyleft) | https://github.com/AILab-CVC/YOLO-World |
| **Ultralytics YOLO (v8/11 etc.)** | - | **AGPL-3.0** | ONNX export built in | **BLOCK** (network-copyleft; also applies to weights trained with it per Ultralytics' terms [Unverified - not read]) | https://github.com/ultralytics/ultralytics/blob/main/LICENSE |
| **RF-DETR** (Roboflow) | Nano..2XL; T4/TensorRT/FP16 latency: det Nano 2.3 ms, Small 3.5, Medium 4.4, Large 6.8, 2XL 17.2; seg Nano 3.4 ms, Medium 5.9, 2XL 21.8 (COCO seg AP50:95 40.3 to 49.9) | Package + "Apache-designated" weights Apache-2.0; **XL, 2XL, Atto/Femto/Pico and `rfdetr_plus` under PML 1.0** (Roboflow Platform Model License - terms not read) | ONNX export not mentioned on README | OK for Apache-designated sizes; **CAUTION** for PML ones | https://github.com/roboflow/rf-detr |
| RT-DETR (Baidu, original) | - | [Unverified - not fetched in this session] | - | - | - |
| Florence-2 (base 0.23B) | MIT | has `<OCR_WITH_REGION>`; detection/grounding tasks exist [Unverified on this card] | OK | https://huggingface.co/microsoft/Florence-2-base |

## C. Background removal / salient object matting

| Model | Params / size | Licence | ONNX | Flag | Source |
|---|---|---|---|---|---|
| **BiRefNet** (general, lite, HR, dynamic, matting) | memory 4.8 GB FP32 / 3.5 GB FP16 for standard model (README); params not listed | **MIT** | ONNX for all weights on GitHub releases (Aug 2024); ONNX ~90% slower for SwinL (~165 ms A100) and ~75% for SwinT (~93.8 ms) at 1024x1024 per README; a third-party RTX 4080S comparison reports 4.43 s ONNX vs 0.15 s PyTorch (README); `onnx-community/BiRefNet_lite-ONNX` (MIT) loads with transformers.js | OK | https://github.com/ZhengPeng7/BiRefNet , https://huggingface.co/onnx-community/BiRefNet_lite-ONNX |
| U2-Net / U2-Netp / silueta (via rembg) | silueta ~43 MB | Apache-2.0 (U-2-Net repo) | rembg ships ONNX | OK | https://raw.githubusercontent.com/xuebinqin/U-2-Net/master/LICENSE , https://github.com/danielgatis/rembg |
| IS-Net / DIS (`isnet-general-use`) | - | Code Apache-2.0; DIS5K dataset has separate terms; **weights licence not stated** | rembg ships ONNX | **CAUTION** (weights terms [Unverified]) | https://github.com/xuebinqin/DIS |
| **RMBG-1.4** (Bria) | 44.1M params | CC BY-NC / "bria-rmbg-1.4": non-commercial, commercial needs agreement | ONNX tag | **BLOCK** | https://huggingface.co/briaai/RMBG-1.4 |
| **RMBG-2.0** (Bria) | ~0.2B params | **CC BY-NC 4.0**; commercial use "subject to a commercial agreement with BRIA" | ONNX tag; 5 quantised variants | **BLOCK** | https://huggingface.co/briaai/RMBG-2.0 |
| rembg (wrapper) | `bria-rmbg` default is ~1.02 GB | rembg MIT, but "weights carry their own licenses"; default `bria-rmbg` needs paid agreement for commercial use | - | wrapper OK, **default model BLOCK** | https://github.com/danielgatis/rembg |

## Recommended set

| Need | Pick | Why |
|---|---|---|
| Click/box/brush object select | **SAM 2.1 Tiny/Small ONNX** (Apache-2.0) as default; **MobileSAM or SlimSAM** (Apache-2.0, much smaller) as "lite" option | Same two-stage design (encoder once, decoder per click); Apache-2.0 weights. SAM 2.1 hiera-tiny is 38.9M "Size (M)" and 91.2 FPS on A100 per Meta; MobileSAM is 9.66M. [Inference] Ship one small model first and benchmark on target Windows CPUs/iGPUs before adding more |
| Text-prompted "select the dog" (optional) | **Grounding DINO tiny** or **OWLv2 base** boxes -> SAM box prompt | Apache-2.0; ~0.2B params each. Mark as optional download |
| Auto background removal | **BiRefNet_lite** (MIT) | Only high-quality permissive option verified; lite variant for CPU |
| Fast / tiny fallback matting | U2-Netp / silueta (Apache-2.0) | Small ONNX files |
| Avoid | Ultralytics YOLO (AGPL), YOLO-World (GPL-3), RMBG-1.4/2.0 (non-commercial), EdgeSAM until licence read, SAM 3 unless field-of-use clause acceptable |

## Open items
- Measure actual ONNX file sizes and Windows CPU/DirectML latency for SAM 2.1 tiny/small encoder+decoder (not in any fetched source).
- Verify the licence of `onnx-community` SAM 2.1 exports and the `isnet-general-use` weights.
- SAM 3: decide whether the "SAM License" (non-OSI, field-of-use) is acceptable for an MIT/Apache project; at 848M params it is heavy for CPU [Inference].
