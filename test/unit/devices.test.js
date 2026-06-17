import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getAllDevices,
  getUserDevicesPath,
  listDevices,
  loadBuiltinDevices,
  loadUserDevices,
  normalizeDeviceProfile,
  resolveDevice
} from '../../src/devices.js';

test('loadBuiltinDevices returns known presets', async () => {
  const devices = await loadBuiltinDevices();
  assert.ok(devices['iPhone 14']);
  assert.equal(devices['iPhone 14'].width, 390);
  assert.equal(devices['iPhone 14'].mobile, true);
});

test('normalizeDeviceProfile applies defaults', () => {
  const profile = normalizeDeviceProfile({ width: 400, height: 540 });
  assert.equal(profile.deviceScaleFactor, 1);
  assert.equal(profile.mobile, false);
  assert.equal(profile.touch, false);
  assert.equal(profile.userAgent, null);
});

test('normalizeDeviceProfile enables touch when mobile', () => {
  const profile = normalizeDeviceProfile({ width: 400, height: 540, mobile: true });
  assert.equal(profile.touch, true);
});

test('getAllDevices merges user devices over builtin', async (t) => {
  const configDir = await mkdtemp(join(tmpdir(), 'devices-test-'));
  const configPath = join(configDir, 'devices.json');
  t.after(async () => {
    await rm(configDir, { recursive: true, force: true });
    delete process.env.BROWSER_MCP_TOOLS_DEVICES;
  });

  await writeFile(
    configPath,
    JSON.stringify({
      'iPhone 14': { width: 999, height: 999, mobile: true },
      'custom-tablet': { width: 768, height: 1024, mobile: false }
    })
  );

  process.env.BROWSER_MCP_TOOLS_DEVICES = configPath;

  const all = await getAllDevices();
  assert.equal(all['iPhone 14'].width, 999);
  assert.equal(all['custom-tablet'].width, 768);
  assert.ok(all['Pixel 7']);
});

test('resolveDevice throws for unknown device', async () => {
  await assert.rejects(() => resolveDevice('does-not-exist-xyz'), /Unknown device/);
});

test('resolveDevice returns profile for builtin device', async () => {
  const profile = await resolveDevice('iPad');
  assert.equal(profile.width, 820);
  assert.equal(profile.height, 1180);
});

test('loadUserDevices returns empty object when file missing', async (t) => {
  const configDir = await mkdtemp(join(tmpdir(), 'devices-missing-'));
  t.after(async () => {
    await rm(configDir, { recursive: true, force: true });
    delete process.env.BROWSER_MCP_TOOLS_DEVICES;
  });

  process.env.BROWSER_MCP_TOOLS_DEVICES = join(configDir, 'missing.json');
  assert.deepEqual(await loadUserDevices(), {});
});

test('listDevices marks source as builtin or user', async (t) => {
  const configDir = await mkdtemp(join(tmpdir(), 'devices-list-'));
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, 'devices.json');
  t.after(async () => {
    await rm(configDir, { recursive: true, force: true });
    delete process.env.BROWSER_MCP_TOOLS_DEVICES;
  });

  await writeFile(
    configPath,
    JSON.stringify({
      'my-phone': { width: 400, height: 540, mobile: true }
    })
  );
  process.env.BROWSER_MCP_TOOLS_DEVICES = configPath;

  const devices = await listDevices();
  const builtin = devices.find((d) => d.name === 'iPhone 14');
  const user = devices.find((d) => d.name === 'my-phone');

  assert.equal(builtin.source, 'builtin');
  assert.equal(user.source, 'user');
  assert.equal(getUserDevicesPath(), configPath);
});

test('normalizeDeviceProfile rejects invalid dimensions', () => {
  assert.throws(
    () => normalizeDeviceProfile({ width: -1, height: 100 }),
    /Number must be greater than 0/
  );
});
