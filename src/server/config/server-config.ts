export type CopilotStoreMode = "memory" | "file";

export interface ServerConfig {
  host: string;
  port: number;
  storeMode: CopilotStoreMode;
  dataDir: string;
  consoleBaseUrl: string;
}

export function createServerConfig(
  env: Record<string, string | undefined> = process.env
): ServerConfig {
  const storeMode =
    env.COPILOT_STORE_MODE === "file"
      ? "file"
      : "memory";

  return {
    host: env.COPILOT_API_HOST || "0.0.0.0",
    port: Number(env.COPILOT_API_PORT || "8787"),
    storeMode,
    dataDir: env.COPILOT_DATA_DIR || ".copilot-data",
    consoleBaseUrl: env.COPILOT_CONSOLE_BASE_URL || "http://127.0.0.1:7070",
  };
}
