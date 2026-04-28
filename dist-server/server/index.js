import { fileURLToPath } from "node:url";
import { loadServerEnv } from "./config/load-server-env.js";
import { createServerConfig } from "./config/server-config.js";
import { createCopilotApiServer } from "./http.js";
import { initializeSkillRegistry, resolveDefaultSkillsRoot, } from "./skills/skill-registry.js";
function isWorkflowDebugEnabled(env = process.env) {
    const raw = env.COPILOT_DEBUG_WORKFLOW || env.RAINBOND_DEBUG_WORKFLOW || "";
    return /^(1|true|yes|on)$/i.test(raw.trim());
}
async function bootstrap() {
    loadServerEnv();
    if (isWorkflowDebugEnabled()) {
        console.log("[workflow-debug] runtime logging enabled");
    }
    const skillsRoot = resolveDefaultSkillsRoot();
    await initializeSkillRegistry({ rootDir: skillsRoot });
    console.log(`[skills] loaded skills from ${skillsRoot}`);
    const config = createServerConfig();
    const server = createCopilotApiServer({ config });
    server.listen(config.port, config.host, () => {
        console.log(`rainbond-copilot api server listening on http://${config.host}:${config.port}`);
    });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    bootstrap().catch((error) => {
        console.error("[bootstrap] fatal error:", error);
        process.exitCode = 1;
    });
}
export { createCopilotApiServer } from "./http.js";
export { createServerConfig } from "./config/server-config.js";
export { initializeSkillRegistry, resolveDefaultSkillsRoot, } from "./skills/skill-registry.js";
