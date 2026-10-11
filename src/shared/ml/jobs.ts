import { z } from 'zod'
import { ModelId } from './models'
import type { JobKind } from './protocol'

/** Input/output schemas per ML job; the worker validates inputs, the renderer types results. */
export const jobs = {
  probe: {
    input: z.object({ model: ModelId }),
    result: z.object({
      model: ModelId,
      provider: z.enum(['dml', 'cpu']),
      loadMs: z.number(),
      sessions: z.array(
        z.object({ file: z.string(), inputs: z.array(z.string()), outputs: z.array(z.string()) })
      )
    })
  }
} as const satisfies Record<JobKind, { input: z.ZodType; result: z.ZodType }>

export type JobInput<K extends JobKind> = z.infer<(typeof jobs)[K]['input']>
export type JobResult<K extends JobKind> = z.infer<(typeof jobs)[K]['result']>
