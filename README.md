# CallMissed Studio

Open-source (MIT) desktop editor for images and PDFs that understands what is in them. It detects text and objects **locally** so you can retype text, move or remove objects, erase things and strip backgrounds. Then it sends the edited page plus a prompt to the CallMissed image API (your own key) for AI image-to-image generation, with full history.

> Status: under active development toward v1.0. See the [design spec](docs/superpowers/specs/2026-10-11-callmissed-studio-design.md) and the [research notes](.research/00-summary.md).

## Editing PDFs

- **Detect Text on a PDF page** reads the page's own text: exact words, fonts and positions, with no recognition needed. Scanned pages are recognized with OCR instead.
- **Export → PDF** writes every page. Pages you did not change are copied as they are, so their vectors and text stay intact. Your edits are drawn on top as real text, using embedded fonts. You can optionally make scanned pages searchable.
- **Known limitation:** the original text inside a PDF page is not edited in place. Replaced text is erased visually and new text is placed over it. By default, the export writes such edited pages as images ("Remove replaced text"), so the old text is really gone. If you turn that option off, edited pages stay as vectors, but the replaced text remains in the file under the edit, where it can still be selected and searched.

## Development

Requirements: Windows 10/11 x64, Node.js ≥ 22.12.

```sh
npm install
npm run dev        # run the app with hot reload
npm run typecheck
npm run lint
npm test           # unit tests (Vitest)
npm run test:e2e   # builds, then runs Playwright against the Electron app
```

## Architecture (short)

- `src/main`: Electron main process (files, database, secrets, network, model downloads)
- `src/preload`: typed, minimal `window.studio` bridge
- `src/renderer`: React UI, sandboxed, no Node access
- `src/shared`: IPC contracts (zod) and shared types
- `src/ml`: ONNX Runtime worker process (from milestone M2)

## License

MIT. See [LICENSE](LICENSE).
