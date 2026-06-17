import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserRecorder } from '../../src/recorder.js';

test('records a headless browser session to mp4', async (t) => {
  const recorder = new BrowserRecorder();
  const outputPath = join(tmpdir(), `browser-mcp-tools-test-${Date.now()}.mp4`);

  t.after(async () => {
    await recorder.close();
  });

  await recorder.launchBrowser({ headless: true, debugPort: 9333 });
  await recorder.startRecording({ format: 'jpeg', quality: 60 });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const result = await recorder.stopRecording({ outputPath, fps: 5 });
  assert.ok(result.frameCount > 0);
  assert.equal(result.outputPath, outputPath);

  await access(outputPath);
});
