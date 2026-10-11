import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '@shared/csp'

describe('contentSecurityPolicy', () => {
  it('production policy forbids inline scripts and remote connections', () => {
    const policy = contentSecurityPolicy(false)
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(policy).toContain("connect-src 'self'")
    expect(policy).not.toContain('ws://')
    expect(policy).toContain("object-src 'none'")
  })

  it('dev policy allows only what Vite HMR needs', () => {
    const policy = contentSecurityPolicy(true)
    expect(policy).toMatch(/script-src[^;]*unsafe-inline/)
    expect(policy).toContain('ws://localhost:*')
  })
})
