import { describe, expect, it, vi } from 'vitest'
import { AsusHidTransport } from './transport'

class FakeHidDevice {
  productName = 'Virtual HID'
  vendorId = 0x0b05
  productId = 0x1a70
  opened = true
  collections: HIDCollectionInfo[] = [{
    usagePage: 0xff01,
    usage: 1,
    outputReports: [{
      reportId: 7,
      items: [{ reportSize: 8, reportCount: 64 }],
    }],
  }] as HIDCollectionInfo[]
  sendReport = vi.fn(async () => undefined)
  close = vi.fn(async () => {
    this.opened = false
  })
  private listener: ((event: HIDInputReportEvent) => void) | null = null

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
    this.listener = listener as (event: HIDInputReportEvent) => void
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
    if (this.listener === listener) this.listener = null
  }

  emitInput(reportId: number, bytes: Uint8Array) {
    this.listener?.({
      reportId,
      data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    } as HIDInputReportEvent)
  }
}

describe('AsusHidTransport', () => {
  it('rejects a packet that is not exactly 64 bytes', async () => {
    const transport = new AsusHidTransport(new FakeHidDevice() as unknown as HIDDevice)

    await expect(transport.query(new Uint8Array(63))).rejects.toThrow(
      'ASUS 命令必须是 64 字节',
    )
  })

  it('reports a WebHID send failure with its original cause', async () => {
    const device = new FakeHidDevice()
    const cause = new Error('USB write failed')
    device.sendReport.mockRejectedValueOnce(cause)
    const transport = new AsusHidTransport(device as unknown as HIDDevice)

    const error = await transport.query(new Uint8Array(64)).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ message: '发送 HID 命令失败', cause })
  })

  it('rejects an ASUS error response from the device', async () => {
    const device = new FakeHidDevice()
    const transport = new AsusHidTransport(device as unknown as HIDDevice)
    const result = expect(transport.query(new Uint8Array(64))).rejects.toThrow('鼠标拒绝了命令')
    await Promise.resolve()

    const response = new Uint8Array(64)
    response.set([0xaa, 0xff])
    device.emitInput(7, response)

    await result
  })

  it('also accepts the reversed ASUS error header as the pending response', async () => {
    const device = new FakeHidDevice()
    const transport = new AsusHidTransport(device as unknown as HIDDevice)
    const result = expect(transport.query(new Uint8Array(64))).rejects.toThrow('鼠标拒绝了命令')
    await Promise.resolve()

    const response = new Uint8Array(64)
    response.set([0xff, 0xaa])
    device.emitInput(7, response)

    await result
  })

  it('refuses a HID interface without output reports', () => {
    const device = new FakeHidDevice()
    device.collections = []

    expect(() => new AsusHidTransport(device as unknown as HIDDevice)).toThrow(
      '没有找到可写入的 HID Output Report',
    )
  })

  it('falls back to a generic report and report ID zero', () => {
    const device = new FakeHidDevice()
    device.collections = [
      {
        usagePage: 1,
        outputReports: [{}, { items: [{}] }],
      },
      { usagePage: 2 },
    ] as HIDCollectionInfo[]

    const transport = new AsusHidTransport(device as unknown as HIDDevice)

    expect(transport.diagnostics).toMatchObject({ reportId: 0, vendorCollections: [] })
  })

  it('times out a command when the device never responds', async () => {
    vi.useFakeTimers()
    try {
      const device = new FakeHidDevice()
      const transport = new AsusHidTransport(device as unknown as HIDDevice)
      const result = expect(transport.query(new Uint8Array(64))).rejects.toThrow(
        '等待鼠标响应超时',
      )
      await Promise.resolve()

      await vi.advanceTimersByTimeAsync(2500)

      await result
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a timeout callback after its response has already settled', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined)
    try {
      const device = new FakeHidDevice()
      const transport = new AsusHidTransport(device as unknown as HIDDevice)
      const result = transport.query(new Uint8Array(64))
      await Promise.resolve()

      device.emitInput(7, new Uint8Array(64))
      await expect(result).resolves.toHaveLength(64)
      await vi.advanceTimersByTimeAsync(2500)
    } finally {
      clearTimeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('ignores a late send rejection after the response has already settled', async () => {
    const device = new FakeHidDevice()
    let rejectSend!: (cause: unknown) => void
    device.sendReport.mockImplementationOnce(
      () => new Promise<undefined>((_resolve, reject) => {
        rejectSend = reject
      }),
    )
    const transport = new AsusHidTransport(device as unknown as HIDDevice)
    const result = transport.query(new Uint8Array(64))
    await Promise.resolve()

    device.emitInput(7, new Uint8Array(64))
    await expect(result).resolves.toHaveLength(64)
    rejectSend(new Error('late failure'))
    await Promise.resolve()
  })

  it('prefers a complete output report that has a matching input report', () => {
    const device = new FakeHidDevice()
    device.collections = [{
      usagePage: 0xff01,
      outputReports: [
        { reportId: 7, items: [{ reportSize: 8, reportCount: 64 }] },
        { reportId: 3, items: [{ reportSize: 8, reportCount: 64 }] },
      ],
      inputReports: [{ reportId: 3, items: [{ reportSize: 8, reportCount: 64 }] }],
    }] as HIDCollectionInfo[]

    const transport = new AsusHidTransport(device as unknown as HIDDevice)

    expect(transport.diagnostics.reportId).toBe(3)
  })

  it('uses the largest vendor report and resolves only its complete input response', async () => {
    const device = new FakeHidDevice()
    device.collections = [{
      usagePage: 1,
      usage: 2,
      outputReports: [{ reportId: 1, items: [{ reportSize: 8, reportCount: 64 }] }],
      children: [{
        usagePage: 0xff01,
        usage: 1,
        outputReports: [
          { reportId: 3, items: [{ reportSize: 8, reportCount: 16 }] },
          { reportId: 7, items: [{ reportSize: 8, reportCount: 64 }] },
        ],
      }],
    }] as HIDCollectionInfo[]
    const logs: string[] = []
    const transport = new AsusHidTransport(
      device as unknown as HIDDevice,
      (entry) => logs.push(`${entry.direction}:${entry.message}`),
    )

    const request = new Uint8Array(64)
    request.set([0x12, 0x00, 0xab])
    let settled = false
    const result = transport.query(request).then((response) => {
      settled = true
      return response
    })
    await Promise.resolve()

    expect(transport.diagnostics).toMatchObject({
      reportId: 7,
      collectionCount: 2,
      vendorCollections: ['0xff01:0x1'],
    })
    expect(device.sendReport).toHaveBeenCalledWith(7, request.buffer)

    device.emitInput(3, new Uint8Array(64))
    device.emitInput(7, new Uint8Array(63))
    await Promise.resolve()
    expect(settled).toBe(false)

    const response = new Uint8Array(64)
    response.set([0x12, 0x00, 0xcd])
    device.emitInput(7, response)
    await expect(result).resolves.toEqual(response)
    expect(logs.map((entry) => entry.slice(0, 4))).toEqual(['info', 'tx:1', 'rx:1'])
  })

  it('ignores stale command packets and the wrong settings subsection', async () => {
    const device = new FakeHidDevice()
    const transport = new AsusHidTransport(device as unknown as HIDDevice)
    const request = new Uint8Array(64)
    request.set([0x12, 0x04, 0x02])
    let settled = false
    const result = transport.query(request).then((response) => {
      settled = true
      return response
    })
    await Promise.resolve()

    const staleButtons = new Uint8Array(64)
    staleButtons.set([0x12, 0x05, 0x00])
    device.emitInput(7, staleButtons)
    const wrongSettings = new Uint8Array(64)
    wrongSettings.set([0x12, 0x04, 0x00])
    device.emitInput(7, wrongSettings)
    await Promise.resolve()
    expect(settled).toBe(false)

    const expected = new Uint8Array(64)
    expected.set([0x12, 0x04, 0x02])
    device.emitInput(7, expected)
    await expect(result).resolves.toEqual(expected)
  })

  it('rejects pending and queued commands without writing after close', async () => {
    const device = new FakeHidDevice()
    const transport = new AsusHidTransport(device as unknown as HIDDevice)
    const request = new Uint8Array(64)

    const pending = transport.query(request).catch((error: unknown) => error)
    const queued = transport.query(request).catch((error: unknown) => error)
    await Promise.resolve()
    await transport.close()

    await expect(pending).resolves.toMatchObject({ message: '设备连接已关闭' })
    await expect(queued).resolves.toMatchObject({ message: '设备连接已关闭' })
    expect(device.sendReport).toHaveBeenCalledTimes(1)
    expect(device.close).toHaveBeenCalledOnce()
  })

  it('does not close the underlying HID twice when it is already closed', async () => {
    const device = new FakeHidDevice()
    device.opened = false
    const transport = new AsusHidTransport(device as unknown as HIDDevice)

    await transport.close()

    expect(device.close).not.toHaveBeenCalled()
  })
})
