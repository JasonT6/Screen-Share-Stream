// Local preview only. Production hosts serve the exported out/ files directly.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../out/", import.meta.url)));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain",
  ".woff2": "font/woff2"
};
export async function startStaticServer(
  port = Number(process.env.PORT || 3000)
) {
  await stat(path.join(root, "index.html")).catch(() => {
    throw new Error("Run npm run build before starting Private Stream.");
  });
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const url = new URL(request.url, "http://localhost");
      const requested = path.resolve(
        root,
        `.${decodeURIComponent(url.pathname)}`
      );
      if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const file = (await stat(requested)).isDirectory()
        ? path.join(requested, "index.html")
        : requested;
      const content = await readFile(file);
      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Permissions-Policy": "camera=(), microphone=(), display-capture=(self)"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const server = await startStaticServer();
  console.log(`Private Stream: http://localhost:${server.address().port}`);
}
