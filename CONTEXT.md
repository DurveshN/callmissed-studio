# CONTEXT

## Project

CallMissed Studio — open-source (MIT) Windows Electron app: local OCR/segmentation/inpainting editing of images and PDFs + CallMissed image-to-image generation. Full design: `docs/superpowers/specs/2026-10-11-callmissed-studio-design.md`. Research: `.research/`.

## Status (2026-10-11)

- Research complete (`.research/00-08`).
- Design spec approved by owner.
- **M0 foundation done** (tag `m0-foundation`): secure Electron shell, typed IPC, tests, CI.
- Next: M1 shell & project files (layout B, open image/PDF, canvas, layers, undo/redo, `.cmsp`, autosave, export, app icon).

## Pinned toolchain (compatibility-constrained)

- Electron 44.7.0, electron-vite 5.0.0 → Vite must stay ≤ 7 (7.3.7), so `@vitejs/plugin-react` 5.2.0 (v6 needs Vite 8).
- TypeScript 6.0.3 — typescript-eslint 8.71 supports `<6.1`; TS 7 not usable yet.
- No `"type": "module"` in package.json: main/preload build as CJS (sandboxed preload requires it). ESLint config is `.mjs`.

## Architecture notes (M0)

- Renderer loads from custom protocol `studio://app` (`src/main/app-protocol.ts`), not `file://`. Dev uses `ELECTRON_RENDERER_URL`.
- `URL.origin` is `"null"` for custom schemes in Node → trusted-sender check compares protocol + host (`src/main/security.ts`).
- IPC: channel list in `src/shared/ipc/channels.ts` (zod-free, keeps preload ~0.5 kB); schemas in `contracts.ts` (`satisfies Record<Channel, Contract>`); handlers via `handle()` in `src/main/ipc/router.ts` return `IpcResult` envelopes; renderer uses `call()` from `src/renderer/src/lib/ipc.ts`.
- CSP injected by a Vite plugin from `src/shared/csp.ts` (dev allows inline script + ws for HMR only).
- ESLint forbids Node/Electron imports in `src/renderer` and `src/shared`.

## Decisions log

See spec §1 "Decisions (fixed)". Branding images via CallMissed MCP `gpt-image-2`, cost approved per batch.

## Open items

- Code-signing route (SignPath Foundation vs Azure Artifact Signing) — needed before v1.0.0.
- Verify exact CallMissed field names against raw docs before M6.
- GitHub repo URL not yet created (no `homepage`/`publish` config until it exists).
