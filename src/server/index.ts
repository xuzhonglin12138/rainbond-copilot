import { createServerConfig } from "./config/server-config";
import { createCopilotApiServer } from "./http";

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = createServerConfig();
  const server = createCopilotApiServer({ config });
  server.listen(config.port, config.host, () => {
    console.log(
      `rainbond-copilot api server listening on http://${config.host}:${config.port}`
    );
  });
}

export { createCopilotApiServer } from "./http";
export { createServerConfig } from "./config/server-config";
