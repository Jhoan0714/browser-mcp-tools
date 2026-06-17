import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTarget, pickLatestTarget } from '../../src/cdp-client.js';

const pages = [
  { id: 'A', url: 'https://example.com/login', title: 'Login', webSocketDebuggerUrl: 'ws://a' },
  { id: 'B', url: 'https://example.com/cart', title: 'Cart', webSocketDebuggerUrl: 'ws://b' },
  { id: 'C', url: 'https://other.com', title: 'Other', webSocketDebuggerUrl: 'ws://c' }
];

// --- pickTarget ---

test('pickTarget defaults to first page when no selector given', () => {
  assert.equal(pickTarget(pages).id, 'A');
});

test('pickTarget selects by index', () => {
  assert.equal(pickTarget(pages, { targetIndex: 1 }).id, 'B');
});

test('pickTarget clamps out-of-bounds index to last page', () => {
  assert.equal(pickTarget(pages, { targetIndex: 99 }).id, 'C');
});

test('pickTarget selects by target id', () => {
  assert.equal(pickTarget(pages, { targetId: 'C' }).url, 'https://other.com');
});

test('pickTarget selects by selenium window handle', () => {
  assert.equal(pickTarget(pages, { windowHandle: 'B' }).title, 'Cart');
});

test('pickTarget selects by url substring', () => {
  assert.equal(pickTarget(pages, { url: '/cart' }).id, 'B');
});

test('pickTarget throws when pages is empty', () => {
  assert.throws(() => pickTarget([]), /No page targets found/);
});

test('pickTarget throws when id is not found', () => {
  assert.throws(() => pickTarget(pages, { targetId: 'missing' }), /No page target with id/);
});

test('pickTarget throws when url does not match', () => {
  assert.throws(
    () => pickTarget(pages, { url: '/nonexistent' }),
    /No page target with url containing/
  );
});

// --- pickLatestTarget ---

test('pickLatestTarget selects newly opened tab', () => {
  const testPages = [
    { id: 'NEW', url: 'https://sahitest.com/demo/login.htm', title: 'Login' },
    { id: 'OLD', url: 'https://sahitest.com/demo/books.htm', title: 'Books' }
  ];

  assert.equal(
    pickLatestTarget(testPages, { seenTargetIds: new Set(['OLD']), currentTargetId: 'OLD' }).id,
    'NEW'
  );
});

test('pickLatestTarget ignores list order', () => {
  assert.equal(
    pickLatestTarget(pages, { seenTargetIds: new Set(['A', 'B']), currentTargetId: 'B' }).id,
    'C'
  );
});

test('pickLatestTarget throws when no new tab was opened', () => {
  assert.throws(
    () =>
      pickLatestTarget(pages, { seenTargetIds: new Set(['A', 'B', 'C']), currentTargetId: 'B' }),
    /No new tabs detected/
  );
});

test('pickLatestTarget throws when only one tab exists', () => {
  const single = [{ id: 'A', url: 'https://example.com', title: 'Only' }];
  assert.throws(
    () => pickLatestTarget(single, { seenTargetIds: new Set(['A']), currentTargetId: 'A' }),
    /Only one tab is open/
  );
});

test('pickLatestTarget throws when pages is empty', () => {
  assert.throws(() => pickLatestTarget([]), /No page targets found/);
});
