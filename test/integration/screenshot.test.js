import test from 'node:test';
import assert from 'node:assert/strict';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserRecorder } from '../../src/recorder.js';

test('takeFullScreenshot saves a full-page PNG on desktop', async (t) => {
  const recorder = new BrowserRecorder();
  const outputPath = join(tmpdir(), `browser-mcp-tools-screenshot-${Date.now()}.png`);

  t.after(async () => {
    await recorder.close();
  });

  await recorder.launchBrowser({ headless: true, debugPort: 9334 });
  const result = await recorder.takeFullScreenshot({ outputPath, format: 'png' });

  assert.equal(result.outputPath, outputPath);
  assert.equal(result.format, 'png');
  assert.equal(result.activeDevice, null);
  assert.ok(result.sizeBytes > 0);

  await access(outputPath);
  const info = await stat(outputPath);
  assert.ok(info.size > 0);
});

test('takeFullScreenshot respects persistent device emulation', async (t) => {
  const recorder = new BrowserRecorder();
  const outputPath = join(tmpdir(), `browser-mcp-tools-mobile-${Date.now()}.png`);

  t.after(async () => {
    await recorder.close();
  });

  await recorder.launchBrowser({ headless: true, debugPort: 9335 });
  await recorder.emulateDevice('iPhone 14');

  assert.equal(recorder.status.activeDevice, 'iPhone 14');

  const result = await recorder.takeFullScreenshot({ outputPath });
  assert.equal(result.activeDevice, 'iPhone 14');
  assert.equal(result.width, 390);
  assert.equal(result.height, 844);

  await access(outputPath);
});

test('clearEmulation restores desktop mode', async (t) => {
  const recorder = new BrowserRecorder();

  t.after(async () => {
    await recorder.close();
  });

  await recorder.launchBrowser({ headless: true, debugPort: 9336 });
  await recorder.emulateDevice('iPhone 14');
  assert.equal(recorder.status.activeDevice, 'iPhone 14');

  const cleared = await recorder.clearEmulation();
  assert.equal(cleared.activeDevice, null);
  assert.equal(recorder.status.activeDevice, null);
});

test('close() clears active device emulation', async () => {
  const recorder = new BrowserRecorder();

  await recorder.launchBrowser({ headless: true, debugPort: 9337 });
  await recorder.emulateDevice('iPhone 14');
  assert.equal(recorder.status.activeDevice, 'iPhone 14');

  await recorder.close();
  assert.equal(recorder.status.activeDevice, null);
});
