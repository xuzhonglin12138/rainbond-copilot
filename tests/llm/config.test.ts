// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { getLLMConfig } from "../../src/llm/config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
});

describe("getLLMConfig", () => {
  it("accepts ANTHROPIC_AUTH_TOKEN as a fallback api key", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.VITE_OPENAI_API_KEY;
    delete process.env.VITE_OPENAI_BASE_URL;
    delete process.env.VITE_OPENAI_MODEL;
    process.env.ANTHROPIC_AUTH_TOKEN = "test-anthropic-token";
    process.env.ANTHROPIC_MODEL = "claude-test";
    process.env.ANTHROPIC_BASE_URL = "http://anthropic.test";

    const config = getLLMConfig();

    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBe("test-anthropic-token");
    expect(config.model).toBe("claude-test");
    expect(config.baseURL).toBe("http://anthropic.test");
  });

  it("prefers OpenAI-compatible config when both OpenAI and Anthropic envs are present", () => {
    delete process.env.VITE_OPENAI_API_KEY;
    delete process.env.VITE_OPENAI_BASE_URL;
    delete process.env.VITE_OPENAI_MODEL;
    process.env.ANTHROPIC_AUTH_TOKEN = "anthropic-token";
    process.env.ANTHROPIC_BASE_URL = "http://anthropic.test";
    process.env.ANTHROPIC_MODEL = "claude-test";
    process.env.OPENAI_API_KEY = "openai-token";
    process.env.OPENAI_BASE_URL = "https://api.deepseek.com/v1";
    process.env.OPENAI_MODEL = "deepseek-reasoner";

    const config = getLLMConfig();

    expect(config.provider).toBe("openai");
    expect(config.apiKey).toBe("openai-token");
    expect(config.baseURL).toBe("https://api.deepseek.com/v1");
    expect(config.model).toBe("deepseek-reasoner");
  });
});
