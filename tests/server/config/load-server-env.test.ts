// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerEnv } from "../../../src/server/config/load-server-env.js";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("loadServerEnv", () => {
  it("loads .env and maps ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "copilot-env-"));
    tempDirs.push(cwd);

    await writeFile(
      join(cwd, ".env"),
      [
        "ANTHROPIC_AUTH_TOKEN=env-token",
        "ANTHROPIC_BASE_URL=http://anthropic.example",
        "ANTHROPIC_MODEL=claude-test",
      ].join("\n"),
      "utf-8"
    );

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.VITE_OPENAI_API_KEY;
    delete process.env.VITE_OPENAI_BASE_URL;
    delete process.env.VITE_OPENAI_MODEL;

    loadServerEnv(cwd);

    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("env-token");
    expect(process.env.ANTHROPIC_API_KEY).toBe("env-token");
    expect(process.env.ANTHROPIC_BASE_URL).toBe("http://anthropic.example");
    expect(process.env.ANTHROPIC_MODEL).toBe("claude-test");
  });

  it("maps VITE_OPENAI variables to OPENAI variables for the server runtime", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "copilot-env-"));
    tempDirs.push(cwd);

    await writeFile(
      join(cwd, ".env"),
      [
        "VITE_OPENAI_API_KEY=deepseek-key",
        "VITE_OPENAI_BASE_URL=https://api.deepseek.com/v1",
        "VITE_OPENAI_MODEL=deepseek-reasoner",
      ].join("\n"),
      "utf-8"
    );

    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.VITE_OPENAI_API_KEY;
    delete process.env.VITE_OPENAI_BASE_URL;
    delete process.env.VITE_OPENAI_MODEL;

    loadServerEnv(cwd);

    expect(process.env.OPENAI_API_KEY).toBe("deepseek-key");
    expect(process.env.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(process.env.OPENAI_MODEL).toBe("deepseek-reasoner");
  });
});
