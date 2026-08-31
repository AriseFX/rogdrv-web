# ROGDRV Web

一个基于 React、TypeScript 和 WebHID 的华硕 ROG 鼠标开源网页配置器。首个支持型号是 **ROG Gladius III Wireless AimPoint 36K（战刃 III 无线 AimPoint 36K）**。

> 当前状态：协议移植、单元测试和浏览器界面已经完成，但仍需要在真实鼠标上验证各固件版本。首次使用时建议先记录原配置，并从读取、切换 DPI 等低风险操作开始。

## 支持范围

| 连接方式 | VID:PID | 状态 |
| --- | --- | --- |
| USB 有线 | `0b05:1a70` | 已实现，待实机验证 |
| 2.4G 原装接收器 | `0b05:1a72` | 已实现，待实机验证 |
| 蓝牙 | `0b05:1a74` | 暂不支持 |

已实现功能：

- 5 个板载配置档切换
- 4 档 DPI，范围 `100–36,000`，步进 `100`
- `125 / 250 / 500 / 1000 Hz` 回报率
- `4–32 ms` 按键去抖
- 直线修正（Angle Snapping）
- 鼠标动作及单键键盘映射
- Logo RGB 模式、颜色和亮度
- 固件版本、当前 DPI 档位和原始 HID 通信日志
- 只写入发生变化的字段，最后单次提交到板载内存

本项目**不提供固件升级**，也不会尝试访问鼠标的 DFU 模式。

## 本地运行

需要 Node.js 20.19+ 或 22.12+，以及支持 WebHID 的桌面 Chromium 浏览器（Chrome、Edge、Brave 等）。

```bash
npm install
npm run dev
```

打开终端显示的 `http://localhost:5173`。WebHID 只能在 HTTPS 或 localhost 安全上下文中使用，不能直接双击 `index.html`。

没有鼠标时，可以访问 `http://localhost:5173/?demo=1` 预览完整配置界面；演示模式不会访问任何硬件。

使用前：

1. 完全退出 Armoury Crate（奥创）。
2. 使用 USB 有线或原装 2.4G 接收器连接鼠标。
3. 点击“授权并连接”，在浏览器弹窗中选择鼠标。
4. 修改配置后点击“应用到设备”，才会写入板载内存。

## 开发命令

```bash
npm run test
npm run lint
npm run build
npm run preview
```

## 技术说明

项目使用 64 字节 ASUS HID Input/Output Report，而不是 Feature Report。核心命令包括：

| 命令 | 值 | 用途 |
| --- | --- | --- |
| `GET_PROFILE` | `0x0012` | 当前配置档和固件信息 |
| `GET_LED` | `0x0312` | 灯效 |
| `GET_SETTINGS` | `0x0412` | DPI、回报率、去抖、直线修正 |
| `GET_BUTTONS` | `0x0512` | 按键映射 |
| `SET_PROFILE` | `0x0250` | 切换配置档 |
| `SAVE` | `0x0350` | 提交到板载内存 |
| `SET_BUTTON` | `0x2151` | 设置按键 |
| `SET_LED` | `0x2851` | 设置灯效 |
| `SET_SETTING` | `0x3151` | 设置性能参数 |

协议实现位于 [`src/protocol/asus`](src/protocol/asus)，React 设备状态位于 [`src/hooks/useAsusMouse.ts`](src/hooks/useAsusMouse.ts)。

## 上游与致谢

ASUS HID 协议移植自以下 MIT 许可证代码：

- [libratbag/libratbag](https://github.com/libratbag/libratbag)，`src/asus.c`、`src/asus.h` 和 `src/driver-asus.c`
- [kyokenn/ratbag-python](https://github.com/kyokenn/ratbag-python)，`ratbag/drivers/asus.py`
- [kyokenn/rogdrv](https://github.com/kyokenn/rogdrv)，原始 Linux 用户态配置工具

完整声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。本项目与 ASUS、ROG 没有官方关联，产品名称仅用于说明兼容性。

## 许可证

本项目采用 [GNU GPL v3](LICENSE)。
