export function createServerConfig(env = process.env) {
    const storeMode = env.COPILOT_STORE_MODE === "file"
        ? "file"
        : "memory";
    return {
        host: env.COPILOT_API_HOST || "0.0.0.0",
        port: Number(env.COPILOT_API_PORT || "8787"),
        storeMode,
        dataDir: env.COPILOT_DATA_DIR || ".copilot-data",
    };
}
