import type { Session } from "../shared/types";

export class MemorySessionStore {
  private sessions = new Map<string, Session>();

  async createSession(sessionId: string): Promise<Session> {
    const session: Session = {
      sessionId,
      transcriptIds: [],
      pendingApprovals: [],
      openTasks: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) || null;
  }

  async updateSession(session: Session): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
