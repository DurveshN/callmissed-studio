# 01 - How "edit text in image/PDF" and "magic grab/erase" work end to end

Research date: 2026-10-11. Labels: **[Inference]** = my reasoning, **[Unverified]** = no reliable source found. Vendors do not publish their internal pipelines; the pipeline below is assembled from public vendor help pages plus the academic/open-source literature. Where a vendor step is not documented it is marked.

## 1. What the vendors document (user-visible behaviour only)

| Product / feature | What the vendor says | Source |
|---|---|---|
| Adobe Acrobat "Edit scanned PDFs" | Acrobat runs OCR automatically when a scanned file is opened in edit mode and converts it to an editable copy; by default only the current page is converted; replacement text is designed to look like the original; settings let you choose OCR language, use system fonts, convert all pages at once; a "Recognize text" option switches between image-to-text and text-to-image modes | https://helpx.adobe.com/acrobat/current/edit-scanned-pdfs.html (content read via search result summary; direct fetch returned 403) |
| Canva Magic Grab | Lets you select an object from a photo (click, drag over several objects, or Brush, then Grab) to move/resize/edit it "while keeping its background"; not supported for images in frames/grids | https://www.canva.com/help/using-magic-grab/ |
| Canva Grab Text | Help page could not be fetched (HTTP 403). Internal method: **[Unverified]** | https://www.canva.com/help/grab-text/ |
| Photoshop Generative Fill / Remove | Select the object (any selection method, e.g. Select Subject), leave prompt empty, Photoshop fills with context-appropriate content; 3 variations on a new layer with a mask; generative fill synthesises new pixels rather than sampling elsewhere in the image (unlike Content-Aware Fill); needs internet + Creative Cloud | https://www.adobe.com/uk/learn/photoshop/web/remove-unwanted-objects-generative-fill (via search summary). Adobe's own "Remove tool" help page returned 403, so its internals are **[Unverified]** |

## 2. Reference pipeline: edit text in a raster image or scanned page

```
pixels -> [A] text detection -> [B] recognition -> [C] line/paragraph grouping
       -> [D] style estimation (font, size, colour, rotation)
       -> [E] erase original glyphs (mask + inpaint background)
       -> [F] re-render new text as an editable object
```

| Stage | Technique | Open-source / literature reference | Notes |
|---|---|---|---|
| A. Detection | Segmentation-style detector producing a text probability map, then polygon extraction. DBNet (Differentiable Binarization) is the basis of PaddleOCR's detector family | DBNet paper: https://arxiv.org/abs/1911.08947 (AAAI 2020; ResNet-18 version reports F-measure 82.8 at 62 FPS on MSRA-TD500) | Gives polygon/quad per text region |
| B. Recognition | Cropped text line -> CNN/Transformer + CTC (or attention) decoder | CRNN: https://arxiv.org/abs/1507.05717 [Unverified: not fetched in this session; arXiv id from memory, verify before citing]. PaddleOCR / Tesseract LSTM implement this stage (see 02-ocr-engines.md) | Outputs string + confidence per line (and sometimes per word/char) |
| C. Grouping | Sort boxes into lines, merge lines into paragraphs/blocks by distance + alignment | Engine-native (Windows.Media.Ocr returns Lines -> Words with positions: https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine). PaddleOCR `PP-StructureV3` / PaddleOCR-VL do layout analysis: https://github.com/PaddlePaddle/PaddleOCR | [Inference] Editing UI should operate on line or paragraph objects, not single words, to avoid re-flow artefacts |
| D. Style estimation | Colour: dominant foreground colour inside the glyph mask (k-means / median of mask pixels). Size: line box height -> font size via cap-height/x-height ratio. Angle: from polygon. Font family: classifier | Font recognition research: DeepFont https://arxiv.org/abs/1507.03196 (>80% top-5 on their dataset, Adobe/UIUC); newer DINOv2 LoRA approach https://arxiv.org/pdf/2602.13889; VLMs are weak at fonts https://arxiv.org/pdf/2503.23768. Open code: YuzuMarker.FontDetection (CJK) | [Inference] Practical approach = nearest-match from a bundled/system font list + user override; exact font ID is a research-grade problem |
| E. Erase | Binary mask = dilated glyph pixels (or detection polygon); fill with inpainting. Simple backgrounds: OpenCV Telea/NS; complex: LaMa / MI-GAN (see 04-inpainting.md). Learned scene-text editors (SRNet) combine "text conversion + background inpainting + fusion" modules | SRNet "Editing Text in the Wild": https://arxiv.org/abs/1908.03047 ; SwapText (curved/perspective); TextStyleBrush (StyleGAN2, 512-d style vector): https://arxiv.org/abs/2106.08385 ; survey: https://arxiv.org/pdf/2504.21682 | [Inference] For a desktop app, "mask + LaMa + render vector text" is far cheaper than neural scene-text editors, which are GAN/diffusion models with heavy compute |
| F. Re-render | Draw new string with chosen font/size/colour on a canvas layer (Konva/Fabric) and flatten on export; for PDF, emit as real text object (see 06-pdf-stack.md) | - | Keeps text editable until export |

## 3. Reference pipeline: object magic grab / magic erase

```
click/box/brush prompt -> promptable segmentation model (image embedding once, mask decoder per click)
 -> binary/soft mask -> refine edge (feather / matting)
 -> "cut to layer": RGBA crop = image * mask
 -> inpaint the hole in the base layer (LaMa/MI-GAN or generative fill)
 -> user moves/resizes the cut-out layer
```

| Step | Technique | Source |
|---|---|---|
| Promptable segmentation | Segment Anything: heavy image encoder runs once, light mask decoder runs per prompt (points/box/mask) | SAM paper https://arxiv.org/abs/2304.02643 [Unverified: arXiv id from memory]; SAM 3 repo describes prompts as "points, boxes, and masks" plus text/exemplar concepts: https://github.com/facebookresearch/sam3 |
| Mask -> layer | Pixel multiply / alpha channel | [Inference] standard compositing |
| Hole filling | Large-mask inpainting. LaMa ("Resolution-robust Large Mask Inpainting with Fourier Convolutions", WACV 2022) generalises to ~2K images though trained at 256x256 | https://github.com/advimman/lama , https://arxiv.org/abs/2109.07161 |
| Commercial analogue | Photoshop fills a selection generatively on a new masked layer; Canva Magic Grab keeps the background after lifting the object | Sources in section 1 (Canva's and Adobe's actual fill algorithms: **[Unverified]**) |

## 4. Native PDF vs scanned PDF

| Aspect | Native (born-digital) PDF | Scanned PDF |
|---|---|---|
| Content | Text drawn by content-stream operators using embedded fonts (often subsets) | Page = one raster image per page (often JPEG/JBIG2/CCITT) |
| Text discovery | Parse content stream / use PDF library text extraction (pdf.js, PDFium). No OCR needed | OCR (stages A-C above) |
| Editing | Real text editing requires rewriting content-stream runs and handling subset fonts that lack the needed glyphs. Library reality check in 06-pdf-stack.md: pdf-lib "cannot edit text on a page outside form fields" (https://github.com/Hopding/pdf-lib). Practical pattern = cover/redact old run + draw new text | Erase glyphs in the page raster (stage E), then either keep as image or add vector text above |
| Searchable text | Already present | OCR text added as an **invisible text layer**: text rendering mode 3 ("neither fill nor stroke") so it is selectable/searchable while the scanned image shows through (sandwich layout). Sources: https://leanpub.com/read/pdfkungfoo/make-ocr-visible , https://docs.unidoc.io/unipdf/faq/extracting/add-invisible-text-layer/ , https://www.pdflib.com/pdflib-cookbook/text_output/invisible_text/ . Tesseract itself can emit "invisible-text-only PDF" per https://github.com/tesseract-ocr/tesseract |
| Coordinates | PDF origin is bottom-left; OCR/image origin is top-left, so y must be flipped (noted in the UniDoc FAQ above) | same |

## 5. Implications for this product (all [Inference])
1. One shared "text object" model: {polygon, text, fontFamily, size, colour, angle, source: ocr|native}. Native PDFs fill it from the PDF text API; images/scans fill it from OCR.
2. Edit flow = detect -> user edits string -> build mask from original polygon -> inpaint -> draw new text layer. Same flow for images and scanned PDFs; native PDFs can use redact+overlay.
3. Object flow = SAM-family encoder (once per image, cached) + decoder per click -> cut layer -> LaMa on the hole. Both are fully local.
4. Generative step (CallMissed API) is a separate, optional, online "polish" step; the offline flow must not depend on it.
