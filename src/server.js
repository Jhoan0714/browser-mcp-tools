#!/usr/bin/env node

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fetchDebugTargets, listCdpPorts } from './cdp-client.js';
import { listDevices } from './devices.js';
import { SessionManager } from './sessions.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const sessions = new SessionManager();

const sessionIdSchema = z
  .string()
  .optional()
  .describe(
    'Recording session id for parallel runs. Defaults to "default", or "port-{debugPort}" when debugPort is provided. Use unique ids per agent (e.g. "agent-a").'
  );

function jsonResponse(data) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function withSession(data, sessionId) {
  return { sessionId, ...data };
}

function requireSession(sessions, { sessionId, debugPort }) {
  const id = sessions.resolveSessionId({ sessionId, debugPort });
  const entry = sessions.get(id);
  if (!entry) {
    throw new Error(`Session "${id}" not found. Call attach_browser or attach_auto first.`);
  }
  return { id, entry };
}

const server = new McpServer(
  {
    name: 'MCP Browser Tools',
    version
  },
  {
    instructions: [
      'CDP tools for Chrome and Edge: screen recording, full-page screenshots, and device emulation.',
      'Default viewport is desktop. Call emulate_device before screenshots or recording to simulate a mobile device.',
      'User devices: ~/.config/mcp-browser-tools/devices.json',
      'With mcp-selenium: start browser with --remote-debugging-port=9222 and --remote-allow-origins=*, then attach_auto or attach_browser.',
      'Recording workflow: attach -> start_recording -> (selenium actions) -> stop_recording -> close_session.',
      'Screenshot workflow: attach -> take_full_screenshot(outputPath: ...).',
      'Multi-session: pass unique sessionId per browser or use debug ports 9222, 9223, ...'
    ].join(' ')
  }
);

server.registerTool(
  'list_devices',
  {
    description: 'List built-in and user-defined device profiles for emulate_device.',
    inputSchema: {}
  },
  async () => jsonResponse({ devices: await listDevices() })
);

server.registerTool(
  'emulate_device',
  {
    description:
      'Apply persistent device emulation (viewport, touch, user agent) until clear_emulation or close_session.',
    inputSchema: {
      sessionId: sessionIdSchema,
      debugPort: z
        .number()
        .optional()
        .describe('Used to resolve session when sessionId is omitted'),
      device: z.string().describe('Device name from list_devices (builtin or user-defined)')
    }
  },
  async ({ sessionId, debugPort, device }) => {
    const { id, entry } = requireSession(sessions, { sessionId, debugPort });
    const result = await entry.recorder.emulateDevice(device);
    return jsonResponse(
      withSession(
        {
          message: `Emulating device "${device}"`,
          ...result,
          status: entry.recorder.status
        },
        id
      )
    );
  }
);

server.registerTool(
  'clear_emulation',
  {
    description: 'Restore desktop viewport and clear device emulation for the session.',
    inputSchema: {
      sessionId: sessionIdSchema,
      debugPort: z.number().optional().describe('Used to resolve session when sessionId is omitted')
    }
  },
  async ({ sessionId, debugPort }) => {
    const { id, entry } = requireSession(sessions, { sessionId, debugPort });
    const result = await entry.recorder.clearEmulation();
    return jsonResponse(
      withSession(
        {
          ...result,
          status: entry.recorder.status
        },
        id
      )
    );
  }
);

server.registerTool(
  'take_full_screenshot',
  {
    description:
      'Capture a full-page screenshot of the attached tab (entire scrollable content). Uses active device emulation if set.',
    inputSchema: {
      sessionId: sessionIdSchema,
      debugPort: z
        .number()
        .optional()
        .describe('Used to resolve session when sessionId is omitted'),
      outputPath: z.string().optional().describe('Absolute path for the output PNG or JPEG file'),
      format: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)'),
      quality: z.number().optional().describe('JPEG quality 0-100 (only for jpeg format)')
    }
  },
  async ({ sessionId, debugPort, outputPath, format, quality }) => {
    const { id, entry } = requireSession(sessions, { sessionId, debugPort });
    const result = await entry.recorder.takeFullScreenshot({ outputPath, format, quality });
    return jsonResponse(
      withSession(
        {
          message: 'Full-page screenshot saved',
          ...result,
          status: entry.recorder.status
        },
        id
      )
    );
  }
);

server.registerTool(
  'list_sessions',
  {
    description: 'List all active recording sessions.',
    inputSchema: {}
  },
  async () =>
    jsonResponse({
      sessions: sessions.listSessions()
    })
);

server.registerTool(
  'list_cdp_ports',
  {
    description: 'Scan for Chrome/Edge CDP debug ports and page target counts.',
    inputSchema: {}
  },
  async () => jsonResponse({ cdp: await listCdpPorts() })
);

server.registerTool(
  'start_browser',
  {
    description:
      'Launch Chrome or Edge with remote debugging enabled and attach for CDP recording.',
    inputSchema: {
      sessionId: sessionIdSchema,
      browser: z
        .enum(['chrome', 'edge'])
        .optional()
        .describe('Chromium browser to launch (default: chrome)'),
      debugPort: z.number().optional().describe('Remote debugging port (default: 9222)'),
      headless: z.boolean().optional().describe('Run browser in headless mode'),
      browserPath: z.string().optional().describe('Path to browser executable'),
      chromePath: z.string().optional().describe('Deprecated alias for browserPath'),
      userDataDir: z.string().optional().describe('Custom browser user data directory'),
      extraArgs: z.array(z.string()).optional().describe('Additional browser launch arguments')
    }
  },
  async ({
    sessionId,
    browser = 'chrome',
    debugPort = 9222,
    headless = false,
    browserPath,
    chromePath,
    userDataDir,
    extraArgs = []
  }) => {
    const id = sessions.resolveSessionId({ sessionId, debugPort });
    const { recorder } = sessions.getOrCreate(id);
    await recorder.launchBrowser({
      browser,
      debugPort,
      headless,
      browserPath,
      chromePath,
      userDataDir,
      extraArgs
    });
    return jsonResponse(
      withSession(
        {
          message: 'Browser launched and attached for recording',
          ...recorder.status
        },
        id
      )
    );
  }
);

server.registerTool(
  'attach_auto',
  {
    description: 'Auto-discover and attach to a Chrome/Edge session via CDP debug port scanning.',
    inputSchema: {
      sessionId: sessionIdSchema,
      browser: z.enum(['chrome', 'edge']).optional().describe('Expected browser type hint'),
      debugPort: z.number().optional().describe('Preferred CDP debug port when multiple exist'),
      targetIndex: z.number().optional().describe('CDP page target index when attaching')
    }
  },
  async ({ sessionId, browser, debugPort, targetIndex = 0 }) => {
    const id = sessions.resolveSessionId({ sessionId, debugPort });
    const { recorder } = sessions.getOrCreate(id);
    const result = await recorder.attachAuto({
      browser,
      debugPort,
      targetIndex
    });
    return jsonResponse(
      withSession(
        {
          message: 'Auto-attached to Chrome/Edge CDP session',
          ...result,
          status: recorder.status
        },
        id
      )
    );
  }
);

server.registerTool(
  'attach_browser',
  {
    description:
      'Attach to an existing Chrome/Edge session via CDP debug port. If already attached (or recording), switches tab when selectors are provided.',
    inputSchema: {
      sessionId: sessionIdSchema,
      debugPort: z.number().optional().describe('Remote debugging port (default: 9222)'),
      browser: z.enum(['chrome', 'edge']).optional().describe('Browser type hint'),
      cdpUrl: z.string().optional().describe('Full WebSocket debugger URL (overrides debugPort)'),
      targetIndex: z
        .number()
        .optional()
        .describe('Page target index from list_targets (default: 0)'),
      targetId: z.string().optional().describe('CDP target id from list_targets'),
      windowHandle: z
        .string()
        .optional()
        .describe('Selenium window handle (same as CDP target id in Chrome)'),
      url: z.string().optional().describe('Match tab by URL substring'),
      latest: z.boolean().optional().describe('Attach to a tab opened since the last attach/switch')
    }
  },
  async ({
    sessionId,
    debugPort = 9222,
    browser = 'chrome',
    cdpUrl,
    targetIndex,
    targetId,
    windowHandle,
    url,
    latest
  }) => {
    const id = sessions.resolveSessionId({ sessionId, debugPort });
    const { recorder } = sessions.getOrCreate(id);
    const selector = { targetIndex, targetId, windowHandle, url, latest };
    const hasSelector = [targetIndex, targetId, windowHandle, url, latest].some(
      (value) => value !== undefined && value !== false
    );

    if (recorder.connected && hasSelector) {
      const result = await recorder.switchTarget(selector);
      return jsonResponse(
        withSession(
          {
            message: 'Switched recording target',
            ...result,
            status: recorder.status
          },
          id
        )
      );
    }

    await recorder.attach({
      debugPort,
      browser,
      cdpUrl,
      targetIndex: targetIndex ?? 0,
      targetId,
      windowHandle,
      url,
      latest
    });

    return jsonResponse(
      withSession(
        {
          message: 'Attached to browser for recording',
          ...recorder.status
        },
        id
      )
    );
  }
);

server.registerTool(
  'list_targets',
  {
    description: 'List attachable Chrome/Edge page targets on a CDP debug port.',
    inputSchema: {
      debugPort: z.number().optional().describe('Remote debugging port (default: 9222)')
    }
  },
  async ({ debugPort = 9222 }) => {
    const targets = await fetchDebugTargets(debugPort);
    return jsonResponse(
      targets.map((target, index) => ({
        index,
        id: target.id,
        title: target.title,
        url: target.url,
        webSocketDebuggerUrl: target.webSocketDebuggerUrl
      }))
    );
  }
);

server.registerTool(
  'switch_target',
  {
    description:
      'Switch recording to a different browser tab/window within the same session. Works during active recording.',
    inputSchema: {
      sessionId: sessionIdSchema,
      debugPort: z
        .number()
        .optional()
        .describe('Used to resolve session when sessionId is omitted'),
      targetIndex: z.number().optional().describe('CDP page target index from list_targets'),
      targetId: z.string().optional().describe('CDP target id from list_targets'),
      windowHandle: z
        .string()
        .optional()
        .describe('Selenium window handle (same as CDP target id in Chrome)'),
      url: z.string().optional().describe('Match tab by URL substring'),
      latest: z.boolean().optional().describe('Switch to tab opened since last attach/switch')
    }
  },
  async ({ sessionId, debugPort, ...options }) => {
    const id = sessions.resolveSessionId({ sessionId, debugPort });
    const entry = sessions.get(id);
    if (!entry) {
      throw new Error(`Session "${id}" not found. Call attach_browser or attach_auto first.`);
    }

    const result = await entry.recorder.switchTarget(options);
    return jsonResponse(
      withSession(
        {
          message: 'Switched recording target',
          ...result,
          status: entry.recorder.status
        },
        id
      )
    );
  }
);

server.registerTool(
  'start_recording',
  {
    description: 'Start CDP screencast frame capture on the attached Chrome/Edge tab.',
    inputSchema: {
      sessionId: sessionIdSchema,
      debugPort: z
        .number()
        .optional()
        .describe('Used to resolve session when sessionId is omitted'),
      format: z.enum(['jpeg', 'png']).optional().describe('Frame format (default: jpeg)'),
      quality: z.number().optional().describe('JPEG quality 0-100 (default: 80)'),
      everyNthFrame: z
        .number()
        .optional()
        .describe('Capture every Nth screencast frame (default: 1)'),
      maxWidth: z.number().optional().describe('Maximum frame width'),
      maxHeight: z.number().optional().describe('Maximum frame height')
    }
  },
  async ({ sessionId, debugPort, format, quality, everyNthFrame, maxWidth, maxHeight }) => {
    const id = sessions.resolveSessionId({ sessionId, debugPort });
    const entry = sessions.get(id);
    if (!entry) {
      throw new Error(`Session "${id}" not found. Call attach_browser or attach_auto first.`);
    }

    const result = await entry.recorder.startRecording({
      format,
      quality,
      everyNthFrame,
      maxWidth,
      maxHeight
    });

    return jsonResponse(
      withSession(
        {
          message: 'Recording started',
          ...result,
          status: entry.recorder.status
        },
        id
      )
    );
  }
);

server.registerTool(
  'stop_recording',
  {
    description: 'Stop recording and encode captured frames into an MP4 video using ffmpeg.',
    inputSchema: {
      sessionId: sessionIdSchema,
      debugPort: z
        .number()
        .optional()
        .describe('Used to resolve session when sessionId is omitted'),
      outputPath: z.string().optional().describe('Absolute path for the output MP4 file'),
      fps: z.number().optional().describe('Output video frame rate (default: 10)'),
      cleanupFrames: z
        .boolean()
        .optional()
        .describe('Delete temporary frame files after encoding (default: true)')
    }
  },
  async ({ sessionId, debugPort, outputPath, fps = 10, cleanupFrames = true }) => {
    const id = sessions.resolveSessionId({ sessionId, debugPort });
    const entry = sessions.get(id);
    if (!entry) {
      throw new Error(`Session "${id}" not found.`);
    }

    const result = await entry.recorder.stopRecording({ outputPath, fps, cleanupFrames });
    return jsonResponse(
      withSession(
        {
          message: 'Recording saved',
          ...result
        },
        id
      )
    );
  }
);

server.registerTool(
  'recording_status',
  {
    description:
      'Get recording status for one session, or all sessions when sessionId is omitted and multiple exist.',
    inputSchema: {
      sessionId: sessionIdSchema,
      debugPort: z.number().optional().describe('Used to resolve session when sessionId is omitted')
    }
  },
  async ({ sessionId, debugPort }) => {
    if (sessionId !== undefined || debugPort !== undefined) {
      const id = sessions.resolveSessionId({ sessionId, debugPort });
      const entry = sessions.get(id);
      if (!entry) {
        return jsonResponse(withSession({ exists: false, message: 'Session not found' }, id));
      }
      return jsonResponse(withSession(entry.recorder.status, id));
    }

    const all = sessions.listSessions();
    if (all.length === 0) {
      return jsonResponse({ sessions: [], message: 'No active sessions' });
    }
    if (all.length === 1) {
      return jsonResponse(withSession(all[0], all[0].sessionId));
    }
    return jsonResponse({ sessions: all });
  }
);

server.registerTool(
  'close_session',
  {
    description: 'Close one recording session, or all sessions when closeAll is true.',
    inputSchema: {
      sessionId: sessionIdSchema,
      debugPort: z
        .number()
        .optional()
        .describe('Used to resolve session when sessionId is omitted'),
      closeAll: z.boolean().optional().describe('Close every active session (default: false)')
    }
  },
  async ({ sessionId, debugPort, closeAll = false }) => {
    if (closeAll) {
      const closed = await sessions.closeAllSessions();
      return jsonResponse({
        message: 'All sessions closed',
        closedSessions: closed
      });
    }

    const id = sessions.resolveSessionId({ sessionId, debugPort });
    const closed = await sessions.closeSession(id);
    return jsonResponse({
      sessionId: id,
      message: closed ? 'Session closed' : 'Session not found'
    });
  }
);

server.registerResource(
  'recording-status',
  'recording://status',
  {
    description: 'Status of all active recording sessions',
    mimeType: 'application/json'
  },
  async () => ({
    contents: [
      {
        uri: 'recording://status',
        mimeType: 'application/json',
        text: JSON.stringify({ sessions: sessions.listSessions() }, null, 2)
      }
    ]
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
