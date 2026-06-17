import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../../src/sessions.js';

// --- resolveSessionId ---

test('resolveSessionId uses explicit sessionId over debugPort', () => {
  const manager = new SessionManager();
  assert.equal(manager.resolveSessionId({ sessionId: 'agent-a', debugPort: 9222 }), 'agent-a');
});

test('resolveSessionId derives from debugPort when no sessionId', () => {
  const manager = new SessionManager();
  assert.equal(manager.resolveSessionId({ debugPort: 9223 }), 'port-9223');
});

test('resolveSessionId defaults to "default"', () => {
  const manager = new SessionManager();
  assert.equal(manager.resolveSessionId({}), 'default');
});

// --- getOrCreate ---

test('getOrCreate keeps isolated recorders per session', () => {
  const manager = new SessionManager();
  const a = manager.getOrCreate('agent-a').recorder;
  const b = manager.getOrCreate('agent-b').recorder;
  assert.notEqual(a, b);
});

test('getOrCreate returns the same entry on repeated calls', () => {
  const manager = new SessionManager();
  const first = manager.getOrCreate('agent-a');
  const second = manager.getOrCreate('agent-a');
  assert.equal(first, second);
});

// --- listSessions ---

test('listSessions returns all active sessions', () => {
  const manager = new SessionManager();
  manager.getOrCreate('agent-a');
  manager.getOrCreate('agent-b');
  assert.equal(manager.listSessions().length, 2);
});

test('listSessions includes recorder status fields', () => {
  const manager = new SessionManager();
  manager.getOrCreate('my-session');
  const [entry] = manager.listSessions();
  assert.equal(entry.sessionId, 'my-session');
  assert.equal(typeof entry.connected, 'boolean');
  assert.equal(typeof entry.recording, 'boolean');
});

// --- closeSession ---

test('closeSession removes only the requested session', async () => {
  const manager = new SessionManager();
  manager.getOrCreate('agent-a');
  manager.getOrCreate('agent-b');
  await manager.closeSession('agent-a');
  assert.equal(manager.listSessions().length, 1);
  assert.equal(manager.listSessions()[0].sessionId, 'agent-b');
});

test('closeSession returns false when session does not exist', async () => {
  const manager = new SessionManager();
  const result = await manager.closeSession('nonexistent');
  assert.equal(result, false);
});

// --- closeAllSessions ---

test('closeAllSessions removes every session and returns their ids', async () => {
  const manager = new SessionManager();
  manager.getOrCreate('agent-a');
  manager.getOrCreate('agent-b');
  const closed = await manager.closeAllSessions();
  assert.deepEqual(closed.sort(), ['agent-a', 'agent-b']);
  assert.equal(manager.listSessions().length, 0);
});
