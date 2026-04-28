// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApprovalRecord } from "../../../src/server/stores/approval-store";
import { createEventRecord } from "../../../src/server/stores/event-store";
import { createRunRecord } from "../../../src/server/stores/run-store";
import { createSessionRecord } from "../../../src/server/stores/session-store";
import {
  FileApprovalStore,
  FileEventStore,
  FileRunStore,
  FileSessionStore,
} from "../../../src/server/stores/file-stores";
import { resolveStoreFile } from "../../../src/server/stores/file-store-utils";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("file-backed stores", () => {
  it("persist records across store re-instantiation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "copilot-file-store-"));
    tempDirs.push(dir);

    const sessionStore = new FileSessionStore(dir);
    const runStore = new FileRunStore(dir);
    const eventStore = new FileEventStore(dir);
    const approvalStore = new FileApprovalStore(dir);

    await sessionStore.create(
      createSessionRecord({
        sessionId: "cs_123",
        tenantId: "t_123",
        userId: "u_456",
        sourceSystem: "ops-console",
      })
    );
    await runStore.create(
      createRunRecord({
        runId: "run_123",
        tenantId: "t_123",
        sessionId: "cs_123",
        messageText: "restart frontend-ui",
      })
    );
    await eventStore.append(
      createEventRecord({
        tenantId: "t_123",
        sessionId: "cs_123",
        runId: "run_123",
        sequence: 1,
        eventType: "run.status",
        payload: { status: "thinking" },
      })
    );
    await approvalStore.create(
      createApprovalRecord({
        approvalId: "ap_123",
        tenantId: "t_123",
        sessionId: "cs_123",
        runId: "run_123",
        skillId: "restart-component",
        description: "重启 frontend-ui",
        requestedBy: "u_456",
        risk: "high",
      })
    );

    const reloadedSessionStore = new FileSessionStore(dir);
    const reloadedRunStore = new FileRunStore(dir);
    const reloadedEventStore = new FileEventStore(dir);
    const reloadedApprovalStore = new FileApprovalStore(dir);

    expect(await reloadedSessionStore.getById("cs_123", "t_123")).toBeTruthy();
    expect(await reloadedRunStore.getById("run_123", "t_123")).toBeTruthy();
    expect(
      await reloadedEventStore.listByRun("run_123", "t_123", { afterSequence: 0 })
    ).toHaveLength(1);
    expect(await reloadedApprovalStore.getById("ap_123", "t_123")).toBeTruthy();
  });

  it("surfaces the corrupted store file path when json parsing fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "copilot-file-store-"));
    tempDirs.push(dir);

    const eventFile = resolveStoreFile(dir, "events");
    await writeFile(eventFile, '[{"broken": "value"', "utf-8");

    const eventStore = new FileEventStore(dir);

    await expect(
      eventStore.listByRun("run_123", "t_123", { afterSequence: 0 })
    ).rejects.toThrow(`Failed to parse JSON store ${eventFile}`);
  });
});
