import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FrameWriter } from '../../src/video.js';

test('FrameWriter writes sequential frame files', async () => {
  const framesDir = await mkdtemp(join(tmpdir(), 'frame-writer-'));
  const writer = new FrameWriter({ framesDir, extension: 'jpg', deduplicate: false });

  await writer.writeBuffer(Buffer.from('frame-a'));
  await writer.writeBuffer(Buffer.from('frame-b'));

  assert.equal(writer.frameCount, 2);
  const files = (await readdir(framesDir)).sort();
  assert.deepEqual(files, ['frame_000001.jpg', 'frame_000002.jpg']);
  assert.equal(await readFile(join(framesDir, files[0]), 'utf8'), 'frame-a');

  await rm(framesDir, { recursive: true, force: true });
});

test('FrameWriter deduplicates consecutive identical frames', async () => {
  const framesDir = await mkdtemp(join(tmpdir(), 'frame-writer-dedup-'));
  const writer = new FrameWriter({ framesDir, extension: 'png', deduplicate: true });
  const payload = Buffer.from('same-frame');

  assert.equal(await writer.writeBuffer(payload), true);
  assert.equal(await writer.writeBuffer(payload), false);
  assert.equal(await writer.writeBuffer(Buffer.from('different')), true);

  assert.equal(writer.frameCount, 2);
  assert.equal(writer.framesSkippedDuplicate, 1);
  assert.equal((await readdir(framesDir)).length, 2);

  await rm(framesDir, { recursive: true, force: true });
});

test('FrameWriter.reset() clears counters and allows dedup restart', async () => {
  const framesDir = await mkdtemp(join(tmpdir(), 'frame-writer-reset-'));
  const writer = new FrameWriter({ framesDir, extension: 'jpg', deduplicate: true });
  const payload = Buffer.from('same');

  await writer.writeBuffer(payload);
  await writer.writeBuffer(payload);
  assert.equal(writer.frameCount, 1);
  assert.equal(writer.framesSkippedDuplicate, 1);

  writer.reset();
  assert.equal(writer.frameCount, 0);
  assert.equal(writer.framesSkippedDuplicate, 0);

  // After reset the same frame is no longer considered a duplicate
  assert.equal(await writer.writeBuffer(payload), true);
  assert.equal(writer.frameCount, 1);

  await rm(framesDir, { recursive: true, force: true });
});

test('FrameWriter.writeFromBase64 decodes and writes correctly', async () => {
  const framesDir = await mkdtemp(join(tmpdir(), 'frame-writer-b64-'));
  const writer = new FrameWriter({ framesDir, extension: 'jpg', deduplicate: false });

  const content = 'hello-frame';
  const b64 = Buffer.from(content).toString('base64');

  await writer.writeFromBase64(b64);

  assert.equal(writer.frameCount, 1);
  const files = await readdir(framesDir);
  assert.equal(await readFile(join(framesDir, files[0]), 'utf8'), content);

  await rm(framesDir, { recursive: true, force: true });
});
