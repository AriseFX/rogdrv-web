import {
  AsusCommandRejectedError,
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
  parseButtons,
  parseBatteryStatus,
  parseDpiColors,
  parseLed,
  parseLiftOffDistance,
  parsePerformance,
  parseProfileInfo,
} from './codec'
import type { ProfileSnapshot, QueryTransport } from './types'
import {
  PRIMARY_BUTTON_ACTION_CODE,
  PRIMARY_BUTTON_SOURCE_CODE,
} from './constants'

const sameColor = (
  left: ProfileSnapshot['led']['color'],
  right: ProfileSnapshot['led']['color'],
) => left.r === right.r && left.g === right.g && left.b === right.b

const sameSnapshot = (left: ProfileSnapshot, right: ProfileSnapshot) =>
  JSON.stringify(left) === JSON.stringify(right)

const verificationFailures = (
  before: ProfileSnapshot,
  expected: ProfileSnapshot,
  actual: ProfileSnapshot,
) => {
  const failures: string[] = []
  const verify = (changed: boolean, matches: boolean, label: string) => {
    if (changed && !matches) failures.push(label)
  }
  verify(before.dpiPreset !== expected.dpiPreset, actual.dpiPreset === expected.dpiPreset, '当前 DPI 档位')
  verify(before.dpiPresetCount !== expected.dpiPresetCount, actual.dpiPresetCount === expected.dpiPresetCount, 'DPI 档位数量')
  expected.performance.dpi.forEach((dpi, index) => {
    verify(before.performance.dpi[index] !== dpi, actual.performance.dpi[index] === dpi, `DPI 档位 ${index + 1}`)
    verify(
      !sameColor(before.dpiColors[index], expected.dpiColors[index]),
      sameColor(actual.dpiColors[index], expected.dpiColors[index]),
      `DPI 档位 ${index + 1} 颜色`,
    )
  })
  verify(
    before.performance.pollingRate !== expected.performance.pollingRate,
    actual.performance.pollingRate === expected.performance.pollingRate,
    '回报率',
  )
  verify(
    before.performance.debounce !== expected.performance.debounce,
    actual.performance.debounce === expected.performance.debounce,
    '按键去抖',
  )
  verify(
    before.performance.angleSnapping !== expected.performance.angleSnapping,
    actual.performance.angleSnapping === expected.performance.angleSnapping,
    '直线修正',
  )
  verify(
    before.sensor.liftOffDistance !== expected.sensor.liftOffDistance,
    actual.sensor.liftOffDistance === expected.sensor.liftOffDistance,
    '抬升距离',
  )
  expected.buttons.forEach((button, index) => {
    const previous = before.buttons[index]
    const received = actual.buttons[index]
    verify(
      previous.action.kind !== button.action.kind || previous.action.code !== button.action.code,
      received.action.kind === button.action.kind && received.action.code === button.action.code,
      button.sourceLabel,
    )
  })
  verify(before.led.mode !== expected.led.mode, actual.led.mode === expected.led.mode, 'Logo 灯效模式')
  verify(before.led.brightness !== expected.led.brightness, actual.led.brightness === expected.led.brightness, 'Logo 灯效亮度')
  verify(
    !sameColor(before.led.color, expected.led.color),
    sameColor(actual.led.color, expected.led.color),
    'Logo 灯效颜色',
  )
  return failures
}

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)

const assertPrimaryButtonLocked = (profile: ProfileSnapshot) => {
  const primaryButtons = profile.buttons.filter(
    (button) => button.sourceCode === PRIMARY_BUTTON_SOURCE_CODE,
  )
  const [primaryButton] = primaryButtons
  if (
    primaryButtons.length !== 1
    || primaryButton.action.kind !== 'mouse'
    || primaryButton.action.code !== PRIMARY_BUTTON_ACTION_CODE
  ) {
    throw new Error('左键是系统保留按键，不能重新映射')
  }
}

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
    const sensor = {
      liftOffDistance: parseLiftOffDistance(
        await this.transport.query(buildGetLiftOffDistanceRequest()),
      ),
    }

    return {
      profileIndex: info.profileIndex,
      dpiPreset: info.dpiPreset,
      dpiPresetCount,
      primaryFirmware: info.primaryFirmware,
      secondaryFirmware: info.secondaryFirmware,
      performance,
      sensor,
      dpiColors,
      buttons,
      led,
    }
  }

  async readBatteryStatus() {
    return parseBatteryStatus(await this.transport.query(buildGetBatteryRequest()))
  }

  async resetSurfaceCalibration() {
    const current = await this.readCurrentProfile()
    await this.transport.query(buildSetLiftOffDistanceRequest(current.sensor.liftOffDistance))
    await this.transport.query(buildSaveRequest())
    const actual = await this.readCurrentProfile()
    if (actual.sensor.liftOffDistance !== current.sensor.liftOffDistance) {
      throw new Error('标准表面校准恢复后校验失败')
    }
    return actual.sensor
  }

  async switchProfile(index: number) {
    await this.transport.query(buildSetProfileRequest(index))
    return this.readCurrentProfile()
  }

  async readAllProfiles() {
    const initial = await this.readCurrentProfile()
    const profiles: ProfileSnapshot[] = []
    try {
      for (let index = 0; index < 5; index += 1) {
        if (index === initial.profileIndex) {
          profiles[index] = initial
        } else {
          profiles[index] = await this.switchProfile(index)
        }
      }
    } finally {
      await this.switchProfile(initial.profileIndex)
    }
    return profiles
  }

  async restoreProfiles(profiles: ProfileSnapshot[], activeProfileIndex: number) {
    if (profiles.length !== 5) throw new Error('恢复必须包含 5 个板载配置')
    if (!Number.isInteger(activeProfileIndex) || activeProfileIndex < 0 || activeProfileIndex > 4) {
      throw new Error('恢复的活动配置档无效')
    }
    profiles.forEach(assertPrimaryButtonLocked)
    for (let index = 0; index < 5; index += 1) {
      const current = await this.switchProfile(index)
      await this.applyChangesSafely(current, profiles[index])
    }
    return this.switchProfile(activeProfileIndex)
  }

  async applyChangesSafely(current: ProfileSnapshot, draft: ProfileSnapshot) {
    assertPrimaryButtonLocked(draft)
    let actual: ProfileSnapshot | null = null
    let verificationFailed = false
    try {
      const changed = await this.applyChanges(current, draft)
      if (!changed) return false
      actual = await this.readCurrentProfile()
      const failures = verificationFailures(current, draft, actual)
      if (failures.length > 0) {
        verificationFailed = true
        throw new Error(`写入校验失败：${failures.join('、')}`)
      }
      return true
    } catch (cause) {
      if (!actual) actual = await this.readCurrentProfile().catch(() => structuredClone(draft))
      const needsRecovery = verificationFailed || !sameSnapshot(current, actual)
      if (!needsRecovery) throw cause
      try {
        await this.applyChanges(actual, current)
        const restored = await this.readCurrentProfile()
        const recoveryFailures = verificationFailures(actual, current, restored)
        if (recoveryFailures.length > 0) {
          throw new Error(`恢复校验失败：${recoveryFailures.join('、')}`)
        }
      } catch (recoveryCause) {
        throw new Error(
          `${errorMessage(cause)}；自动恢复失败：${errorMessage(recoveryCause)}`,
          { cause },
        )
      }
      throw new Error(`${errorMessage(cause)}；已自动恢复原配置`, { cause })
    }
  }

  async applyChanges(current: ProfileSnapshot, draft: ProfileSnapshot) {
    assertPrimaryButtonLocked(draft)
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
    if (current.sensor.liftOffDistance !== draft.sensor.liftOffDistance) {
      await this.transport.query(buildSetLiftOffDistanceRequest(draft.sensor.liftOffDistance))
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
