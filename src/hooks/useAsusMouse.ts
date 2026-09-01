import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createMouseBackup } from '../protocol/asus/backup'
import { SUPPORTED_DEVICES } from '../protocol/asus/constants'
import { AsusMouse } from '../protocol/asus/mouse'
import { VirtualAsusDevice } from '../protocol/asus/simulator'
import { AsusHidTransport } from '../protocol/asus/transport'
import type {
  BatteryStatus,
  MouseBackup,
  ProfileSnapshot,
  SupportedDevice,
  TransportDiagnostics,
  TransportLogEntry,
} from '../protocol/asus/types'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'unsupported'

const demoMode = new URLSearchParams(window.location.search).has('demo')
const demoMouse = demoMode ? new AsusMouse(new VirtualAsusDevice()) : null
const demoStartedAt = Date.now()
const demoDiagnostics: TransportDiagnostics = {
  productName: 'ROG Gladius III Wireless AimPoint (Demo)',
  vendorId: 0x0b05,
  productId: 0x1a70,
  reportId: 0,
  collectionCount: 1,
  vendorCollections: ['0xff01:0x0001'],
}
const demoBattery: BatteryStatus = { percentage: 68, charging: false }

const makeDemoProfile = (profileIndex = 0): ProfileSnapshot => ({
  profileIndex,
  dpiPreset: 1,
  dpiPresetCount: 2,
  primaryFirmware: { major: 1, minor: 8, build: 3 },
  secondaryFirmware: { major: 1, minor: 4, build: 2 },
  performance: {
    dpi: [400, 800, 1600, 3200],
    pollingRate: 1000,
    debounce: 12,
    angleSnapping: false,
  },
  sensor: { liftOffDistance: 'low' },
  dpiColors: [
    { r: 0xff, g: 0x00, b: 0x00 },
    { r: 0xc1, g: 0x00, b: 0xff },
    { r: 0x00, g: 0x3d, b: 0xff },
    { r: 0x31, g: 0xff, b: 0x00 },
  ],
  buttons: [
    { index: 0, sourceCode: 0xf0, sourceLabel: '左键', action: { kind: 'mouse', code: 0xf0, label: '左键' } },
    { index: 1, sourceCode: 0xf1, sourceLabel: '右键', action: { kind: 'mouse', code: 0xf1, label: '右键' } },
    { index: 2, sourceCode: 0xf2, sourceLabel: '滚轮按下', action: { kind: 'mouse', code: 0xf2, label: '中键' } },
    { index: 3, sourceCode: 0xe4, sourceLabel: '侧键 · 后退', action: { kind: 'mouse', code: 0xe4, label: '后退' } },
    { index: 4, sourceCode: 0xe5, sourceLabel: '侧键 · 前进', action: { kind: 'mouse', code: 0xe5, label: '前进' } },
    { index: 5, sourceCode: 0xe6, sourceLabel: 'DPI 循环', action: { kind: 'mouse', code: 0xe6, label: 'DPI 循环' } },
    { index: 6, sourceCode: 0xe8, sourceLabel: '滚轮向上', action: { kind: 'mouse', code: 0xe8, label: '滚轮向上' } },
    { index: 7, sourceCode: 0xe9, sourceLabel: '滚轮向下', action: { kind: 'mouse', code: 0xe9, label: '滚轮向下' } },
  ],
  led: { mode: 0, brightness: 100, color: { r: 243, g: 52, b: 74 } },
})

const isSupported = (device: HIDDevice) =>
  SUPPORTED_DEVICES.some(
    (candidate) =>
      candidate.vendorId === device.vendorId && candidate.productId === device.productId,
  )

const definitionFor = (device: HIDDevice) =>
  SUPPORTED_DEVICES.find(
    (candidate) =>
      candidate.vendorId === device.vendorId && candidate.productId === device.productId,
  )

const snapshotsEqual = (left: ProfileSnapshot, right: ProfileSnapshot) =>
  JSON.stringify(left) === JSON.stringify(right)

export function useAsusMouse() {
  const transportRef = useRef<AsusHidTransport | null>(null)
  const mouseRef = useRef<AsusMouse | null>(demoMouse)

  const initialDemoProfile = demoMode ? makeDemoProfile() : null
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    demoMode ? 'connected' : 'hid' in navigator ? 'idle' : 'unsupported',
  )
  const [deviceDefinition, setDeviceDefinition] = useState<SupportedDevice | null>(
    demoMode ? SUPPORTED_DEVICES[0] : null,
  )
  const [profile, setProfile] = useState<ProfileSnapshot | null>(initialDemoProfile)
  const [draft, setDraft] = useState<ProfileSnapshot | null>(
    initialDemoProfile ? structuredClone(initialDemoProfile) : null,
  )
  const [diagnostics, setDiagnostics] = useState<TransportDiagnostics | null>(
    demoMode ? demoDiagnostics : null,
  )
  const [battery, setBattery] = useState<BatteryStatus | null>(demoMode ? demoBattery : null)
  const [logs, setLogs] = useState<TransportLogEntry[]>(
    demoMode ? [{ direction: 'info', message: '演示模式：未连接真实硬件', timestamp: demoStartedAt }] : [],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connected = connectionState === 'connected'
  const dirty = useMemo(
    () => profile !== null && draft !== null && !snapshotsEqual(profile, draft),
    [draft, profile],
  )

  const appendLog = useCallback((entry: TransportLogEntry) => {
    setLogs((current) => [...current.slice(-119), entry])
  }, [])

  const readBattery = useCallback(async (mouse: AsusMouse) => {
    try {
      return await mouse.readBatteryStatus()
    } catch (cause) {
      appendLog({
        direction: 'info',
        message: `电量读取不可用：${cause instanceof Error ? cause.message : String(cause)}`,
        timestamp: Date.now(),
      })
      return null
    }
  }, [appendLog])

  const resetConnection = useCallback(() => {
    transportRef.current = null
    if (!demoMode) mouseRef.current = null
    setConnectionState('idle')
    setDeviceDefinition(null)
    setProfile(null)
    setDraft(null)
    setDiagnostics(null)
    setBattery(null)
    setBusy(false)
  }, [])

  const openDemoDevice = useCallback(async () => {
    const mouse = mouseRef.current!
    setConnectionState('connecting')
    setError(null)
    const snapshot = await mouse.readCurrentProfile()
    setBattery(await readBattery(mouse))
    setDeviceDefinition(SUPPORTED_DEVICES[0])
    setProfile(snapshot)
    setDraft(structuredClone(snapshot))
    setDiagnostics(demoDiagnostics)
    appendLog({
      direction: 'info',
      message: '演示模式：虚拟鼠标已连接',
      timestamp: Date.now(),
    })
    setConnectionState('connected')
    return true
  }, [appendLog, readBattery])

  const openDevice = useCallback(
    async (device: HIDDevice) => {
      setConnectionState('connecting')
      try {
        if (!device.opened) await device.open()
        const transport = new AsusHidTransport(device, appendLog)
        const mouse = new AsusMouse(transport)
        transportRef.current = transport
        mouseRef.current = mouse
        setDiagnostics(transport.diagnostics)
        setDeviceDefinition(definitionFor(device) ?? null)
        const snapshot = await mouse.readCurrentProfile()
        setBattery(await readBattery(mouse))
        setProfile(snapshot)
        setDraft(structuredClone(snapshot))
        setConnectionState('connected')
        return null
      } catch (cause) {
        if (transportRef.current?.device === device) {
          await transportRef.current.close().catch(() => undefined)
        } else if (device.opened) {
          await device.close().catch(() => undefined)
        }
        resetConnection()
        return cause instanceof Error ? cause.message : String(cause)
      }
    },
    [appendLog, readBattery, resetConnection],
  )

  const openFirstCompatibleDevice = useCallback(
    async (devices: HIDDevice[], reportError = true) => {
      setError(null)
      setLogs([])
      let firstError: string | null = null
      for (const device of devices) {
        const deviceError = await openDevice(device)
        if (deviceError === null) return true
        firstError ??= deviceError
      }
      if (firstError !== null && reportError) setError(firstError)
      return false
    },
    [openDevice],
  )

  const connect = useCallback(async () => {
    if (demoMode) {
      await openDemoDevice()
      return
    }
    if (!('hid' in navigator)) return
    setError(null)
    try {
      const devices = await navigator.hid.requestDevice({
        filters: SUPPORTED_DEVICES.map(({ vendorId, productId }) => ({ vendorId, productId })),
      })
      await openFirstCompatibleDevice(devices)
    } catch (cause) {
      setConnectionState('idle')
      if (cause instanceof DOMException && cause.name === 'NotFoundError') return
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [openDemoDevice, openFirstCompatibleDevice])

  const reconnect = useCallback(async () => {
    if (demoMode) return openDemoDevice()
    if (!('hid' in navigator)) return false
    const devices = await navigator.hid.getDevices()
    return openFirstCompatibleDevice(devices.filter(isSupported))
  }, [openDemoDevice, openFirstCompatibleDevice])

  useEffect(() => {
    if (demoMode || !('hid' in navigator)) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void navigator.hid.getDevices()
        .then(async (devices) => {
          if (cancelled) return
          const supportedDevices = devices.filter(isSupported)
          if (supportedDevices.length === 0) return
          await openFirstCompatibleDevice(supportedDevices, false)
        })
        .catch(() => undefined)
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [openFirstCompatibleDevice])

  const disconnect = useCallback(async () => {
    await transportRef.current?.close().catch(() => undefined)
    resetConnection()
  }, [resetConnection])

  const switchProfile = useCallback(async (index: number) => {
    if (!mouseRef.current) return
    setBusy(true)
    setError(null)
    try {
      const snapshot = await mouseRef.current.switchProfile(index)
      setProfile(snapshot)
      setDraft(structuredClone(snapshot))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    const mouse = mouseRef.current
    if (!mouse) return false
    if (dirty) {
      setError('当前有未应用的更改；请先应用或放弃，再重新读取设备。')
      return false
    }
    setBusy(true)
    setError(null)
    try {
      const snapshot = await mouse.readCurrentProfile()
      setBattery(await readBattery(mouse))
      setProfile(snapshot)
      setDraft(structuredClone(snapshot))
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [dirty, readBattery])

  const exportBackup = useCallback(async () => {
    const mouse = mouseRef.current
    if (!mouse || !profile) return null
    if (dirty) {
      setError('当前有未应用的更改；请先应用或放弃，再导出配置备份。')
      return null
    }
    setBusy(true)
    setError(null)
    try {
      const profiles = await mouse.readAllProfiles()
      return createMouseBackup(profiles, {
        vendorId: diagnostics!.vendorId,
        productId: diagnostics!.productId,
        productName: diagnostics!.productName,
      }, profile.profileIndex)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    } finally {
      setBusy(false)
    }
  }, [diagnostics, dirty, profile])

  const restoreBackup = useCallback(async (backup: MouseBackup) => {
    const mouse = mouseRef.current
    if (!mouse) return false
    if (dirty) {
      setError('当前有未应用的更改；请先应用或放弃，再恢复配置。')
      return false
    }
    const supportedBackupDevice = SUPPORTED_DEVICES.some(
      ({ vendorId, productId }) => vendorId === backup.device.vendorId && productId === backup.device.productId,
    )
    if (!supportedBackupDevice) {
      setError('此备份不属于受支持的战刃 III 设备，已停止恢复。')
      return false
    }
    setBusy(true)
    setError(null)
    try {
      const snapshot = await mouse.restoreProfiles(backup.profiles, backup.activeProfileIndex)
      setProfile(snapshot)
      setDraft(structuredClone(snapshot))
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [dirty])

  const resetSurfaceCalibration = useCallback(async () => {
    const mouse = mouseRef.current
    if (!mouse) return false
    if (dirty) {
      setError('当前有未应用的更改；请先应用或放弃，再恢复标准表面校准。')
      return false
    }
    setBusy(true)
    setError(null)
    try {
      await mouse.resetSurfaceCalibration()
      const snapshot = await mouse.readCurrentProfile()
      setProfile(snapshot)
      setDraft(structuredClone(snapshot))
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [dirty])

  const apply = useCallback(async () => {
    const mouse = mouseRef.current
    if (!profile || !draft || !mouse) return
    setBusy(true)
    setError(null)
    try {
      const latest = await mouse.readCurrentProfile()
      if (!snapshotsEqual(profile, latest)) {
        setProfile(latest)
        setError('设备配置已在外部发生变化，已停止写入并保留当前编辑。请检查差异后重新应用。')
        return
      }
      await mouse.applyChangesSafely(profile, draft)
      const snapshot = await mouse.readCurrentProfile()
      setProfile(snapshot)
      setDraft(structuredClone(snapshot))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [draft, profile])

  const discard = useCallback(() => {
    if (profile) setDraft(structuredClone(profile))
  }, [profile])

  useEffect(() => {
    if (!('hid' in navigator)) return
    const handleDisconnect = (event: HIDConnectionEvent) => {
      const transport = transportRef.current
      if (transport?.device === event.device) {
        void transport.close().catch(() => undefined)
        resetConnection()
        setError('鼠标已断开连接')
      }
    }
    navigator.hid.addEventListener('disconnect', handleDisconnect)
    return () => navigator.hid.removeEventListener('disconnect', handleDisconnect)
  }, [resetConnection])

  return {
    connectionState,
    connected,
    deviceDefinition,
    profile,
    draft,
    setDraft,
    diagnostics,
    battery,
    logs,
    error,
    busy,
    dirty,
    connect,
    reconnect,
    disconnect,
    switchProfile,
    refresh,
    exportBackup,
    restoreBackup,
    resetSurfaceCalibration,
    apply,
    discard,
  }
}
