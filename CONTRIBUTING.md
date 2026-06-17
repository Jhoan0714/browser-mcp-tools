# Contributing

Thank you for helping improve this project!

## Requirements

- Node.js 18+
- Chrome or Edge (for integration tests)
- ffmpeg (bundled via `ffmpeg-static`, no install needed)

## Setup

```bash
git clone https://github.com/Jhoan0714/browser-mcp-tools.git
cd browser-mcp-tools
npm install
```

## Running tests

```bash
npm run check           # lint + format check + unit tests
npm test                # unit only (~1s, no Chrome)
npm run test:integration  # headless Chrome (~30–60s)
npm run test:all        # unit + integration
```

### Lint & format

```bash
npm run lint            # ESLint
npm run lint:fix        # ESLint with auto-fix
npm run format          # Prettier write
npm run format:check    # Prettier check (CI)
```

Pre-commit hooks (Husky + lint-staged) run ESLint and Prettier on staged files after `npm install` in a git repo.

- **`test/unit/`** — pure logic (no browser): devices, emulation, frame-writer, pick-target, sessions, video
- **`test/integration/`** — headless Chrome: recorder, screenshot

Integration tests require Chrome at a standard path.

## Project structure

```
src/
├── server.js         — MCP tool definitions
├── recorder.js       — BrowserRecorder (attach, record, screenshot, emulation)
├── sessions.js       — Multi-session manager
├── cdp-client.js     — CDP WebSocket client + target discovery
├── devices.js        — Device registry (builtin + user config)
├── devices/
│   └── builtin.json  — Built-in device presets
├── emulation.js      — CDP Emulation.* apply/clear
├── screenshot.js     — Full-page capture via CDP
├── video.js          — FrameWriter + ffmpeg encoding
└── browser-paths.js  — Chrome/Edge executable detection
test/
├── unit/
│   ├── devices.test.js
│   ├── emulation.test.js
│   ├── frame-writer.test.js
│   ├── pick-target.test.js
│   ├── sessions.test.js
│   ├── video-dimensions.test.js
│   └── video-encode.test.js
└── integration/
    ├── recorder.test.js
    └── screenshot.test.js
```

## Custom devices for testing

User devices load from `~/.config/browser-mcp-tools/devices.json` or `BROWSER_MCP_TOOLS_DEVICES`.

## Sending a pull request

1. Fork and create a branch from `main`
2. Make your changes and add or update tests
3. Ensure `npm run check` passes
4. Open a PR with a clear description of the change and why

## Reporting bugs

Open an issue at https://github.com/Jhoan0714/browser-mcp-tools/issues.

Please include:

- Node.js version (`node --version`)
- Browser and version
- OS
- Steps to reproduce
- Expected vs actual behavior

## Code style

- ES modules (`import`/`export`), no CommonJS
- Node.js built-in modules imported with the `node:` prefix
- Private class fields (`#field`) for encapsulation
- Async/await throughout; no callbacks except in legacy interop
