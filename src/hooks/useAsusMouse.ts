import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SUPPORTED_DEVICES } from '../protocol/asus/constants'
import { AsusMouse } from '../protocol/asus/mouse'
import { AsusHidTransport } from '../protocol/asus/transport'
import type {
  ProfileSnapshot,
  SupportedDevice,
  TransportDiagnostics,
  TransportLogEntry,
} from '../protocol/asus/types'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'unsupported'

const demoMode = new URLSearchParams(window.location.search).has('demo')
const demoStartedAt = Date.now()

const makeDemoProfile = (profileIndex = 0): ProfileSnapshot => ({
  profileIndex,
  dpiPreset: 1,
  primaryFirmware: { major: 1, minor: 8, build: 3 },
  secondaryFirmware: { major: 1, minor: 4, build: 2 },
  performance: {
    dpi: [400, 800, 1600, 3200],
    pollingRate: 1000,
    debounce: 12,
    angleSnapping: false,
  },
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
  led: { mode: 0, brightness: 4, color: { r: 243, g: 52, b: 74 } },
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

export function useAsusMouse() {
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
    demoMode ? {
      productName: 'ROG Gladius III Wireless AimPoint (Demo)',
      vendorId: 0x0b05,
      productId: 0x1a70,
      reportId: 0,
      collectionCount: 1,
      vendorCollections: ['0xff01:0x0001'],
    } : null,
  )
  const [logs, setLogs] = useState<TransportLogEntry[]>(
    demoMode ? [{ direction: 'info', message: '演示模式：未连接真实硬件', timestamp: demoStartedAt }] : [],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const transportRef = useRef<AsusHidTransport | null>(null)
  const mouseRef = useRef<AsusMouse | null>(null)

  const connected = connectionState === 'connected'
  const dirty = useMemo(
    () => profile !== null && draft !== null && JSON.stringify(profile) !== JSON.stringify(draft),
    [draft, profile],
  )

  const appendLog = useCallback((entry: TransportLogEntry) => {
    setLogs((current) => [...current.slice(-119), entry])
  }, [])

  const resetConnection = useCallback(() => {
    transportRef.current = null
    mouseRef.current = null
    setConnectionState('idle')
    setDeviceDefinition(null)
    setProfile(null)
    setDraft(null)
    setDiagnostics(null)
    setBusy(false)
  }, [])

  const openDevice = useCallback(
    async (device: HIDDevice) => {
      setConnectionState('connecting')
      setError(null)
      setLogs([])
      try {
        if (!device.opened) await device.open()
        const transport = new AsusHidTransport(device, appendLog)
        const mouse = new AsusMouse(transport)
        transportRef.current = transport
        mouseRef.current = mouse
        setDiagnostics(transport.diagnostics)
        setDeviceDefinition(definitionFor(device) ?? null)
        const snapshot = await mouse.readCurrentProfile()
        setProfile(snapshot)
        setDraft(structuredClone(snapshot))
        setConnectionState('connected')
      } catch (cause) {
        await transportRef.current?.close().catch(() => undefined)
        resetConnection()
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [appendLog, resetConnection],
  )

  const connect = useCallback(async () => {
    if (!('hid' in navigator)) return
    setError(null)
    try {
      const devices = await navigator.hid.requestDevice({
        filters: SUPPORTED_DEVICES.map(({ vendorId, productId }) => ({ vendorId, productId })),
      })
      if (devices[0]) await openDevice(devices[0])
    } catch (cause) {
      setConnectionState('idle')
      if (cause instanceof DOMException && cause.name === 'NotFoundError') return
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [openDevice])

  const reconnect = useCallback(async () => {
    if (demoMode) return true
    if (!('hid' in navigator)) return false
    const devices = await navigator.hid.getDevices()
    const known = devices.find(isSupported)
    if (!known) return false
    await openDevice(known)
    return true
  }, [openDevice])

  const disconnect = useCallback(async () => {
    await transportRef.current?.close().catch(() => undefined)
    resetConnection()
  }, [resetConnection])

  const switchProfile = useCallback(async (index: number) => {
    if (demoMode) {
      const snapshot = makeDemoProfile(index)
      setProfile(snapshot)
      setDraft(structuredClone(snapshot))
      return
    }
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

  const apply = useCallback(async () => {
    if (!profile || !draft) return
    if (demoMode) {
      setProfile(structuredClone(draft))
      return
    }
    if (!mouseRef.current) return
    setBusy(true)
    setError(null)
    try {
      await mouseRef.current.applyChanges(profile, draft)
      const snapshot = await mouseRef.current.readCurrentProfile()
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
      if (transportRef.current?.device === event.device) {
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
    logs,
    error,
    busy,
    dirty,
    connect,
    reconnect,
    disconnect,
    switchProfile,
    apply,
    discard,
  }
}
