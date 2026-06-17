import { BrowserRecorder } from './recorder.js';

const DEFAULT_SESSION_ID = 'default';

export class SessionManager {
  #sessions = new Map();

  resolveSessionId({ sessionId, debugPort } = {}) {
    if (sessionId) {
      return sessionId;
    }
    if (debugPort !== undefined) {
      return `port-${debugPort}`;
    }
    return DEFAULT_SESSION_ID;
  }

  get(sessionId = DEFAULT_SESSION_ID) {
    return this.#sessions.get(sessionId) ?? null;
  }

  getOrCreate(sessionId = DEFAULT_SESSION_ID) {
    if (!this.#sessions.has(sessionId)) {
      this.#sessions.set(sessionId, {
        sessionId,
        recorder: new BrowserRecorder(),
        createdAt: Date.now()
      });
    }
    return this.#sessions.get(sessionId);
  }

  listSessions() {
    return [...this.#sessions.values()].map((entry) => ({
      sessionId: entry.sessionId,
      createdAt: entry.createdAt,
      ...entry.recorder.status
    }));
  }

  async closeSession(sessionId) {
    const entry = this.#sessions.get(sessionId);
    if (!entry) {
      return false;
    }

    await entry.recorder.close();
    this.#sessions.delete(sessionId);
    return true;
  }

  async closeAllSessions() {
    const ids = [...this.#sessions.keys()];
    await Promise.all(ids.map((id) => this.closeSession(id)));
    return ids;
  }
}

export { DEFAULT_SESSION_ID };
