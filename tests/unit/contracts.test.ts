import { describe, expect, it } from 'vitest'
import { CHANNELS, contracts, isChannel } from '@shared/ipc/contracts'

describe('ipc contracts', () => {
  it('recognises only declared channels', () => {
    expect(isChannel('app:get-info')).toBe(true)
    expect(isChannel('fs:delete-everything')).toBe(false)
    expect(isChannel('toString')).toBe(false)
    expect(isChannel(42)).toBe(false)
  })

  it('has exactly one contract per channel', () => {
    expect([...CHANNELS].sort()).toEqual(Object.keys(contracts).sort())
  })

  it('rejects unexpected input for app:get-info', () => {
    expect(contracts['app:get-info'].request.safeParse(undefined).success).toBe(true)
    expect(contracts['app:get-info'].request.safeParse({ evil: true }).success).toBe(false)
  })

  it('validates app:get-info responses', () => {
    const schema = contracts['app:get-info'].response
    expect(schema.safeParse({ name: 'a', version: '1', electron: '44', platform: 'win32' }).success).toBe(
      true
    )
    expect(schema.safeParse({ name: 'a' }).success).toBe(false)
  })
})
