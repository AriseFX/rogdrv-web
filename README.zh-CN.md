# ROGDRV Web

[English](README.md) · **简体中文**

一个基于 React、TypeScript 和 WebHID 的 ASUS ROG 游戏鼠标开源网页配置器。

[打开 ROGDRV Web](https://arisefx.github.io/rogdrv-web/) · 需要桌面版 Chromium 浏览器

ROGDRV Web 通过 Chromium 浏览器直接与受支持的鼠标通信，不需要安装常驻后台程序，也不需要账户。除非你明确将更改写入鼠标板载内存，否则配置数据不会离开当前浏览器会话。

> **当前硬件状态：**首个支持型号是 **ROG Gladius III Wireless AimPoint 36K（战刃 III 无线 AimPoint 36K）**。已使用原装 2.4G 接收器，在鼠标固件 `02.00.11`、接收器固件 `03.00.05` 上完成真实设备读写验证。USB 有线支持已经实现，但仍需要更多实机验证。测试新的固件或连接组合前，请先记录原始配置。

## 功能亮点

- 切换 5 个板载配置档。
- 设置 2–4 个 DPI 档位，范围 `100–36,000` DPI、步进 `50`，每档拥有独立指示色。
- 选择 `125 / 250 / 500 / 1000 Hz` 回报率。
- 设置 `4–32 ms` 按键去抖和直线修正（Angle Snapping）。
- 映射鼠标动作和单个键盘按键。
- 设置 Logo RGB 模式、颜色和亮度。
- 展示简洁的鼠标示意图，并标明主按键和前后侧键位置。
- 读取固件版本、当前 DPI 档位和原始 HID 通信日志。
- 只写入发生变化的字段，最后单次提交到板载内存。
- 自动识别接收器暴露的多个 HID 接口，并选择可写的厂商接口。
- 页面刷新后自动重连已授权设备，无需重复打开授权弹窗。
- 自动识别每个板载配置的 DPI 档位数，并在写入过程中保持原有档位结构。

ROGDRV Web 明确**不提供固件升级**，也不会尝试访问鼠标的 DFU 模式。

## 兼容性

| 设备 | 连接方式 | VID:PID | 状态 |
| --- | --- | --- | --- |
| ROG Gladius III Wireless AimPoint 36K | 原装 2.4G 接收器 | `0b05:1a72` | 已在 `02.00.11 / 03.00.05` 上实机验证 |
| ROG Gladius III Wireless AimPoint 36K | USB 有线 | `0b05:1a70` | 已实现，仍需实机验证 |
| ROG Gladius III Wireless AimPoint 36K | 蓝牙 | `0b05:1a74` | 暂不支持 |

即使产品名称相同，不同固件和地区硬件版本也可能存在差异。兼容性表中未列出的组合均应视为尚未验证。

## 路线图：支持全部 ROG 鼠标

ROGDRV Web 的长期目标，是在一个统一的浏览器界面中支持 **ASUS ROG 的全部鼠标型号**。

协议层与界面层已经相互分离，后续可以逐个型号扩展，而不需要复制整套应用。未来将重点推进：

- 为完整的 ROG 鼠标产品线补充设备定义和协议差异；
- 验证不同固件版本下的 USB 有线与 2.4G 行为；
- 在统一交互基础上适配各型号独有的功能；
- 扩充安全的读写夹具和真实设备回归验证；
- 完善新设备识别、协议分析和实机验证的贡献文档。

这是项目的发展方向，不代表当前已经兼容全部型号。未出现在兼容性表中的鼠标目前仍不受支持。

## 本地运行

运行要求：

- Node.js `20.19+` 或 `22.12+`；
- 支持 WebHID 的桌面 Chromium 浏览器，例如 Chrome、Edge 或 Brave。

```bash
npm install
npm run dev
```

打开 Vite 输出的 `http://localhost:5173`。WebHID 只能在 HTTPS 或 localhost 安全上下文中使用，不能直接双击 `index.html`。

### 演示模式

没有受支持的鼠标也可以体验完整界面：

```text
http://localhost:5173/?demo=1
```

演示模式使用正式的 ASUS 命令编解码和鼠标事务层，并通过虚拟 HID 设备运行。它支持 5 个相互独立的配置档、修改、应用、切换、断开和重连，不会调用 WebHID 或访问真实硬件。刷新页面后虚拟设备会恢复默认值。

## 连接鼠标

1. 完全退出 Armoury Crate（奥创），避免它占用 HID 接口。
2. 使用 USB 有线或原装 2.4G 接收器连接鼠标。
3. 点击“授权并连接”，然后在浏览器弹窗中选择鼠标。
4. 检查修改内容，点击“应用到设备”后才会写入板载内存。

如果无法恢复原始配置，请不要在尚未支持的设备或未知固件上进行实验。

## 开发命令

```bash
npm run test
npm run test:coverage
npm run lint
npm run build
npm run preview
```

自动化测试覆盖四个公开边界：ASUS 报文编解码、鼠标读写事务、WebHID 传输和 React 用户交互。业务源码的语句、分支、函数和行覆盖率门槛均为 `100%`；纯类型声明和应用入口不计入业务逻辑覆盖率。

虚拟设备可以覆盖全部已实现命令和异常路径，但不能替代真实 USB/2.4G 硬件、固件差异和断电保存验证。

## 协议说明

ROGDRV Web 使用 64 字节 ASUS HID Input/Output Report，而不是 Feature Report。

| 命令 | 值 | 用途 |
| --- | --- | --- |
| `GET_PROFILE` | `0x0012` | 当前配置档和固件信息 |
| `GET_LED` | `0x0312` | 灯效配置 |
| `GET_SETTINGS` | `0x0412` | DPI、指示色、回报率、去抖和直线修正 |
| `GET_BUTTONS` | `0x0512` | 按键映射 |
| `SET_PROFILE` | `0x0250` | 切换板载配置档 |
| `SAVE` | `0x0350` | 提交到板载内存 |
| `SET_BUTTON` | `0x2151` | 设置按键映射 |
| `SET_LED` | `0x2851` | 设置灯效 |
| `SET_SETTING` | `0x3151` | 设置性能参数 |

协议实现位于 [`src/protocol/asus`](src/protocol/asus)，React 设备状态位于 [`src/hooks/useAsusMouse.ts`](src/hooks/useAsusMouse.ts)。

## 贡献新设备支持

欢迎其他 ROG 鼠标用户提供设备信息。提交 Issue 时，请包含准确的产品名称、连接方式、VID:PID、鼠标和接收器固件版本，以及是否已经完全退出 Armoury Crate。请勿公开设备序列号或其他个人标识。

新增设备或协议差异的代码应同时提供模拟器覆盖，并测试配置读取、变化字段写入、板载保存和失败恢复。

## 上游与致谢

ASUS HID 协议移植自以下 MIT 许可证项目：

- [libratbag/libratbag](https://github.com/libratbag/libratbag)，包括 `src/asus.c`、`src/asus.h` 和 `src/driver-asus.c`；
- [kyokenn/ratbag-python](https://github.com/kyokenn/ratbag-python)，包括 `ratbag/drivers/asus.py`；
- [kyokenn/rogdrv](https://github.com/kyokenn/rogdrv)，原始 Linux 用户态配置工具。

完整声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 许可证与声明

ROGDRV Web 采用 [GNU General Public License v3.0](LICENSE)。

本项目是社区项目，与 ASUS 或 ROG 没有官方关联，也未得到其背书。产品名称仅用于说明兼容性。
