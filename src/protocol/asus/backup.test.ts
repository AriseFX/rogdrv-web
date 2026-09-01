import { describe, expect, it } from 'vitest'
import { createMouseBackup, parseMouseBackup, serializeMouseBackup } from './backup'
import { AsusMouse } from './mouse'
import { VirtualAsusDevice } from './simulator'

describe('mouse configuration backup', () => {
  it('round-trips five profiles with device identity and active slot', async () => {
    const profiles = await new AsusMouse(new VirtualAsusDevice()).readAllProfiles()
    const backup = createMouseBackup(
      profiles,
      { vendorId: 0x0b05, productId: 0x1a72, productName: 'ROG Mouse' },
      0,
      '2026-09-01T09:00:00.000Z',
    )

    expect(parseMouseBackup(serializeMouseBackup(backup))).toEqual(backup)
    expect(backup).toMatchObject({
      schema: 'rogdrv-web/mouse-backup',
      version: 1,
      activeProfileIndex: 0,
      device: { vendorId: 0x0b05, productId: 0x1a72 },
    })
  })

  it('rejects malformed, incompatible, and incomplete backup files', () => {
    expect(() => parseMouseBackup('{')).toThrow('不是有效的 JSON')
    expect(() => parseMouseBackup(JSON.stringify({ schema: 'other', version: 1 })))
      .toThrow('不支持的备份格式')
    expect(() => parseMouseBackup(JSON.stringify({
      schema: 'rogdrv-web/mouse-backup',
      version: 1,
      profiles: [],
    }))).toThrow('必须包含 5 个板载配置')
  })

  it('validates export inputs and every profile section before accepting a restore', async () => {
    const profiles = await new AsusMouse(new VirtualAsusDevice()).readAllProfiles()
    const device = { vendorId: 0x0b05, productId: 0x1a72, productName: 'ROG Mouse' }
    expect(() => createMouseBackup(profiles.slice(0, 4), device, 0)).toThrow(
      '必须包含 5 个板载配置',
    )
    expect(() => createMouseBackup(profiles, device, -1)).toThrow('活动配置档无效')
    expect(() => createMouseBackup(profiles, device, 1.5)).toThrow('活动配置档无效')
    expect(() => createMouseBackup(profiles, device, 5)).toThrow('活动配置档无效')
    expect(createMouseBackup(profiles, device, 0).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const backup = createMouseBackup(profiles, device, 0, '2026-09-01T09:00:00.000Z')
    const invalidProfile = (mutate: (profile: Record<string, unknown>) => void) => {
      const value = structuredClone(backup) as unknown as Record<string, unknown>
      const storedProfiles = value.profiles as Record<string, unknown>[]
      mutate(storedProfiles[0])
      expect(() => parseMouseBackup(JSON.stringify(value))).toThrow('板载配置不完整')
    }

    invalidProfile((profile) => { profile.profileIndex = 2 })
    invalidProfile((profile) => { profile.performance = null })
    invalidProfile((profile) => {
      const performance = profile.performance as Record<string, unknown>
      performance.dpi = [1, 2, 3]
    })
    invalidProfile((profile) => {
      const performance = profile.performance as Record<string, unknown>
      performance.dpi = [1, 2, 3, 'x']
    })
    invalidProfile((profile) => { profile.sensor = null })
    invalidProfile((profile) => { profile.sensor = { liftOffDistance: 'middle' } })
    invalidProfile((profile) => { profile.dpiColors = null })
    invalidProfile((profile) => { profile.dpiColors = [] })
    invalidProfile((profile) => { profile.buttons = null })
    invalidProfile((profile) => { profile.led = null })
    invalidProfile((profile) => {
      const performance = profile.performance as Record<string, unknown>
      performance.pollingRate = 'fast'
    })
    invalidProfile((profile) => {
      const performance = profile.performance as Record<string, unknown>
      performance.debounce = 'slow'
    })
    invalidProfile((profile) => {
      const performance = profile.performance as Record<string, unknown>
      performance.angleSnapping = 1
    })
    invalidProfile((profile) => { profile.dpiPresetCount = 'four' })
  })

  it('rejects every incomplete backup metadata field', async () => {
    const profiles = await new AsusMouse(new VirtualAsusDevice()).readAllProfiles()
    const backup = createMouseBackup(
      profiles,
      { vendorId: 0x0b05, productId: 0x1a72, productName: 'ROG Mouse' },
      0,
      '2026-09-01T09:00:00.000Z',
    )
    const invalidMetadata = (mutate: (value: Record<string, unknown>) => void) => {
      const value = structuredClone(backup) as unknown as Record<string, unknown>
      mutate(value)
      expect(() => parseMouseBackup(JSON.stringify(value))).toThrow('元数据不完整')
    }
    invalidMetadata((value) => { value.activeProfileIndex = 1.5 })
    invalidMetadata((value) => { value.activeProfileIndex = -1 })
    invalidMetadata((value) => { value.activeProfileIndex = 5 })
    invalidMetadata((value) => { value.device = null })
    invalidMetadata((value) => { (value.device as Record<string, unknown>).vendorId = 'asus' })
    invalidMetadata((value) => { (value.device as Record<string, unknown>).productId = 'mouse' })
    invalidMetadata((value) => { (value.device as Record<string, unknown>).productName = 711 })
    invalidMetadata((value) => { value.createdAt = 123 })

    expect(() => parseMouseBackup('null')).toThrow('不支持的备份格式')
    expect(() => parseMouseBackup(JSON.stringify({
      schema: 'rogdrv-web/mouse-backup', version: 2,
    }))).toThrow('不支持的备份格式')
    expect(() => parseMouseBackup(JSON.stringify({
      schema: 'rogdrv-web/mouse-backup', version: 1, profiles: null,
    }))).toThrow('必须包含 5 个板载配置')
  })
})
