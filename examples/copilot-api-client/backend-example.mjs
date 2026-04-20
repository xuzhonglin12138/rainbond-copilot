const baseUrl = process.env.COPILOT_BASE_URL || "http://127.0.0.1:8787";

const headers = {
  "content-type": "application/json",
  "x-copilot-tenant-id": "t_123",
  "x-copilot-user-id": "u_456",
  "x-copilot-username": "alice",
  "x-copilot-source-system": "ops-console",
};

async function main() {
  const sessionResponse = await fetch(`${baseUrl}/api/v1/copilot/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      context: {
        app_id: "app-001",
        app_name: "trade-center",
      },
    }),
  });
  const session = await sessionResponse.json();

  const runResponse = await fetch(
    `${baseUrl}/api/v1/copilot/sessions/${session.data.session_id}/messages`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "restart frontend-ui",
        stream: true,
      }),
    }
  );
  const run = await runResponse.json();

  console.log("Session:", session.data);
  console.log("Run:", run.data);
  console.log(
    "Open SSE stream with:",
    `${baseUrl}${run.data.stream_url}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
