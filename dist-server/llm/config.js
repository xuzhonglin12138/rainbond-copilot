// Detect environment and use appropriate env variable access
function getEnv(key) {
    if (typeof window === "undefined" && typeof process !== "undefined" && process.env) {
        return process.env[key];
    }
    // Vitest runs in a Node context where import.meta.env may still contain
    // browser-side VITE_* values from local development. Prefer explicit
    // process.env in tests so fallback-mode assertions can disable keys reliably.
    if (typeof process !== "undefined" &&
        process.env &&
        (process.env.VITEST || process.env.NODE_ENV === "test")) {
        return process.env[key];
    }
    // Browser environment (Vite)
    const viteMeta = import.meta;
    if (viteMeta && viteMeta.env) {
        return viteMeta.env[`VITE_${key}`];
    }
    // Node environment (tests)
    if (typeof process !== "undefined" && process.env) {
        return process.env[key];
    }
    return undefined;
}
export function getLLMConfig() {
    const openaiApiKey = getEnv("OPENAI_API_KEY") || getEnv("VITE_OPENAI_API_KEY");
    const openaiModel = getEnv("OPENAI_MODEL") || getEnv("VITE_OPENAI_MODEL") || "gpt-4o-mini";
    const openaiBaseURL = getEnv("OPENAI_BASE_URL") || getEnv("VITE_OPENAI_BASE_URL");
    const anthropicApiKey = getEnv("ANTHROPIC_API_KEY") || getEnv("ANTHROPIC_AUTH_TOKEN");
    const anthropicModel = getEnv("ANTHROPIC_MODEL") || "claude-3-5-sonnet-20241022";
    const anthropicBaseURL = getEnv("ANTHROPIC_BASE_URL");
    let apiKey;
    let model;
    let baseURL;
    let provider;
    if (openaiApiKey) {
        apiKey = openaiApiKey;
        model = openaiModel;
        baseURL = openaiBaseURL;
        provider = "openai";
    }
    else {
        apiKey = anthropicApiKey;
        model = anthropicModel;
        baseURL = anthropicBaseURL;
        provider = "anthropic";
    }
    // Convert relative URL to absolute URL in browser environment
    if (baseURL && typeof window !== "undefined" && baseURL.startsWith("/")) {
        baseURL = window.location.origin + baseURL;
    }
    if (!apiKey) {
        throw new Error("API key is not set. Please configure ANTHROPIC_API_KEY or OPENAI_API_KEY in .env file.");
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
