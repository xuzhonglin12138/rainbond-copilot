import type { LLMConfig } from "./types";

// Detect environment and use appropriate env variable access
function getEnv(key: string): string | undefined {
  // Vitest runs in a Node context where import.meta.env may still contain
  // browser-side VITE_* values from local development. Prefer explicit
  // process.env in tests so fallback-mode assertions can disable keys reliably.
  if (
    typeof process !== "undefined" &&
    process.env &&
    (process.env.VITEST || process.env.NODE_ENV === "test")
  ) {
    return process.env[key];
  }

  // Browser environment (Vite)
  if (typeof import.meta !== "undefined" && import.meta.env) {
    return import.meta.env[`VITE_${key}`];
  }
  // Node environment (tests)
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

export function getLLMConfig(): LLMConfig {
  // Try Anthropic first
  let apiKey = getEnv("ANTHROPIC_API_KEY");
  let model = getEnv("ANTHROPIC_MODEL") || "claude-3-5-sonnet-20241022";
  let baseURL = getEnv("ANTHROPIC_BASE_URL");
  let provider: "anthropic" | "openai" = "anthropic";

  // Fallback to OpenAI if Anthropic not configured
  if (!apiKey) {
    apiKey = getEnv("OPENAI_API_KEY");
    model = getEnv("OPENAI_MODEL") || "gpt-4o-mini";
    baseURL = getEnv("OPENAI_BASE_URL");
    provider = "openai";
  }

  // Convert relative URL to absolute URL in browser environment
  if (baseURL && typeof window !== "undefined" && baseURL.startsWith("/")) {
    baseURL = window.location.origin + baseURL;
  }

  if (!apiKey) {
    throw new Error(
      "API key is not set. Please configure ANTHROPIC_API_KEY or OPENAI_API_KEY in .env file."
    );
  }

  return {
    apiKey,
    model,
    baseURL,
    provider,
    temperature: 0.7,
    maxTokens: 4096,
    requestTimeoutMs: 8000,
  };
}
