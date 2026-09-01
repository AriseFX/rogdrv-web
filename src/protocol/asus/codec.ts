import {
  ASUS_COMMAND,
  ASUS_PACKET_SIZE,
  ASUS_STATUS_ERROR,
  BUTTON_ACTIONS,
  DEBOUNCE_TIMES,
  PHYSICAL_BUTTONS,
  POLLING_RATES,
} from './constants'
import type {
  ButtonAction,
  ButtonBinding,
  DpiColors,
  FirmwareVersion,
  LedSettings,
  PerformanceSettings,
  ProfileInfo,
  RgbColor,
} from './types'

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export class AsusCommandRejectedError extends Error {
  constructor() {
    super('鼠标拒绝了命令；设备可能正在休眠、断开，或被奥创占用')
    this.name = 'AsusCommandRejectedError'
  }
}

export function makeRequest(command: number, configure?: (packet: Uint8Array) => void) {
  const packet = new Uint8Array(ASUS_PACKET_SIZE)
  new DataView(packet.buffer).setUint16(0, command, true)
  configure?.(packet)
  return packet
}

export function responseCode(response: Uint8Array) {
  if (response.byteLength < 2) {
    throw new Error(`鼠标返回了过短的数据包（${response.byteLength} 字节）`)
  }
  return new DataView(response.buffer, response.byteOffset, response.byteLength).getUint16(0, true)
}

export function assertSuccessfulResponse(response: Uint8Array) {
  const code = responseCode(response)
  if (code === ASUS_STATUS_ERROR || code === 0xffaa) {
    throw new AsusCommandRejectedError()
  }
  return response
}

const firmware = (major: number, minor: number, build: number): FirmwareVersion => ({
  major,
  minor,
  build,
})

export function parseProfileInfo(response: Uint8Array): ProfileInfo {
  assertSuccessfulResponse(response)
  if (response.byteLength < 17) {
    throw new Error('配置档信息不完整')
  }

  return {
    profileIndex: response[10],
    dpiPreset: response[11] === 0 ? null : response[11] - 1,
    primaryFirmware: firmware(response[16], response[15], response[14]),
    secondaryFirmware: firmware(response[6], response[5], response[4]),
  }
}

export function parsePerformance(
  response: Uint8Array,
  separateDpiResponse?: Uint8Array,
): PerformanceSettings {
  assertSuccessfulResponse(response)
  if (response.byteLength < 18) {
    throw new Error('性能配置数据不完整')
  }

  const view = new DataView(response.buffer, response.byteOffset, response.byteLength)
  let encodedDpi: [number, number, number, number]
  if (separateDpiResponse) {
    assertSuccessfulResponse(separateDpiResponse)
    if (separateDpiResponse.byteLength < 20) {
      throw new Error('独立 X/Y DPI 数据不完整')
    }
    const dpiView = new DataView(
      separateDpiResponse.buffer,
      separateDpiResponse.byteOffset,
      separateDpiResponse.byteLength,
    )
    encodedDpi = Array.from({ length: 4 }, (_, index) => {
      const x = dpiView.getUint16(4 + index * 4, true)
      const y = dpiView.getUint16(6 + index * 4, true)
      if (x !== y) {
        throw new Error('检测到独立 X/Y DPI；当前设备模型不能安全地把两轴合并写回')
      }
      return x
    }) as [number, number, number, number]
  } else {
    encodedDpi = Array.from({ length: 4 }, (_, index) =>
      view.getUint16(4 + index * 2, true),
    ) as [number, number, number, number]
    if (encodedDpi.every((value) => value === 0xffff)) {
      throw new Error('鼠标要求使用独立 X/Y DPI 查询')
    }
  }
  const dpi = encodedDpi.map((value) => value * 50 + 50) as [number, number, number, number]
  const rateId = view.getUint16(12, true) & 0x07
  const debounceId = response[14]

  return {
    dpi,
    pollingRate: POLLING_RATES[rateId] ?? 1000,
    debounce: DEBOUNCE_TIMES[debounceId] ?? 12,
    angleSnapping: response[16] !== 0,
  }
}

export function parseDpiColors(response: Uint8Array): DpiColors {
  assertSuccessfulResponse(response)
  if (response.byteLength < 16) {
    throw new Error('DPI 指示颜色数据不完整')
  }

  return Array.from({ length: 4 }, (_, index) => {
    const offset = 4 + index * 3
    return {
      r: response[offset],
      g: response[offset + 1],
      b: response[offset + 2],
    }
  }) as DpiColors
}

function resolveAction(actionCode: number, actionType: number): ButtonAction {
  if ((actionCode === 0 && actionType === 0) || actionCode === 0xff) {
    return { kind: 'disabled', code: 0, label: '禁用' }
  }
  if (actionType !== 0 && actionType !== 1) {
    return {
      kind: 'unknown',
      code: actionCode,
      label: `未知类型 ${actionType} / 0x${actionCode.toString(16).padStart(2, '0')}`,
    }
  }
  const kind = actionType === 0 ? 'keyboard' : 'mouse'
  const known = BUTTON_ACTIONS.find((action) => action.kind === kind && action.code === actionCode)
  return known ?? {
    kind: 'unknown',
    code: actionCode,
    label: `未知 0x${actionCode.toString(16).padStart(2, '0')}`,
  }
}

export function parseButtons(response: Uint8Array): ButtonBinding[] {
  assertSuccessfulResponse(response)
  if (response.byteLength < 4 + PHYSICAL_BUTTONS.length * 2) {
    throw new Error('按键配置数据不完整')
  }

  return PHYSICAL_BUTTONS.map((button, index) => {
    const offset = 4 + index * 2
    return {
      index,
      sourceCode: button.sourceCode,
      sourceLabel: button.label,
      action: resolveAction(response[offset], response[offset + 1]),
    }
  })
}

export function parseLed(response: Uint8Array): LedSettings {
  assertSuccessfulResponse(response)
  if (response.byteLength < 9) {
    throw new Error('灯效配置数据不完整')
  }

  return {
    mode: response[4],
    brightness: clamp(response[5], 0, 100),
    color: {
      r: response[6],
      g: response[7],
      b: response[8],
    },
  }
}

export function buildGetProfileRequest() {
  return makeRequest(ASUS_COMMAND.getProfile)
}

export function buildGetSettingsRequest(section = 0) {
  return makeRequest(ASUS_COMMAND.getSettings, (packet) => {
    packet[2] = section
  })
}

export function buildGetButtonsRequest() {
  return makeRequest(ASUS_COMMAND.getButtons)
}

export function buildGetLedRequest(index = 0) {
  return makeRequest(ASUS_COMMAND.getLed, (packet) => {
    packet[2] = index
  })
}

export function buildSetProfileRequest(index: number) {
  return makeRequest(ASUS_COMMAND.setProfile, (packet) => {
    packet[2] = clamp(Math.round(index), 0, 4)
  })
}

export function normalizeDpi(dpi: number) {
  if (Number.isNaN(dpi)) return 100
  return clamp(Math.round(dpi / 50) * 50, 100, 36_000)
}

export function buildSetDpiRequest(index: number, dpi: number, color: RgbColor) {
  return makeRequest(ASUS_COMMAND.setSetting, (packet) => {
    const encodedDpi = Math.round((normalizeDpi(dpi) - 50) / 50)
    packet[2] = clamp(Math.round(index), 0, 3)
    packet[4] = encodedDpi & 0xff
    packet[5] = (encodedDpi >> 8) & 0xff
    packet[6] = clamp(Math.round(color.r), 0, 255)
    packet[7] = clamp(Math.round(color.g), 0, 255)
    packet[8] = clamp(Math.round(color.b), 0, 255)
  })
}

export function buildSetDpiPresetRequest(index: number) {
  return makeRequest(ASUS_COMMAND.setSetting, (packet) => {
    packet[2] = 9
    packet[4] = clamp(Math.round(index), 0, 3) + 1
  })
}

export function buildSetDpiPresetCountRequest(count: number) {
  return makeRequest(ASUS_COMMAND.setSetting, (packet) => {
    packet[2] = 10
    packet[4] = clamp(Math.round(count), 2, 4)
  })
}

export function buildSetPollingRateRequest(rate: number) {
  const rateIndex = POLLING_RATES.indexOf(rate as (typeof POLLING_RATES)[number])
  if (rateIndex === -1) throw new Error(`不支持 ${rate} Hz 回报率`)
  return makeRequest(ASUS_COMMAND.setSetting, (packet) => {
    packet[2] = 4
    packet[4] = rateIndex
  })
}

export function buildSetDebounceRequest(debounce: number) {
  const debounceIndex = DEBOUNCE_TIMES.indexOf(debounce as (typeof DEBOUNCE_TIMES)[number])
  if (debounceIndex === -1) throw new Error(`不支持 ${debounce} ms 去抖时间`)
  return makeRequest(ASUS_COMMAND.setSetting, (packet) => {
    packet[2] = 5
    packet[4] = debounceIndex
  })
}

export function buildSetAngleSnappingRequest(enabled: boolean) {
  return makeRequest(ASUS_COMMAND.setSetting, (packet) => {
    packet[2] = 6
    packet[4] = enabled ? 1 : 0
  })
}

export function buildSetButtonRequest(sourceCode: number, action: ButtonAction) {
  if (action.kind === 'unknown') throw new Error('无法写入未知按键动作')
  return makeRequest(ASUS_COMMAND.setButton, (packet) => {
    packet[4] = sourceCode
    packet[5] = 1
    packet[6] = action.code
    packet[7] = action.kind === 'mouse' ? 1 : 0
  })
}

export function buildSetLedRequest(settings: LedSettings, index = 0) {
  return makeRequest(ASUS_COMMAND.setLed, (packet) => {
    packet[2] = index
    packet[4] = settings.mode
    packet[5] = clamp(Math.round(settings.brightness), 0, 100)
    packet[6] = clamp(Math.round(settings.color.r), 0, 255)
    packet[7] = clamp(Math.round(settings.color.g), 0, 255)
    packet[8] = clamp(Math.round(settings.color.b), 0, 255)
  })
}

export function buildSaveRequest() {
  return makeRequest(ASUS_COMMAND.save)
}
