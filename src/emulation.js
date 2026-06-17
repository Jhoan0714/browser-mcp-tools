import { CdpClient, fetchBrowserWebSocketUrl } from './cdp-client.js';

const CHROME_UI_HEIGHT = 87;
const WINDOW_WIDTH_TOLERANCE = 20;

export function shouldUseSoftEmulation(windowWidth, profileWidth) {
  return windowWidth !== null && windowWidth <= profileWidth + WINDOW_WIDTH_TOLERANCE;
}

async function getWindowContentWidth(debugPort, targetId) {
  const browserClient = new CdpClient();
  await browserClient.connect(await fetchBrowserWebSocketUrl(debugPort));
  try {
    const { windowId } = await browserClient.send('Browser.getWindowForTarget', { targetId });
    const { bounds } = await browserClient.send('Browser.getWindowBounds', { windowId });
    return bounds.width;
  } catch {
    return null;
  } finally {
    await browserClient.disconnect();
  }
}

export async function readDisplayDPR(client) {
  try {
    const { result } = await client.send('Runtime.evaluate', {
      expression: 'window.devicePixelRatio',
      returnByValue: true
    });
    return result?.value || 1;
  } catch {
    return 1;
  }
}

/** Screencast capture size in physical pixels for a device profile. */
export function getPhysicalCaptureSize(profile, displayDpr) {
  const dpr = Math.min(profile.deviceScaleFactor, displayDpr);
  return {
    maxWidth: Math.round(profile.width * dpr),
    maxHeight: Math.round(profile.height * dpr)
  };
}

export async function applyEmulation(
  client,
  profile,
  { targetId, debugPort, resizeWindow = true } = {}
) {
  const windowWidth =
    targetId && debugPort ? await getWindowContentWidth(debugPort, targetId) : null;

  if (shouldUseSoftEmulation(windowWidth, profile.width)) {
    // Window is already device-sized. Applying DPR=3 on a ~780px-physical window (DPR-2 Retina)
    // causes a scaling conflict (innerWidth becomes ~653, scale ~0.6). Instead, cap DPR to the
    // display's own DPR so the physical pixels needed match what's available, keeping scale=1
    // while still enabling mobile=true and proper mobile viewport behavior.
    const displayDPR = await readDisplayDPR(client);
    const adjustedDPR = Math.min(profile.deviceScaleFactor, displayDPR);
    await applyEmulationMetricsOnly(client, { ...profile, deviceScaleFactor: adjustedDPR });
    return;
  }

  await applyEmulationMetricsOnly(client, profile);

  if (resizeWindow && targetId && debugPort) {
    await resizeWindowForDevice(debugPort, profile, targetId);
  }
}

export async function resizeWindowForDevice(debugPort, profile, targetId) {
  const browserClient = new CdpClient();
  await browserClient.connect(await fetchBrowserWebSocketUrl(debugPort));
  try {
    const { windowId } = await browserClient.send('Browser.getWindowForTarget', { targetId });
    const { bounds: current } = await browserClient.send('Browser.getWindowBounds', { windowId });
    const chromeUi = current.height <= profile.height + 40 ? 0 : CHROME_UI_HEIGHT;
    await browserClient.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        width: profile.width,
        height: profile.height + chromeUi,
        windowState: 'normal'
      }
    });
  } catch {
    // Window resize is best-effort (minimum window size, headless, etc.)
  } finally {
    await browserClient.disconnect();
  }
}

export async function applyEmulationMetricsOnly(client, profile) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: profile.deviceScaleFactor,
    mobile: profile.mobile,
    screenWidth: profile.width,
    screenHeight: profile.height
  });

  await client.send('Emulation.setVisibleSize', {
    width: profile.width,
    height: profile.height
  });

  if (profile.userAgent) {
    await client.send('Emulation.setUserAgentOverride', {
      userAgent: profile.userAgent
    });
  }

  await client.send('Emulation.setTouchEmulationEnabled', {
    enabled: profile.touch,
    maxTouchPoints: profile.touch ? 5 : 0
  });
}

export async function clearEmulation(client) {
  await client.send('Emulation.clearDeviceMetricsOverride');
  await client.send('Emulation.setUserAgentOverride', { userAgent: '' });
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
}
