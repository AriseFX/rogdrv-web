import {
  buildGetButtonsRequest,
  buildGetLedRequest,
  buildGetProfileRequest,
  buildGetSettingsRequest,
  buildSaveRequest,
  buildSetAngleSnappingRequest,
  buildSetButtonRequest,
  buildSetDebounceRequest,
  buildSetDpiRequest,
  buildSetLedRequest,
  buildSetPollingRateRequest,
  buildSetProfileRequest,
  parseButtons,
  parseLed,
  parsePerformance,
  parseProfileInfo,
} from './codec'
import type { ProfileSnapshot, QueryTransport } from './types'

const sameColor = (
  left: ProfileSnapshot['led']['color'],
  right: ProfileSnapshot['led']['color'],
) => left.r === right.r && left.g === right.g && left.b === right.b

export class AsusMouse {
  private readonly transport: QueryTransport

  constructor(transport: QueryTransport) {
    this.transport = transport
  }

  async readCurrentProfile(): Promise<ProfileSnapshot> {
    const info = parseProfileInfo(await this.transport.query(buildGetProfileRequest()))
    const performance = parsePerformance(await this.transport.query(buildGetSettingsRequest()))
    const buttons = parseButtons(await this.transport.query(buildGetButtonsRequest()))
    const led = parseLed(await this.transport.query(buildGetLedRequest()))

    return {
      profileIndex: info.profileIndex,
      dpiPreset: info.dpiPreset,
      primaryFirmware: info.primaryFirmware,
      secondaryFirmware: info.secondaryFirmware,
      performance,
      buttons,
      led,
    }
  }

  async switchProfile(index: number) {
    await this.transport.query(buildSetProfileRequest(index))
    return this.readCurrentProfile()
  }

  async applyChanges(current: ProfileSnapshot, draft: ProfileSnapshot) {
    if (current.profileIndex !== draft.profileIndex) {
      throw new Error('配置档在编辑期间发生了变化，请重新读取设备')
    }

    let changed = false
    for (let index = 0; index < draft.performance.dpi.length; index += 1) {
      if (current.performance.dpi[index] !== draft.performance.dpi[index]) {
        await this.transport.query(buildSetDpiRequest(index, draft.performance.dpi[index]))
        changed = true
      }
    }

    if (current.performance.pollingRate !== draft.performance.pollingRate) {
      await this.transport.query(buildSetPollingRateRequest(draft.performance.pollingRate))
      changed = true
    }
    if (current.performance.debounce !== draft.performance.debounce) {
      await this.transport.query(buildSetDebounceRequest(draft.performance.debounce))
      changed = true
    }
    if (current.performance.angleSnapping !== draft.performance.angleSnapping) {
      await this.transport.query(buildSetAngleSnappingRequest(draft.performance.angleSnapping))
      changed = true
    }

    for (let index = 0; index < draft.buttons.length; index += 1) {
      const before = current.buttons[index]
      const after = draft.buttons[index]
      if (before.action.kind !== after.action.kind || before.action.code !== after.action.code) {
        await this.transport.query(buildSetButtonRequest(after.sourceCode, after.action))
        changed = true
      }
    }

    if (
      current.led.mode !== draft.led.mode ||
      current.led.brightness !== draft.led.brightness ||
      !sameColor(current.led.color, draft.led.color)
    ) {
      await this.transport.query(buildSetLedRequest(draft.led))
      changed = true
    }

    if (changed) await this.transport.query(buildSaveRequest())
    return changed
  }
}
