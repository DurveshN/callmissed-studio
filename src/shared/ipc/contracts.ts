import { z } from 'zod'
import { AssetMeta, Id, StudioDocument } from '../document/model'
import { History } from '../document/history'
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
