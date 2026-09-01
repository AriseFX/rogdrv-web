import {
  AsusCommandRejectedError,
  buildGetButtonsRequest,
  buildGetLedRequest,
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
  buildSetPollingRateRequest,
  buildSetProfileRequest,
  parseButtons,
  parseDpiColors,
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
  private readonly dpiPresetCounts = new Map<number, number>()

  constructor(transport: QueryTransport) {
    this.transport = transport
  }

  async readCurrentProfile(): Promise<ProfileSnapshot> {
    const info = parseProfileInfo(await this.transport.query(buildGetProfileRequest()))
    const dpiPresetCount = info.dpiPreset === null
      ? 4
      : await this.detectDpiPresetCount(info.profileIndex, info.dpiPreset)
    const settingsResponse = await this.transport.query(buildGetSettingsRequest())
    const dpiResponse = await this.transport.query(buildGetSettingsRequest(2))
    const performance = parsePerformance(settingsResponse, dpiResponse)
    const dpiColors = parseDpiColors(await this.transport.query(buildGetSettingsRequest(3)))
    const buttons = parseButtons(await this.transport.query(buildGetButtonsRequest()))
    const led = parseLed(await this.transport.query(buildGetLedRequest()))

    return {
      profileIndex: info.profileIndex,
      dpiPreset: info.dpiPreset,
      dpiPresetCount,
      primaryFirmware: info.primaryFirmware,
      secondaryFirmware: info.secondaryFirmware,
      performance,
      dpiColors,
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

    if (!Number.isInteger(draft.dpiPresetCount) || draft.dpiPresetCount < 2 || draft.dpiPresetCount > 4) {
      throw new Error('DPI 档位数量必须在 2–4 档之间')
    }
    if (
      draft.dpiPreset !== null
      && (draft.dpiPreset < 0 || draft.dpiPreset >= draft.dpiPresetCount)
    ) {
      throw new Error('当前 DPI 档位超出了启用范围')
    }

    let changed = false
    const changedDpiIndices = draft.performance.dpi.flatMap((_, index) => (
      (
        current.performance.dpi[index] !== draft.performance.dpi[index]
        || !sameColor(current.dpiColors[index], draft.dpiColors[index])
      ) ? [index] : []
    ))
    if (changedDpiIndices.length > 0 && current.dpiPreset === null) {
      throw new Error('设备没有报告当前 DPI 档位，无法安全写入并恢复')
    }

    const originalDpiPresetCount = current.dpiPresetCount
    const requiredDpiPresetCount = Math.max(
      draft.dpiPresetCount,
      changedDpiIndices.length > 0 ? Math.max(...changedDpiIndices) + 1 : 0,
      current.dpiPreset === null ? 0 : current.dpiPreset + 1,
    )
    let effectiveDpiPresetCount = originalDpiPresetCount
    let selectedDpiPreset = current.dpiPreset
    let dpiWritesSucceeded = false
    try {
      if (requiredDpiPresetCount > originalDpiPresetCount) {
        await this.transport.query(buildSetDpiPresetCountRequest(requiredDpiPresetCount))
        effectiveDpiPresetCount = requiredDpiPresetCount
      }
      for (const index of changedDpiIndices) {
        if (selectedDpiPreset !== index) {
          await this.transport.query(buildSetDpiPresetRequest(index))
          selectedDpiPreset = index
        }
        await this.transport.query(
          buildSetDpiRequest(index, draft.performance.dpi[index], draft.dpiColors[index]),
        )
        changed = true
      }

      if (draft.dpiPreset !== null && selectedDpiPreset !== draft.dpiPreset) {
        await this.transport.query(buildSetDpiPresetRequest(draft.dpiPreset))
        selectedDpiPreset = draft.dpiPreset
        changed = true
      }
      if (effectiveDpiPresetCount !== draft.dpiPresetCount) {
        await this.transport.query(buildSetDpiPresetCountRequest(draft.dpiPresetCount))
        effectiveDpiPresetCount = draft.dpiPresetCount
      }
      if (originalDpiPresetCount !== draft.dpiPresetCount) changed = true
      this.dpiPresetCounts.set(current.profileIndex, draft.dpiPresetCount)
      dpiWritesSucceeded = true
    } finally {
      if (!dpiWritesSucceeded) {
        try {
          if (selectedDpiPreset !== current.dpiPreset && current.dpiPreset !== null) {
            await this.transport.query(buildSetDpiPresetRequest(current.dpiPreset))
          }
        } finally {
          if (effectiveDpiPresetCount !== originalDpiPresetCount) {
            await this.transport.query(buildSetDpiPresetCountRequest(originalDpiPresetCount))
            this.dpiPresetCounts.set(current.profileIndex, originalDpiPresetCount)
          }
        }
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

  private async detectDpiPresetCount(profileIndex: number, currentPreset: number) {
    const cached = this.dpiPresetCounts.get(profileIndex)
    if (cached !== undefined) return cached

    for (let candidate = 3; candidate > currentPreset; candidate -= 1) {
      try {
        await this.transport.query(buildSetDpiPresetRequest(candidate))
      } catch (error) {
        if (error instanceof AsusCommandRejectedError) continue
        throw error
      }
      await this.transport.query(buildSetDpiPresetRequest(currentPreset))
      const count = candidate + 1
      this.dpiPresetCounts.set(profileIndex, count)
      return count
    }

    const count = currentPreset + 1
    this.dpiPresetCounts.set(profileIndex, count)
    return count
  }
}
