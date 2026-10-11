import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: {}, protocol: {} }))
const { resolveAppAsset } = await import('../../src/main/app-protocol')

const root = join('C:', 'app', 'renderer')

describe('resolveAppAsset', () => {
  it('maps the root to index.html', () => {
    expect(resolveAppAsset(root, 'studio://app/')).toBe(join(root, 'index.html'))
  })

  it('maps nested assets inside the root', () => {
    expect(resolveAppAsset(root, 'studio://app/assets/index-abc.js')).toBe(
      join(root, 'assets', 'index-abc.js')
    )
  })

  it('never resolves outside the root', () => {
    // The URL parser already collapses literal and %2e dot segments to the root.
    expect(resolveAppAsset(root, 'studio://app/../secrets.txt')).toBe(join(root, 'secrets.txt'))
    expect(resolveAppAsset(root, 'studio://app/%2e%2e/%2e%2e/secrets.txt')).toBe(join(root, 'secrets.txt'))
    // Encoded backslashes survive URL parsing and must be caught by the guard.
    expect(resolveAppAsset(root, 'studio://app/assets/..%5C..%5C..%5Csecrets.txt')).toBeNull()
  })

  it('rejects other hosts and schemes', () => {
    expect(resolveAppAsset(root, 'studio://evil/index.html')).toBeNull()
    expect(resolveAppAsset(root, 'file:///C:/app/renderer/index.html')).toBeNull()
  })
})
