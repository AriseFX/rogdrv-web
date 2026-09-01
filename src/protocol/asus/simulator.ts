import {
  ASUS_COMMAND,
  ASUS_PACKET_SIZE,
  BUTTON_ACTIONS,
  DEBOUNCE_TIMES,
  PHYSICAL_BUTTONS,
  POLLING_RATES,
} from './constants'
import { AsusCommandRejectedError, responseCode } from './codec'
import type { ProfileSnapshot, QueryTransport } from './types'

type VirtualProfile = Omit<ProfileSnapshot, 'dpiPreset'> & { dpiPreset: number }

const makeProfile = (profileIndex: number): VirtualProfile => ({
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
  buttons: PHYSICAL_BUTTONS.map((button, index) => ({
    index,
    sourceCode: button.sourceCode,
    sourceLabel: button.label,
    action: BUTTON_ACTIONS.find(
      (action) => action.kind === 'mouse' && action.code === button.sourceCode,
    )!,
  })),
  led: { mode: 0, brightness: 100, color: { r: 243, g: 52, b: 74 } },
})

export class VirtualAsusDevice implements QueryTransport {
  private profileIndex = 0
  private readonly profiles = Array.from({ length: 5 }, (_, index) => makeProfile(index))

  async query(request: Uint8Array) {
    if (request.byteLength !== ASUS_PACKET_SIZE) {
      throw new Error(`ASUS 命令必须是 ${ASUS_PACKET_SIZE} 字节`)
    }

    const response = request.slice()
    const command = responseCode(request)
    const profile = this.profiles[this.profileIndex]

    switch (command) {
      case ASUS_COMMAND.getProfile:
        response[4] = profile.secondaryFirmware.build
        response[5] = profile.secondaryFirmware.minor
        response[6] = profile.secondaryFirmware.major
        response[10] = profile.profileIndex
        response[11] = profile.dpiPreset + 1
        response[14] = profile.primaryFirmware.build
        response[15] = profile.primaryFirmware.minor
        response[16] = profile.primaryFirmware.major
        break
      case ASUS_COMMAND.getSettings: {
        const view = new DataView(response.buffer, response.byteOffset, response.byteLength)
        if (request[2] === 2) {
          profile.performance.dpi.forEach((dpi, index) => {
            const encoded = Math.round((dpi - 50) / 50)
            view.setUint16(4 + index * 4, encoded, true)
            view.setUint16(6 + index * 4, encoded, true)
          })
        } else if (request[2] === 3) {
          profile.dpiColors.forEach((color, index) => {
            response.set([color.r, color.g, color.b], 4 + index * 3)
          })
        } else {
          response.fill(0xff, 4, 12)
          response[12] = POLLING_RATES.findIndex(
            (rate) => rate === profile.performance.pollingRate,
          )
          response[13] = 0
          response[14] = DEBOUNCE_TIMES.findIndex(
            (debounce) => debounce === profile.performance.debounce,
          )
          response[15] = 0
          response[16] = profile.performance.angleSnapping ? 1 : 0
          response[17] = 0
        }
        break
      }
      case ASUS_COMMAND.getButtons:
        profile.buttons.forEach((button, index) => {
          response[4 + index * 2] = button.action.code
          response[5 + index * 2] = button.action.kind === 'mouse' ? 1 : 0
        })
        break
      case ASUS_COMMAND.getLed:
        response[4] = profile.led.mode
        response[5] = profile.led.brightness
        response[6] = profile.led.color.r
        response[7] = profile.led.color.g
        response[8] = profile.led.color.b
        break
      case ASUS_COMMAND.getBattery:
        response[4] = 68
        response[9] = 0
        break
      case ASUS_COMMAND.getLiftOffDistance:
        response[7] = profile.sensor.liftOffDistance === 'high' ? 1 : 0
        break
      case ASUS_COMMAND.setProfile:
        this.profileIndex = request[2]
        break
      case ASUS_COMMAND.setSetting: {
        const field = request[2]
        if (field < profile.performance.dpi.length) {
          const encoded = new DataView(
            request.buffer,
            request.byteOffset,
            request.byteLength,
          ).getUint16(4, true)
          profile.performance.dpi[field] = encoded * 50 + 50
          profile.dpiColors[field] = {
            r: request[6],
            g: request[7],
            b: request[8],
          }
        } else if (field === 4) {
          profile.performance.pollingRate = POLLING_RATES[request[4]]
        } else if (field === 5) {
          profile.performance.debounce = DEBOUNCE_TIMES[request[4]]
        } else if (field === 6) {
          profile.performance.angleSnapping = request[4] !== 0
        } else if (field === 9) {
          if (request[4] > profile.dpiPresetCount) throw new AsusCommandRejectedError()
          profile.dpiPreset = request[4] - 1
        } else if (field === 10) {
          profile.dpiPresetCount = request[4]
          profile.dpiPreset = Math.min(profile.dpiPreset, profile.dpiPresetCount - 1)
        }
        break
      }
      case ASUS_COMMAND.setButton: {
        const button = profile.buttons.find((candidate) => candidate.sourceCode === request[4])
        const kind = request[6] === 0 && request[7] === 0
          ? 'disabled'
          : request[7] === 0 ? 'keyboard' : 'mouse'
        const action = BUTTON_ACTIONS.find(
          (candidate) => candidate.kind === kind && candidate.code === request[6],
        )
        if (button && action) button.action = action
        break
      }
      case ASUS_COMMAND.setLed:
        profile.led = {
          mode: request[4],
          brightness: request[5],
          color: { r: request[6], g: request[7], b: request[8] },
        }
        break
      case ASUS_COMMAND.setLiftOffDistance:
        profile.sensor.liftOffDistance = request[5] === 1 ? 'high' : 'low'
        break
      case ASUS_COMMAND.save:
        break
      default:
        throw new Error(`虚拟鼠标不支持命令 0x${command.toString(16).padStart(4, '0')}`)
    }

    return response
  }
}
