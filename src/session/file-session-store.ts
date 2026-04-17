import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Session } from "../shared/types";

export class FileSessionStore {
  constructor(private readonly baseDir: string) {}

  async createSession(sessionId: string): Promise<Session> {
    const sessionDir = join(this.baseDir, sessionId);
    await mkdir(sessionDir, { recursive: true });
    const session: Session = {
      sessionId,
      transcriptIds: [],
      pendingApprovals: [],
      openTasks: [],
    };
    await writeFile(join(sessionDir, "metadata.json"), JSON.stringify(session, null, 2));
    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(join(this.baseDir, sessionId, "metadata.json"), "utf-8");
      return JSON.parse(raw) as Session;
    } catch {
      return null;
    }
  }
}
