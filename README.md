# MCP Browser Tools

MCP server for **Chrome and Edge** via **Chrome DevTools Protocol**: screen recording, full-page screenshots, and device emulation. Complements [mcp-selenium](https://github.com/angiejones/mcp-selenium).

## Requirements

- **Node.js 18+**
- **Chrome or Edge** (Chromium)
- **ffmpeg** bundled via `ffmpeg-static` (recording only)

## Install in Cursor

```json
{
  "mcpServers": {
    "browser-tools": {
      "command": "npx",
      "args": ["-y", "mcp-browser-tools"]
    }
  }
}
```

Local development:

```json
{
  "mcpServers": {
    "browser-tools": {
      "command": "node",
      "args": ["/path/to/mcp-browser-tools/src/server.js"]
    }
  }
}
```

## Quick start with mcp-selenium

1. Start Chrome or Edge with remote debugging:

```json
{
  "browser": "chrome",
  "options": {
    "arguments": ["--remote-debugging-port=9222", "--remote-allow-origins=*"]
  }
}
```

2. Record:

```
attach_auto → start_recording → (selenium actions) → stop_recording
```

3. Full-page screenshot (desktop, default):

```
attach_auto → take_full_screenshot(outputPath: ~/Downloads/page.png)
```

## Device emulation

Default viewport is **desktop**. Emulation is opt-in and **persistent** until `clear_emulation` or `close_session`.

```
attach_auto
→ emulate_device(device: "iPhone 14")
→ (selenium navigate / interact)
→ take_full_screenshot(outputPath: ~/Downloads/mobile.png)
→ clear_emulation()
```

List available devices:

```
list_devices
```

Built-in presets: iPhone 14, iPhone SE, Pixel 7, Galaxy S23, iPad.

### Custom devices

Create `~/.config/mcp-browser-tools/devices.json`:

```json
{
  "mercado-libre-mobile": {
    "width": 400,
    "height": 540,
    "deviceScaleFactor": 1,
    "mobile": true,
    "touch": true
  }
}
```

User devices override built-in presets with the same name.

Override config path with env var `MCP_BROWSER_TOOLS_DEVICES`.

Device profile fields:

| Field               | Required | Default  | Description                   |
| ------------------- | -------- | -------- | ----------------------------- |
| `width`             | yes      | —        | Viewport width in CSS pixels  |
| `height`            | yes      | —        | Viewport height in CSS pixels |
| `deviceScaleFactor` | no       | `1`      | Device pixel ratio            |
| `mobile`            | no       | `false`  | Mobile viewport hint          |
| `touch`             | no       | `mobile` | Touch event emulation         |
| `userAgent`         | no       | `null`   | Custom user agent string      |

## Multi-session

Pass a unique `sessionId` per browser, or use different debug ports (`9222`, `9223`, …):

```
attach_auto(sessionId: "agent-a", debugPort: 9222)
attach_auto(sessionId: "agent-b", debugPort: 9223)
```

## Tab switching during recording

```
switch_target(latest: true)
switch_target(url: "/checkout")
switch_target(windowHandle: "...")
```

## Tools

| Tool                   | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `attach_auto`          | Auto-discover Chrome/Edge CDP debug port and attach |
| `attach_browser`       | Attach to a specific CDP debug port                 |
| `start_browser`        | Launch Chrome/Edge with debug port and attach       |
| `list_cdp_ports`       | Scan for attachable CDP debug ports                 |
| `list_targets`         | List page targets on a debug port                   |
| `switch_target`        | Switch tab during recording                         |
| `start_recording`      | Start CDP screencast capture                        |
| `stop_recording`       | Encode frames to MP4                                |
| `take_full_screenshot` | Full-page screenshot (entire scrollable content)    |
| `list_devices`         | List built-in and user device profiles              |
| `emulate_device`       | Apply persistent device emulation                   |
| `clear_emulation`      | Restore desktop viewport                            |
| `recording_status`     | Session status                                      |
| `list_sessions`        | List all sessions                                   |
| `close_session`        | Close one or all sessions                           |

### `take_full_screenshot` options

| Parameter    | Default   | Description                    |
| ------------ | --------- | ------------------------------ |
| `format`     | `png`     | Image format (`png` or `jpeg`) |
| `quality`    | —         | JPEG quality 0-100             |
| `outputPath` | temp file | Absolute path for the image    |

### `start_recording` options

| Parameter                | Default | Description                        |
| ------------------------ | ------- | ---------------------------------- |
| `format`                 | `jpeg`  | Frame format (`jpeg` or `png`)     |
| `quality`                | `80`    | JPEG quality                       |
| `everyNthFrame`          | `1`     | Capture every Nth screencast frame |
| `maxWidth` / `maxHeight` | —       | Optional frame size limits         |

### `stop_recording` options

| Parameter       | Default   | Description                                |
| --------------- | --------- | ------------------------------------------ |
| `fps`           | `10`      | Output video frame rate (encode-time only) |
| `outputPath`    | temp file | Absolute path for the MP4                  |
| `cleanupFrames` | `true`    | Delete temp frames after encoding          |

## How it works

Connects via CDP WebSocket to an attached Chrome/Edge tab.

- **Recording:** `Page.startScreencast` captures frames on visual changes; ffmpeg encodes to MP4 on `stop_recording`.
- **Screenshots:** `Page.captureScreenshot` with `captureBeyondViewport: true` captures the full scrollable page.
- **Emulation:** `Emulation.setDeviceMetricsOverride` + optional user agent and touch emulation.

**FPS** only affects ffmpeg encoding speed — it does not control how often CDP sends screencast frames.

## Limitations

- **Lazy-loaded content** may not appear in full-page screenshots unless the page is scrolled first.
- **Very long pages** may hit memory or timeout limits.
- **Sticky headers/footers** may appear duplicated in full-page captures.
- **Firefox / Safari** are not supported (no CDP screencast).

## Browser support

| Browser | Support                                                                                      |
| ------- | -------------------------------------------------------------------------------------------- |
| Chrome  | ✅                                                                                           |
| Edge    | ✅                                                                                           |
| Firefox | ❌ ([CDP removed in Selenium 4.29+](https://www.selenium.dev/blog/2025/remove-cdp-firefox/)) |
| Safari  | ❌                                                                                           |

## Development

```bash
npm install
npm start
npm run check          # lint + format + unit tests
npm run test:integration
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
