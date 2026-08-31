export type ConnectionMode = 'wired' | 'receiver'

export interface SupportedDevice {
  vendorId: number
  productId: number
  name: string
  connection: ConnectionMode
}

export interface FirmwareVersion {
  major: number
  minor: number
  build: number
}

export interface ProfileInfo {
  profileIndex: number
  dpiPreset: number | null
  primaryFirmware: FirmwareVersion
  secondaryFirmware: FirmwareVersion
}

export interface PerformanceSettings {
  dpi: [number, number, number, number]
  pollingRate: number
  debounce: number
  angleSnapping: boolean
}

export type ButtonActionKind = 'mouse' | 'keyboard' | 'disabled' | 'unknown'

export interface ButtonAction {
  kind: ButtonActionKind
  code: number
  label: string
}

export interface ButtonBinding {
  index: number
  sourceCode: number
  sourceLabel: string
  action: ButtonAction
}

export interface LedSettings {
  mode: number
  brightness: number
  color: {
    r: number
    g: number
    b: number
  }
}

export interface ProfileSnapshot {
  profileIndex: number
  dpiPreset: number | null
  primaryFirmware: FirmwareVersion
  secondaryFirmware: FirmwareVersion
  performance: PerformanceSettings
  buttons: ButtonBinding[]
  led: LedSettings
}

export interface TransportLogEntry {
  direction: 'tx' | 'rx' | 'info'
  message: string
  timestamp: number
}

export interface TransportDiagnostics {
  productName: string
  vendorId: number
  productId: number
  reportId: number
  collectionCount: number
  vendorCollections: string[]
}

export interface QueryTransport {
  query(request: Uint8Array): Promise<Uint8Array>
}
