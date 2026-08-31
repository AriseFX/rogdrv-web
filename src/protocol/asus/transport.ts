import {
  ASUS_PACKET_SIZE,
  ASUS_VENDOR_USAGE_PAGE,
} from './constants'
import { assertSuccessfulResponse } from './codec'
import type { TransportDiagnostics, TransportLogEntry } from './types'

interface PendingQuery {
  resolve: (response: Uint8Array) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function flattenCollections(collections: HIDCollectionInfo[]): HIDCollectionInfo[] {
  return collections.flatMap((collection) => [
    collection,
    ...flattenCollections(collection.children ?? []),
  ])
}

function reportSize(report: HIDReportInfo) {
  return (report.items ?? []).reduce(
    (total, item) => total + (item.reportSize ?? 0) * (item.reportCount ?? 0),
    0,
  ) / 8
}

function hexPacket(packet: Uint8Array) {
  return Array.from(packet.slice(0, 18))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ')
}

export class AsusHidTransport {
  readonly diagnostics: TransportDiagnostics
  readonly device: HIDDevice
  private pending: PendingQuery | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly reportId: number
  private readonly onLog?: (entry: TransportLogEntry) => void

  constructor(
    device: HIDDevice,
    onLog?: (entry: TransportLogEntry) => void,
  ) {
    this.device = device
    this.onLog = onLog
    const collections = flattenCollections(device.collections)
    const preferredCollections = collections.filter(
      (collection) => collection.usagePage === ASUS_VENDOR_USAGE_PAGE,
    )
    const candidates = (preferredCollections.length > 0 ? preferredCollections : collections)
      .flatMap((collection) => collection.outputReports ?? [])
      .sort((a, b) => reportSize(b) - reportSize(a))

    if (candidates.length === 0) {
      throw new Error('没有找到可写入的 HID Output Report；请使用有线或原装 2.4G 接收器')
    }

    const packetReport = candidates.find((candidate) => reportSize(candidate) >= ASUS_PACKET_SIZE)
    this.reportId = packetReport?.reportId ?? candidates[0].reportId ?? 0
    this.diagnostics = {
      productName: device.productName,
      vendorId: device.vendorId,
      productId: device.productId,
      reportId: this.reportId,
      collectionCount: collections.length,
      vendorCollections: preferredCollections.map(
        (collection) =>
          `0x${(collection.usagePage ?? 0).toString(16)}:0x${(collection.usage ?? 0).toString(16)}`,
      ),
    }

    this.device.addEventListener('inputreport', this.handleInputReport)
    this.log('info', `HID 已打开 · reportId=${this.reportId} · ${this.diagnostics.vendorCollections.join(', ') || '通用接口'}`)
  }

  query(request: Uint8Array): Promise<Uint8Array> {
    const next = this.queue.then(() => this.runQuery(request))
    this.queue = next.catch(() => undefined)
    return next
  }

  private runQuery(request: Uint8Array): Promise<Uint8Array> {
    if (request.byteLength !== ASUS_PACKET_SIZE) {
      return Promise.reject(new Error(`ASUS 命令必须是 ${ASUS_PACKET_SIZE} 字节`))
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer !== timer) return
        this.pending = null
        reject(new Error('等待鼠标响应超时；请关闭奥创后重新连接'))
      }, 2500)

      this.pending = { resolve, reject, timer }
      this.log('tx', hexPacket(request))
      const payload = request.slice().buffer as ArrayBuffer
      this.device.sendReport(this.reportId, payload).catch((cause: unknown) => {
        if (this.pending?.timer !== timer) return
        clearTimeout(timer)
        this.pending = null
        reject(new Error('发送 HID 命令失败', { cause }))
      })
    })
  }

  private readonly handleInputReport = (event: HIDInputReportEvent) => {
    if (!this.pending || event.reportId !== this.reportId) return
    if (event.data.byteLength < ASUS_PACKET_SIZE) return

    const response = new Uint8Array(
      event.data.buffer.slice(
        event.data.byteOffset,
        event.data.byteOffset + event.data.byteLength,
      ),
    )
    const pending = this.pending
    this.pending = null
    clearTimeout(pending.timer)
    this.log('rx', hexPacket(response))

    try {
      pending.resolve(assertSuccessfulResponse(response))
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  async close() {
    this.device.removeEventListener('inputreport', this.handleInputReport)
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(new Error('设备连接已关闭'))
      this.pending = null
    }
    if (this.device.opened) await this.device.close()
  }

  private log(direction: TransportLogEntry['direction'], message: string) {
    this.onLog?.({ direction, message, timestamp: Date.now() })
  }
}
