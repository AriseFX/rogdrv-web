# ROGDRV Web

**English** · [简体中文](README.zh-CN.md)

A browser-native, open-source configurator for ASUS ROG gaming mice, built with React, TypeScript, and WebHID.

[Open ROGDRV Web](https://arisefx.github.io/rogdrv-web/) · Desktop Chromium browser required

ROGDRV Web talks directly to supported hardware from a Chromium browser. It does not require a background daemon or an account, and configuration data stays in the browser session unless you explicitly write changes to the mouse's onboard memory.

> **Current hardware status:** the first supported device is the **ROG Gladius III Wireless AimPoint 36K**. Read and write operations have been verified with the original 2.4 GHz receiver on mouse firmware `02.00.11` and receiver firmware `03.00.05`. Wired USB support is implemented but still needs broader hardware validation. Record your original configuration before testing a new firmware or connection combination.

## Highlights

- Switch between five onboard profiles.
- Configure two to four DPI stages from `100` to `36,000` DPI in steps of `50`, with an independent indicator color for each stage.
- Select `125 / 250 / 500 / 1000 Hz` polling rates.
- Configure `4–32 ms` click debounce and angle snapping.
- Remap mouse actions and individual keyboard keys.
- Configure Logo RGB modes, color, and brightness.
- Mirror pointer movement, left/right/middle clicks, wheel direction, and side-button input on an interactive mouse preview.
- Read firmware versions, the active DPI stage, and raw HID communication logs.
- Write only changed fields, then commit them to onboard memory once.
- Detect the writable vendor HID interface exposed by receivers with multiple interfaces.
- Reconnect previously authorized devices after a refresh without reopening the permission picker.
- Detect the enabled DPI-stage count for every onboard profile and preserve it during writes.

ROGDRV Web deliberately **does not provide firmware updates** and never attempts to access a mouse's DFU mode.

## Compatibility

| Device | Connection | VID:PID | Status |
| --- | --- | --- | --- |
| ROG Gladius III Wireless AimPoint 36K | Original 2.4 GHz receiver | `0b05:1a72` | Hardware verified on `02.00.11 / 03.00.05` |
| ROG Gladius III Wireless AimPoint 36K | Wired USB | `0b05:1a70` | Implemented; hardware validation needed |
| ROG Gladius III Wireless AimPoint 36K | Bluetooth | `0b05:1a74` | Not supported |

Firmware and regional hardware revisions may behave differently even when a product name matches. Treat unlisted combinations as unverified.

## Roadmap: every ROG mouse

The long-term goal of ROGDRV Web is to support **every ASUS ROG mouse** in one consistent browser interface.

The protocol layer is intentionally separated from the UI so support can grow model by model without duplicating the application. Future work will focus on:

- adding device definitions and protocol variations for the complete ROG mouse lineup;
- validating wired and 2.4 GHz behavior across firmware revisions;
- modelling model-specific controls without sacrificing the shared interface;
- expanding safe read/write fixtures and real-device regression coverage;
- documenting repeatable steps for contributors to identify and validate new devices.

This is a direction, not a claim of current compatibility. Models not listed in the compatibility table are not supported yet.

## Run locally

Requirements:

- Node.js `20.19+` or `22.12+`;
- a desktop Chromium browser with WebHID support, such as Chrome, Edge, or Brave.

```bash
npm install
npm run dev
```

Open the `http://localhost:5173` URL printed by Vite. WebHID requires HTTPS or a localhost secure context; opening `index.html` directly will not work.

### Demo mode

No supported mouse is required to explore the complete interface:

```text
http://localhost:5173/?demo=1
```

Demo mode uses the production ASUS command codec and mouse transaction layer with a virtual HID device. It supports five independent profiles, edits, apply, profile switching, disconnect, and reconnect without touching WebHID or physical hardware. Refreshing resets the simulator to its defaults.

## Use with a mouse

1. Fully exit Armoury Crate so it does not compete for the HID interface.
2. Connect the mouse over wired USB or its original 2.4 GHz receiver.
3. Select **Authorize and connect**, then choose the mouse in the browser picker.
4. Review your changes and select **Apply to device** to write onboard memory.

Do not experiment with an unsupported device or unknown firmware unless you can restore its original configuration.

## Development

```bash
npm run test
npm run test:coverage
npm run lint
npm run build
npm run preview
```

The automated suite covers four public boundaries: ASUS packet encoding/decoding, mouse read/write transactions, WebHID transport, and React user interactions. Business source files have a `100%` statement, branch, function, and line coverage threshold. Type-only declarations and the application entry point are excluded from the business-logic threshold.

The virtual device exercises all implemented commands and error paths, but it cannot replace validation against real USB/2.4 GHz hardware, firmware differences, or power-cycle persistence.

## Protocol notes

ROGDRV Web uses 64-byte ASUS HID Input/Output Reports rather than Feature Reports.

| Command | Value | Purpose |
| --- | --- | --- |
| `GET_PROFILE` | `0x0012` | Active profile and firmware information |
| `GET_LED` | `0x0312` | Lighting configuration |
| `GET_SETTINGS` | `0x0412` | DPI, indicator colors, polling rate, debounce, and angle snapping |
| `GET_BUTTONS` | `0x0512` | Button mappings |
| `SET_PROFILE` | `0x0250` | Switch onboard profile |
| `SAVE` | `0x0350` | Commit changes to onboard memory |
| `SET_BUTTON` | `0x2151` | Set a button mapping |
| `SET_LED` | `0x2851` | Set lighting configuration |
| `SET_SETTING` | `0x3151` | Set a performance field |

The protocol implementation lives in [`src/protocol/asus`](src/protocol/asus), and React device state lives in [`src/hooks/useAsusMouse.ts`](src/hooks/useAsusMouse.ts).

## Contributing device support

Reports from additional ROG mouse owners are welcome. When opening an issue, include the exact product name, connection method, VID:PID, mouse and receiver firmware versions, and whether Armoury Crate was fully closed. Do not publish device serial numbers or other personal identifiers.

Changes that add a device or protocol variation should include simulator coverage and tests for read, changed-field writes, save behavior, and failure recovery.

## Credits

The ASUS HID protocol was ported from MIT-licensed work in:

- [libratbag/libratbag](https://github.com/libratbag/libratbag), including `src/asus.c`, `src/asus.h`, and `src/driver-asus.c`;
- [kyokenn/ratbag-python](https://github.com/kyokenn/ratbag-python), including `ratbag/drivers/asus.py`;
- [kyokenn/rogdrv](https://github.com/kyokenn/rogdrv), the original Linux userspace configurator.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the complete notice.

## License and disclaimer

ROGDRV Web is licensed under the [GNU General Public License v3.0](LICENSE).

This is a community project and is not affiliated with or endorsed by ASUS or ROG. Product names are used only to describe compatibility.
