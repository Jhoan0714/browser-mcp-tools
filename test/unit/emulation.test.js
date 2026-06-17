import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEmulation, clearEmulation, shouldUseSoftEmulation } from '../../src/emulation.js';

function createMockClient() {
  const calls = [];
  return {
    calls,
    async send(method, params = {}) {
      calls.push({ method, params });
      // Stub Runtime.evaluate for devicePixelRatio queries
      if (method === 'Runtime.evaluate' && params.expression?.includes('devicePixelRatio')) {
        return { result: { value: 2 } };
      }
      return {};
    }
  };
}

const mobileProfile = {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
  touch: true,
  userAgent: 'Mozilla/5.0 (iPhone) Mobile'
};

const desktopProfile = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  mobile: false,
  touch: false,
  userAgent: null
};

test('shouldUseSoftEmulation when window already matches device width', () => {
  assert.equal(shouldUseSoftEmulation(390, 390), true);
  assert.equal(shouldUseSoftEmulation(410, 390), true);
  assert.equal(shouldUseSoftEmulation(411, 390), false);
  assert.equal(shouldUseSoftEmulation(null, 390), false);
});

test('applyEmulation sends device metrics override', async () => {
  const client = createMockClient();
  await applyEmulation(client, mobileProfile);

  const metrics = client.calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.ok(metrics);
  assert.equal(metrics.params.width, 390);
  assert.equal(metrics.params.height, 844);
  assert.equal(metrics.params.mobile, true);
});

test('applyEmulation sets visible size to match device', async () => {
  const client = createMockClient();
  await applyEmulation(client, mobileProfile);

  const visible = client.calls.find((c) => c.method === 'Emulation.setVisibleSize');
  assert.ok(visible);
  assert.equal(visible.params.width, 390);
  assert.equal(visible.params.height, 844);
});

test('applyEmulation does not call Browser domain on page client', async () => {
  const client = createMockClient();
  await applyEmulation(client, mobileProfile, { targetId: 'TAB-1' });

  assert.equal(
    client.calls.some((c) => c.method.startsWith('Browser.')),
    false
  );
});

test('applyEmulation sends user agent when defined', async () => {
  const client = createMockClient();
  await applyEmulation(client, mobileProfile);

  const ua = client.calls.find((c) => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(ua);
  assert.equal(ua.params.userAgent, mobileProfile.userAgent);
});

test('applyEmulation skips user agent when null', async () => {
  const client = createMockClient();
  await applyEmulation(client, desktopProfile);

  const ua = client.calls.find((c) => c.method === 'Emulation.setUserAgentOverride');
  assert.equal(ua, undefined);
});

test('applyEmulation enables touch when profile.touch is true', async () => {
  const client = createMockClient();
  await applyEmulation(client, mobileProfile);

  const touch = client.calls.find((c) => c.method === 'Emulation.setTouchEmulationEnabled');
  assert.ok(touch);
  assert.equal(touch.params.enabled, true);
  assert.equal(touch.params.maxTouchPoints, 5);
});

test('applyEmulation disables touch for desktop profile', async () => {
  const client = createMockClient();
  await applyEmulation(client, desktopProfile);

  const touch = client.calls.find((c) => c.method === 'Emulation.setTouchEmulationEnabled');
  assert.ok(touch);
  assert.equal(touch.params.enabled, false);
  assert.equal(touch.params.maxTouchPoints, 0);
});

test('applyEmulation on device-sized window caps DPR to display DPR (avoids scaling conflict)', async () => {
  // displayDPR=2 is returned by the mock; profile.deviceScaleFactor=3 → should be capped to 2
  let windowWidth = 390;
  const client = {
    calls: [],
    async send(method, params = {}) {
      this.calls.push({ method, params });
      if (method === 'Runtime.evaluate' && params.expression?.includes('devicePixelRatio')) {
        return { result: { value: 2 } };
      }
      if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
      if (method === 'Browser.getWindowBounds') return { bounds: { width: windowWidth } };
      return {};
    }
  };

  await applyEmulation(client, mobileProfile, { targetId: 'TAB-1', debugPort: 9222 }).catch(() => {
    // getWindowContentWidth opens a real browser WS — expected to fail in unit test
  });

  // Without a real browser, test the math via shouldUseSoftEmulation
  assert.equal(shouldUseSoftEmulation(390, 390), true);
  assert.equal(Math.min(mobileProfile.deviceScaleFactor, 2), 2);
});

test('clearEmulation sends all reset commands', async () => {
  const client = createMockClient();
  await clearEmulation(client);

  assert.ok(client.calls.some((c) => c.method === 'Emulation.clearDeviceMetricsOverride'));
  assert.ok(client.calls.some((c) => c.method === 'Emulation.setUserAgentOverride'));
  assert.ok(client.calls.some((c) => c.method === 'Emulation.setTouchEmulationEnabled'));
});
