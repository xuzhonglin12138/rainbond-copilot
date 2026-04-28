import { fileURLToPath } from "node:url";
import { loadServerEnv } from "./config/load-server-env.js";
import { createServerConfig } from "./config/server-config.js";
import { createCopilotApiServer } from "./http.js";
function isWorkflowDebugEnabled(env = process.env) {
    const raw = env.COPILOT_DEBUG_WORKFLOW || env.RAINBOND_DEBUG_WORKFLOW || "";
    return /^(1|true|yes|on)$/i.test(raw.trim());
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    loadServerEnv();
    if (isWorkflowDebugEnabled()) {
        console.log("[workflow-debug] runtime logging enabled");
    }
    const config = createServerConfig();
    const server = createCopilotApiServer({ config });
    server.listen(config.port, config.host, () => {
        console.log(`rainbond-copilot api server listening on http://${config.host}:${config.port}`);
    });
}
export { createCopilotApiServer } from "./http.js";
export { createServerConfig } from "./config/server-config.js";
