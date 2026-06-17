import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectBrowserPath } from './browser-paths.js';
import { CdpClient, discoverCdpAttachment, fetchDebugTargets, pickTarget } from './cdp-client.js';
import { resolveDevice } from './devices.js';
import {
  applyEmulation,
  clearEmulation as clearCdpEmulation,
  getPhysicalCaptureSize,
  readDisplayDPR
} from './emulation.js';
import { takeFullScreenshot as captureFullPage } from './screenshot.js';
import { encodeFramesToVideo, FrameWriter } from './video.js';

export {
  pickTarget,
  pickLatestTarget,
  fetchDebugTargets,
  resolveTarget,
  resolveWebSocketUrl,
  discoverCdpDebugPorts,
  CdpClient
} from './cdp-client.js';

const BACKEND = 'cdp-screencast';

export class BrowserRecorder {
  #client = new CdpClient();
  #recording = false;
  #framesDir = null;
  #frameWriter = null;
  #frameErrors = [];
  #unsubscribeFrame = null;
  #unsubscribeNav = null;
  #debugPort = null;
  #webSocketUrl = null;
  #browser = null;
  #launchedBrowser = null;
  #recordingOptions = null;
  #targetId = null;
  #targetUrl = null;
  #targetTitle = null;
  #seenTargetIds = new Set();
  #activeDevice = null;

  get isRecording() {
    return this.#recording;
  }

  get connected() {
    return this.#client.connected;
  }

  get status() {
    return {
      connected: this.connected,
      recording: this.#recording,
      backend: BACKEND,
      browser: this.#browser,
      frameCount: this.#frameWriter?.frameCount ?? 0,
      framesSkippedDuplicate: this.#frameWriter?.framesSkippedDuplicate ?? 0,
      framesDir: this.#framesDir,
      debugPort: this.#debugPort,
      webSocketUrl: this.#webSocketUrl,
      targetId: this.#targetId,
      targetUrl: this.#targetUrl,
      targetTitle: this.#targetTitle,
      launchedBrowser: Boolean(this.#launchedBrowser),
      activeDevice: this.#activeDevice
    };
  }

  async attachAuto({ browser = null, debugPort = null, targetIndex = 0 } = {}) {
    const discovery = await discoverCdpAttachment({ browser, debugPort });
    if (!discovery) {
      throw new Error(
        'Could not discover a Chrome/Edge CDP session. Start the browser with ' +
          '--remote-debugging-port=9222 (e.g. via mcp-selenium) or use start_browser.'
      );
    }

    await this.attach({
      debugPort: discovery.debugPort,
      targetIndex,
      browser: discovery.browser
    });

    return { ...discovery, status: this.status };
  }

  async attach({
    debugPort = 9222,
    cdpUrl,
    targetIndex = 0,
    targetId,
    windowHandle,
    url,
    latest = false,
    browser = 'chrome'
  }) {
    if (cdpUrl) {
      this.#browser = browser;
      this.#debugPort = null;
      await this.#connectToCdpTarget({
        id: null,
        title: null,
        url: cdpUrl,
        webSocketDebuggerUrl: cdpUrl
      });
      return;
    }

    const pages = await fetchDebugTargets(debugPort);
    const seenIds = new Set(pages.map((page) => page.id));

    const target = pickTarget(pages, {
      targetIndex,
      targetId,
      windowHandle,
      url,
      latest,
      seenTargetIds: seenIds,
      currentTargetId: this.#targetId
    });

    // Only commit state after all fallible operations succeed
    this.#browser = browser;
    this.#debugPort = debugPort;
    this.#seenTargetIds = seenIds;

    await this.#connectToCdpTarget(target);
  }

  async switchTarget({ targetIndex, targetId, windowHandle, url, latest = false } = {}) {
    const hasSelector = [targetIndex, targetId, windowHandle, url, latest].some(
      (value) => value !== undefined && value !== false
    );
    if (!hasSelector) {
      throw new Error(
        'Provide a selector: targetIndex, targetId, windowHandle, url, or latest=true'
      );
    }

    if (!this.#debugPort) {
      throw new Error('Not attached to a browser. Call attach_browser or attach_auto first.');
    }

    const wasRecording = this.#recording;
    if (wasRecording) {
      await this.#pauseCapture();
    }

    await this.#client.disconnect();

    const pages = await fetchDebugTargets(this.#debugPort);
    const target = pickTarget(pages, {
      targetIndex,
      targetId,
      windowHandle,
      url,
      latest,
      seenTargetIds: this.#seenTargetIds,
      currentTargetId: this.#targetId
    });
    await this.#connectToCdpTarget(target);

    if (wasRecording) {
      await this.#startCapture();
    }

    return {
      targetId: this.#targetId,
      targetUrl: this.#targetUrl,
      targetTitle: this.#targetTitle,
      recordingResumed: wasRecording,
      frameCount: this.#frameWriter?.frameCount ?? 0,
      backend: BACKEND
    };
  }

  async launchBrowser({
    browser = 'chrome',
    debugPort = 9222,
    headless = false,
    chromePath,
    browserPath,
    userDataDir,
    extraArgs = []
  }) {
    if (this.#launchedBrowser) {
      throw new Error('A browser was already launched by this session');
    }

    const executable = browserPath ?? chromePath ?? (await detectBrowserPath(browser));
    const profileDir = userDataDir ?? join(tmpdir(), `browser-mcp-tools-profile-${Date.now()}`);
    const args = [
      `--remote-debugging-port=${debugPort}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
      ...extraArgs
    ];

    if (headless) {
      args.push('--headless=new');
    }

    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore'
    });

    // Detect immediate launch failures (e.g. ENOENT) before unreffing
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    });

    child.unref();
    this.#launchedBrowser = child;

    await waitForPageTarget(debugPort);
    await this.attach({ debugPort, targetIndex: 0, browser });
  }

  async startRecording({ format, quality = 80, everyNthFrame = 1, maxWidth, maxHeight } = {}) {
    if (!this.connected) {
      throw new Error('No browser attached. Call attach_browser or attach_auto first.');
    }
    if (this.#recording) {
      throw new Error('Recording is already in progress');
    }

    let resolvedFormat = format ?? (this.#activeDevice ? 'png' : 'jpeg');

    if (this.#activeDevice && (maxWidth === undefined || maxHeight === undefined)) {
      const profile = await resolveDevice(this.#activeDevice);
      const displayDpr = await readDisplayDPR(this.#client);
      const capture = getPhysicalCaptureSize(profile, displayDpr);
      maxWidth ??= capture.maxWidth;
      maxHeight ??= capture.maxHeight;
    }

    this.#framesDir = await mkFramesDir();
    const extension = resolvedFormat === 'png' ? 'png' : 'jpg';
    this.#frameWriter = new FrameWriter({
      framesDir: this.#framesDir,
      extension,
      deduplicate: false
    });
    this.#frameErrors = [];

    this.#recordingOptions = {
      format: resolvedFormat,
      quality,
      everyNthFrame,
      maxWidth,
      maxHeight
    };

    await this.#startCapture();
    this.#recording = true;

    return {
      backend: BACKEND,
      framesDir: this.#framesDir,
      format: resolvedFormat,
      quality,
      everyNthFrame,
      maxWidth,
      maxHeight,
      targetId: this.#targetId,
      targetUrl: this.#targetUrl
    };
  }

  async stopRecording({ outputPath, fps = 10, cleanupFrames = true } = {}) {
    if (!this.#recording) {
      throw new Error('No active recording');
    }

    await this.#pauseCapture();
    this.#recording = false;
    this.#recordingOptions = null;

    // Brief wait for any in-flight screencast frames to finish writing to disk
    await sleep(250);

    const frameCount = this.#frameWriter?.frameCount ?? 0;
    const framesSkippedDuplicate = this.#frameWriter?.framesSkippedDuplicate ?? 0;
    this.#frameWriter = null;

    if (frameCount === 0) {
      throw new Error('Recording stopped but no frames were captured');
    }

    const videoPath = outputPath ?? join(tmpdir(), `browser-mcp-tools-${Date.now()}.mp4`);
    const encodeOptions = {
      framesDir: this.#framesDir,
      outputPath: videoPath,
      fps
    };

    // Keep native screencast resolution (e.g. 780×1688 at 2× DPR). Do not downscale to CSS
    // viewport size (390×844) — that destroys text sharpness on emulated device recordings.
    const outputSize = await encodeFramesToVideo(encodeOptions);

    if (cleanupFrames && this.#framesDir) {
      await rm(this.#framesDir, { recursive: true, force: true });
      this.#framesDir = null;
    }

    const result = {
      outputPath: videoPath,
      frameCount,
      framesSkippedDuplicate,
      fps,
      width: outputSize.width,
      height: outputSize.height,
      backend: BACKEND
    };

    if (this.#frameErrors.length > 0) {
      result.frameWriteErrors = this.#frameErrors.length;
      result.firstFrameWriteError = this.#frameErrors[0];
    }

    this.#frameErrors = [];
    return result;
  }

  async emulateDevice(device) {
    if (!this.connected) {
      throw new Error('No browser attached. Call attach_browser or attach_auto first.');
    }

    const profile = await resolveDevice(device);
    await this.#applyEmulationOnTarget(profile);
    this.#activeDevice = device;

    return {
      device,
      width: profile.width,
      height: profile.height,
      mobile: profile.mobile,
      activeDevice: device
    };
  }

  async clearEmulation() {
    if (!this.#activeDevice) {
      return { activeDevice: null, message: 'Already in desktop mode' };
    }

    if (this.#client.connected) {
      await clearCdpEmulation(this.#client);
    }

    this.#activeDevice = null;
    return { activeDevice: null, message: 'Restored desktop viewport' };
  }

  async takeFullScreenshot({ outputPath, format = 'png', quality } = {}) {
    if (!this.connected) {
      throw new Error('No browser attached. Call attach_browser or attach_auto first.');
    }

    const buffer = await captureFullPage(this.#client, { format, quality });
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const filePath =
      outputPath ?? join(tmpdir(), `browser-mcp-tools-screenshot-${Date.now()}.${ext}`);
    await writeFile(filePath, buffer);

    const result = {
      outputPath: filePath,
      format,
      sizeBytes: buffer.length,
      activeDevice: this.#activeDevice,
      targetUrl: this.#targetUrl
    };

    if (this.#activeDevice) {
      const profile = await resolveDevice(this.#activeDevice);
      result.width = profile.width;
      result.height = profile.height;
    }

    return result;
  }

  async close() {
    await this.#pauseCapture();
    this.#recording = false;
    this.#unsubscribeNav?.();
    this.#unsubscribeNav = null;

    if (this.#activeDevice && this.#client.connected) {
      await this.clearEmulation();
    }

    await this.#client.disconnect();

    if (this.#launchedBrowser && !this.#launchedBrowser.killed) {
      this.#launchedBrowser.kill('SIGTERM');
    }

    this.#launchedBrowser = null;
    this.#debugPort = null;
    this.#webSocketUrl = null;
    this.#browser = null;
    this.#targetId = null;
    this.#targetUrl = null;
    this.#targetTitle = null;
    this.#recordingOptions = null;
    this.#seenTargetIds = new Set();
    this.#frameWriter = null;
    this.#frameErrors = [];
    this.#activeDevice = null;

    if (this.#framesDir) {
      await rm(this.#framesDir, { recursive: true, force: true });
      this.#framesDir = null;
    }
  }

  async #connectToCdpTarget(target) {
    this.#webSocketUrl = target.webSocketDebuggerUrl;
    this.#targetId = target.id ?? null;
    this.#targetUrl = target.url ?? null;
    this.#targetTitle = target.title ?? null;
    await this.#client.connect(this.#webSocketUrl);
    await this.#client.send('Page.enable');
    this.#setupNavigationHandler();
    await this.#refreshSeenTargets();
    await this.#reapplyEmulationIfNeeded();
  }

  async #reapplyEmulationIfNeeded() {
    if (!this.#activeDevice) {
      return;
    }

    const profile = await resolveDevice(this.#activeDevice);
    await this.#applyEmulationOnTarget(profile);
  }

  async #applyEmulationOnTarget(profile) {
    if (!this.#client.connected) {
      throw new Error('No browser attached. Call attach_browser or attach_auto first.');
    }

    // Apply only through the main persistent client. Emulation.setDeviceMetricsOverride is
    // session-level in CDP and persists automatically through same-tab navigations — no need
    // to reapply on every page load. Window resize only needed once on initial attach.
    await applyEmulation(this.#client, profile, {
      targetId: this.#targetId,
      debugPort: this.#debugPort
    });
  }

  #setupNavigationHandler() {
    this.#unsubscribeNav?.();

    // Track URL/title changes for status reporting only.
    // Emulation does NOT need reapplication — setDeviceMetricsOverride persists across
    // same-tab navigations in the same CDP session.
    const onFrameNavigated = this.#client.on('Page.frameNavigated', (params) => {
      if (!params.frame.parentId) {
        this.#targetUrl = params.frame.url;
        this.#targetTitle = params.frame.name || this.#targetTitle;
      }
    });

    this.#unsubscribeNav = () => {
      onFrameNavigated();
    };
  }

  async #refreshSeenTargets() {
    if (!this.#debugPort) {
      return;
    }

    const pages = await fetchDebugTargets(this.#debugPort);
    this.#seenTargetIds = new Set(pages.map((page) => page.id));
  }

  async #startCapture() {
    if (!this.#recordingOptions || !this.#framesDir || !this.#frameWriter) {
      throw new Error('Recording options not initialized');
    }

    const {
      format = 'jpeg',
      quality = 80,
      everyNthFrame = 1,
      maxWidth,
      maxHeight
    } = this.#recordingOptions;

    this.#unsubscribeFrame = this.#client.on('Page.screencastFrame', (params) => {
      this.#client.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
      this.#frameWriter.writeFromBase64(params.data).catch((err) => {
        this.#frameErrors.push(err.message);
      });
    });

    const params = { format, quality, everyNthFrame };
    if (maxWidth) params.maxWidth = maxWidth;
    if (maxHeight) params.maxHeight = maxHeight;

    try {
      await this.#client.send('Page.startScreencast', params);
    } catch (err) {
      this.#unsubscribeFrame?.();
      this.#unsubscribeFrame = null;
      throw err;
    }
  }

  async #pauseCapture() {
    if (this.#client.connected) {
      try {
        await this.#client.send('Page.stopScreencast');
      } catch {
        // ignore: browser may already be gone
      }
    }
    this.#unsubscribeFrame?.();
    this.#unsubscribeFrame = null;
  }
}

async function mkFramesDir() {
  const dir = join(
    tmpdir(),
    `browser-mcp-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function waitForPageTarget(debugPort, timeoutMs = 15000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const pages = await fetchDebugTargets(debugPort);
      if (pages.length > 0) return;
    } catch {
      // browser not ready yet, retry
    }
    await sleep(200);
  }

  throw new Error(`Timed out waiting for a page target on debug port ${debugPort}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
