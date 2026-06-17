import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 5000;
const SEND_TIMEOUT_MS = 30000;
const DISCONNECT_TIMEOUT_MS = 3000;

export class CdpClient {
  #ws = null;
  #messageId = 1;
  #pending = new Map();
  #eventHandlers = new Map();

  get connected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  async connect(webSocketUrl) {
    if (this.connected) {
      await this.disconnect();
    }

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(webSocketUrl);
      this.#ws = ws;

      ws.on('open', resolve);
      ws.on('error', reject);
      ws.on('message', (raw) => this.#handleMessage(raw.toString()));
      ws.on('close', () => {
        this.#rejectAllPending(new Error('CDP connection closed'));
      });
    });
  }

  async disconnect() {
    if (!this.#ws) return;

    const ws = this.#ws;
    this.#ws = null;
    this.#rejectAllPending(new Error('CDP connection closed'));

    await Promise.race([
      new Promise((resolve) => {
        ws.once('close', resolve);
        ws.close();
      }),
      sleep(DISCONNECT_TIMEOUT_MS).then(() => {
        try {
          ws.terminate();
        } catch {
          /* already gone */
        }
      })
    ]);
  }

  on(event, handler) {
    if (!this.#eventHandlers.has(event)) {
      this.#eventHandlers.set(event, new Set());
    }
    this.#eventHandlers.get(event).add(handler);
    return () => this.#eventHandlers.get(event)?.delete(handler);
  }

  async send(method, params = {}) {
    if (!this.connected) {
      throw new Error('Not connected to browser');
    }

    const id = this.#messageId++;
    const payload = JSON.stringify({ id, method, params });

    return Promise.race([
      new Promise((resolve, reject) => {
        this.#pending.set(id, { resolve, reject });
        this.#ws.send(payload, (err) => {
          if (err) {
            this.#pending.delete(id);
            reject(err);
          }
        });
      }),
      sleep(SEND_TIMEOUT_MS).then(() => {
        this.#pending.delete(id);
        throw new Error(`CDP command timed out: ${method}`);
      })
    ]);
  }

  #handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;

      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'CDP command failed'));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method) {
      const handlers = this.#eventHandlers.get(message.method);
      if (handlers) {
        for (const handler of handlers) {
          handler(message.params ?? {}, message);
        }
      }
    }
  }

  #rejectAllPending(error) {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export function pickLatestTarget(
  pages,
  { seenTargetIds = new Set(), currentTargetId = null } = {}
) {
  if (pages.length === 0) {
    throw new Error('No page targets found');
  }

  const newPages = pages.filter((page) => !seenTargetIds.has(page.id));

  if (newPages.length === 1) {
    return newPages[0];
  }

  if (newPages.length > 1) {
    const notCurrent = newPages.filter((page) => page.id !== currentTargetId);
    if (notCurrent.length === 1) {
      return notCurrent[0];
    }
    return (notCurrent.length > 0 ? notCurrent : newPages).at(-1);
  }

  const others = pages.filter((page) => page.id !== currentTargetId);
  if (others.length === 0) {
    throw new Error('Only one tab is open. Open a new tab before using latest=true.');
  }

  throw new Error(
    'No new tabs detected since last attach/switch. Open a new tab or use windowHandle, targetIndex, or url.'
  );
}

export function pickTarget(
  pages,
  {
    targetIndex,
    targetId,
    windowHandle,
    url,
    latest = false,
    seenTargetIds,
    currentTargetId = null
  } = {}
) {
  if (pages.length === 0) {
    throw new Error('No page targets found');
  }

  const id = targetId ?? windowHandle;
  if (id) {
    const match = pages.find((page) => page.id === id);
    if (!match) {
      throw new Error(`No page target with id "${id}". Use list_targets to see available tabs.`);
    }
    return match;
  }

  if (url) {
    const match = pages.find((page) => page.url.includes(url));
    if (!match) {
      throw new Error(
        `No page target with url containing "${url}". Use list_targets to see available tabs.`
      );
    }
    return match;
  }

  if (latest) {
    return pickLatestTarget(pages, {
      seenTargetIds: seenTargetIds ?? new Set(),
      currentTargetId
    });
  }

  const index = Math.min(Math.max(targetIndex ?? 0, 0), pages.length - 1);
  return pages[index];
}

export async function fetchBrowserWebSocketUrl(debugPort = 9222) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
      signal: controller.signal
    });
  } catch {
    throw new Error(`Could not reach Chrome debug port ${debugPort} for browser target`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Could not reach Chrome debug port ${debugPort} for browser target`);
  }

  const version = await response.json();
  if (!version.webSocketDebuggerUrl) {
    throw new Error(`Chrome debug port ${debugPort} did not return a browser WebSocket URL`);
  }

  return version.webSocketDebuggerUrl;
}

export async function fetchDebugTargets(debugPort = 9222) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
      signal: controller.signal
    });
  } catch (err) {
    throw new Error(
      `Could not reach Chrome debug port ${debugPort}. Is the browser running with --remote-debugging-port=${debugPort}?`,
      { cause: err }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `Could not reach Chrome debug port ${debugPort}. Is the browser running with --remote-debugging-port=${debugPort}?`
    );
  }

  const targets = await response.json();
  return targets.filter((target) => target.type === 'page' && !target.url.startsWith('chrome://'));
}

export async function resolveTarget({
  debugPort = 9222,
  cdpUrl,
  targetIndex,
  targetId,
  windowHandle,
  url,
  latest = false,
  seenTargetIds,
  currentTargetId = null
} = {}) {
  if (cdpUrl) {
    return {
      id: null,
      title: null,
      url: cdpUrl,
      webSocketDebuggerUrl: cdpUrl
    };
  }

  const pages = await fetchDebugTargets(debugPort);
  return pickTarget(pages, {
    targetIndex,
    targetId,
    windowHandle,
    url,
    latest,
    seenTargetIds,
    currentTargetId
  });
}

export async function resolveWebSocketUrl(options) {
  const target = await resolveTarget(options);
  return target.webSocketDebuggerUrl;
}

export async function discoverCdpDebugPorts() {
  const processes = await scanProcesses();
  const ports = new Set();

  for (const proc of processes) {
    const name = proc.name.toLowerCase();
    if (!/(chrome|chromium|msedge|edge)/.test(name)) {
      continue;
    }

    for (const match of proc.command.matchAll(/--remote-debugging-port[=\s]+(\d+)/g)) {
      ports.add(Number(match[1]));
    }
  }

  return [...ports].sort((a, b) => a - b);
}

export async function discoverCdpAttachment({ browser = null, debugPort = null } = {}) {
  const ports =
    debugPort !== null && debugPort !== undefined ? [debugPort] : await discoverCdpDebugPorts();

  for (const port of ports) {
    try {
      const pages = await fetchDebugTargets(port);
      if (pages.length === 0) {
        continue;
      }

      return {
        debugPort: port,
        browser: browser ?? 'chrome',
        target: pages[0],
        message: `Discovered CDP debug port ${port}`
      };
    } catch {
      // try next port
    }
  }

  return null;
}

export async function listCdpPorts() {
  const cdpPorts = await discoverCdpDebugPorts();
  const results = [];

  for (const port of cdpPorts) {
    try {
      const pages = await fetchDebugTargets(port);
      results.push({ debugPort: port, pages: pages.length });
    } catch {
      results.push({ debugPort: port, pages: 0, error: 'unreachable' });
    }
  }

  return results;
}

async function scanProcesses() {
  if (process.platform === 'win32') {
    return scanWindowsProcesses();
  }
  return scanUnixProcesses();
}

async function scanUnixProcesses() {
  const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,command=']);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      const command = match[2];
      return {
        pid: Number(match[1]),
        command,
        name: command.split(/[/\s]/).pop()?.split(' ')[0] ?? command
      };
    })
    .filter(Boolean);
}

async function scanWindowsProcesses() {
  const { stdout } = await execFileAsync(
    'wmic',
    ['process', 'get', 'ProcessId,CommandLine', '/FORMAT:LIST'],
    { windowsHide: true }
  );

  const processes = [];
  let current = { pid: null, command: '' };

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (current.pid && current.command) {
        processes.push({
          pid: current.pid,
          command: current.command,
          name: current.command.split(/[\\/]/).pop()?.split(' ')[0] ?? current.command
        });
      }
      current = { pid: null, command: '' };
      continue;
    }

    if (line.startsWith('CommandLine=')) {
      current.command = line.slice('CommandLine='.length).trim();
    } else if (line.startsWith('ProcessId=')) {
      current.pid = Number(line.slice('ProcessId='.length).trim());
    }
  }

  if (current.pid && current.command) {
    processes.push({
      pid: current.pid,
      command: current.command,
      name: current.command.split(/[\\/]/).pop()?.split(' ')[0] ?? current.command
    });
  }

  return processes;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
