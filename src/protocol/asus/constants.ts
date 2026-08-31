import type { ButtonAction, SupportedDevice } from './types'

export const ASUS_VENDOR_ID = 0x0b05
export const ASUS_VENDOR_USAGE_PAGE = 0xff01
export const ASUS_PACKET_SIZE = 64
export const ASUS_STATUS_ERROR = 0xaaff

export const ASUS_COMMAND = {
  getProfile: 0x0012,
  getLed: 0x0312,
  getSettings: 0x0412,
  getButtons: 0x0512,
  setProfile: 0x0250,
  save: 0x0350,
  setButton: 0x2151,
  setLed: 0x2851,
  setSetting: 0x3151,
} as const

export const SUPPORTED_DEVICES: SupportedDevice[] = [
  {
    vendorId: ASUS_VENDOR_ID,
    productId: 0x1a70,
    name: 'ROG Gladius III Wireless AimPoint',
    connection: 'wired',
  },
  {
    vendorId: ASUS_VENDOR_ID,
    productId: 0x1a72,
    name: 'ROG Gladius III Wireless AimPoint',
    connection: 'receiver',
  },
]

export const POLLING_RATES = [125, 250, 500, 1000] as const
export const DEBOUNCE_TIMES = [4, 8, 12, 16, 20, 24, 28, 32] as const

export const PHYSICAL_BUTTONS = [
  { sourceCode: 0xf0, label: '左键' },
  { sourceCode: 0xf1, label: '右键' },
  { sourceCode: 0xf2, label: '滚轮按下' },
  { sourceCode: 0xe4, label: '侧键 · 后退' },
  { sourceCode: 0xe5, label: '侧键 · 前进' },
  { sourceCode: 0xe6, label: 'DPI 循环' },
  { sourceCode: 0xe8, label: '滚轮向上' },
  { sourceCode: 0xe9, label: '滚轮向下' },
] as const

export const MOUSE_ACTIONS: ButtonAction[] = [
  { kind: 'mouse', code: 0xf0, label: '左键' },
  { kind: 'mouse', code: 0xf1, label: '右键' },
  { kind: 'mouse', code: 0xf2, label: '中键' },
  { kind: 'mouse', code: 0xe4, label: '后退' },
  { kind: 'mouse', code: 0xe5, label: '前进' },
  { kind: 'mouse', code: 0xe6, label: 'DPI 循环' },
  { kind: 'mouse', code: 0xe7, label: 'DPI 临时切换' },
  { kind: 'mouse', code: 0xe8, label: '滚轮向上' },
  { kind: 'mouse', code: 0xe9, label: '滚轮向下' },
  { kind: 'disabled', code: 0xff, label: '禁用' },
]

const letterKeys = Array.from({ length: 26 }, (_, index): ButtonAction => ({
  kind: 'keyboard',
  code: 0x04 + index,
  label: String.fromCharCode(65 + index),
}))

const digitLabels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const digitKeys = digitLabels.map((label, index): ButtonAction => ({
  kind: 'keyboard',
  code: 0x1e + index,
  label,
}))

const functionKeys = Array.from({ length: 12 }, (_, index): ButtonAction => ({
  kind: 'keyboard',
  code: 0x3a + index,
  label: `F${index + 1}`,
}))

export const KEYBOARD_ACTIONS: ButtonAction[] = [
  ...letterKeys,
  ...digitKeys,
  { kind: 'keyboard', code: 0x28, label: 'Enter' },
  { kind: 'keyboard', code: 0x29, label: 'Esc' },
  { kind: 'keyboard', code: 0x2a, label: 'Backspace' },
  { kind: 'keyboard', code: 0x2b, label: 'Tab' },
  { kind: 'keyboard', code: 0x2c, label: 'Space' },
  ...functionKeys,
  { kind: 'keyboard', code: 0x4a, label: 'Home' },
  { kind: 'keyboard', code: 0x4b, label: 'Page Up' },
  { kind: 'keyboard', code: 0x4c, label: 'Delete' },
  { kind: 'keyboard', code: 0x4e, label: 'Page Down' },
  { kind: 'keyboard', code: 0x4f, label: '→' },
  { kind: 'keyboard', code: 0x50, label: '←' },
  { kind: 'keyboard', code: 0x51, label: '↓' },
  { kind: 'keyboard', code: 0x52, label: '↑' },
]

export const BUTTON_ACTIONS = [...MOUSE_ACTIONS, ...KEYBOARD_ACTIONS]

export const LED_MODES = [
  { value: 0, label: '常亮' },
  { value: 1, label: '呼吸' },
  { value: 2, label: '色彩循环' },
  { value: 3, label: '彩虹' },
  { value: 4, label: '响应' },
  { value: 6, label: '电量指示' },
] as const

export const DEFAULT_BUTTON_MAPPING = PHYSICAL_BUTTONS.map((button) => button.sourceCode)
