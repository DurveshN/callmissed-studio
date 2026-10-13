import { z } from 'zod'
import { AssetMeta, Id, StudioDocument } from '../document/model'
import { History } from '../document/history'
import { PdfPlan } from '../pdf/plan'
import { AI_MODEL_IDS, AI_SIZES, MAX_IMAGES, MAX_PROMPT } from '../ai/models'
import { ModelId, ModelStatus } from '../ml/models'
import { Settings, SettingsPatch } from '../settings'
import type { AppEvent, Channel } from './channels'

export { CHANNELS, EVENTS, isAppEvent, isChannel, type AppEvent, type Channel } from './channels'

interface Contract {
  request: z.ZodType
  response: z.ZodType
}

/** Any Uint8Array (Buffer included) regardless of its backing buffer type. */
const Bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array, { message: 'Expected bytes' })
const MAX_PATH = 4096

const KeyStatus = z.object({
  configured: z.boolean(),
  /** "cm_…abcd" (the key itself never leaves main). */
  hint: z.string().nullable(),
  secureStorage: z.boolean()
})

const ImageMime = z.enum(['image/png', 'image/jpeg'])
/** CallMissed accepts reference images up to 10 MB decoded. */
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024

const ApiCallRow = z.object({
  endpoint: z.string(),
  model: z.string().nullable(),
  httpStatus: z.number().nullable(),
  errorCode: z.string().nullable(),
  images: z.number(),
  credits: z.number(),
  latencyMs: z.number(),
  createdAt: z.string()
})

const OpenedProject = z.object({
  kind: z.literal('project'),
  docId: Id,
  document: StudioDocument,
  history: History,
  projectPath: z.string().max(MAX_PATH).nullable()
})

const OpenedSource = z.object({
  kind: z.literal('source'),
  docId: Id,
  sourceAssetId: Id,
  mime: AssetMeta.shape.mime,
  fileName: z.string()
})

const RecentProject = z.object({
  path: z.string(),
  name: z.string(),
  lastOpenedAt: z.string(),
  thumbnail: z.string().nullable()
})

const Recoverable = z.object({
  docId: Id,
  name: z.string(),
  updatedAt: z.string(),
  projectPath: z.string().nullable()
})

/**
 * Request/response schemas per channel; both sides of the IPC boundary validate against these.
 * `satisfies` forces a contract for every channel in CHANNELS and no extras.
 */
export const contracts = {
  'app:get-info': {
    request: z.undefined(),
    response: z.object({ name: z.string(), version: z.string(), electron: z.string(), platform: z.string() })
  },
  'file:pick-open': {
    request: z.undefined(),
    response: z.string().nullable()
  },
  'file:pick-image': {
    request: z.undefined(),
    response: z.string().nullable()
  },
  'workspace:open-path': {
    request: z.object({ path: z.string().min(1).max(MAX_PATH) }),
    response: z.discriminatedUnion('kind', [OpenedProject, OpenedSource])
  },
  'workspace:import-image': {
    request: z.object({ docId: Id, path: z.string().min(1).max(MAX_PATH) }),
    response: z.object({ assetId: Id, mime: AssetMeta.shape.mime, fileName: z.string() })
  },
  'workspace:autosave': {
    request: z.object({ docId: Id, document: StudioDocument, history: History }),
    response: z.undefined()
  },
  'workspace:close': {
    request: z.object({ docId: Id }),
    response: z.undefined()
  },
  'workspace:list-recoverable': {
    request: z.undefined(),
    response: z.array(Recoverable)
  },
  'workspace:recover': {
    request: z.object({ docId: Id }),
    response: OpenedProject
  },
  'workspace:discard': {
    request: z.object({ docId: Id }),
    response: z.undefined()
  },
  'asset:read': {
    request: z.object({ docId: Id, assetId: Id }),
    response: Bytes
  },
  'asset:write': {
    request: z.object({ docId: Id, assetId: Id, mime: AssetMeta.shape.mime, bytes: Bytes }),
    response: z.undefined()
  },
  'project:save': {
    request: z.object({
      docId: Id,
      document: StudioDocument,
      history: History,
      thumbnail: Bytes,
      saveAs: z.boolean()
    }),
    response: z.string().nullable()
  },
  'library:recent': {
    request: z.undefined(),
    response: z.array(RecentProject)
  },
  'library:forget': {
    request: z.object({ path: z.string().max(MAX_PATH) }),
    response: z.undefined()
  },
  'export:save-image': {
    request: z.object({
      bytes: Bytes,
      suggestedName: z.string().max(260),
      format: z.enum(['png', 'jpeg', 'webp'])
    }),
    response: z.string().nullable()
  },
  /** Asks where to save; only a path chosen here can be written by export:write-pdf (once). */
  'export:choose-pdf-path': {
    request: z.object({ suggestedName: z.string().max(260) }),
    response: z.string().nullable()
  },
  'export:write-pdf': {
    request: z.object({
      path: z.string().max(MAX_PATH),
      docId: Id,
      /** The document's original PDF, when pages are copied from it. */
      sourceAssetId: Id.nullable(),
      plan: PdfPlan
    }),
    response: z.undefined()
  },
  'window:set-dirty': {
    request: z.object({ dirty: z.boolean() }),
    response: z.undefined()
  },
  'window:close-confirmed': {
    request: z.undefined(),
    response: z.undefined()
  },
  'window:renderer-ready': {
    request: z.undefined(),
    response: z.undefined()
  },
  'models:list': {
    request: z.undefined(),
    response: z.array(ModelStatus)
  },
  'models:download': {
    request: z.object({ ids: z.array(ModelId).min(1) }),
    response: z.undefined()
  },
  'models:cancel': {
    request: z.object({ id: ModelId }),
    response: z.undefined()
  },
  'models:remove': {
    request: z.object({ id: ModelId }),
    response: z.undefined()
  },
  'settings:get': {
    request: z.undefined(),
    response: Settings
  },
  'ai:key-status': { request: z.undefined(), response: KeyStatus },
  'ai:set-key': { request: z.object({ key: z.string().max(300) }), response: KeyStatus },
  'ai:remove-key': { request: z.undefined(), response: KeyStatus },
  'ai:test-key': { request: z.undefined(), response: z.undefined() },
  /** The image-to-image models, with availability from CallMissed's catalogue when reachable. */
  'ai:models': {
    request: z.undefined(),
    response: z.array(z.object({ id: z.string(), available: z.boolean(), message: z.string().nullable() }))
  },
  /** Generates from the flattened page; the images are written into the document's workspace as assets. */
  'ai:generate': {
    request: z.object({
      requestId: z.uuid(),
      docId: Id,
      model: z.enum(AI_MODEL_IDS),
      prompt: z.string().trim().min(1).max(MAX_PROMPT),
      n: z.number().int().min(1).max(MAX_IMAGES),
      size: z.enum(AI_SIZES),
      reference: Bytes.refine((b) => b.byteLength <= MAX_REFERENCE_BYTES, 'Reference image over 10 MB')
    }),
    response: z.object({
      images: z.array(z.object({ assetId: Id, mime: ImageMime, revisedPrompt: z.string().nullable() })),
      credits: z.number()
    })
  },
  'ai:cancel': { request: z.object({ requestId: z.uuid() }), response: z.undefined() },
  'ai:usage': {
    request: z.undefined(),
    response: z.object({
      generations: z.number(),
      failures: z.number(),
      images: z.number(),
      credits: z.number(),
      byModel: z.array(z.object({ model: z.string(), images: z.number(), credits: z.number() })),
      recent: z.array(ApiCallRow)
    })
  },
  /** Images made with this key on CallMissed (from any app), newest first. */
  'ai:history': {
    request: z.object({ before: z.string().max(64).nullable() }),
    response: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          url: z.string(),
          model: z.string(),
          size: z.string(),
          prompt: z.string(),
          revisedPrompt: z.string().nullable(),
          created: z.number()
        })
      ),
      nextCursor: z.string().nullable()
    })
  },
  /** Downloads an account-history image into the document's workspace. */
  'ai:import': {
    request: z.object({ docId: Id, url: z.url({ protocol: /^https$/ }) }),
    response: z.object({ assetId: Id, mime: ImageMime })
  },
  'settings:update': {
    request: SettingsPatch,
    response: Settings
  }
} as const satisfies Record<Channel, Contract>

export type Request<C extends Channel> = z.infer<(typeof contracts)[C]['request']>
export type Response<C extends Channel> = z.infer<(typeof contracts)[C]['response']>

/** Payloads of main → renderer events. */
export interface EventPayloads {
  'app:save-and-close': undefined
  'app:open-path': { path: string }
  'models:changed': ModelStatus[]
  'settings:changed': Settings
  'ml:gpu-failed': { message: string }
}
export type EventPayload<E extends AppEvent> = EventPayloads[E]

export type OpenedProject = z.infer<typeof OpenedProject>
export type OpenedSource = z.infer<typeof OpenedSource>
export type RecentProject = z.infer<typeof RecentProject>
export type Recoverable = z.infer<typeof Recoverable>
