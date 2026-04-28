# Copilot API Client Example

This folder shows how another project can call the Rainbond Copilot API service while keeping its own UI.

## Files

- `backend-example.mjs`: backend-oriented usage with `fetch`
- `frontend-sse-example.ts`: UI-oriented usage with the shared client helper

## Assumptions

The Copilot API server is already running:

```bash
./scripts/start-copilot-api.sh
```

Default URL:

```text
http://127.0.0.1:8787
```

## Notes

- The caller backend should attach trusted actor headers.
- The frontend should not directly invent tenant or user identity.
- For production, prefer: browser -> caller backend -> Copilot API.
