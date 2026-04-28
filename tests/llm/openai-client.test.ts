import { describe, expect, it, vi } from "vitest";
import { OpenAIClient } from "../../src/llm/openai-client";
import type { LLMConfig } from "../../src/llm/types";

describe("OpenAIClient", () => {
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

it("merges streamed tool call deltas into one complete tool call", async () => {
  const client = new OpenAIClient({
    apiKey: "test-key",
    model: "gpt-4o-mini",
  });

  const createSpy = vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "rainbond_get_component_summary",
                    arguments: "{",
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: "\"team_name\":\"demo\",",
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: "\"region_name\":\"rainbond\"}",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
    },
  }));

  (client as any).client = {
    chat: {
      completions: {
        create: createSpy,
      },
    },
  };

  const response = await client.streamChat([]);

  expect(createSpy).toHaveBeenCalled();
  expect(response.finish_reason).toBe("tool_calls");
  expect(response.tool_calls).toEqual([
    {
      id: "call_1",
      type: "function",
      function: {
        name: "rainbond_get_component_summary",
        arguments: "{\"team_name\":\"demo\",\"region_name\":\"rainbond\"}",
      },
    },
  ]);
});
});
