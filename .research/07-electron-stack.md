# 07 - Electron application stack

Research date: 2026-10-11. **[Inference]** = my reasoning. **[Unverified]** = not confirmed from a source. Versions from `npm view` on the research date (npm "modified" date shown where relevant).

## Electron versions and support schedule

Support policy: "The latest three stable major versions are supported" (https://www.electronjs.org/docs/latest/tutorial/electron-timelines). Latest GitHub release: v44.7.0 (2026-10-07) (https://api.github.com/repos/electron/electron/releases/latest).

| Version | Stable | End of life | Chromium | Node.js |
|---|---|---|---|---|
| 42 | 2026-05-05 | 2026-10-20 | M148 | 24.15.0 |
| 43 | 2026-06-30 | 2027-01-05 | M150 | 24.17.0 |
| **44** | 2026-08-25 | 2027-03-02 | M152 | 24.18.1 |
| 45 | 2026-10-20 | 2027-04-27 | M156 | 24.21.0 |
| 46 | 2027-01-05 | 2027-06-22 | M160 | 24.21.0 |

Source: https://releases.electronjs.org/schedule (dates are goals and may change). **Recommendation:** start on Electron 44 (stable, EOL 2027-03-02), plan upgrade to 45 shortly after its 2026-10-20 release; Electron 44 depends on `@types/node ^24.9.0`.

## Security checklist (Electron official, https://www.electronjs.org/docs/latest/tutorial/security)

Key items for this app: enable context isolation; enable process sandboxing; define a restrictive CSP; do not enable Node integration for remote content; validate the sender of all IPC messages; disable/limit navigation and new windows; do not use `shell.openExternal` with untrusted content; avoid `file://` in favour of a custom protocol; check/flip fuses; keep Electron up to date; handle session permission requests. Fuses: ASAR integrity needs `EnableEmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar` (Windows since Electron 30; https://www.electronjs.org/docs/latest/tutorial/asar-integrity); `@electron/fuses` 2.1.3 (MIT).

[Inference] Extra for this app: IPC channels must be typed and schema-validated (e.g. Zod); renderer never gets file system or API keys; the CallMissed request is made from the main process; opened PDF/image bytes are treated as untrusted input; ML worker has no network access.

## Build tooling

| Tool | Version | Licence | Notes | Source |
|---|---|---|---|---|
| **electron-vite** | 5.0.0 (npm modified 2026-10-10) | MIT | Single config for main/preload/renderer, HMR, V8 bytecode option, "isolated build" for sandbox; needs Node 20.19+ / 22.12+, Vite 5+ (peer deps list Vite 5-7 + `@swc/core`) | https://electron-vite.org/guide/ |
| Electron Forge | 8.0.1 (2026-09-29) | MIT | Vite plugin `@electron-forge/plugin-vite` 8.0.1; docs say plugin was **experimental as of v7.5.0**, breaking changes possible [status for v8 not re-checked] | https://www.electronforge.io/config/plugins/vite |
| **electron-builder** | 26.15.3 (2026-10-08) | MIT | NSIS installer, GitHub publish, differential updates, Azure signing (`win.sign.type: "azure"`; v27 migration notes mention `azureSignOptions` -> `win.sign`) | https://github.com/electron-userland/electron-builder (docs via context7) |
| electron-updater | 6.8.9 | MIT | `checkForUpdatesAndNotify()`, GitHub provider reads `latest.yml` channel files | same |

**Recommendation:** electron-vite for dev/build + electron-builder for packaging/publishing/updating. [Inference] Rationale: electron-builder + electron-updater is the documented pairing for GitHub Releases + NSIS + differential updates; Forge's Vite plugin was labelled experimental.

## Auto-update via GitHub Releases

| Option | Facts | Fit |
|---|---|---|
| **electron-updater** (electron-builder) | `publish: { provider: github }` generates update metadata; GitHub provider supported; blockmap differential downloads (docs show for AppImage/mac; Windows NSIS differential [Unverified in this session]) | Recommended |
| update-electron-app / update.electronjs.org | Service for apps with a public GitHub repo publishing to GitHub Releases; Windows uses Squirrel.Windows `RELEASES` + `.nupkg`; doc page does not mention a licence requirement | Works with Squirrel/Forge makers, not NSIS |

Sources: https://www.electronjs.org/docs/latest/tutorial/updates ; context7 electron-builder docs above. (electron.build site pages returned 404 in this session.)

## Windows code signing

| Option | Facts | Fit |
|---|---|---|
| **SignPath Foundation (free for OSS)** | Requires OSI-approved licence for all components, no commercial dual-licensing, no proprietary code (system libs allowed), actively maintained, already released, download page describing functionality; SignPath Foundation is the publisher on the certificate; only your own builds from your own source; MFA for all members; every release needs manual approval; "Code signing policy" section on site; verifiable builds from source | Good fit **if** the app is OSI-open (note: do not bundle non-OSI model weights inside the signed installer, e.g. CC-BY-NC or SAM License - [Inference] such components may violate "no proprietary / non-open-source code"). https://signpath.org/terms |
| **Azure Artifact Signing** (formerly Trusted Signing; GA 2026-01-12) | $9.99/month (5,000 signatures, 1 profile) or $99.99/month; individuals only in US/Canada; organisations in US/Canada/EU/UK; electron-builder supports `win.sign: { type: "azure", endpoint, codeSigningAccountName, certificateProfileName }` | Paid but cheap; eligibility depends on owner's country |
| Traditional OV/EV certificate | Not researched in detail | **[Unverified]** |

Sources: https://learn.microsoft.com/azure/artifact-signing/quickstart (via search summary), https://devclass.com/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/ , electron-builder docs via context7.

## API key storage - safeStorage

Main-process only. On Windows uses DPAPI: protects from other users on the machine, **not from other apps in the same user session**. Prefer async API (`encryptStringAsync`); on Linux can fall back to plaintext (`basic_text`). Store ciphertext in userData. https://www.electronjs.org/docs/latest/api/safe-storage

## Local data storage

| Option | Facts | Fit |
|---|---|---|
| **better-sqlite3** | 13.0.3 (2026-08-05), MIT; native module (needs rebuild for Electron ABI + asar unpack) | Mature; native packaging step |
| **node:sqlite** | Added v22.5.0; "Stability 1.2 Release candidate" since v25.7.0; synchronous API; no native build; Electron 44 bundles Node 24.18.1 so availability depends on the 24.x backport status [Unverified for 24.x] | Zero native dependency if present in Electron's Node; verify at runtime |
| Plain files (JSON + image files in userData) | - | Simplest for generation history: one folder per generation (prompt.json + png) [Inference] |

Source: https://nodejs.org/api/sqlite.html . [Inference] Use files for images/models, SQLite for the generation-history index and settings if queries are needed.

## Canvas editor libraries

| Library | Version | Licence | Notes |
|---|---|---|---|
| **Konva** | 10.7.1 | MIT | `react-konva` 19.3.0 (MIT) |
| Fabric.js | **7.4.0** (npm modified 2026-05-18; the brief mentions v6) | MIT | Rich object model, text editing built in |
| PixiJS | 8.22.0 | MIT | WebGL renderer, not an editor framework |
| Excalidraw | `@excalidraw/excalidraw` 0.18.1 | MIT | Whiteboard UX, not image-editing oriented [Inference] |
| **Polotno** | 4.15.3 | **Proprietary: "All rights reserved"; 60-day evaluation, then production use requires a paid subscription (including internal tools); no redistribution/sublicensing** (LICENSE.md read from the npm tarball) | **BLOCK for an open-source app** |

Sources: `npm view`, Polotno tarball `package/LICENSE.md`. **Recommendation:** Konva (+react-konva) for layers/transform handles/hit-testing, own pixel-ops (cut-outs, masks) on OffscreenCanvas; Fabric 7 as the alternative if built-in text editing is preferred [Inference].

## UI, state, tests

| Layer | Choice | Version / licence | Source |
|---|---|---|---|
| UI | React 19 + TypeScript | react 19.3.0, MIT | npm |
| State | Zustand | 5.0.15, MIT | npm |
| Unit tests | Vitest | 5.0.3, MIT | npm |
| E2E | Playwright (`_electron.launch`) | @playwright/test 1.64.0, Apache-2.0; Electron support is **experimental**, supports Electron v21+; do not set `nodeCliInspect` fuse to false | https://playwright.dev/docs/api/class-electron |
| Image codec (main) | sharp | 0.35.5, Apache-2.0 | npm |

## Open items
- Confirm Windows differential-update behaviour for NSIS in electron-updater 6.8.x.
- Check whether Electron 44's Node 24.18.1 ships `node:sqlite` without a flag.
- Decide signing route (SignPath vs Azure) after the owner's country/entity and model-licence decisions.
