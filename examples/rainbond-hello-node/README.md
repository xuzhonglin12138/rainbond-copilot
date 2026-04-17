# rainbond-hello-node

Minimal example service for validating Rainbond deployment.

## Endpoints

- `/` returns a JSON hello payload
- `/healthz` returns `{"ok": true}`

## Local run

```bash
node server.js
```

## Container run

```bash
docker build -t rainbond-hello-node .
docker run --rm -p 3000:3000 rainbond-hello-node
```
