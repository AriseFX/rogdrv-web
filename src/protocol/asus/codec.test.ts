import { describe, expect, it } from 'vitest'
import {
  assertSuccessfulResponse,
  buildGetButtonsRequest,
  buildGetBatteryRequest,
  buildGetLedRequest,
  buildGetLiftOffDistanceRequest,
  buildGetProfileRequest,
  buildGetSettingsRequest,
  buildSaveRequest,
  buildSetAngleSnappingRequest,
  buildSetButtonRequest,
  buildSetDebounceRequest,
  buildSetDpiRequest,
  buildSetDpiPresetRequest,
  buildSetDpiPresetCountRequest,
  buildSetLedRequest,
  buildSetLiftOffDistanceRequest,
  buildSetPollingRateRequest,
  buildSetProfileRequest,
  makeRequest,
  normalizeDpi,
  parseButtons,
  parseBatteryStatus,
  parseDpiColors,
  parseLed,
  parseLiftOffDistance,
  parsePerformance,
  parseProfileInfo,
  responseCode,
} from './codec'

describe('ASUS protocol codec', () => {
  it('normalizes an empty numeric DPI input to the safe minimum', () => {
    expect(normalizeDpi(Number.NaN)).toBe(100)
  })

  it('parses active profile, DPI preset, and firmware versions', () => {
    const response = new Uint8Array(64)
    response[10] = 3
    response[11] = 2
    response[14] = 0x21
    response[15] = 0x02
    response[16] = 0x17
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

  it('builds and parses the AimPoint battery and charging-status report', () => {
    const request = buildGetBatteryRequest()
    expect(Array.from(request.slice(0, 10))).toEqual([0x12, 0x07, 0, 0, 0, 0, 0, 0, 0, 0])
    const response = request.slice()
    response[4] = 73
    response[9] = 1
    expect(parseBatteryStatus(response)).toEqual({ percentage: 73, charging: true })
    expect(() => parseBatteryStatus(new Uint8Array(9))).toThrow('电量数据不完整')
    response[4] = 101
    expect(() => parseBatteryStatus(response)).toThrow('电量数值超出范围')
  })

  it('builds and parses the exact P711 lift-off-distance packets', () => {
    expect(Array.from(buildGetLiftOffDistanceRequest().slice(0, 8))).toEqual([
      0x12, 0x06, 0, 0, 0, 0, 0, 0,
    ])
    expect(Array.from(buildSetLiftOffDistanceRequest('high').slice(0, 8))).toEqual([
      0x51, 0x35, 0xff, 0, 0xff, 1, 0, 0,
    ])
    expect(buildSetLiftOffDistanceRequest('low')[5]).toBe(0)
    const response = buildGetLiftOffDistanceRequest()
    response[7] = 1
    expect(parseLiftOffDistance(response)).toBe('high')
    response[7] = 2
    expect(() => parseLiftOffDistance(response)).toThrow('未知的抬升距离')
    expect(() => parseLiftOffDistance(new Uint8Array(7))).toThrow('抬升距离数据不完整')
  })

  it('parses a device without an active DPI preset', () => {
    const response = new Uint8Array(64)
    response[11] = 0

    expect(parseProfileInfo(response).dpiPreset).toBeNull()
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

  it('uses safe defaults for unknown performance identifiers', () => {
    const response = new Uint8Array(64)
    response[12] = 7
    response[14] = 0xff

    expect(parsePerformance(response)).toMatchObject({
      pollingRate: 1000,
      debounce: 12,
      angleSnapping: false,
    })
  })

  it('combines the receiver performance packet with its separate X/Y DPI packet', () => {
    const performance = new Uint8Array(64)
    performance.set([
      0x12, 0x04, 0x00, 0x00,
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0x03, 0x00, 0x02, 0x00, 0x00, 0x00,
    ])
    const dpi = new Uint8Array(64)
    dpi.set([
      0x12, 0x04, 0x02, 0x00,
      0x29, 0x00, 0x29, 0x00,
      0x2b, 0x00, 0x2b, 0x00,
      0x28, 0x00, 0x28, 0x00,
      0x28, 0x00, 0x28, 0x00,
    ])

    expect(parsePerformance(performance, dpi)).toEqual({
      dpi: [2100, 2200, 2050, 2050],
      pollingRate: 1000,
      debounce: 12,
      angleSnapping: false,
    })
  })

  it('refuses to flatten unequal X/Y DPI values into a destructive write model', () => {
    const performance = new Uint8Array(64)
    performance.fill(0xff, 4, 12)
    const dpi = new Uint8Array(64)
    dpi[2] = 2
    new DataView(dpi.buffer).setUint16(4, 41, true)
    new DataView(dpi.buffer).setUint16(6, 42, true)

    expect(() => parsePerformance(performance, dpi)).toThrow('独立 X/Y DPI')
  })

  it('requires the complete separate DPI packet when the receiver returns sentinels', () => {
    const performance = new Uint8Array(64)
    performance.fill(0xff, 4, 12)

    expect(() => parsePerformance(performance)).toThrow('独立 X/Y DPI 查询')
    expect(() => parsePerformance(performance, new Uint8Array(19))).toThrow(
      '独立 X/Y DPI 数据不完整',
    )
  })

  it('parses the four real per-DPI indicator colors', () => {
    const response = new Uint8Array(64)
    response.set([
      0x12, 0x04, 0x03, 0x00,
      0xff, 0x00, 0x00,
      0xc1, 0x00, 0xff,
      0x00, 0x3d, 0xff,
      0x31, 0xff, 0x00,
    ])

    expect(parseDpiColors(response)).toEqual([
      { r: 0xff, g: 0x00, b: 0x00 },
      { r: 0xc1, g: 0x00, b: 0xff },
      { r: 0x00, g: 0x3d, b: 0xff },
      { r: 0x31, g: 0xff, b: 0x00 },
    ])
    expect(() => parseDpiColors(new Uint8Array(15))).toThrow('DPI 指示颜色数据不完整')
  })

  it('encodes 36K DPI using both low and high bytes', () => {
    const request = buildSetDpiRequest(3, 36_000, { r: 0x12, g: 0x34, b: 0x56 })
    expect(Array.from(request.slice(0, 9))).toEqual([
      0x51, 0x31, 3, 0, 0xcf, 0x02, 0x12, 0x34, 0x56,
    ])
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
      0x00, 0,
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
  it('preserves an action with an unknown type for a future firmware', () => {
    const response = new Uint8Array(64)
    response.set([0x04, 9], 4)

    expect(parseButtons(response)[0].action).toEqual({
      kind: 'unknown',
      code: 0x04,
      label: '未知类型 9 / 0x04',
    })
  })

  it('parses the 0-100 brightness and off mode reported by the AimPoint LED', () => {
    const response = new Uint8Array(64)
    response.set([0xf0, 75, 255, 32, 16], 4)
    expect(parseLed(response)).toEqual({
      mode: 0xf0,
      brightness: 75,
      color: { r: 255, g: 32, b: 16 },
    })
  })

  it('clamps an invalid LED brightness reported by firmware', () => {
    const response = new Uint8Array(64)
    response[5] = 0xff

    expect(parseLed(response).brightness).toBe(100)
  })

  it.each([
    ['response code', () => responseCode(new Uint8Array(1)), '鼠标返回了过短的数据包'],
    ['profile', () => parseProfileInfo(new Uint8Array(16)), '配置档信息不完整'],
    ['performance', () => parsePerformance(new Uint8Array(17)), '性能配置数据不完整'],
    ['buttons', () => parseButtons(new Uint8Array(19)), '按键配置数据不完整'],
    ['LED', () => parseLed(new Uint8Array(8)), '灯效配置数据不完整'],
  ])('rejects an incomplete %s response', (_name, read, message) => {
    expect(read).toThrow(message)
  })

  it.each([
    new Uint8Array([0xff, 0xaa]),
    new Uint8Array([0xaa, 0xff]),
  ])('recognizes either known ASUS error byte order', (response) => {
    expect(() => assertSuccessfulResponse(response)).toThrow('鼠标拒绝了命令')
  })

  it('builds every read, profile, save, debounce, and snapping command', () => {
    expect([
      responseCode(buildGetProfileRequest()),
      responseCode(buildGetLedRequest(2)),
      responseCode(buildGetSettingsRequest()),
      responseCode(buildGetButtonsRequest()),
      responseCode(buildSetProfileRequest(99)),
      responseCode(buildSaveRequest()),
    ]).toEqual([0x0012, 0x0312, 0x0412, 0x0512, 0x0250, 0x0350])
    expect(buildGetLedRequest(2)[2]).toBe(2)
    expect(buildGetSettingsRequest(2)[2]).toBe(2)
    expect(buildSetProfileRequest(99)[2]).toBe(4)
    expect(Array.from(buildSetDpiPresetRequest(3).slice(0, 5))).toEqual([
      0x51, 0x31, 9, 0, 4,
    ])
    expect(Array.from(buildSetDpiPresetCountRequest(99).slice(0, 5))).toEqual([
      0x51, 0x31, 10, 0, 4,
    ])
    expect(buildSetDpiPresetCountRequest(-1)[4]).toBe(2)
    expect(Array.from(buildSetDebounceRequest(32).slice(0, 5))).toEqual([
      0x51, 0x31, 5, 0, 7,
    ])
    expect(buildSetAngleSnappingRequest(true)[4]).toBe(1)
    expect(buildSetAngleSnappingRequest(false)[4]).toBe(0)
  })

  it('builds keyboard, mouse, and disabled button actions', () => {
    expect(Array.from(buildSetButtonRequest(0xe4, {
      kind: 'keyboard', code: 0x04, label: 'A',
    }).slice(4, 8))).toEqual([0xe4, 1, 0x04, 0])
    expect(Array.from(buildSetButtonRequest(0xe5, {
      kind: 'mouse', code: 0xf0, label: '左键',
    }).slice(4, 8))).toEqual([0xe5, 1, 0xf0, 1])
    expect(Array.from(buildSetButtonRequest(0xe6, {
      kind: 'disabled', code: 0x00, label: '禁用',
    }).slice(4, 8))).toEqual([0xe6, 1, 0x00, 0])
  })

  it('rejects unsupported write values', () => {
    expect(() => buildSetPollingRateRequest(2000)).toThrow('不支持 2000 Hz')
    expect(() => buildSetDebounceRequest(6)).toThrow('不支持 6 ms')
    expect(() => buildSetButtonRequest(0xf0, {
      kind: 'unknown', code: 0, label: '未知',
    })).toThrow('无法写入未知按键动作')
  })

  it('rounds and clamps DPI, indices, brightness, and RGB channels', () => {
    expect(normalizeDpi(149)).toBe(150)
    expect(normalizeDpi(151)).toBe(150)
    expect(normalizeDpi(-Infinity)).toBe(100)
    expect(normalizeDpi(Infinity)).toBe(36_000)
    expect(normalizeDpi(126)).toBe(150)
    expect(buildSetDpiRequest(-3, 149, { r: 1, g: 2, b: 3 })[2]).toBe(0)
    expect(Array.from(buildSetLedRequest({
      mode: 4,
      brightness: 999,
      color: { r: -1, g: 12.6, b: 999 },
    }, 2).slice(2, 9))).toEqual([2, 0, 4, 100, 0, 13, 255])
  })

  it('creates an isolated 64-byte request and runs its configurator', () => {
    const request = makeRequest(0x1234, (packet) => {
      packet[63] = 0xab
    })

    expect(request).toHaveLength(64)
    expect(responseCode(request)).toBe(0x1234)
    expect(request[63]).toBe(0xab)
  })
})
