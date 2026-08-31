import { useState } from 'react'
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
import type { ButtonAction, ProfileSnapshot } from './protocol/asus/types'

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

function MouseIllustration({ connected }: { connected: boolean }) {
  return (
    <div className={`mouse-visual ${connected ? 'is-connected' : ''}`} aria-hidden="true">
      <div className="mouse-glow" />
      <svg viewBox="0 0 180 240" role="presentation">
        <path
          className="mouse-body"
          d="M90 13c-37 0-64 27-70 76l-8 70c-5 42 26 68 78 68s83-26 78-68l-8-70c-6-49-33-76-70-76Z"
        />
        <path className="mouse-seam" d="M90 14v69M20 91h140" />
        <rect className="mouse-wheel" x="82" y="42" width="16" height="39" rx="8" />
        <path className="mouse-mark" d="m71 139 33-19-14 25 20 2-38 29 13-27-20-2 6-8Z" />
      </svg>
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
  } = useAsusMouse()
  const [showLogs, setShowLogs] = useState(false)
  const [reconnectLabel, setReconnectLabel] = useState('使用已授权设备')

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

  const updateButton = (index: number, value: string) => {
    const action = BUTTON_ACTIONS.find((candidate) => actionValue(candidate) === value)
    if (!action) return
    updateDraft((current) => ({
      ...current,
      buttons: current.buttons.map((button, buttonIndex) =>
        buttonIndex === index ? { ...button, action } : button,
      ),
    }))
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

  const isConnecting = connectionState === 'connecting'

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
          {connected ? (
            <button className="button secondary compact" type="button" onClick={() => void disconnectDevice()}>
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
          <MouseIllustration connected={connected} />
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
              <span>固件</span>
              <strong>{profile ? firmwareLabel(profile.primaryFirmware) : '—'}</strong>
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
              <div className="hero-copy">
                <span className="eyebrow accent">NO CRATE. JUST CONTROL.</span>
                <h2>轻量、透明的<br /><em>网页鼠标驱动。</em></h2>
                <p>
                  直接通过 WebHID 读写鼠标板载配置。没有常驻进程，没有账户，配置数据不会离开浏览器。
                </p>
                <div className="connect-actions">
                  <button className="button primary large" type="button" onClick={() => void connect()} disabled={isConnecting}>
                    <span>{isConnecting ? '正在读取设备' : '授权并连接'}</span>
                    <b>→</b>
                  </button>
                  <button className="button ghost large" type="button" onClick={() => void tryReconnect()} disabled={isConnecting}>
                    {reconnectLabel}
                  </button>
                </div>
              </div>
              <div className="connection-guide">
                <span className="guide-number">01</span>
                <div><strong>关闭奥创</strong><small>避免两个程序同时写入配置</small></div>
                <span className="guide-number">02</span>
                <div><strong>使用有线或 2.4G</strong><small>蓝牙模式暂不支持配置</small></div>
                <span className="guide-number">03</span>
                <div><strong>在弹窗中选择鼠标</strong><small>权限只授予当前网站</small></div>
              </div>
              <div className="feature-strip">
                <span>DPI 100—36K</span><span>125—1000 HZ</span><span>5 ONBOARD PROFILES</span><span>RGB</span>
              </div>
            </div>
          ) : (
            <div className="dashboard">
              <div className="dashboard-heading">
                <div>
                  <span className="eyebrow accent">PROFILE 0{draft.profileIndex + 1}</span>
                  <h2>性能与控制</h2>
                </div>
                <div className="firmware-block">
                  <span>主 / 接收器固件</span>
                  <strong>{firmwareLabel(draft.primaryFirmware)} / {firmwareLabel(draft.secondaryFirmware)}</strong>
                </div>
              </div>

              <section className="control-card dpi-card">
                <div className="card-heading">
                  <div><span className="card-index">01</span><div><h3>DPI 档位</h3><p>四档板载灵敏度，100 DPI 步进</p></div></div>
                  <span className="card-tag">AIMPOINT 36K</span>
                </div>
                <div className="dpi-list">
                  {draft.performance.dpi.map((dpi, index) => (
                    <div className={`dpi-row ${draft.dpiPreset === index ? 'current' : ''}`} key={index}>
                      <div className="dpi-name"><i style={{ '--dpi-color': ['#ff4b4b', '#b473ff', '#55a7ff', '#57e08a'][index] } as CSSProperties} /><span>档位 {index + 1}</span>{draft.dpiPreset === index && <small>当前</small>}</div>
                      <input
                        aria-label={`DPI 档位 ${index + 1}`}
                        type="range"
                        min="100"
                        max="36000"
                        step="100"
                        value={dpi}
                        onChange={(event) => updateDpi(index, Number(event.target.value))}
                      />
                      <label><input aria-label={`DPI 档位 ${index + 1} 数值`} type="number" min="100" max="36000" step="100" value={dpi} onChange={(event) => updateDpi(index, Number(event.target.value))} /><span>DPI</span></label>
                    </div>
                  ))}
                </div>
              </section>

              <div className="two-column">
                <section className="control-card performance-card">
                  <div className="card-heading compact-heading">
                    <div><span className="card-index">02</span><div><h3>性能</h3><p>传感器和点击响应</p></div></div>
                  </div>
                  <div className="field-group">
                    <label>回报率</label>
                    <div className="segmented">
                      {POLLING_RATES.map((rate) => <button key={rate} type="button" className={draft.performance.pollingRate === rate ? 'active' : ''} onClick={() => updateDraft((current) => ({ ...current, performance: { ...current.performance, pollingRate: rate } }))}>{rate}<small>Hz</small></button>)}
                    </div>
                  </div>
                  <div className="inline-fields">
                    <label><span>按键去抖</span><select value={draft.performance.debounce} onChange={(event) => updateDraft((current) => ({ ...current, performance: { ...current.performance, debounce: Number(event.target.value) } }))}>{DEBOUNCE_TIMES.map((time) => <option key={time} value={time}>{time} ms</option>)}</select></label>
                    <label className="toggle-row"><span><b>直线修正</b><small>Angle snapping</small></span><input type="checkbox" checked={draft.performance.angleSnapping} onChange={(event) => updateDraft((current) => ({ ...current, performance: { ...current.performance, angleSnapping: event.target.checked } }))} /><i /></label>
                  </div>
                </section>

                <section className="control-card lighting-card">
                  <div className="card-heading compact-heading">
                    <div><span className="card-index">03</span><div><h3>Logo 灯效</h3><p>写入当前板载配置</p></div></div>
                    <span className="light-preview" style={{ backgroundColor: rgbToHex(draft.led.color), boxShadow: `0 0 24px ${rgbToHex(draft.led.color)}88` }} />
                  </div>
                  <div className="lighting-fields">
                    <label><span>模式</span><select value={draft.led.mode} onChange={(event) => updateDraft((current) => ({ ...current, led: { ...current.led, mode: Number(event.target.value) } }))}>{LED_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
                    <label className="color-field"><span>颜色</span><input type="color" value={rgbToHex(draft.led.color)} disabled={draft.led.mode === 2 || draft.led.mode === 3 || draft.led.mode === 6} onChange={(event) => updateDraft((current) => ({ ...current, led: { ...current.led, color: hexToRgb(event.target.value) } }))} /><b>{rgbToHex(draft.led.color).toUpperCase()}</b></label>
                    <label className="brightness-field"><span>亮度</span><input type="range" min="0" max="4" step="1" value={draft.led.brightness} onChange={(event) => updateDraft((current) => ({ ...current, led: { ...current.led, brightness: Number(event.target.value) } }))} /><b>{draft.led.brightness * 25}%</b></label>
                  </div>
                </section>
              </div>

              <section className="control-card buttons-card">
                <div className="card-heading">
                  <div><span className="card-index">04</span><div><h3>按键映射</h3><p>支持鼠标动作和单个键盘按键</p></div></div>
                  <span className="card-tag">8 INPUTS</span>
                </div>
                <div className="button-map-grid">
                  {draft.buttons.map((button, index) => {
                    const currentValue = actionValue(button.action)
                    const isKnown = BUTTON_ACTIONS.some((action) => actionValue(action) === currentValue)
                    return (
                      <label className="button-map" key={`${button.sourceCode}-${index}`}>
                        <span><b>{String(index + 1).padStart(2, '0')}</b><i /><em>{button.sourceLabel}</em></span>
                        <select value={currentValue} onChange={(event) => updateButton(index, event.target.value)}>
                          {!isKnown && <option value={currentValue}>{button.action.label}（保留）</option>}
                          <optgroup label="鼠标动作">{BUTTON_ACTIONS.filter((action) => action.kind !== 'keyboard').map((action) => <option key={actionValue(action)} value={actionValue(action)}>{action.label}</option>)}</optgroup>
                          <optgroup label="键盘按键">{BUTTON_ACTIONS.filter((action) => action.kind === 'keyboard').map((action) => <option key={actionValue(action)} value={actionValue(action)}>{action.label}</option>)}</optgroup>
                        </select>
                      </label>
                    )
                  })}
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
        </section>
      </main>

      <footer>
        <span>ROGDRV WEB · COMMUNITY PROJECT</span>
        <span>GPL-3.0 · 本项目与 ASUS / ROG 无官方关联</span>
      </footer>

      {connected && dirty && draft && (
        <div className="save-dock">
          <div><span className="status-dot" /><p><strong>配置 0{draft.profileIndex + 1} 有未保存的更改</strong><small>应用后将写入鼠标板载内存</small></p></div>
          <div><button type="button" className="button ghost" onClick={discard} disabled={busy}>放弃更改</button><button type="button" className="button primary" onClick={() => void apply()} disabled={busy}>{busy ? '正在写入…' : '应用到设备'} <b>→</b></button></div>
        </div>
      )}
    </div>
  )
}

export default App
