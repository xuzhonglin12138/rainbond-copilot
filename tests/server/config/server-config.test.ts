// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createServerConfig } from "../../../src/server/config/server-config";

describe("server config", () => {
  it("parses file-backed API server configuration", () => {
    const config = createServerConfig({
      COPILOT_API_HOST: "127.0.0.1",
      COPILOT_API_PORT: "8899",
      COPILOT_STORE_MODE: "file",
      COPILOT_DATA_DIR: ".copilot-data",
      COPILOT_CONSOLE_BASE_URL: "http://127.0.0.1:7070",
    });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8899);
    expect(config.storeMode).toBe("file");
    expect(config.dataDir).toBe(".copilot-data");
    expect(config.consoleBaseUrl).toBe("http://127.0.0.1:7070");
  });
});
