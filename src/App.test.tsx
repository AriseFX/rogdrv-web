import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AsusCommandRejectedError } from './protocol/asus/codec'
import { AsusMouse } from './protocol/asus/mouse'
import { VirtualAsusDevice } from './protocol/asus/simulator'

class InteractiveHidDevice {
  productName = 'ROG Gladius III Wireless AimPoint'
  vendorId = 0x0b05
  productId = 0x1a72
  opened = false
  collections = [{
    usagePage: 0xff01,
    usage: 1,
    inputReports: [{ reportId: 7, items: [{ reportSize: 8, reportCount: 64 }] }],
    outputReports: [{ reportId: 7, items: [{ reportSize: 8, reportCount: 64 }] }],
  }] as HIDCollectionInfo[]
  private readonly simulator = new VirtualAsusDevice()
  private inputListener: ((event: HIDInputReportEvent) => void) | null = null
  open = vi.fn(async () => {
    this.opened = true
  })
  close = vi.fn(async () => {
    this.opened = false
  })
  sendReport = vi.fn(async (reportId: number, data: BufferSource) => {
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    let response: Uint8Array
    try {
      response = await this.simulator.query(bytes)
    } catch (error) {
      if (!(error instanceof AsusCommandRejectedError)) throw error
      response = bytes.slice()
      response[0] = 0xaa
      response[1] = 0xff
    }
    this.inputListener?.({
      reportId,
      data: new DataView(response.buffer, response.byteOffset, response.byteLength),
    } as HIDInputReportEvent)
  })
  addEventListener = vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
    this.inputListener = listener as (event: HIDInputReportEvent) => void
  })
  removeEventListener = vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
    if (this.inputListener === listener) this.inputListener = null
  })
}

function installWebHid(devices: object[], authorizedDevices: object[] = []) {
  let disconnectListener: ((event: HIDConnectionEvent) => void) | null = null
  const hid = {
    requestDevice: vi.fn(async () => devices),
    getDevices: vi.fn(async () => authorizedDevices),
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      disconnectListener = listener as (event: HIDConnectionEvent) => void
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      if (disconnectListener === listener) disconnectListener = null
    }),
    disconnect(device: object) {
      disconnectListener?.({ device } as HIDConnectionEvent)
    },
  }
  Object.defineProperty(navigator, 'hid', { configurable: true, value: hid })
  return hid
}

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  Reflect.deleteProperty(navigator, 'hid')
  vi.doUnmock('./hooks/useAsusMouse')
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('demo mode', () => {
  it('renders a static mouse overview and keeps page controls compact', async () => {
    window.history.replaceState({}, '', '/?demo=1')
    const { default: App } = await import('./App')
    render(<App />)

    expect(screen.queryByRole('button', { name: '显示月耀白鼠标' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示黑色鼠标' })).not.toBeInTheDocument()
    expect(await screen.findByRole('img', { name: '通用游戏鼠标黑色示意图' })).toHaveAttribute(
      'data-color',
      'black',
    )
    const sideButtons = document.querySelectorAll('.mouse-side-button')
    expect(sideButtons).toHaveLength(2)
    expect(sideButtons[0]).toHaveAttribute('y', '148')
    expect(sideButtons[1]).toHaveAttribute('y', '195')
    expect(document.querySelector('[data-control]')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '鼠标实时输入' })).not.toBeInTheDocument()
    expect(screen.queryByText('PROFILE 01')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '性能与控制' })).not.toBeInTheDocument()
    expect(screen.getByText('主 / 接收器固件').parentElement).toHaveTextContent(
      '01.08.03 / 01.04.02',
    )
    expect(document.querySelector('.content-panel')).toContainElement(
      screen.getByText('ROGDRV WEB · COMMUNITY PROJECT').closest('footer'),
    )

    fireEvent.click(screen.getByRole('button', { name: '选择 DPI 档位 1' }))
    const stageOneCurrent = screen.getByRole('button', { name: 'DPI 档位 1 设为当前' })
    fireEvent.click(stageOneCurrent)
    expect(screen.getByRole('button', { name: 'DPI 档位 1 当前档' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: '选择 DPI 档位 2' }))
    const stageTwoValue = screen.getByLabelText('DPI 档位 2 数值')
    const decreaseStageTwo = screen.getByRole('button', { name: 'DPI 档位 2 减少 50' })
    const increaseStageTwo = screen.getByRole('button', { name: 'DPI 档位 2 增加 50' })
    fireEvent.click(decreaseStageTwo)
    expect(stageTwoValue).toHaveValue(750)
    fireEvent.click(increaseStageTwo)
    expect(stageTwoValue).toHaveValue(800)
    fireEvent.change(stageTwoValue, { target: { value: '100' } })
    expect(decreaseStageTwo).toBeDisabled()
    fireEvent.change(stageTwoValue, { target: { value: '36000' } })
    expect(increaseStageTwo).toBeDisabled()
    fireEvent.change(stageTwoValue, { target: { value: '800' } })

    const decreaseDpiStages = screen.getByRole('button', { name: '减少 DPI 档位' })
    const increaseDpiStages = screen.getByRole('button', { name: '增加 DPI 档位' })
    expect(decreaseDpiStages).toBeDisabled()
    expect(screen.getByLabelText('DPI 档位 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '选择 DPI 档位 3' })).not.toBeInTheDocument()
    fireEvent.click(increaseDpiStages)
    expect(screen.getByLabelText('DPI 档位 3')).toBeInTheDocument()
    expect(decreaseDpiStages).toBeEnabled()
    fireEvent.click(increaseDpiStages)
    expect(screen.getByLabelText('DPI 档位 4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '增加 DPI 档位' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '选择 DPI 档位 2' }))
    fireEvent.click(decreaseDpiStages)
    fireEvent.click(decreaseDpiStages)
    expect(screen.queryByRole('button', { name: '选择 DPI 档位 3' })).not.toBeInTheDocument()
    expect(decreaseDpiStages).toBeDisabled()
    expect(screen.getByRole('button', { name: '增加 DPI 档位' })).toBeInTheDocument()

    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    window.dispatchEvent(contextMenu)
    expect(contextMenu.defaultPrevented).toBe(true)
  })

  it('edits and discards every exposed control and shows protocol diagnostics', async () => {
    window.history.replaceState({}, '', '/?demo=1')
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    fireEvent.change(await screen.findByLabelText('DPI 档位 2'), {
      target: { value: '500' },
    })
    expect(screen.getByLabelText('DPI 档位 2 数值')).toHaveValue(1900)
    fireEvent.change(screen.getByLabelText('DPI 档位 2 颜色'), {
      target: { value: '#654321' },
    })
    await user.click(screen.getByRole('button', { name: '500Hz' }))
    expect(screen.getByRole('button', { name: '500Hz' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '按键去抖 32ms' }))
    expect(screen.getByRole('button', { name: '按键去抖 32ms' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('checkbox', { name: /直线修正/ }))
    await user.click(screen.getByRole('button', { name: 'Logo 灯效模式 呼吸' }))
    expect(screen.getByRole('button', { name: 'Logo 灯效模式 呼吸' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Logo 灯效模式 彩虹' }))
    expect(screen.queryByLabelText('Logo 灯效颜色')).not.toBeInTheDocument()
    expect(screen.getByText('循环色谱')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Logo 灯效模式 呼吸' }))
    await user.click(screen.getByRole('button', { name: '设置 Logo 颜色 #3478FF' }))
    expect(screen.getByLabelText('Logo 灯效颜色')).toHaveValue('#3478ff')
    fireEvent.change(screen.getByLabelText('Logo 灯效颜色'), { target: { value: '#123456' } })
    fireEvent.change(screen.getByLabelText('Logo 灯效亮度'), { target: { value: '75' } })
    await user.click(screen.getByRole('button', { name: '编辑侧键 · 前进映射' }))
    await user.click(screen.getByRole('tab', { name: '键盘按键' }))
    await user.click(screen.getByRole('button', { name: '映射为A' }))
    expect(screen.getByRole('button', { name: '映射为A' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '编辑左键映射' }))
    expect(screen.getByRole('tab', { name: '鼠标动作' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: '编辑侧键 · 前进映射' }))
    expect(screen.getByRole('tab', { name: '键盘按键' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: '鼠标动作' }))
    expect(screen.getByRole('tab', { name: '鼠标动作' })).toHaveAttribute('aria-selected', 'true')

    expect(screen.getByText(/保存或放弃更改后/)).toBeInTheDocument()
    expect(screen.getAllByText('#123456')).toHaveLength(2)
    expect(screen.getByText('75%')).toBeInTheDocument()
    const applyButton = screen.getByRole('button', { name: '应用到设备' })
    expect(screen.getByRole('banner')).toContainElement(applyButton)
    expect(document.querySelector('.save-dock')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '放弃' }))
    expect(screen.queryByText(/保存或放弃更改后/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('DPI 档位 2 数值')).toHaveValue(800)

    await user.click(screen.getByRole('button', { name: /设备诊断/ }))
    expect(screen.getByText('0b05:1a70')).toBeInTheDocument()
    expect(screen.getByText(/演示模式：未连接真实硬件/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /设备诊断/ }))
    expect(screen.queryByText('0b05:1a70')).not.toBeInTheDocument()
  })

  it('links the right-side lighting editor to the selected lighting mode', async () => {
    window.history.replaceState({}, '', '/?demo=1')
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Logo 灯效模式 电量指示' }))
    expect(screen.queryByLabelText('Logo 灯效颜色')).not.toBeInTheDocument()
    expect(screen.getByText('电量色阶')).toBeInTheDocument()
    expect(screen.getByLabelText('Logo 灯效预览')).toHaveAttribute('data-mode', 'battery')
    expect(screen.getByText('高电量')).toBeInTheDocument()
    expect(screen.getByText('中电量')).toBeInTheDocument()
    expect(screen.getByText('低电量')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Logo 灯效模式 彩虹' }))
    expect(screen.getByText('循环色谱')).toBeInTheDocument()
    expect(screen.getByLabelText('Logo 灯效预览')).toHaveAttribute('data-mode', 'rainbow')

    await user.click(screen.getByRole('button', { name: 'Logo 灯效模式 关闭' }))
    expect(screen.getByText('灯效已关闭')).toBeInTheDocument()
    expect(screen.getByLabelText('Logo 灯效亮度')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Logo 灯效模式 常亮' }))
    expect(screen.getByLabelText('Logo 灯效颜色')).toBeEnabled()
    expect(screen.getByLabelText('Logo 灯效亮度')).toBeEnabled()
  })

  it('persists an applied setting independently in each virtual onboard profile', async () => {
    window.history.replaceState({}, '', '/?demo=1')
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '选择 DPI 档位 1' }))
    const firstDpi = screen.getByLabelText('DPI 档位 1 数值')
    fireEvent.change(firstDpi, { target: { value: '1200' } })
    await user.click(screen.getByRole('button', { name: '增加 DPI 档位' }))
    expect(screen.getByRole('button', { name: '选择 DPI 档位 3' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /应用到设备/ }))
    await waitFor(() => expect(screen.queryByText(/保存或放弃更改后/)).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '切换到配置 2' }))
    await user.click(screen.getByRole('button', { name: '选择 DPI 档位 1' }))
    expect(screen.getByLabelText('DPI 档位 1 数值')).toHaveValue(400)
    expect(screen.queryByRole('button', { name: '选择 DPI 档位 3' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '切换到配置 1' }))
    await user.click(screen.getByRole('button', { name: '选择 DPI 档位 1' }))
    expect(screen.getByLabelText('DPI 档位 1 数值')).toHaveValue(1200)
    expect(screen.getByRole('button', { name: '选择 DPI 档位 3' })).toBeInTheDocument()
  })

  it('can disconnect and reconnect the virtual mouse', async () => {
    window.history.replaceState({}, '', '/?demo=1')
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '断开' }))
    expect(screen.getByRole('button', { name: '连接鼠标' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '连接战刃 III' })).toBeInTheDocument()
    expect(screen.getByText('完全退出 Armoury Crate')).toBeInTheDocument()
    expect(screen.queryByText(/轻量、透明/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '连接鼠标' }))
    expect(await screen.findByRole('button', { name: '断开' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'DPI 灵敏度' })).toBeInTheDocument()
  })

  it('reconnects through the previously authorized-device action', async () => {
    window.history.replaceState({}, '', '/?demo=1')
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '断开' }))
    await user.click(screen.getByRole('button', { name: '使用已授权设备' }))

    expect(await screen.findByRole('button', { name: '断开' })).toBeInTheDocument()
  })

  it('turns non-Error protocol failures into readable switch and apply errors', async () => {
    window.history.replaceState({}, '', '/?demo=1')
    const simulatorModule = await import('./protocol/asus/simulator')
    const query = vi.spyOn(simulatorModule.VirtualAsusDevice.prototype, 'query')
    const { useAsusMouse } = await import('./hooks/useAsusMouse')
    const { result } = renderHook(() => useAsusMouse())

    query.mockRejectedValueOnce('switch failed')
    await act(async () => result.current.switchProfile(1))
    expect(result.current.error).toBe('switch failed')

    act(() => {
      result.current.setDraft((current) => current ? {
        ...current,
        performance: { ...current.performance, dpi: [1200, 800, 1600, 3200] },
      } : current)
    })
    query.mockRejectedValueOnce('apply failed')
    await act(async () => result.current.apply())
    expect(result.current.error).toBe('apply failed')
  })
})

describe('WebHID connection', () => {
  it('keeps disconnected operations safe when WebHID is unavailable', async () => {
    const { useAsusMouse } = await import('./hooks/useAsusMouse')
    const { result } = renderHook(() => useAsusMouse())

    await act(async () => {
      await result.current.connect()
      await expect(result.current.reconnect()).resolves.toBe(false)
      await result.current.switchProfile(1)
      await result.current.apply()
      result.current.discard()
      await result.current.disconnect()
    })

    expect(result.current.connectionState).toBe('idle')
  })

  it('keeps a user-cancelled device picker silent', async () => {
    const hid = installWebHid([])
    hid.requestDevice.mockRejectedValueOnce(new DOMException('cancelled', 'NotFoundError'))
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /授权并连接/ }))
    await waitFor(() => expect(hid.requestDevice).toHaveBeenCalledOnce())

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a device-picker failure even when the browser rejects with a non-Error value', async () => {
    const hid = installWebHid([])
    hid.requestDevice.mockRejectedValueOnce('permission denied')
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /授权并连接/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
    hid.requestDevice.mockResolvedValueOnce([])
    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(hid.requestDevice).toHaveBeenCalledTimes(2))

    hid.requestDevice.mockRejectedValueOnce(new Error('picker failed'))
    await user.click(screen.getByRole('button', { name: '连接鼠标' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('picker failed')
  })

  it('connects an already-open HID and keeps an unknown product definition neutral', async () => {
    const device = new InteractiveHidDevice()
    device.opened = true
    device.productId = 0xffff
    installWebHid([device])
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /授权并连接/ }))

    expect(await screen.findByRole('heading', { name: 'DPI 灵敏度' })).toBeInTheDocument()
    expect(device.open).not.toHaveBeenCalled()
    expect(screen.getByText('USB 有线')).toBeInTheDocument()
  })

  it('reports a non-Error device-open rejection without attempting a close', async () => {
    const device = new InteractiveHidDevice()
    device.open.mockRejectedValueOnce('open denied')
    installWebHid([device])
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /授权并连接/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('open denied')
    expect(device.close).not.toHaveBeenCalled()
  })

  it('closes a transport that fails while reading the initial profile', async () => {
    const device = new InteractiveHidDevice()
    device.sendReport.mockRejectedValueOnce(new Error('read failed'))
    device.close.mockRejectedValueOnce(new Error('close failed'))
    installWebHid([device])
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /授权并连接/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('发送 HID 命令失败')
    expect(device.close).toHaveBeenCalledOnce()
    expect(device.removeEventListener).toHaveBeenCalledWith('inputreport', expect.any(Function))
  })

  it('surfaces profile-switch and apply failures while keeping the session usable', async () => {
    const device = new InteractiveHidDevice()
    installWebHid([device])
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /授权并连接/ }))
    await screen.findByRole('heading', { name: 'DPI 灵敏度' })

    device.sendReport.mockRejectedValueOnce(new Error('profile switch failed'))
    await user.click(screen.getByRole('button', { name: '切换到配置 2' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('发送 HID 命令失败')

    await user.click(screen.getByRole('button', { name: '选择 DPI 档位 1' }))
    fireEvent.change(screen.getByLabelText('DPI 档位 1 数值'), {
      target: { value: '1200' },
    })
    const requestsBeforeApply = device.sendReport.mock.calls.length
    device.sendReport.mockRejectedValueOnce(new Error('apply failed'))
    await user.click(screen.getByRole('button', { name: /应用到设备/ }))
    await waitFor(() => expect(device.sendReport).toHaveBeenCalledTimes(requestsBeforeApply + 1))
    expect(screen.getByRole('alert')).toHaveTextContent('发送 HID 命令失败')
    await waitFor(() => expect(screen.getByRole('button', { name: /应用到设备/ })).toBeEnabled())
  })

  it('cleans up the transport when the connected device is unplugged', async () => {
    const device = new InteractiveHidDevice()
    const hid = installWebHid([device])
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /授权并连接/ }))
    expect(await screen.findByRole('heading', { name: 'DPI 灵敏度' })).toBeInTheDocument()
    expect(screen.getByText('2.4G RF')).toBeInTheDocument()

    hid.disconnect({})
    expect(screen.getByRole('heading', { name: 'DPI 灵敏度' })).toBeInTheDocument()

    device.close.mockRejectedValueOnce(new Error('close failed'))
    hid.disconnect(device)

    expect(await screen.findByRole('alert')).toHaveTextContent('鼠标已断开连接')
    expect(device.removeEventListener).toHaveBeenCalledWith('inputreport', expect.any(Function))
  })

  it('renders preserved unknown mappings and empty diagnostic fallbacks', async () => {
    const profile = await new AsusMouse(new VirtualAsusDevice()).readCurrentProfile()
    profile.dpiPreset = null
    profile.dpiPresetCount = 3
    profile.led.mode = 0xab
    profile.buttons[0].action = { kind: 'unknown', code: 0xab, label: '未知动作 AB' }
    const setDraft = vi.fn((updater: unknown) => {
      if (typeof updater === 'function') {
        const applyUpdater = updater as (current: null) => null
        applyUpdater(null)
        const applyProfileUpdater = updater as (current: typeof profile) => typeof profile
        applyProfileUpdater(profile)
      }
    })
    vi.doMock('./hooks/useAsusMouse', () => ({
      useAsusMouse: () => ({
        connectionState: 'connected',
        connected: true,
        deviceDefinition: null,
        profile,
        draft: profile,
        setDraft,
        diagnostics: null,
        logs: [],
        error: null,
        busy: false,
        dirty: false,
        connect: vi.fn(),
        reconnect: vi.fn(),
        disconnect: vi.fn(),
        switchProfile: vi.fn(),
        apply: vi.fn(),
        discard: vi.fn(),
      }),
    }))
    const { default: App } = await import('./App')
    render(<App />)

    expect(screen.getAllByText('未知动作 AB')).toHaveLength(2)
    expect(screen.getByText('保留')).toBeInTheDocument()
    expect(screen.getByText('未知模式')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '选择 DPI 档位 1' }))
    fireEvent.change(screen.getByLabelText('DPI 档位 1 数值'), { target: { value: '1200' } })
    expect(setDraft).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '增加 DPI 档位' }))
    expect(setDraft).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '减少 DPI 档位' }))
    expect(setDraft).toHaveBeenCalledTimes(3)

    await userEvent.setup().click(screen.getByRole('button', { name: /设备诊断/ }))
    expect(screen.getByText('尚无通信记录')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(3)
  })

  it('resets the UI even if closing the device fails during manual disconnect', async () => {
    const device = new InteractiveHidDevice()
    installWebHid([device])
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /授权并连接/ }))
    await screen.findByRole('heading', { name: 'DPI 灵敏度' })
    device.close.mockRejectedValueOnce(new Error('close failed'))
    await user.click(screen.getByRole('button', { name: '断开' }))

    expect(await screen.findByRole('button', { name: '连接鼠标' })).toBeInTheDocument()
  })

  it('shows a browser support message when WebHID is unavailable', async () => {
    const { default: App } = await import('./App')

    render(<App />)

    expect(screen.getByRole('heading', { name: '当前浏览器不支持 WebHID' })).toBeInTheDocument()
  })

  it('reports when no previously authorized supported device is available', async () => {
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: {
        requestDevice: vi.fn(async () => []),
        getDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '使用已授权设备' }))

    expect(await screen.findByRole('button', { name: '没有已授权设备' })).toBeInTheDocument()
  })

  it('reports no authorized device when browser lookup rejects', async () => {
    const hid = installWebHid([])
    hid.getDevices.mockRejectedValue(new Error('lookup failed'))
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '使用已授权设备' }))

    expect(await screen.findByRole('button', { name: '没有已授权设备' })).toBeInTheDocument()
  })

  it('cancels an automatic authorized-device lookup when the page unmounts', async () => {
    const device = new InteractiveHidDevice()
    const hid = installWebHid([])
    let resolveLookup: (devices: object[]) => void = () => undefined
    hid.getDevices.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLookup = resolve
    }))
    const { default: App } = await import('./App')
    const view = render(<App />)

    await waitFor(() => expect(hid.getDevices).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => {
      resolveLookup([device])
      await Promise.resolve()
    })

    expect(device.open).not.toHaveBeenCalled()
  })

  it('automatically skips unrelated authorized devices and reconnects the supported receiver', async () => {
    const receiver = new InteractiveHidDevice()
    const unrelated = { vendorId: 0x1234, productId: 0x5678 }
    const hid = installWebHid([], [unrelated, receiver])
    const { default: App } = await import('./App')
    render(<App />)

    expect(await screen.findByText('2.4G RF')).toBeInTheDocument()
    expect(hid.getDevices).toHaveBeenCalledOnce()
    expect(hid.requestDevice).not.toHaveBeenCalled()
    expect(receiver.open).toHaveBeenCalledOnce()
  })

  it('tries every matching HID interface until it finds the writable receiver interface', async () => {
    const unusableInterface = {
      opened: false,
      productName: 'ROG GIII WIRELESS AIMPOINT',
      vendorId: 0x0b05,
      productId: 0x1a72,
      collections: [],
      open: vi.fn(async function (this: { opened: boolean }) {
        this.opened = true
      }),
      close: vi.fn(async function (this: { opened: boolean }) {
        this.opened = false
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const receiver = new InteractiveHidDevice()
    installWebHid([], [unusableInterface, receiver])
    const { default: App } = await import('./App')
    render(<App />)

    expect(await screen.findByText('2.4G RF')).toBeInTheDocument()
    expect(unusableInterface.open).toHaveBeenCalledOnce()
    expect(unusableInterface.close).toHaveBeenCalledOnce()
    expect(receiver.open).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the first meaningful receiver error after trying unusable sibling interfaces', async () => {
    const receiver = new InteractiveHidDevice()
    receiver.sendReport.mockRejectedValue(new Error('mouse asleep'))
    const unusableInterface = {
      opened: false,
      productName: receiver.productName,
      vendorId: receiver.vendorId,
      productId: receiver.productId,
      collections: [],
      open: vi.fn(async function (this: { opened: boolean }) {
        this.opened = true
      }),
      close: vi.fn(async function (this: { opened: boolean }) {
        this.opened = false
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    installWebHid([], [receiver, unusableInterface])
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => expect(unusableInterface.close).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '使用已授权设备' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('发送 HID 命令失败')
  })

  it('does not report success when an authorized device fails to open', async () => {
    const device = {
      opened: false,
      productName: 'Incomplete ASUS HID',
      vendorId: 0x0b05,
      productId: 0x1a70,
      collections: [],
      open: vi.fn(async function (this: { opened: boolean }) {
        this.opened = true
      }),
      close: vi.fn(async function (this: { opened: boolean }) {
        this.opened = false
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    installWebHid([], [device])
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => expect(device.close).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '使用已授权设备' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('没有找到可写入的 HID Output Report')
    expect(screen.getByRole('button', { name: '没有已授权设备' })).toBeInTheDocument()
  })

  it('closes a device that opened but has no compatible output report', async () => {
    const device = {
      opened: false,
      productName: 'Incomplete ASUS HID',
      vendorId: 0x0b05,
      productId: 0x1a70,
      collections: [],
      open: vi.fn(async function (this: { opened: boolean }) {
        this.opened = true
      }),
      close: vi.fn(async function (this: { opened: boolean }) {
        this.opened = false
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: {
        requestDevice: vi.fn(async () => [device]),
        getDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    const { default: App } = await import('./App')
    const user = userEvent.setup()
    render(<App />)

    device.close.mockRejectedValueOnce(new Error('close failed'))

    await user.click(screen.getByRole('button', { name: /授权并连接/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('没有找到可写入的 HID Output Report')
    expect(device.close).toHaveBeenCalledOnce()
  })
})
