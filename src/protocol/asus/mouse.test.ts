import { describe, expect, it } from 'vitest'
import { AsusMouse } from './mouse'
import type { ProfileSnapshot, QueryTransport } from './types'

class FakeTransport implements QueryTransport {
  requests: Uint8Array[] = []

  async query(request: Uint8Array) {
    this.requests.push(request)
    return request.slice()
  }
}

const baseProfile = (): ProfileSnapshot => ({
  profileIndex: 0,
  dpiPreset: 0,
  primaryFirmware: { major: 1, minor: 0, build: 0 },
  secondaryFirmware: { major: 1, minor: 0, build: 0 },
  performance: {
    dpi: [400, 800, 1600, 3200],
    pollingRate: 1000,
    debounce: 12,
    angleSnapping: false,
  },
  buttons: [
    { index: 0, sourceCode: 0xf0, sourceLabel: '左键', action: { kind: 'mouse', code: 0xf0, label: '左键' } },
  ],
  led: { mode: 0, brightness: 4, color: { r: 255, g: 0, b: 0 } },
})

describe('AsusMouse', () => {
  it('writes only changed fields and commits once', async () => {
    const transport = new FakeTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    const draft = structuredClone(current)
    draft.performance.dpi[1] = 1200
    draft.performance.pollingRate = 500

    await mouse.applyChanges(current, draft)

    const commands = transport.requests.map((request) => new DataView(request.buffer).getUint16(0, true))
    expect(commands).toEqual([0x3151, 0x3151, 0x0350])
  })

  it('does not send a save command when nothing changed', async () => {
    const transport = new FakeTransport()
    const mouse = new AsusMouse(transport)
    const profile = baseProfile()

    await expect(mouse.applyChanges(profile, structuredClone(profile))).resolves.toBe(false)
    expect(transport.requests).toHaveLength(0)
  })
})
