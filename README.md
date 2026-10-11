# CallMissed Studio

Open-source (MIT) desktop editor for images and PDFs that understands what is in them. It detects text and objects **locally** so you can retype text, move or remove objects, erase things and strip backgrounds. Then it sends the edited page plus a prompt to the CallMissed image API (your own key) for AI image-to-image generation, with full history.

> Status: under active development toward v1.0. See the [design spec](docs/superpowers/specs/2026-10-11-callmissed-studio-design.md) and the [research notes](.research/00-summary.md).

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
