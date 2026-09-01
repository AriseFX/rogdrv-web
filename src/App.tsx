import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import './App.css'
import { useAsusMouse } from './hooks/useAsusMouse'
import {
  BUTTON_ACTIONS,
  DEBOUNCE_TIMES,
  LED_MODES,
  POLLING_RATES,
} from './protocol/asus/constants'
import { normalizeDpi } from './protocol/asus/codec'
import { parseMouseBackup, serializeMouseBackup } from './protocol/asus/backup'
import type { ButtonAction, MouseBackup, ProfileSnapshot } from './protocol/asus/types'

function firmwareLabel(version: ProfileSnapshot['primaryFirmware']) {
  return [version.major, version.minor, version.build]
    .map((part) => part.toString(16).padStart(2, '0').toUpperCase())
    .join('.')
}

function rgbToHex(color: ProfileSnapshot['led']['color']) {
  return `#${[color.r, color.g, color.b]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')}`
}

function hexToRgb(value: string) {
  const normalized = value.replace('#', '')
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function actionValue(action: ButtonAction) {
  return `${action.kind}:${action.code}`
}

const DPI_MIN = 100
const DPI_MAX = 36_000
const DPI_SLIDER_STEPS = 1000
const DPI_SCALE_MARKS = [400, 800, 1200, 1600, 2400, 3200, 6400, 12_000, 36_000]

function dpiToSliderValue(dpi: number) {
  return Math.round(
    Math.log(normalizeDpi(dpi) / DPI_MIN)
    / Math.log(DPI_MAX / DPI_MIN)
    * DPI_SLIDER_STEPS,
  )
}

function sliderValueToDpi(value: number) {
  return DPI_MIN * Math.pow(DPI_MAX / DPI_MIN, value / DPI_SLIDER_STEPS)
}

function MouseIllustration({
  connected,
  dpiPreset,
}: {
  connected: boolean
  dpiPreset: number | null | undefined
}) {
  return (
    <div className={`mouse-visual ${connected ? 'is-connected' : ''}`}>
      <div className="mouse-stage-grid" />
      <div className="mouse-orbit orbit-one" />
      <div className="mouse-orbit orbit-two" />
      <div className="mouse-callout callout-left" aria-hidden="true"><b>01</b><span>左键</span></div>
      <div className="mouse-callout callout-right" aria-hidden="true"><span>右键</span><b>02</b></div>
      <div className="mouse-callout callout-forward" aria-hidden="true"><b>05</b><span>前进</span></div>
      <div className="mouse-callout callout-back" aria-hidden="true"><b>04</b><span>后退</span></div>
      <div className="mouse-model" data-color="black">
        <div className="mouse-glow" />
        <svg
          className="mouse-illustration"
          data-color="black"
          viewBox="0 0 220 360"
          role="img"
          aria-label="通用游戏鼠标黑色示意图"
        >
          <path
            className="mouse-shell"
            d="M110 8C56 8 25 45 25 105V255C25 315 62 352 110 352C158 352 195 315 195 255V105C195 45 164 8 110 8Z"
          />
          <path
            className="mouse-button-surface mouse-main-button"
            d="M107 11C60 12 29 45 29 104V122H107Z"
          />
          <path
            className="mouse-button-surface mouse-main-button"
            d="M113 11C160 12 191 45 191 104V122H113Z"
          />
          <path className="mouse-seam" d="M27 122H193M110 9V122" />
          <rect className="mouse-wheel-channel" x="96" y="34" width="28" height="78" rx="14" />
          <rect
            className="mouse-button-surface mouse-wheel"
            x="101"
            y="43"
            width="18"
            height="52"
            rx="9"
          />
          <circle
            className="dpi-indicator"
            data-active={dpiPreset !== null && dpiPreset !== undefined}
            cx="110"
            cy="139"
            r="3"
          />
          <rect
            className="mouse-button-surface mouse-side-button"
            x="18"
            y="148"
            width="18"
            height="38"
            rx="6"
          />
          <rect
            className="mouse-button-surface mouse-side-button"
            x="18"
            y="195"
            width="18"
            height="38"
            rx="6"
          />
        </svg>
      </div>
    </div>
  )
}

function App() {
  const {
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
  } = useAsusMouse()
  const [showLogs, setShowLogs] = useState(false)
  const [reconnectLabel, setReconnectLabel] = useState('使用已授权设备')
  const [dpiSelection, setDpiSelection] = useState<{ profileIndex: number, stage: number } | null>(null)
  const [selectedButtonIndex, setSelectedButtonIndex] = useState(0)
  const [buttonActionGroup, setButtonActionGroup] = useState<'mouse' | 'keyboard'>('mouse')
  const [pendingBackup, setPendingBackup] = useState<MouseBackup | null>(null)
  const [backupFileError, setBackupFileError] = useState<string | null>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => event.preventDefault()
    window.addEventListener('contextmenu', preventContextMenu)
    return () => window.removeEventListener('contextmenu', preventContextMenu)
  }, [])

  const updateDraft = (updater: (current: ProfileSnapshot) => ProfileSnapshot) => {
    setDraft((current) => (current ? updater(current) : current))
  }

  const updateDpi = (index: number, value: number) => {
    updateDraft((current) => {
      const dpi = [...current.performance.dpi] as ProfileSnapshot['performance']['dpi']
      dpi[index] = normalizeDpi(value)
      return {
        ...current,
        performance: { ...current.performance, dpi },
      }
    })
  }

  const updateDpiColor = (index: number, value: string) => {
    updateDraft((current) => {
      const dpiColors = [...current.dpiColors] as ProfileSnapshot['dpiColors']
      dpiColors[index] = hexToRgb(value)
      return { ...current, dpiColors }
    })
  }

  const addDpiPreset = (profileIndex: number, nextIndex: number) => {
    setDpiSelection({ profileIndex, stage: nextIndex })
    updateDraft((current) => ({ ...current, dpiPresetCount: current.dpiPresetCount + 1 }))
  }

  const removeDpiPreset = (profileIndex: number, removedIndex: number, dpiPresetCount: number) => {
    setDpiSelection({ profileIndex, stage: Math.min(removedIndex, dpiPresetCount - 1) })
    updateDraft((current) => {
      const dpi = [...current.performance.dpi] as ProfileSnapshot['performance']['dpi']
      const dpiColors = [...current.dpiColors] as ProfileSnapshot['dpiColors']
      for (let index = removedIndex; index < dpiPresetCount; index += 1) {
        dpi[index] = dpi[index + 1]
        dpiColors[index] = dpiColors[index + 1]
      }
      return {
        ...current,
        dpiPresetCount,
        dpiPreset: current.dpiPreset === null
          ? null
          : Math.min(
              current.dpiPreset - Number(current.dpiPreset > removedIndex),
              dpiPresetCount - 1,
            ),
        performance: { ...current.performance, dpi },
        dpiColors,
      }
    })
  }

  const updateButton = (index: number, action: ButtonAction) => {
    updateDraft((current) => ({
      ...current,
      buttons: current.buttons.map((button, buttonIndex) =>
        buttonIndex === index ? { ...button, action } : button,
      ),
    }))
  }

  const selectButtonMapping = (index: number, actionKind: ButtonAction['kind']) => {
    setSelectedButtonIndex(index)
    setButtonActionGroup(actionKind === 'keyboard' ? 'keyboard' : 'mouse')
  }

  const tryReconnect = async () => {
    setReconnectLabel('正在查找…')
    const found = await reconnect().catch(() => false)
    setReconnectLabel(found ? '使用已授权设备' : '没有已授权设备')
  }

  const disconnectDevice = async () => {
    await disconnect()
    setReconnectLabel('使用已授权设备')
  }

  const exportConfiguration = async () => {
    const backup = await exportBackup()
    if (!backup) return
    const url = URL.createObjectURL(new Blob([serializeMouseBackup(backup)], {
      type: 'application/json',
    }))
    const link = document.createElement('a')
    link.href = url
    link.download = `rog-gladius-iii-backup-${backup.createdAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const readBackupFile = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')))
    reader.addEventListener('error', () => reject(new Error('无法读取备份文件')))
    reader.readAsText(file)
  })

  const importConfiguration = async (file: File | undefined) => {
    if (!file) return
    setBackupFileError(null)
    try {
      setPendingBackup(parseMouseBackup(await readBackupFile(file)))
    } catch (cause) {
      setBackupFileError((cause as Error).message)
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = ''
    }
  }

  const confirmRestore = async () => {
    if (await restoreBackup(pendingBackup!)) setPendingBackup(null)
  }

  const isConnecting = connectionState === 'connecting'
  const selectedDpiIndex = draft
    ? Math.min(
        dpiSelection?.profileIndex === draft.profileIndex
          ? dpiSelection.stage
          : (draft.dpiPreset ?? 0),
        draft.dpiPresetCount - 1,
      )
    : 0
  const selectedDpi = draft?.performance.dpi[selectedDpiIndex] ?? DPI_MIN
  const selectedDpiColor = draft?.dpiColors[selectedDpiIndex] ?? { r: 255, g: 49, b: 80 }
  const selectedButton = draft?.buttons[selectedButtonIndex]
  const ledColorHex = draft ? rgbToHex(draft.led.color) : '#ff3150'
  const ledEditorMode = draft?.led.mode === 0xf0
    ? 'off'
    : draft?.led.mode === 6
      ? 'battery'
      : [2, 3].includes(draft?.led.mode ?? -1)
        ? 'rainbow'
        : 'solid'
  const ledAccentColor = {
    off: '#4d5560',
    battery: '#35d07f',
    rainbow: '#9b5cff',
    solid: ledColorHex,
  }[ledEditorMode]
  const ledPaint = {
    off: '#4d5560',
    battery: 'linear-gradient(135deg, #35d07f 0 34%, #ffd43b 50% 67%, #ff3150 84%)',
    rainbow: 'conic-gradient(from 35deg, #ff3150, #ff8a3d, #ffd43b, #35d07f, #3478ff, #9b5cff, #ff3150)',
    solid: ledColorHex,
  }[ledEditorMode]
  const ledModeDescription = {
    off: '未输出灯光',
    battery: '颜色随电量自动变化',
    rainbow: '颜色由灯效自动循环',
    solid: ledColorHex.toUpperCase(),
  }[ledEditorMode]

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ROG Driver Web 首页">
          <span className="brand-mark">R</span>
          <span>
            <strong>ROGDRV</strong>
            <small>WEB CONTROL</small>
          </span>
        </a>
        <div className="topbar-actions">
          <span className={`connection-pill ${connected ? 'online' : ''}`}>
            <span className="status-dot" />
            {connected ? '设备在线' : '等待设备'}
          </span>
          {connected && (
            <div className="header-save-actions">
              <button type="button" className="button ghost header-refresh" onClick={() => void refresh()} disabled={busy}>
                {busy ? '正在读取…' : '重新读取设备'}
              </button>
              {dirty && <button type="button" className="button ghost header-discard" onClick={discard} disabled={busy}>放弃</button>}
              <button type="button" className="button primary header-apply" onClick={() => void apply()} disabled={!dirty || busy}>
                {busy ? '正在写入…' : '应用到设备'}
              </button>
            </div>
          )}
          {connected ? (
            <button className={`button secondary compact disconnect-button ${dirty ? 'has-dirty' : ''}`} type="button" onClick={() => void disconnectDevice()}>
              断开
            </button>
          ) : (
            <button className="button primary compact" type="button" onClick={() => void connect()} disabled={isConnecting}>
              {isConnecting ? '连接中…' : '连接鼠标'}
            </button>
          )}
          <a
            className="github-link"
            href="https://github.com/AriseFX/rogdrv-web"
            target="_blank"
            rel="noreferrer"
            aria-label="打开 GitHub 仓库"
          >
            GitHub ↗
          </a>
        </div>
      </header>

      <main id="top" className="workspace">
        <aside className="device-panel">
          <div className="device-heading">
            <span className="eyebrow">TARGET DEVICE</span>
            <span className="device-index">P711</span>
          </div>
          <MouseIllustration connected={connected} dpiPreset={draft?.dpiPreset ?? profile?.dpiPreset} />
          <div className="device-title">
            <h1>战刃 III</h1>
            <p>Wireless AimPoint 36K</p>
          </div>

          <div className="device-meta">
            <div>
              <span>连接</span>
              <strong>{deviceDefinition?.connection === 'receiver' ? '2.4G RF' : connected ? 'USB 有线' : '—'}</strong>
            </div>
            <div>
              <span>主 / 接收器固件</span>
              <strong>{profile ? `${firmwareLabel(profile.primaryFirmware)} / ${firmwareLabel(profile.secondaryFirmware)}` : '— / —'}</strong>
            </div>
            <div>
              <span>电量</span>
              <strong>{battery ? `${battery.percentage}% · ${battery.charging ? '正在充电' : '使用电池'}` : '—'}</strong>
            </div>
          </div>

          <div className="profile-nav">
            <div className="section-label">
              <span>板载配置</span>
              <small>5 SLOTS</small>
            </div>
            <div className="profile-grid">
              {Array.from({ length: 5 }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  className={profile?.profileIndex === index ? 'active' : ''}
                  disabled={!connected || busy || dirty}
                  onClick={() => void switchProfile(index)}
                  aria-label={`切换到配置 ${index + 1}`}
                >
                  <span>0{index + 1}</span>
                  {profile?.profileIndex === index && <i />}
                </button>
              ))}
            </div>
            {dirty && <p className="profile-hint">保存或放弃更改后才能切换配置档</p>}
            <div className="profile-tools">
              <button type="button" onClick={() => void exportConfiguration()} disabled={!connected || busy}>导出配置备份</button>
              <button type="button" onClick={() => backupInputRef.current?.click()} disabled={!connected || busy}>导入配置备份</button>
              <input
                ref={backupInputRef}
                className="visually-hidden"
                type="file"
                accept="application/json,.json"
                aria-label="选择配置备份文件"
                onChange={(event) => void importConfiguration(event.target.files?.[0])}
              />
            </div>
            {backupFileError && <p className="profile-file-error" role="alert">{backupFileError}</p>}
          </div>

          <div className="support-note">
            <span className="support-icon">i</span>
            <p>使用前请完全退出奥创。暂不提供固件升级，避免设备风险。</p>
          </div>
        </aside>

        <section className="content-panel">
          {error && (
            <div className="alert error" role="alert">
              <span>!</span>
              <p><strong>操作没有完成</strong>{error}</p>
              <button type="button" onClick={() => void connect()}>重试</button>
            </div>
          )}

          {connectionState === 'unsupported' ? (
            <div className="empty-state">
              <span className="empty-code">WEBHID / UNSUPPORTED</span>
              <h2>当前浏览器不支持 WebHID</h2>
              <p>请在桌面版 Chrome、Edge、Brave 或其他 Chromium 浏览器中打开本页。</p>
            </div>
          ) : !connected || !draft ? (
            <div className="connect-view">
              <section className="connect-card" aria-labelledby="connect-title">
                <div className="connect-heading">
                  <div>
                    <span className="eyebrow accent">设备连接</span>
                    <h2 id="connect-title">连接战刃 III</h2>
                  </div>
                  <span className="connection-type">WEBHID</span>
                </div>
                <p className="connect-summary">使用 USB 有线或原装 2.4G 接收器，授权浏览器读取和写入板载配置。</p>
                <div className="connection-requirements">
                  <div><span>01</span><strong>完全退出 Armoury Crate</strong></div>
                  <div><span>02</span><strong>连接 USB 或 2.4G 接收器</strong></div>
                  <div><span>03</span><strong>在设备弹窗中选择鼠标</strong></div>
                </div>
                <div className="connect-actions">
                  <button className="button primary large" type="button" onClick={() => void connect()} disabled={isConnecting}>
                    <span>{isConnecting ? '正在读取设备' : '授权并连接'}</span>
                    <b>→</b>
                  </button>
                  <button className="button ghost large" type="button" onClick={() => void tryReconnect()} disabled={isConnecting}>
                    {reconnectLabel}
                  </button>
                </div>
                <p className="connection-note">2.4G 已实机验证 · 蓝牙暂不支持 · 不提供固件升级</p>
              </section>
            </div>
          ) : (
            <div className="dashboard">
              <section className="control-card dpi-card">
                <div className="card-heading">
                  <div><span className="card-index">01</span><div><h3>DPI 灵敏度</h3><p>{draft.dpiPreset === null ? '当前档未知' : `当前 ${draft.performance.dpi[draft.dpiPreset].toLocaleString()} DPI`} · 50 DPI 步进</p></div></div>
                  <span className="card-tag">{draft.dpiPresetCount} 个档位</span>
                </div>
                <div className="dpi-workbench">
                  <aside className="dpi-preset-panel" aria-label="DPI 档位">
                    <div className="dpi-preset-heading">
                      <div><strong>DPI 档位</strong><span>选择后编辑</span></div>
                      <button
                        type="button"
                        className="dpi-remove-button"
                        aria-label="减少 DPI 档位"
                        disabled={draft.dpiPresetCount <= 2}
                        onClick={() => removeDpiPreset(draft.profileIndex, selectedDpiIndex, draft.dpiPresetCount - 1)}
                      >
                        <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 5.5h12M8 3.5h4M6 5.5l.7 10h6.6l.7-10M8.5 8v5M11.5 8v5" /></svg>
                      </button>
                    </div>
                    <div className="dpi-preset-list">
                      {draft.performance.dpi.slice(0, draft.dpiPresetCount).map((dpi, index) => (
                        <button
                          type="button"
                          key={index}
                          className={selectedDpiIndex === index ? 'selected' : ''}
                          aria-label={`选择 DPI 档位 ${index + 1}`}
                          aria-pressed={selectedDpiIndex === index}
                          onClick={() => setDpiSelection({ profileIndex: draft.profileIndex, stage: index })}
                        >
                          <i style={{ '--dpi-color': rgbToHex(draft.dpiColors[index]) } as CSSProperties} />
                          <span>档位 {String(index + 1).padStart(2, '0')}</span>
                          <strong>{dpi}</strong>
                          {draft.dpiPreset === index && <em>当前</em>}
                        </button>
                      ))}
                      {draft.dpiPresetCount < 4 && (
                        <button
                          type="button"
                          className="dpi-add-button"
                          aria-label="增加 DPI 档位"
                          onClick={() => addDpiPreset(draft.profileIndex, draft.dpiPresetCount)}
                        ><b>+</b><span>添加档位</span></button>
                      )}
                    </div>
                  </aside>

                  <div
                    className="dpi-editor"
                    style={{
                      '--dpi-color': rgbToHex(selectedDpiColor),
                      '--dpi-progress': `${dpiToSliderValue(selectedDpi) / 10}%`,
                    } as CSSProperties}
                  >
                    <div className="dpi-editor-heading">
                      <div><strong>DPI 设置</strong><span>档位 {String(selectedDpiIndex + 1).padStart(2, '0')}</span></div>
                      <div className="dpi-editor-actions">
                        <label className="dpi-color-field">
                          <span>颜色</span>
                          <input
                            aria-label={`DPI 档位 ${selectedDpiIndex + 1} 颜色`}
                            className="dpi-color"
                            type="color"
                            value={rgbToHex(selectedDpiColor)}
                            onChange={(event) => updateDpiColor(selectedDpiIndex, event.target.value)}
                            style={{ '--dpi-color': rgbToHex(selectedDpiColor) } as CSSProperties}
                          />
                        </label>
                        <button
                          type="button"
                          className="dpi-current-button"
                          aria-label={`DPI 档位 ${selectedDpiIndex + 1} ${draft.dpiPreset === selectedDpiIndex ? '当前档' : '设为当前'}`}
                          aria-pressed={draft.dpiPreset === selectedDpiIndex}
                          onClick={() => updateDraft((current) => ({ ...current, dpiPreset: selectedDpiIndex }))}
                        ><i />{draft.dpiPreset === selectedDpiIndex ? '当前档' : '设为当前'}</button>
                      </div>
                    </div>

                    <div className="dpi-slider-area">
                      <output>{selectedDpi.toLocaleString()}</output>
                      <input
                        aria-label={`DPI 档位 ${selectedDpiIndex + 1}`}
                        aria-valuetext={`${selectedDpi} DPI`}
                        type="range"
                        min="0"
                        max={DPI_SLIDER_STEPS}
                        step="1"
                        value={dpiToSliderValue(selectedDpi)}
                        onChange={(event) => updateDpi(selectedDpiIndex, sliderValueToDpi(Number(event.target.value)))}
                      />
                      <div className="dpi-scale" aria-hidden="true">
                        {DPI_SCALE_MARKS.map((mark, index) => (
                          <span
                            key={mark}
                            data-edge={index === DPI_SCALE_MARKS.length - 1 ? 'end' : undefined}
                            style={{ '--dpi-mark': `${dpiToSliderValue(mark) / 10}%` } as CSSProperties}
                          >{mark === DPI_MAX ? '36K' : mark.toLocaleString()}</span>
                        ))}
                      </div>
                    </div>

                    <div className="dpi-editor-footer">
                      <span>100–36,000 DPI · 50 步进</span>
                      <div className="dpi-value-stepper">
                        <button
                          type="button"
                          aria-label={`DPI 档位 ${selectedDpiIndex + 1} 减少 50`}
                          disabled={selectedDpi <= DPI_MIN}
                          onClick={() => updateDpi(selectedDpiIndex, selectedDpi - 50)}
                        >−</button>
                        <label>
                          <input
                            aria-label={`DPI 档位 ${selectedDpiIndex + 1} 数值`}
                            type="number"
                            min={DPI_MIN}
                            max={DPI_MAX}
                            step="50"
                            value={selectedDpi}
                            onChange={(event) => updateDpi(selectedDpiIndex, Number(event.target.value))}
                          />
                          <span>DPI</span>
                        </label>
                        <button
                          type="button"
                          aria-label={`DPI 档位 ${selectedDpiIndex + 1} 增加 50`}
                          disabled={selectedDpi >= DPI_MAX}
                          onClick={() => updateDpi(selectedDpiIndex, selectedDpi + 50)}
                        >+</button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="control-card performance-card">
                <div className="card-heading">
                  <div><span className="card-index">02</span><div><h3>性能</h3><p>传感器回报与按键响应</p></div></div>
                  <span className="card-tag">{draft.performance.pollingRate.toLocaleString()} HZ</span>
                </div>
                <div className="settings-workbench performance-workbench">
                  <aside className="settings-summary-panel" aria-label="性能摘要">
                    <div className="settings-panel-heading"><strong>当前性能</strong><span>修改后应用到设备</span></div>
                    <div className="performance-summary-list">
                      <div><span>回报率</span><strong>{draft.performance.pollingRate.toLocaleString()} Hz</strong><small>{(1000 / draft.performance.pollingRate).toFixed(draft.performance.pollingRate === 1000 ? 0 : 1)} ms</small></div>
                      <div><span>按键去抖</span><strong>{draft.performance.debounce} ms</strong><small>点击延迟</small></div>
                      <div><span>直线修正</span><strong>{draft.performance.angleSnapping ? '开启' : '关闭'}</strong><small>指针轨迹</small></div>
                      <div><span>抬升距离</span><strong>{draft.sensor.liftOffDistance === 'low' ? '低' : '高'}</strong><small>表面感应</small></div>
                    </div>
                  </aside>
                  <div className="settings-editor performance-editor">
                    <section className="editor-section polling-section">
                      <div className="editor-section-heading"><div><strong>USB 回报率</strong><span>越高，指针反馈越及时</span></div><output>{draft.performance.pollingRate.toLocaleString()} Hz</output></div>
                      <div className="polling-rate-track">
                        {POLLING_RATES.map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            className={draft.performance.pollingRate === rate ? 'selected' : ''}
                            aria-label={`${rate}Hz`}
                            aria-pressed={draft.performance.pollingRate === rate}
                            onClick={() => updateDraft((current) => ({ ...current, performance: { ...current.performance, pollingRate: rate } }))}
                          ><strong>{rate}</strong><span>Hz</span><small>{(1000 / rate).toFixed(rate === 1000 ? 0 : 1)} ms</small></button>
                        ))}
                      </div>
                    </section>
                    <div className="performance-detail-grid">
                      <section className="editor-section debounce-section">
                        <div className="editor-section-heading"><div><strong>按键去抖</strong><span>数值越低，点击响应越快</span></div><output>{draft.performance.debounce} ms</output></div>
                        <div className="debounce-options">
                          {DEBOUNCE_TIMES.map((time) => (
                            <button
                              key={time}
                              type="button"
                              className={draft.performance.debounce === time ? 'selected' : ''}
                              aria-label={`按键去抖 ${time}ms`}
                              aria-pressed={draft.performance.debounce === time}
                              onClick={() => updateDraft((current) => ({ ...current, performance: { ...current.performance, debounce: time } }))}
                            >{time}<small>ms</small></button>
                          ))}
                        </div>
                      </section>
                      <label className="feature-toggle-card">
                        <span><b>直线修正</b><small>平滑修正细微的指针抖动</small></span>
                        <input aria-label="直线修正" type="checkbox" checked={draft.performance.angleSnapping} onChange={(event) => updateDraft((current) => ({ ...current, performance: { ...current.performance, angleSnapping: event.target.checked } }))} />
                        <i />
                      </label>
                      <section className="sensor-calibration-card">
                        <div><strong>表面感应</strong><span>低档更快停止追踪；改变档位会恢复标准表面校准</span></div>
                        <div className="lift-off-options" role="group" aria-label="抬升距离">
                          {(['low', 'high'] as const).map((distance) => (
                            <button
                              key={distance}
                              type="button"
                              className={draft.sensor.liftOffDistance === distance ? 'selected' : ''}
                              aria-label={`${distance === 'low' ? '低' : '高'}抬升距离`}
                              aria-pressed={draft.sensor.liftOffDistance === distance}
                              onClick={() => updateDraft((current) => ({ ...current, sensor: { liftOffDistance: distance } }))}
                            >{distance === 'low' ? '低' : '高'}<small>{distance === 'low' ? '更早停止' : '更高容差'}</small></button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="calibration-reset"
                          aria-label="恢复标准表面校准"
                          disabled={busy || dirty}
                          onClick={() => void resetSurfaceCalibration()}
                        >恢复标准校准</button>
                      </section>
                    </div>
                  </div>
                </div>
              </section>

              <section
                className="control-card lighting-card"
                data-mode={ledEditorMode}
                style={{
                  '--light-color': ledAccentColor,
                  '--light-paint': ledPaint,
                  '--light-progress': `${draft.led.brightness}%`,
                  '--light-opacity': draft.led.brightness / 100,
                } as CSSProperties}
              >
                <div className="card-heading">
                  <div><span className="card-index">03</span><div><h3>Logo 灯效</h3><p>模式、颜色和亮度</p></div></div>
                  <span className="light-preview" style={{ background: ledPaint, boxShadow: ledEditorMode === 'off' ? 'none' : `0 0 24px ${ledAccentColor}88` }} />
                </div>
                <div className="settings-workbench lighting-workbench">
                  <aside className="lighting-mode-panel" aria-label="Logo 灯效模式">
                    <div className="settings-panel-heading"><strong>灯效模式</strong><span>选择后编辑</span></div>
                    <div className="lighting-mode-list">
                      {LED_MODES.map((mode) => (
                        <button
                          key={mode.value}
                          type="button"
                          className={draft.led.mode === mode.value ? 'selected' : ''}
                          aria-label={`Logo 灯效模式 ${mode.label}`}
                          aria-pressed={draft.led.mode === mode.value}
                          onClick={() => updateDraft((current) => ({ ...current, led: { ...current.led, mode: mode.value } }))}
                        ><i /><span>{mode.label}</span>{draft.led.mode === mode.value && <em>当前</em>}</button>
                      ))}
                    </div>
                  </aside>
                  <div className="settings-editor lighting-editor">
                    <div className="lighting-hero">
                      <div className="lighting-orb" role="img" aria-label="Logo 灯效预览" data-mode={ledEditorMode}><i /></div>
                      <div><span>当前效果</span><strong>{LED_MODES.find((mode) => mode.value === draft.led.mode)?.label ?? '未知模式'}</strong><small>{ledModeDescription}</small></div>
                    </div>
                    {ledEditorMode === 'solid' && (
                      <section className="editor-section color-editor-section">
                        <div className="editor-section-heading"><div><strong>Logo 颜色</strong><span>选择预设或自定义颜色</span></div></div>
                        <div className="color-preset-row">
                          {['#ff3150', '#ff8a3d', '#ffd43b', '#35d07f', '#3478ff', '#9b5cff', '#ffffff'].map((color) => (
                            <button
                              key={color}
                              type="button"
                              aria-label={`设置 Logo 颜色 ${color.toUpperCase()}`}
                              aria-pressed={ledColorHex.toLowerCase() === color}
                              style={{ '--preset-color': color } as CSSProperties}
                              onClick={() => updateDraft((current) => ({ ...current, led: { ...current.led, color: hexToRgb(color) } }))}
                            ><i /></button>
                          ))}
                          <label className="custom-color-button">
                            <input aria-label="Logo 灯效颜色" type="color" value={ledColorHex} onChange={(event) => updateDraft((current) => ({ ...current, led: { ...current.led, color: hexToRgb(event.target.value) } }))} />
                            <span>自定义</span><b>{ledColorHex.toUpperCase()}</b>
                          </label>
                        </div>
                      </section>
                    )}
                    {ledEditorMode === 'rainbow' && (
                      <section className="editor-section automatic-color-section">
                        <div className="editor-section-heading"><div><strong>循环色谱</strong><span>该模式自动生成颜色，无需选择单色</span></div></div>
                        <div className="spectrum-preview" aria-label="自动循环色谱"><i /><span>自动循环</span></div>
                      </section>
                    )}
                    {ledEditorMode === 'battery' && (
                      <section className="editor-section automatic-color-section">
                        <div className="editor-section-heading"><div><strong>电量色阶</strong><span>Logo 颜色会根据剩余电量自动切换</span></div></div>
                        <div className="battery-color-scale" aria-label="电量指示颜色">
                          <div><i /><span><strong>高电量</strong><small>绿色</small></span></div>
                          <div><i /><span><strong>中电量</strong><small>黄色</small></span></div>
                          <div><i /><span><strong>低电量</strong><small>红色</small></span></div>
                        </div>
                      </section>
                    )}
                    {ledEditorMode === 'off' && (
                      <section className="editor-section lighting-off-state">
                        <i aria-hidden="true" />
                        <div><strong>灯效已关闭</strong><span>选择左侧其他模式后可继续编辑灯光</span></div>
                      </section>
                    )}
                    <section className={`editor-section brightness-editor-section ${ledEditorMode === 'off' ? 'is-disabled' : ''}`}>
                      <div className="editor-section-heading"><div><strong>亮度</strong><span>{ledEditorMode === 'off' ? '关闭模式下不可调节' : 'Logo 灯光输出强度'}</span></div><output>{ledEditorMode === 'off' ? '—' : `${draft.led.brightness}%`}</output></div>
                      <div className="lighting-range"><input aria-label="Logo 灯效亮度" type="range" min="0" max="100" step="1" value={draft.led.brightness} disabled={ledEditorMode === 'off'} onChange={(event) => updateDraft((current) => ({ ...current, led: { ...current.led, brightness: Number(event.target.value) } }))} /></div>
                    </section>
                  </div>
                </div>
              </section>

              <section className="control-card buttons-card">
                <div className="card-heading">
                  <div><span className="card-index">04</span><div><h3>按键映射</h3><p>支持鼠标动作和单个键盘按键</p></div></div>
                  <span className="card-tag">8 INPUTS</span>
                </div>
                <div className="settings-workbench button-mapping-workbench">
                  <aside className="button-source-panel" aria-label="鼠标实体按键">
                    <div className="settings-panel-heading"><strong>实体按键</strong><span>选择要修改的按键</span></div>
                    <div className="button-source-list">
                      {draft.buttons.map((button, index) => (
                        <button
                          key={`${button.sourceCode}-${index}`}
                          type="button"
                          className={selectedButtonIndex === index ? 'selected' : ''}
                          aria-label={`编辑${button.sourceLabel}映射`}
                          aria-pressed={selectedButtonIndex === index}
                          onClick={() => selectButtonMapping(index, button.action.kind)}
                        ><b>{String(index + 1).padStart(2, '0')}</b><span>{button.sourceLabel}</span><em>{button.action.label}</em></button>
                      ))}
                    </div>
                  </aside>
                  {selectedButton && (
                    <div className="settings-editor mapping-editor">
                      <div className="mapping-editor-heading">
                        <div><span>正在编辑</span><strong>{selectedButton.sourceLabel}</strong></div>
                        <div className="mapping-current"><span>当前功能</span><strong>{selectedButton.action.label}</strong>{selectedButton.action.kind === 'unknown' && <em>保留</em>}</div>
                      </div>
                      <div className="mapping-tabs" role="tablist" aria-label="映射功能分类">
                        <button type="button" role="tab" aria-selected={buttonActionGroup === 'mouse'} className={buttonActionGroup === 'mouse' ? 'selected' : ''} onClick={() => setButtonActionGroup('mouse')}>鼠标动作</button>
                        <button type="button" role="tab" aria-selected={buttonActionGroup === 'keyboard'} className={buttonActionGroup === 'keyboard' ? 'selected' : ''} onClick={() => setButtonActionGroup('keyboard')}>键盘按键</button>
                      </div>
                      <div className={`mapping-action-grid ${buttonActionGroup === 'keyboard' ? 'keyboard-actions' : ''}`} role="tabpanel">
                        {BUTTON_ACTIONS.filter((action) => buttonActionGroup === 'keyboard' ? action.kind === 'keyboard' : action.kind !== 'keyboard').map((action) => {
                          const selected = actionValue(selectedButton.action) === actionValue(action)
                          return (
                            <button
                              key={actionValue(action)}
                              type="button"
                              className={selected ? 'selected' : ''}
                              aria-label={`映射为${action.label}`}
                              aria-pressed={selected}
                              onClick={() => updateButton(selectedButtonIndex, action)}
                            ><i /><span>{action.label}</span>{selected && <em>当前</em>}</button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section className="diagnostics">
                <button type="button" onClick={() => setShowLogs((current) => !current)}>
                  <span><i />设备诊断</span><b>{showLogs ? '收起 ↑' : '展开 ↓'}</b>
                </button>
                {showLogs && (
                  <div className="diagnostics-body">
                    <div className="diagnostic-meta">
                      <span>VID:PID <b>{diagnostics ? `${diagnostics.vendorId.toString(16).padStart(4, '0')}:${diagnostics.productId.toString(16).padStart(4, '0')}` : '—'}</b></span>
                      <span>Report ID <b>{diagnostics?.reportId ?? '—'}</b></span>
                      <span>Collections <b>{diagnostics?.collectionCount ?? '—'}</b></span>
                    </div>
                    <pre>{logs.length > 0 ? logs.map((entry) => `${new Date(entry.timestamp).toLocaleTimeString()}  ${entry.direction.toUpperCase().padEnd(4)} ${entry.message}`).join('\n') : '尚无通信记录'}</pre>
                  </div>
                )}
              </section>
            </div>
          )}

          <footer>
            <span>ROGDRV WEB · COMMUNITY PROJECT</span>
            <span>GPL-3.0 · 本项目与 ASUS / ROG 无官方关联</span>
          </footer>
        </section>
      </main>

      {pendingBackup && (
        <div className="modal-backdrop" role="presentation">
          <section className="restore-dialog" role="dialog" aria-modal="true" aria-label="配置恢复预览">
            <span className="eyebrow accent">恢复预览</span>
            <h2>恢复 5 个板载配置</h2>
            <dl>
              <div><dt>备份日期</dt><dd>{pendingBackup.createdAt.slice(0, 10)}</dd></div>
              <div><dt>目标设备</dt><dd>{pendingBackup.device.productName}</dd></div>
              <div><dt>恢复后配置</dt><dd>0{pendingBackup.activeProfileIndex + 1}</dd></div>
            </dl>
            <p>将依次写入全部配置档。恢复过程中请保持鼠标连接。</p>
            <div className="restore-actions">
              <button type="button" className="button ghost" onClick={() => setPendingBackup(null)} disabled={busy}>取消</button>
              <button type="button" className="button primary" onClick={() => void confirmRestore()} disabled={busy}>{busy ? '正在恢复…' : '恢复到设备'}</button>
            </div>
          </section>
        </div>
      )}

    </div>
  )
}

export default App
