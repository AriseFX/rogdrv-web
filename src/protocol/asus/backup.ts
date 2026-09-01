import type { MouseBackup, ProfileSnapshot } from './types'

type DeviceIdentity = MouseBackup['device']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isNumberArray = (value: unknown, length: number) =>
  Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number')

const isProfileSnapshot = (value: unknown, index: number): value is ProfileSnapshot => {
  if (!isRecord(value) || value.profileIndex !== index) return false
  if (!isRecord(value.performance) || !isNumberArray(value.performance.dpi, 4)) return false
  if (!isRecord(value.sensor) || !['low', 'high'].includes(String(value.sensor.liftOffDistance))) return false
  if (!Array.isArray(value.dpiColors) || value.dpiColors.length !== 4) return false
  if (!Array.isArray(value.buttons) || !isRecord(value.led)) return false
  return typeof value.performance.pollingRate === 'number'
    && typeof value.performance.debounce === 'number'
    && typeof value.performance.angleSnapping === 'boolean'
    && typeof value.dpiPresetCount === 'number'
}

export function createMouseBackup(
  profiles: ProfileSnapshot[],
  device: DeviceIdentity,
  activeProfileIndex: number,
  createdAt = new Date().toISOString(),
): MouseBackup {
  if (profiles.length !== 5) throw new Error('备份必须包含 5 个板载配置')
  if (!Number.isInteger(activeProfileIndex) || activeProfileIndex < 0 || activeProfileIndex > 4) {
    throw new Error('备份的活动配置档无效')
  }
  return {
    schema: 'rogdrv-web/mouse-backup',
    version: 1,
    createdAt,
    activeProfileIndex,
    device,
    profiles: structuredClone(profiles),
  }
}

export function serializeMouseBackup(backup: MouseBackup) {
  return `${JSON.stringify(backup, null, 2)}\n`
}

export function parseMouseBackup(source: string): MouseBackup {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('备份文件不是有效的 JSON')
  }
  if (!isRecord(value) || value.schema !== 'rogdrv-web/mouse-backup' || value.version !== 1) {
    throw new Error('不支持的备份格式或版本')
  }
  if (!Array.isArray(value.profiles) || value.profiles.length !== 5) {
    throw new Error('备份必须包含 5 个板载配置')
  }
  if (!value.profiles.every((profile, index) => isProfileSnapshot(profile, index))) {
    throw new Error('备份中的板载配置不完整')
  }
  if (
    !Number.isInteger(value.activeProfileIndex)
    || Number(value.activeProfileIndex) < 0
    || Number(value.activeProfileIndex) > 4
    || !isRecord(value.device)
    || typeof value.device.vendorId !== 'number'
    || typeof value.device.productId !== 'number'
    || typeof value.device.productName !== 'string'
    || typeof value.createdAt !== 'string'
  ) {
    throw new Error('备份元数据不完整')
  }
  return value as unknown as MouseBackup
}
