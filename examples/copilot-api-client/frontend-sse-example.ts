import {
  createCopilotApiClient,
  readCopilotSseStream,
} from "../../src/shared/copilot-api-client";

async function example() {
  const client = createCopilotApiClient({
    baseUrl: "http://127.0.0.1:8787",
    actor: {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    },
  });

  const session = await client.createSession({
    context: {
      app_id: "app-001",
      page: "service-detail",
    },
  });

  const run = await client.createMessageRun(session.data.session_id, {
    message: "check frontend-ui status",
    stream: true,
  });

  const response = await client.openEventStream(
    session.data.session_id,
    run.data.run_id
  );
  const events = await readCopilotSseStream(response);

  console.log(events);
}

void example();
