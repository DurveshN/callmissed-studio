# 08 - CallMissed image generation API

Research date: 2026-10-11. **[Inference]** = my reasoning. **[Unverified]** = not confirmed.

## What I tried (and what worked)

| Attempt | Result |
|---|---|
| `https://docs.callmissed.com`, `https://callmissed.com`, `https://callmissed.com/docs` | HTTP 500 via WebFetch |
| `https://api.callmissed.com/v1/models` | HTTP 401 (requires key; no unauthenticated probing beyond this) |
| curl from the shell to callmissed hosts | failed (no network from that shell) |
| Web search "callmissed API image generation endpoint documentation" | No callmissed results |
| **`https://docs.callmissed.com/llms.txt`** | **Worked** - docs index; says any page is available as markdown by appending `.md`, and full docs at `docs.callmissed.com/llms-full.txt` |
| `https://docs.callmissed.com/docs/image-generation.md`, `/docs/rate-limits.md`, `/docs/authentication.md`, `/docs/pricing.md` | **Worked** (summarised by the fetch tool; request/response tables not reproduced verbatim) |
| `list_models` (CallMissed MCP tool, category image; free read-only call) | Worked - returned model catalogue with prices; used to cross-check docs |

Primary sources: https://docs.callmissed.com/docs/image-generation , https://docs.callmissed.com/docs/authentication , https://docs.callmissed.com/docs/rate-limits , https://docs.callmissed.com/docs/pricing , https://docs.callmissed.com/docs/errors (not read), https://docs.callmissed.com/docs/credits-rate-limits (not read), https://docs.callmissed.com/docs/idempotency (not read). The `/docs/*` pages are summaries produced by the fetch tool, so quote exact field names from the raw `.md` before coding.

## Connection

| Item | Value | Source |
|---|---|---|
| Base URL | `https://api.callmissed.com/v1` (OpenAI-compatible; point any OpenAI SDK at it) | docs index (llms.txt) and image-generation page. The authentication page itself does not state the host |
| Auth | `Authorization: Bearer cm_...` (key prefix `cm_`) | authentication page |
| Key permissions | `llm, stt, tts, search, image, email, *`; image endpoints require `image` permission else `403 permission_denied`. Keys can also restrict `allowed_models`. No image "scope" exists | authentication + image-generation pages |

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /v1/images/generations` | Text-to-image **and** reference-image editing (see `reference_images`) |
| `GET /v1/images/history` | Past generations, newest first; `limit` 1-100 (default 20), `before` ISO-8601 cursor from `next_cursor` (null on last page); each item has ID, signed URL, model, size, prompt, negative prompt, revised prompt, seed, steps, creation time; needs `image` permission |
| `/v1/images/edits` | A third-party listing (https://www.callmissed.com/models/gpt-image-2-5-sunburst, seen only in a search summary) says reference images drive an edits surface; the official image-generation page summary lists only `generations` and `history`. **[Unverified]** |

## Request parameters (`POST /v1/images/generations`)

| Param | Details |
|---|---|
| `model` | Default `flux-2-klein-9b` |
| `prompt` | Required, 1-4000 chars |
| `n` | 1-4, billed per image |
| `size` | `WxH`, 64-4096 per side; per-model limits (e.g. flux-1.1-pro cap 1.6 MP); out-of-range -> 400. Presets 512x512, 768x768, 1024x1024, 1024x1536, 1536x1024. gpt-image-2.5 models: custom sizes up to 3840 px per edge (model catalogue) |
| `response_format` | `b64_json` (default) or `url` (falls back to base64 if no link can be issued) |
| `negative_prompt` | <= 4000 chars; not supported by `lucid-origin` |
| `seed` | 0-2147483647 |
| `steps` | 1-50 |
| `reference_images` | Up to **16** base64 PNG/JPEG, 10 MB each decoded; produces an edit of the references; **requires a `gpt-image-*` model** else `422` before credits are reserved |
| `reference_pdf` | One base64 PDF, 10 MB; extracted text added to the prompt; requires `gpt-image-*` |
| `user` | Your end-user ID |
| Mask / inpainting-region parameter | **Not documented** in the summary. The catalogue says `gpt-image-2.5-sunburst` is "built for editing precision and inpainting" but no `mask` field was found - **[Unverified]** |

## Response

`created` timestamp + `data[]`; each item: `b64_json` (PNG or JPEG depending on model), optional short-lived signed `url` (omitted if storage failed - fall back to base64; download or re-host promptly), `revised_prompt`.

## Sync vs async

Documentation describes a single synchronous request/response; **no polling/job endpoint was found** [Unverified that none exists]. [Inference] Use long timeouts (e.g. 120 s) with AbortController and a cancel button in the UI.

## Models (image category, from docs + `list_models`)

| Model | Owner | Plan | Price/image (USD per catalogue) | Notes |
|---|---|---|---|---|
| flux-2-klein-9b (default) | BFL | Free | 0.1042 | |
| flux-2-dev | BFL | Free | 0.125 | 50-step |
| lucid-origin | Leonardo | Free | 0.08333 | no negative_prompt |
| phoenix-1.0 | Leonardo | Free | 0.1042 | |
| sdxl-lightning | ByteDance | Free | 0.04167 | fastest |
| dreamshaper-8-lcm | Lykon | Free | 0.04167 | |
| flux-2-pro | BFL | Paid | 0.1042 | |
| flux-1.1-pro | BFL | Paid | 0.05208 | currently `maintenance` |
| gemini-3.1-flash-lite-image | Google | Paid | 0.035 | 1K only; reference editing not available |
| nano-banana-2 | Google | Paid | 0.06979 | |
| nano-banana-pro | Google | Paid | 0.1396 | |
| gpt-image-1.5 | OpenAI | Paid | 0.2604 | logo/face-preserving edits |
| gpt-image-2 | OpenAI | Paid | 0.2604 | on-image text |
| gpt-image-2.5-flare | OpenAI | Paid | 0.2604 | reference-image editing |
| gpt-image-2.5-sunburst | OpenAI | Paid | 0.2604 | most capable; inpainting; to 3840 px |

Reference-image editing requires a `gpt-image-*` model (docs). Free keys can use the six free models; paid models need Starter or higher. Fallback: on temporary upstream error the request may be served by a similar model, billed at no more than the requested model's price.

## Pricing, credits, limits

| Item | Value | Source |
|---|---|---|
| Credit | 1 credit = INR 1 (about US$0.0104; US$1 = INR 96) | pricing page |
| Per-image credits | 25 (gpt-image-*), 13.4 nano-banana-pro, 12 flux-2-dev, 10 flux-2-klein/flux-2-pro/phoenix, 8 lucid-origin, 6.7 nano-banana-2, 5 flux-1.1-pro, 4 sdxl-lightning/dreamshaper, 3.36 gemini-3.1-flash-lite-image | image-generation page |
| Credits are reserved before generation and fully refunded on failure | | image-generation page |
| Monthly image caps | Free 50, Starter 500, Pro 5,000, Enterprise unlimited; exceeding -> `429 quota_exceeded` | pricing page |
| Per-key RPM | Free 60, Starter 500, Pro 3,000, Enterprise 10,000 | rate-limits page |
| Headers | `X-RateLimit-Limit/Remaining/Reset` (monthly cap, not per-minute), `X-Usage-Warning` at 80%/95%, `Retry-After` on quota and concurrency 429s (not on per-key RPM 429s from `/v1/*`) | rate-limits page |

## Errors

400 `invalid_request`; 400 `content_policy_violation` (not billed); 402 `insufficient_credits`; 402 `budget_exceeded` (key cap); 403 `permission_denied` / `model_not_available` / `model_not_allowed`; 404 `model_not_found`; 422 validation (prompt length, n, seed, bad/oversized references, references on unsupported model); 429 `quota_exceeded` (do not retry), `rate_limit_exceeded` / `too_many_concurrent_requests` (backoff, honour `Retry-After`); 503 `upstream_error` (no debit, safe to retry), `model_under_maintenance`. Sources: image-generation and rate-limits pages.

## Integration notes for the app [Inference]

1. Call from the **main process** with the key from safeStorage; renderer sends only `{prompt, model, size, n}` + canvas export id.
2. Export the edited canvas to PNG (<= 10 MB; downscale if needed) -> `reference_images: [b64]`; auto-select a `gpt-image-*` model when a reference is attached, else allow free models for text-only.
3. Mask is not documented: describe the edited region in the prompt, or composite the result back using the local mask.
4. Save every generation (`prompt, model, size, seed, revised_prompt, image file`) locally; also offer a sync with `GET /v1/images/history` (signed URLs expire quickly).
5. Show estimated credits per model before sending.
6. Use the official OpenAI SDK with `baseURL` or plain `fetch`; confirm field names against the raw `.md` pages.

## Open items for the product owner / verification
- Confirm `/v1/images/edits` exists and whether a `mask` field is accepted.
- Confirm exact response field names and PNG vs JPEG by model.
- Confirm the idempotency header (page `/docs/idempotency` not read).
