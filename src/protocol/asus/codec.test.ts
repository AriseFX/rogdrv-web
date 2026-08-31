import { describe, expect, it } from 'vitest'
import {
  buildSetDpiRequest,
  buildSetLedRequest,
  buildSetPollingRateRequest,
  parseButtons,
  parseLed,
  parsePerformance,
  parseProfileInfo,
} from './codec'

describe('ASUS protocol codec', () => {
  it('parses active profile, DPI preset, and firmware versions', () => {
    const response = new Uint8Array(64)
    response[10] = 3
    response[11] = 2
    response[13] = 0x21
    response[14] = 0x02
    response[15] = 0x17
    response[4] = 0x11
    response[5] = 0x07
    response[6] = 0x05

    expect(parseProfileInfo(response)).toEqual({
      profileIndex: 3,
      dpiPreset: 1,
      primaryFirmware: { major: 0x17, minor: 0x02, build: 0x21 },
      secondaryFirmware: { major: 0x05, minor: 0x07, build: 0x11 },
    })
  })

  it('parses four 16-bit DPI values and performance fields', () => {
    const response = new Uint8Array(64)
    const view = new DataView(response.buffer)
    ;[7, 15, 319, 719].forEach((value, index) => view.setUint16(4 + index * 2, value, true))
    view.setUint16(12, 3, true)
    view.setUint16(14, 2, true)
    view.setUint16(16, 1, true)

    expect(parsePerformance(response)).toEqual({
      dpi: [400, 800, 16_000, 36_000],
      pollingRate: 1000,
      debounce: 12,
      angleSnapping: true,
    })
  })

  it('encodes 36K DPI using both low and high bytes', () => {
    const request = buildSetDpiRequest(3, 36_000)
    expect(Array.from(request.slice(0, 6))).toEqual([0x51, 0x31, 3, 0, 0xcf, 0x02])
  })

  it('encodes polling rate and LED settings at the upstream protocol offsets', () => {
    expect(Array.from(buildSetPollingRateRequest(500).slice(0, 6))).toEqual([
      0x51, 0x31, 4, 0, 2, 0,
    ])
    expect(Array.from(buildSetLedRequest({
      mode: 1,
      brightness: 4,
      color: { r: 0x12, g: 0x34, b: 0x56 },
    }).slice(0, 9))).toEqual([0x51, 0x28, 0, 0, 1, 4, 0x12, 0x34, 0x56])
  })

  it('parses mouse, keyboard, disabled, and unknown bindings', () => {
    const response = new Uint8Array(64)
    response.set([
      0xf0, 1,
      0x04, 0,
      0xff, 1,
      0x99, 1,
      0xe5, 1,
      0xe6, 1,
      0xe8, 1,
      0xe9, 1,
    ], 4)
    const buttons = parseButtons(response)
    expect(buttons[0].action).toMatchObject({ kind: 'mouse', label: '左键' })
    expect(buttons[1].action).toMatchObject({ kind: 'keyboard', label: 'A' })
    expect(buttons[2].action.kind).toBe('disabled')
    expect(buttons[3].action).toMatchObject({ kind: 'unknown', code: 0x99 })
  })

  it('parses one onboard LED zone', () => {
    const response = new Uint8Array(64)
    response.set([4, 3, 255, 32, 16], 4)
    expect(parseLed(response)).toEqual({
      mode: 4,
      brightness: 3,
      color: { r: 255, g: 32, b: 16 },
    })
  })
})
