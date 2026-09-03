import { describe, expect, it } from 'vitest'
import { ASUS_COMMAND, BUTTON_ACTIONS } from './constants'
import { AsusMouse } from './mouse'
import { makeRequest } from './codec'
import { VirtualAsusDevice } from './simulator'

describe('VirtualAsusDevice', () => {
  it('rejects malformed and unsupported protocol commands', async () => {
    const device = new VirtualAsusDevice()

    await expect(device.query(new Uint8Array(63))).rejects.toThrow('ASUS 命令必须是 64 字节')
    await expect(device.query(makeRequest(0x9999))).rejects.toThrow(
      '虚拟鼠标不支持命令 0x9999',
    )
  })

  it('exercises every supported setting through the real mouse protocol without hardware', async () => {
    const mouse = new AsusMouse(new VirtualAsusDevice())
    const current = await mouse.readCurrentProfile()
    const draft = structuredClone(current)

    expect(current.dpiPresetCount).toBe(2)
    draft.dpiPresetCount = 4
    draft.dpiPreset = 0

    draft.performance.dpi = [100, 1200, 16_000, 36_000]
    draft.dpiColors[1] = { r: 0x11, g: 0x22, b: 0x33 }
    draft.performance.pollingRate = 500
    draft.performance.debounce = 32
    draft.performance.angleSnapping = true
    draft.sensor.liftOffDistance = 'high'
    draft.buttons[3].action = BUTTON_ACTIONS.find(
      (action) => action.kind === 'keyboard' && action.label === 'A',
    )!
    draft.buttons[2].action = BUTTON_ACTIONS.find((action) => action.kind === 'disabled')!
    draft.buttons[1].action = BUTTON_ACTIONS.find(
      (action) => action.kind === 'mouse' && action.label === '左键',
    )!
    draft.led = {
      mode: 1,
      brightness: 50,
      color: { r: 0x12, g: 0x34, b: 0x56 },
    }

    await expect(mouse.applyChangesSafely(current, draft)).resolves.toBe(true)
    await expect(mouse.readCurrentProfile()).resolves.toMatchObject({
      profileIndex: 0,
      dpiPresetCount: 4,
      performance: draft.performance,
      sensor: draft.sensor,
      buttons: expect.arrayContaining([
        expect.objectContaining({
          sourceCode: draft.buttons[2].sourceCode,
          action: expect.objectContaining({ kind: 'disabled' }),
        }),
        expect.objectContaining({
          sourceCode: draft.buttons[1].sourceCode,
          action: expect.objectContaining({ kind: 'mouse', code: 0xf0 }),
        }),
        expect.objectContaining({
          sourceCode: draft.buttons[3].sourceCode,
          action: expect.objectContaining({ kind: 'keyboard', code: 0x04 }),
        }),
      ]),
      led: draft.led,
    })

    const second = await mouse.switchProfile(1)
    expect(second.profileIndex).toBe(1)
    expect(second.dpiPresetCount).toBe(2)
    expect(second.performance.dpi).toEqual([400, 800, 1600, 3200])

    const restored = await mouse.switchProfile(0)
    expect(restored.dpiPresetCount).toBe(4)
    expect(restored.performance).toEqual(draft.performance)
    expect(restored.led).toEqual(draft.led)

    const ignoredSetting = makeRequest(ASUS_COMMAND.setSetting)
    ignoredSetting[2] = 0xff
    const simulator = new VirtualAsusDevice()
    await simulator.query(ignoredSetting)
    const ignoredButton = makeRequest(ASUS_COMMAND.setButton)
    ignoredButton.set([0x01, 0xff, 0x01], 4)
    await simulator.query(ignoredButton)
  })
})
