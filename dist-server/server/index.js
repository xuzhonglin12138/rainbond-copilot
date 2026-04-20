import { fileURLToPath } from "node:url";
import { createServerConfig } from "./config/server-config.js";
import { createCopilotApiServer } from "./http.js";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const config = createServerConfig();
    const server = createCopilotApiServer({ config });
    server.listen(config.port, config.host, () => {
        console.log(`rainbond-copilot api server listening on http://${config.host}:${config.port}`);
    });
}
export { createCopilotApiServer } from "./http.js";
export { createServerConfig } from "./config/server-config.js";
