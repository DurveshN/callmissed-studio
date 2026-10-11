# CONTEXT

## Project
CallMissed Studio — open-source (MIT) Windows Electron app: local OCR/segmentation/inpainting editing of images and PDFs + CallMissed image-to-image generation. Full design: `docs/superpowers/specs/2026-10-11-callmissed-studio-design.md`. Research: `.research/`.

## Status (2026-10-11)
- Research complete (`.research/00-08`).
- Design approved in brainstorming; spec written, awaiting owner review.
- Next: owner reviews spec → implementation plan for M0 (foundation) → build.

## Decisions log
See spec §1 "Decisions (fixed)". Branding images via CallMissed MCP `gpt-image-2`, cost approved per batch.

## Open items
- Code-signing route (SignPath Foundation vs Azure Artifact Signing) — needed before v1.0.0.
- Verify exact CallMissed field names against raw docs before M6.
