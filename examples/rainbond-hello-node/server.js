import http from "node:http";

const port = Number(process.env.PORT || 3000);

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      app: "rainbond-hello-node",
      message: "Hello from Rainbond example app",
      method: req.method,
      path: req.url
    })
  );
});

server.listen(port, () => {
  console.log(`rainbond-hello-node listening on ${port}`);
});
