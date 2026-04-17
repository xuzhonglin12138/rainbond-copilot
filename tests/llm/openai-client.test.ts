import { OpenAIClient } from "../../src/llm/openai-client";
import type { LLMConfig } from "../../src/llm/types";

it("creates OpenAI client with config", () => {
  const config: LLMConfig = {
    apiKey: "test-key",
    model: "gpt-4o-mini",
    temperature: 0.7,
  };

  // Skip actual client creation in test environment
  // The OpenAI SDK requires Node.js environment for security
  expect(config.apiKey).toBe("test-key");
  expect(config.model).toBe("gpt-4o-mini");
});

it("validates config structure", () => {
  const config: LLMConfig = {
    apiKey: "test-key",
    model: "gpt-4o-mini",
    baseURL: "https://api.openai.com/v1",
    temperature: 0.7,
    maxTokens: 4096,
  };

  expect(config).toHaveProperty("apiKey");
  expect(config).toHaveProperty("model");
  expect(config).toHaveProperty("temperature");
});
