import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./serve.mjs";
import { probePublicPage, monitorPublicPage } from "./tunnel-health.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = path.join(root, ".runtime");
const options = new Set(process.argv.slice(2));
const children = new Set();
let server;
let log;
let stopMonitoring;
let stopping = false;
const abort = new AbortController();

if (options.has("--help")) {
  console.log(
    "Private Stream\n\n./run.command           Print a public HTTPS link to paste into your browser.\n./run.command --local   Print a localhost link; no public tunnel.\n./run.command --rebuild Force a fresh build.\n./run.command --no-open Accepted for compatibility; links-only is now the default.\n\nRequires Node.js 22+. No browser is opened or configured.\nKeep this terminal running: Ctrl+C stops the public link."
  );
  process.exit(0);
}
for (const option of options) {
  if (!["--local", "--rebuild", "--no-open"].includes(option)) {
    console.error(`Unknown option: ${option}. Use --help.`);
    process.exit(1);
  }
}

function launch(command, args, extra = {}) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", ...extra });
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", () => children.delete(child));
  return child;
}

async function run(command, args) {
  const child = launch(command, args);
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function fingerprint(names) {
  const hash = createHash("sha256");
  async function add(name) {
    const filename = path.join(root, name);
    let entries;
    try {
      entries = await readdir(filename, { withFileTypes: true });
    } catch {
      /* File or absent optional .env. */
    }
    if (entries) {
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name)
      )) {
        if (!entry.isSymbolicLink()) await add(path.join(name, entry.name));
      }
    } else if (await exists(filename)) {
      hash.update(name);
      hash.update(await readFile(filename));
    }
  }
  for (const name of names) await add(name);
  return hash.digest("hex");
}

async function prepareBuild() {
  await mkdir(runtime, { recursive: true });
  const stateFile = path.join(runtime, "build-state.json");
  let state = {};
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    /* First run. */
  }
  const dependencies = await fingerprint(["package.json", "package-lock.json"]);
  if (
    state.dependencies !== dependencies ||
    !(await exists(path.join(root, "node_modules/next/package.json")))
  ) {
    console.log("Installing the project's dependencies…");
    await run("npm", ["ci"]);
    state = { dependencies };
  }
  const files = await fingerprint([
    "app",
    "components",
    "lib",
    "public",
    "package.json",
    "package-lock.json",
    "next.config.mjs",
    "postcss.config.mjs",
    "tailwind.config.ts",
    "tsconfig.json",
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local"
  ]);
  const publicEnvironment = Object.entries(process.env)
    .filter(([key]) => key.startsWith("NEXT_PUBLIC_"))
    .sort(([a], [b]) => a.localeCompare(b));
  const build = createHash("sha256")
    .update(files)
    .update(JSON.stringify(publicEnvironment))
    .digest("hex");
  if (
    options.has("--rebuild") ||
    state.build !== build ||
    !(await exists(path.join(root, "out/index.html")))
  ) {
    console.log("Building the static web app…");
    await run("npm", ["run", "build"]);
  } else console.log("Using the current build.");
  // Store hashes only, never the contents of environment variables.
  await writeFile(stateFile, JSON.stringify({ dependencies, build }));
}

async function tunnelExecutable() {
  if (process.env.CLOUDFLARED_BIN) return process.env.CLOUDFLARED_BIN;
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, "cloudflared");
    if (await exists(candidate)) return candidate;
  }
  if (
    process.platform !== "darwin" ||
    !["arm64", "x64"].includes(process.arch)
  ) {
    throw new Error(
      "Install cloudflared and add it to PATH, then rerun. Use --local for local-only access."
    );
  }
  const bin = path.join(runtime, "bin");
  const executable = path.join(bin, "cloudflared");
  if (await exists(executable)) return executable;
  console.log("Downloading Cloudflare's tunnel helper (first run only)…");
  await mkdir(bin, { recursive: true });
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const archive = path.join(bin, "cloudflared.tgz");
  const response = await fetch(
    `https://github.com/cloudflare/cloudflared/releases/download/2026.9.0/cloudflared-darwin-${arch}.tgz`,
    { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)]) }
  );
  if (!response.ok)
    throw new Error(
      `Tunnel helper download failed (${response.status}). Please retry.`
    );
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  await run("tar", ["-xzf", archive, "-C", bin, "cloudflared"]);
  await chmod(executable, 0o755);
  await rm(archive);
  return executable;
}

async function publicAddress(executable, localUrl) {
  console.log("Creating a public HTTPS address…");
  log = createWriteStream(path.join(runtime, "tunnel.log"));
  const child = launch(
    executable,
    ["tunnel", "--url", localUrl, "--no-autoupdate", "--protocol", "http2"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  child.once("exit", () => {
    if (!stopping) {
      console.error(
        "The public tunnel stopped; this session's link no longer works. Run ./run.command again, open its NEW address, and send fresh invitations."
      );
      void shutdown(1);
    }
  });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "The tunnel service timed out. See frontend/.runtime/tunnel.log."
          )
        ),
      45_000
    );
    let tail = "";
    let address;
    const receive = (chunk) => {
      log.write(chunk);
      tail = (tail + chunk.toString()).slice(-8192);
      const match = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
      if (match) address = match[0];
      if (address && tail.includes("Registered tunnel connection")) {
        clearTimeout(timeout);
        resolve(address);
      }
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Could not start the public tunnel."));
    });
  });
  // Avoid a premature lookup while the newly allocated hostname is still
  // propagating: a cached NXDOMAIN can otherwise outlive the readiness check.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const expected = await readFile(path.join(root, "out/index.html"), "utf8");
  let lastFailure = "no response";
  const deadline = Date.now() + 90_000;
  let attempts = 0;
  while (Date.now() < deadline && !stopping) {
    const result = await probePublicPage(url, expected, {
      signal: abort.signal
    });
    if (result.ok) {
      stopMonitoring = monitorPublicPage(url, expected, {
        signal: abort.signal,
        onChange: (status) => {
          if (status.ok) console.log(`\nPublic link reachable again: ${url}`);
          else
            console.error(
              `\nPublic link unavailable: ${status.reason}.\nKeep this command running while the tunnel reconnects. If this persists, restart ./run.command, open the NEW address, and send fresh invitations.\nDetails: frontend/.runtime/tunnel.log`
            );
        }
      }).stop;
      return url;
    }
    lastFailure = result.reason;
    if (++attempts === 5)
      console.log("Waiting for the new public address to become reachable…");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `The public address is not reachable yet (${lastFailure}). Please retry; details are in frontend/.runtime/tunnel.log.`
  );
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  stopMonitoring?.();
  abort.abort();
  console.log("\nStopping Private Stream…");
  await Promise.allSettled(
    [...children].map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 4000);
      try {
        await exited;
      } finally {
        clearTimeout(timeout);
      }
    })
  );
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  log?.end();
  process.exit(code);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

try {
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new Error("Use Node.js 22 or newer.");
  await prepareBuild();
  const tunnel = !options.has("--local") ? await tunnelExecutable() : null;
  // Bind our own server to a free port. Never expose an unrelated app on 3000.
  server = await startStaticServer(0);
  const localUrl = `http://localhost:${server.address().port}`;
  const url = tunnel
    ? await publicAddress(tunnel, `http://127.0.0.1:${server.address().port}`)
    : localUrl;
  console.log(
    `\nCopy this host link into your browser:\n\n${url}\n\nClick Create a room, choose a username and password, then Share screen & audio.\nSend attendees the invitation copied INSIDE the app and the password.\nKeep this terminal running and the host tab open while streaming.\nCtrl+C stops the public link; closing a browser does not stop this command.\n${tunnel ? "Each launch creates a NEW address. Invitations from stopped sessions will not work (Cloudflare error 1033)." : "Local mode: this address works only on this computer."}\n`
  );
  if (process.platform === "darwin") {
    const awake = launch("/usr/bin/caffeinate", ["-di"], { stdio: "ignore" });
    awake.on("error", () => console.log("Keep the Mac awake while sharing."));
  }
} catch (error) {
  if (!stopping) console.error(`\n${error.message}`);
  await shutdown(1);
}
