import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.SMOKE_PORT ?? 3456);
const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, "smoke-page.html"), "utf8");

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`smoke server listening on http://127.0.0.1:${port}`);
});
