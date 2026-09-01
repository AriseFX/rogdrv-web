import { describe, expect, it } from 'vitest'
import {
  AsusCommandRejectedError,
  buildSetDpiPresetCountRequest,
  buildSetDpiPresetRequest,
  responseCode,
} from './codec'
import { ASUS_COMMAND } from './constants'
import { AsusMouse } from './mouse'
import { VirtualAsusDevice } from './simulator'
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
  dpiPresetCount: 2,
  primaryFirmware: { major: 1, minor: 0, build: 0 },
  secondaryFirmware: { major: 1, minor: 0, build: 0 },
  performance: {
    dpi: [400, 800, 1600, 3200],
    pollingRate: 1000,
    debounce: 12,
    angleSnapping: false,
  },
  sensor: { liftOffDistance: 'low' },
  dpiColors: [
    { r: 0xff, g: 0, b: 0 },
    { r: 0xc1, g: 0, b: 0xff },
    { r: 0, g: 0x3d, b: 0xff },
    { r: 0x31, g: 0xff, b: 0 },
  ],
  buttons: [
    { index: 0, sourceCode: 0xf0, sourceLabel: '左键', action: { kind: 'mouse', code: 0xf0, label: '左键' } },
  ],
  led: { mode: 0, brightness: 100, color: { r: 255, g: 0, b: 0 } },
})

describe('AsusMouse', () => {
  it('refuses to write a draft that belongs to another onboard profile', async () => {
    const transport = new FakeTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    const draft = structuredClone(current)
    draft.profileIndex = 1

    await expect(mouse.applyChanges(current, draft)).rejects.toThrow(
      '配置档在编辑期间发生了变化',
    )
    expect(transport.requests).toHaveLength(0)
  })

  it('writes only changed fields and commits once', async () => {
    const transport = new FakeTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    const draft = structuredClone(current)
    draft.performance.dpi[1] = 1200
    draft.performance.pollingRate = 500

    await mouse.applyChanges(current, draft)

    expect(transport.requests.map((request) => [
      new DataView(request.buffer).getUint16(0, true),
      request[2],
      request[4],
    ])).toEqual([
      [0x3151, 9, 2],
      [0x3151, 1, 23],
      [0x3151, 9, 1],
      [0x3151, 4, 2],
      [0x0350, 0, 0],
    ])
  })

  it('restores the active DPI preset when a target-preset write fails', async () => {
    class RejectingTransport extends FakeTransport {
      override async query(request: Uint8Array) {
        this.requests.push(request)
        if (request[2] === 1) throw new Error('DPI write rejected')
        return request.slice()
      }
    }
    const transport = new RejectingTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    const draft = structuredClone(current)
    draft.performance.dpi[1] = 1200

    await expect(mouse.applyChanges(current, draft)).rejects.toThrow('DPI write rejected')
    expect(transport.requests.map((request) => [request[2], request[4]])).toEqual([
      [9, 2],
      [1, 23],
      [9, 1],
    ])
  })

  it('does not issue a redundant DPI-stage restore when the active-stage write fails', async () => {
    class RejectsActiveDpiDevice extends FakeTransport {
      override async query(request: Uint8Array) {
        this.requests.push(request)
        if (request[2] === 0) throw new Error('active DPI rejected')
        return request.slice()
      }
    }
    const transport = new RejectsActiveDpiDevice()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    const draft = structuredClone(current)
    draft.performance.dpi[0] = 450

    await expect(mouse.applyChanges(current, draft)).rejects.toThrow('active DPI rejected')
    expect(transport.requests).toHaveLength(1)
  })

  it('temporarily expands a two-stage DPI cycle and caches its detected size', async () => {
    class TwoPresetTransport extends FakeTransport {
      count = 2

      override async query(request: Uint8Array) {
        this.requests.push(request)
        if (request[2] === 9 && request[4] > this.count) {
          throw new AsusCommandRejectedError()
        }
        if (request[2] === 10) this.count = request[4]
        return request.slice()
      }
    }
    const transport = new TwoPresetTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    const draft = structuredClone(current)
    draft.performance.dpi[3] = 3600

    await expect(mouse.applyChanges(current, draft)).resolves.toBe(true)
    expect(transport.requests.map((request) => [request[2], request[4]])).toEqual([
      [10, 4],
      [9, 4],
      [3, 71],
      [9, 1],
      [10, 2],
      [0, 0],
    ])
    expect(transport.count).toBe(2)

    transport.requests = []
    const secondDraft = structuredClone(current)
    secondDraft.performance.dpi[2] = 2400
    await mouse.applyChanges(current, secondDraft)
    expect(transport.requests[0].slice(2, 5)).toEqual(new Uint8Array([10, 0, 3]))
  })

  it('restores the DPI stage count even when restoring the active stage fails', async () => {
    class RestoreRejectingTransport extends FakeTransport {
      count = 2

      override async query(request: Uint8Array) {
        this.requests.push(request)
        if (request[2] === 9 && request[4] > this.count) {
          throw new AsusCommandRejectedError()
        }
        if (request[2] === 10) this.count = request[4]
        if (request[2] === 9 && request[4] === 2 && this.count === 4) {
          throw new Error('active-stage restore failed')
        }
        return request.slice()
      }
    }
    const transport = new RestoreRejectingTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    current.dpiPreset = 1
    const draft = structuredClone(current)
    draft.performance.dpi[3] = 3600

    await expect(mouse.applyChanges(current, draft)).rejects.toThrow(
      'active-stage restore failed',
    )
    expect(transport.requests.at(-1)?.slice(2, 5)).toEqual(new Uint8Array([10, 0, 2]))
    expect(transport.count).toBe(2)
  })

  it('keeps all four enabled stages when the fourth DPI preset is active', async () => {
    const transport = new FakeTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    current.dpiPreset = 3
    current.dpiPresetCount = 4
    const draft = structuredClone(current)
    draft.performance.dpi[0] = 450

    await expect(mouse.applyChanges(current, draft)).resolves.toBe(true)
    expect(transport.requests.map((request) => [request[2], request[4]])).toEqual([
      [9, 1],
      [0, 8],
      [9, 4],
      [0, 0],
    ])
  })

  it('writes the active DPI preset without switching stages', async () => {
    const transport = new FakeTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    const draft = structuredClone(current)
    draft.performance.dpi[0] = 450

    await expect(mouse.applyChanges(current, draft)).resolves.toBe(true)
    expect(transport.requests.map((request) => [request[2], request[4]])).toEqual([
      [0, 8],
      [0, 0],
    ])
  })

  it('adds and removes enabled DPI stages without rewriting their stored values', async () => {
    const transport = new FakeTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    const expanded = structuredClone(current)
    expanded.dpiPresetCount = 3

    await expect(mouse.applyChanges(current, expanded)).resolves.toBe(true)
    expect(transport.requests.map((request) => [request[2], request[4]])).toEqual([
      [10, 3],
      [0, 0],
    ])

    transport.requests = []
    const threeStageCurrent = structuredClone(expanded)
    threeStageCurrent.dpiPreset = 2
    const reduced = structuredClone(threeStageCurrent)
    reduced.dpiPresetCount = 2
    reduced.dpiPreset = 1

    await expect(mouse.applyChanges(threeStageCurrent, reduced)).resolves.toBe(true)
    expect(transport.requests.map((request) => [request[2], request[4]])).toEqual([
      [9, 2],
      [10, 2],
      [0, 0],
    ])
  })

  it('refuses DPI writes without an active preset and preserves non-device probe errors', async () => {
    const current = baseProfile()
    current.dpiPreset = null
    const draft = structuredClone(current)
    draft.performance.dpi[0] = 450
    const mouse = new AsusMouse(new FakeTransport())
    await expect(mouse.applyChanges(current, draft)).rejects.toThrow('没有报告当前 DPI 档位')

    class BrokenProbeTransport extends VirtualAsusDevice {
      override async query(request: Uint8Array) {
        if (request[2] === 9) throw new Error('USB probe failed')
        return super.query(request)
      }
    }
    await expect(new AsusMouse(new BrokenProbeTransport()).readCurrentProfile()).rejects
      .toThrow('USB probe failed')
  })

  it('validates DPI stage count and keeps the active stage inside the enabled range', async () => {
    const mouse = new AsusMouse(new FakeTransport())
    const current = baseProfile()
    const invalidCount = structuredClone(current)
    invalidCount.dpiPresetCount = 1
    await expect(mouse.applyChanges(current, invalidCount)).rejects.toThrow(
      'DPI 档位数量必须在 2–4 档之间',
    )

    invalidCount.dpiPresetCount = 2.5
    await expect(mouse.applyChanges(current, invalidCount)).rejects.toThrow(
      'DPI 档位数量必须在 2–4 档之间',
    )

    const invalidPreset = structuredClone(current)
    invalidPreset.dpiPreset = 2
    await expect(mouse.applyChanges(current, invalidPreset)).rejects.toThrow(
      '当前 DPI 档位超出了启用范围',
    )

    invalidPreset.dpiPreset = -1
    await expect(mouse.applyChanges(current, invalidPreset)).rejects.toThrow(
      '当前 DPI 档位超出了启用范围',
    )
  })

  it('reads and caches two, three, and four enabled DPI stages', async () => {
    class CountingDevice extends VirtualAsusDevice {
      stageSelections = 0

      override async query(request: Uint8Array) {
        if (request[2] === 9) this.stageSelections += 1
        return super.query(request)
      }
    }

    const twoStageDevice = new CountingDevice()
    const twoStageMouse = new AsusMouse(twoStageDevice)
    await expect(twoStageMouse.readCurrentProfile()).resolves.toMatchObject({ dpiPresetCount: 2 })
    const initialSelections = twoStageDevice.stageSelections
    await twoStageMouse.readCurrentProfile()
    expect(twoStageDevice.stageSelections).toBe(initialSelections)

    const threeStageDevice = new VirtualAsusDevice()
    await threeStageDevice.query(buildSetDpiPresetCountRequest(3))
    await expect(new AsusMouse(threeStageDevice).readCurrentProfile()).resolves.toMatchObject({
      dpiPresetCount: 3,
    })

    const fourStageDevice = new VirtualAsusDevice()
    await fourStageDevice.query(buildSetDpiPresetCountRequest(4))
    await fourStageDevice.query(buildSetDpiPresetRequest(3))
    await expect(new AsusMouse(fourStageDevice).readCurrentProfile()).resolves.toMatchObject({
      dpiPreset: 3,
      dpiPresetCount: 4,
    })
  })

  it('reads battery percentage and charging status independently of profile settings', async () => {
    await expect(new AsusMouse(new VirtualAsusDevice()).readBatteryStatus()).resolves.toEqual({
      percentage: 68,
      charging: false,
    })
  })

  it('writes and verifies both lift-off levels and can reset standard surface calibration', async () => {
    class CalibrationDevice extends VirtualAsusDevice {
      calibrationWrites = 0

      override async query(request: Uint8Array) {
        if (responseCode(request) === ASUS_COMMAND.setLiftOffDistance) {
          this.calibrationWrites += 1
        }
        return super.query(request)
      }
    }
    const device = new CalibrationDevice()
    const mouse = new AsusMouse(device)
    const current = await mouse.readCurrentProfile()
    const draft = structuredClone(current)
    draft.sensor.liftOffDistance = 'high'

    await expect(mouse.applyChangesSafely(current, draft)).resolves.toBe(true)
    await expect(mouse.readCurrentProfile()).resolves.toMatchObject({
      sensor: { liftOffDistance: 'high' },
    })
    await expect(mouse.resetSurfaceCalibration()).resolves.toEqual({ liftOffDistance: 'high' })
    expect(device.calibrationWrites).toBe(2)
  })

  it('uses four stages when a device cannot report its active DPI preset', async () => {
    class MissingActivePresetDevice extends VirtualAsusDevice {
      override async query(request: Uint8Array) {
        const response = await super.query(request)
        if (responseCode(request) === ASUS_COMMAND.getProfile) response[11] = 0
        return response
      }
    }

    await expect(new AsusMouse(new MissingActivePresetDevice()).readCurrentProfile()).resolves
      .toMatchObject({ dpiPreset: null, dpiPresetCount: 4 })

    const transport = new FakeTransport()
    const mouse = new AsusMouse(transport)
    const current = baseProfile()
    current.dpiPreset = null
    current.dpiPresetCount = 4
    const reduced = structuredClone(current)
    reduced.dpiPresetCount = 3
    await expect(mouse.applyChanges(current, reduced)).resolves.toBe(true)
    expect(transport.requests.map((request) => [request[2], request[4]])).toEqual([
      [10, 3],
      [0, 0],
    ])
  })

  it('does not send a save command when nothing changed', async () => {
    const transport = new FakeTransport()
    const mouse = new AsusMouse(transport)
    const profile = baseProfile()

    await expect(mouse.applyChanges(profile, structuredClone(profile))).resolves.toBe(false)
    expect(transport.requests).toHaveLength(0)
  })

  it('reads all onboard profiles and restores the previously active slot', async () => {
    const device = new VirtualAsusDevice()
    const mouse = new AsusMouse(device)
    await mouse.switchProfile(2)

    const profiles = await mouse.readAllProfiles()

    expect(profiles.map((profile) => profile.profileIndex)).toEqual([0, 1, 2, 3, 4])
    await expect(mouse.readCurrentProfile()).resolves.toMatchObject({ profileIndex: 2 })
  })

  it('restores all onboard profiles and activates the slot stored in the backup', async () => {
    const device = new VirtualAsusDevice()
    const mouse = new AsusMouse(device)
    const profiles = await mouse.readAllProfiles()
    profiles[0].performance.dpi[0] = 1200
    profiles[4].performance.pollingRate = 500

    const active = await mouse.restoreProfiles(profiles, 4)

    expect(active).toMatchObject({ profileIndex: 4, performance: { pollingRate: 500 } })
    await mouse.switchProfile(0)
    await expect(mouse.readCurrentProfile()).resolves.toMatchObject({
      profileIndex: 0,
      performance: { dpi: [1200, 800, 1600, 3200] },
    })
  })

  it('verifies changed fields after saving and restores the original values on mismatch', async () => {
    class IgnoresPollingRateDevice extends VirtualAsusDevice {
      override async query(request: Uint8Array) {
        if (responseCode(request) === ASUS_COMMAND.setSetting && request[2] === 4) {
          return request.slice()
        }
        return super.query(request)
      }
    }
    const device = new IgnoresPollingRateDevice()
    const mouse = new AsusMouse(device)
    const current = await mouse.readCurrentProfile()
    const draft = structuredClone(current)
    draft.performance.pollingRate = 500

    await expect(mouse.applyChangesSafely(current, draft)).rejects.toThrow(
      '写入校验失败：回报率；已自动恢复原配置',
    )
    await expect(mouse.readCurrentProfile()).resolves.toMatchObject({
      performance: { pollingRate: 1000 },
    })
  })

  it('rolls back fields already written when a later device command fails', async () => {
    class InterruptsWriteDevice extends VirtualAsusDevice {
      interrupted = false

      override async query(request: Uint8Array) {
        if (
          !this.interrupted
          && responseCode(request) === ASUS_COMMAND.setSetting
          && request[2] === 5
        ) {
          this.interrupted = true
          throw new Error('debounce write interrupted')
        }
        return super.query(request)
      }
    }
    const device = new InterruptsWriteDevice()
    const mouse = new AsusMouse(device)
    const current = await mouse.readCurrentProfile()
    const draft = structuredClone(current)
    draft.performance.pollingRate = 500
    draft.performance.debounce = 32

    await expect(mouse.applyChangesSafely(current, draft)).rejects.toThrow(
      'debounce write interrupted；已自动恢复原配置',
    )
    await expect(mouse.readCurrentProfile()).resolves.toMatchObject({
      performance: { pollingRate: 1000, debounce: 12 },
    })
  })

  it('validates full-profile restore inputs before changing the active slot', async () => {
    const mouse = new AsusMouse(new VirtualAsusDevice())
    const profiles = await mouse.readAllProfiles()
    await expect(mouse.restoreProfiles(profiles.slice(0, 4), 0)).rejects.toThrow(
      '恢复必须包含 5 个板载配置',
    )
    await expect(mouse.restoreProfiles(profiles, -1)).rejects.toThrow('活动配置档无效')
    await expect(mouse.restoreProfiles(profiles, 1.5)).rejects.toThrow('活动配置档无效')
    await expect(mouse.restoreProfiles(profiles, 5)).rejects.toThrow('活动配置档无效')
  })

  it('keeps validation failures unchanged and returns false for a verified no-op', async () => {
    const mouse = new AsusMouse(new VirtualAsusDevice())
    const current = await mouse.readCurrentProfile()
    await expect(mouse.applyChangesSafely(current, structuredClone(current))).resolves.toBe(false)
    const wrongProfile = structuredClone(current)
    wrongProfile.profileIndex = 1
    await expect(mouse.applyChangesSafely(current, wrongProfile)).rejects.toThrow(
      '配置档在编辑期间发生了变化',
    )
  })

  it('reports when automatic rollback cannot be written back to the device', async () => {
    class RejectsRollbackDevice extends VirtualAsusDevice {
      interrupted = false

      override async query(request: Uint8Array) {
        if (responseCode(request) === ASUS_COMMAND.setSetting && request[2] === 5) {
          this.interrupted = true
          throw new Error('write interrupted')
        }
        if (
          this.interrupted
          && responseCode(request) === ASUS_COMMAND.setSetting
          && request[2] === 4
        ) {
          throw new Error('rollback rejected')
        }
        return super.query(request)
      }
    }
    const mouse = new AsusMouse(new RejectsRollbackDevice())
    const current = await mouse.readCurrentProfile()
    const draft = structuredClone(current)
    draft.performance.pollingRate = 500
    draft.performance.debounce = 32

    await expect(mouse.applyChangesSafely(current, draft)).rejects.toThrow(
      'write interrupted；自动恢复失败：rollback rejected',
    )
  })

  it('preserves a non-Error interruption message after a successful rollback', async () => {
    class TextInterruptDevice extends VirtualAsusDevice {
      interrupted = false

      override async query(request: Uint8Array) {
        if (
          !this.interrupted
          && responseCode(request) === ASUS_COMMAND.setSetting
          && request[2] === 5
        ) {
          this.interrupted = true
          throw 'text interruption'
        }
        return super.query(request)
      }
    }
    const mouse = new AsusMouse(new TextInterruptDevice())
    const current = await mouse.readCurrentProfile()
    const draft = structuredClone(current)
    draft.performance.pollingRate = 500
    draft.performance.debounce = 32

    await expect(mouse.applyChangesSafely(current, draft)).rejects.toThrow(
      'text interruption；已自动恢复原配置',
    )
  })

  it('uses the intended draft as recovery input when post-failure readback also fails', async () => {
    class OneReadFailureDevice extends VirtualAsusDevice {
      failRead = false
      interrupted = false

      override async query(request: Uint8Array) {
        const command = responseCode(request)
        if (!this.interrupted && command === ASUS_COMMAND.setSetting && request[2] === 5) {
          this.interrupted = true
          this.failRead = true
          throw new Error('write and read interrupted')
        }
        if (this.failRead && command === ASUS_COMMAND.getProfile) {
          this.failRead = false
          throw new Error('readback unavailable')
        }
        return super.query(request)
      }
    }
    const mouse = new AsusMouse(new OneReadFailureDevice())
    const current = await mouse.readCurrentProfile()
    const draft = structuredClone(current)
    draft.performance.pollingRate = 500
    draft.performance.debounce = 32

    await expect(mouse.applyChangesSafely(current, draft)).rejects.toThrow(
      'write and read interrupted；已自动恢复原配置',
    )
  })

  it('reports fields that remain changed after the rollback command is silently ignored', async () => {
    class IgnoresRollbackDevice extends VirtualAsusDevice {
      interrupted = false

      override async query(request: Uint8Array) {
        const command = responseCode(request)
        if (!this.interrupted && command === ASUS_COMMAND.setSetting && request[2] === 5) {
          this.interrupted = true
          throw new Error('write interrupted')
        }
        if (
          this.interrupted
          && command === ASUS_COMMAND.setSetting
          && request[2] === 4
          && request[4] === 3
        ) {
          return request.slice()
        }
        return super.query(request)
      }
    }
    const mouse = new AsusMouse(new IgnoresRollbackDevice())
    const current = await mouse.readCurrentProfile()
    const draft = structuredClone(current)
    draft.performance.pollingRate = 500
    draft.performance.debounce = 32

    await expect(mouse.applyChangesSafely(current, draft)).rejects.toThrow(
      '自动恢复失败：恢复校验失败：回报率',
    )
  })

  it('rejects a surface-calibration reset whose lift-off level does not read back', async () => {
    class MismatchedCalibrationDevice extends VirtualAsusDevice {
      saved = false

      override async query(request: Uint8Array) {
        if (responseCode(request) === ASUS_COMMAND.save) this.saved = true
        const response = await super.query(request)
        if (this.saved && responseCode(request) === ASUS_COMMAND.getLiftOffDistance) {
          response[7] = 1
        }
        return response
      }
    }

    await expect(new AsusMouse(new MismatchedCalibrationDevice()).resetSurfaceCalibration())
      .rejects.toThrow('标准表面校准恢复后校验失败')
  })
})
