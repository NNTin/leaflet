import { describe, expect, it } from 'vitest'
import { PROVIDER_META, PROVIDER_META_MAP } from '../providers'

describe('PROVIDER_META_MAP', () => {
  it('maps every provider entry by name', () => {
    expect(Object.keys(PROVIDER_META_MAP)).toHaveLength(PROVIDER_META.length)

    for (const provider of PROVIDER_META) {
      expect(PROVIDER_META_MAP[provider.name]).toEqual(provider)
    }
  })
})
