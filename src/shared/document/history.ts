import { z } from 'zod'

/** JSON form of an Immer patch. */
export const JsonPatch = z.object({
  op: z.enum(['add', 'remove', 'replace']),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional()
})

export const HistoryEntry = z.object({
  label: z.string().max(100),
  patches: z.array(JsonPatch),
  inverse: z.array(JsonPatch)
})

export const History = z.object({
  undo: z.array(HistoryEntry),
  redo: z.array(HistoryEntry)
})

export const HISTORY_LIMIT = 200

export type JsonPatch = z.infer<typeof JsonPatch>
export type HistoryEntry = z.infer<typeof HistoryEntry>
export type History = z.infer<typeof History>
