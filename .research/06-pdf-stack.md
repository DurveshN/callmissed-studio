# 06 - PDF stack: render, edit, save

Research date: 2026-10-11. **[Inference]** = my reasoning. **[Unverified]** = not confirmed from a source. Versions from `npm view` on the research date.

## Libraries

| Library | Version (npm) | Licence | Renders | Edits | Notes / source |
|---|---|---|---|---|---|
| **pdfjs-dist** (Mozilla pdf.js) | 6.4.299 (2026-10-03) | Apache-2.0 | Yes (canvas + text layer) | Viewer-side annotation editors; no content-stream text rewriting [Unverified - repo README fetch did not list editor features] | https://github.com/mozilla/pdf.js |
| **pdf-lib** | 1.17.1 (last publish **2022-05-12**) | MIT | No | Create/modify PDFs, embed PNG/JPEG, embed fonts via `@pdf-lib/fontkit` (1.1.1), font subsetting via `subset` option ("doesn't work for all fonts"), forms, copy pages. **Cannot edit text outside form fields; cannot extract page text; no encrypted docs** | https://github.com/Hopding/pdf-lib [maintenance: no release since 2022 per npm] |
| @cantoo/pdf-lib (fork) | 2.11.1 (2026-09-15) | MIT | No | Maintained fork of pdf-lib; adds features such as encryption [Unverified which] | https://www.npmjs.com/package/@cantoo/pdf-lib |
| **PDFium WASM**: `@embedpdf/pdfium` | 2.15.1 (2026-09-16) | MIT (package); PDFium itself BSD-3-Clause + Apache-2.0 | Yes | EmbedPDF viewer lists annotations (highlight, free text, ink), **true redaction (content removed)**; its v3 "under active development, not recommended for production"; the engine is a PDFium fork | https://github.com/embedpdf/embed-pdf-viewer ; PDFium licence https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE |
| `@hyzyla/pdfium` | 3.0.0 (2026-10-10) | MIT | Yes: bitmap render at scale, password PDFs, zero deps, Node >= 22 | **No editing documented** | https://github.com/hyzyla/pdfium |
| **PDFium C API** (via custom WASM build) | - | BSD-3 + Apache-2.0 | Yes | `fpdf_edit.h` exposes: `FPDFPageObj_NewTextObj`, `FPDFText_SetText` (UTF-16LE, replaces text), `FPDFText_LoadFont`, `FPDFPageObj_CreateTextObj`, `FPDFTextObj_SetTextRenderMode` (experimental), `FPDFPage_RemoveObject` (experimental), `FPDFPage_GenerateContent` (required before save) | https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_edit.h . Whether `@embedpdf/pdfium` exports these functions: [Unverified] |
| **MuPDF.js** (`mupdf`) | 1.28.1 (2026-09-06) | **AGPL-3.0-or-later** (npm metadata); or Artifex commercial licence | Yes | Editing, redaction, adding text, saving (docs) | https://mupdfjs.readthedocs.io/en/latest/ - **BLOCK for MIT/Apache distribution** |
| **qpdf** | docs for 12.4.2 | Apache-2.0 / Artistic [Unverified from docs fetch; licence page not read] | No | Structural transforms: linearise, repair, merge/split; no content editing | https://qpdf.readthedocs.io/en/stable/ ; npm WASM ports `qpdf-wasm` 0.1.0, `@jspawn/qpdf-wasm` 0.0.2 (Apache-2.0) are low-maturity [Inference] |
| pdfkit | 0.20.2 | MIT | No | Generate new PDFs | npm |

## Can we edit existing text runs in native PDFs?

| Approach | Feasibility | Evidence |
|---|---|---|
| True in-place run editing (rewrite Tj/TJ operators, keep original font) | Hard: fonts are usually embedded subsets lacking new glyphs; no JS library in the permissive set exposes it | pdf-lib states it cannot edit page text (above). PDFium has `FPDFText_SetText` on text objects [header], but font subset limits [Inference] |
| **Redact/cover + overlay new text (recommended)** | Feasible with permissive libs: remove or paint over the old run, draw new text with an embedded font | Adobe's own scanned-PDF flow replaces text with look-alike fonts and offers "use system fonts" (https://helpx.adobe.com/acrobat/current/edit-scanned-pdfs.html via search summary) |
| Raster-erase (scanned PDFs) | Erase glyphs in page image with inpainting (04), re-embed the image, add new text above | See 01 |

[Inference] Implement a "PageEditModel" in app code (list of overlays + erasures) and flush to PDF on save with pdf-lib-fork, rather than relying on library-level text editing.

## Embedding an OCR invisible text layer

- Text rendering mode 3 = neither fill nor stroke: text is searchable/selectable, scan visible (sandwich PDF). Sources: https://leanpub.com/read/pdfkungfoo/make-ocr-visible , https://www.pdflib.com/pdflib-cookbook/text_output/invisible_text/ , https://docs.unidoc.io/unipdf/faq/extracting/add-invisible-text-layer/
- Coordinates: PDF y-axis is bottom-up; flip OCR y (UniDoc FAQ above).
- Implementation paths [Inference]:
  1. pdf-lib/@cantoo/pdf-lib: write raw operators (`BT /F1 n Tf 3 Tr x y Td (...) Tj ET`) via low-level operator API [Unverified that the API exposes this in a stable way - confirm in source], embedding a font with `fontkit` so Unicode (Indic/CJK) text maps correctly.
  2. PDFium: `FPDFPageObj_CreateTextObj` + `FPDFTextObj_SetTextRenderMode(…, FPDF_TEXTRENDERMODE_INVISIBLE)` [mode constant name not confirmed], then `FPDFPage_GenerateContent`.
  3. Tesseract can output "invisible-text-only PDF" itself (https://github.com/tesseract-ocr/tesseract) - usable fallback.
- Fit text width to OCR word box using horizontal scaling (`Tz`) so selection highlights align [Inference].

## Fonts and subsetting

- pdf-lib: custom fonts need `@pdf-lib/fontkit`; `subset` option available but unreliable for some fonts; the 14 standard fonts only support WinAnsi (Latin) so non-Latin needs an embedded font (https://github.com/Hopding/pdf-lib).
- Ship a permissive default font set (e.g. Noto family, SIL OFL) [Inference; licence not verified in this session] covering Latin/Devanagari/CJK on demand.
- Native PDF editing: embedded subset fonts cannot render new characters - always substitute a full font for edited runs.

## Recommendation

| Layer | Choice | Why |
|---|---|---|
| Rendering / viewer | **pdfjs-dist 6.x** (Apache-2.0) | Mature, text layer for selection/search, runs in renderer |
| Save / modify | **@cantoo/pdf-lib** (MIT, maintained) + `@pdf-lib/fontkit`; original `pdf-lib` last released 2022 | Permissive; overlays, image replacement, invisible text |
| High-fidelity raster render (optional) | PDFium WASM (`@embedpdf/pdfium` or `@hyzyla/pdfium`, MIT) | Faster/more faithful rendering for thumbnails and rasterising scans |
| Repair/optimise | qpdf CLI binary (Apache-2.0 [verify]) bundled as extraResource, optional | Structural only |
| **Do not use** | MuPDF.js (AGPL-3.0) | Would force AGPL on the app unless commercial licence from Artifex |

## Open items
- Verify which of the PDFium edit APIs are exported by `@embedpdf/pdfium` 2.15.
- Verify @cantoo/pdf-lib exposes low-level operators for `Tr 3` and check its changelog/maintainer.
- Decide scope: native-PDF text edit = "replace by overlay" (recommended) vs. true content-stream editing (out of reach with permissive JS libs [Inference]).
