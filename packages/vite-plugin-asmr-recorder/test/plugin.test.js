import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import buildSoundMonitor, { createClientSource } from "../src/index.js";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function runClient({ sharedStorage = memoryStorage(), session = memoryStorage() } = {}) {
  const handlers = new Map();
  const sent = [];
  const hot = {
    on: (name, handler) => handlers.set(name, handler),
    send: (name, payload) => sent.push({ name, payload }),
  };
  const executable = createClientSource().replace(
    "const hot = import.meta.hot;",
    "const hot = suppliedHot;",
  );
  new Function(
    "suppliedHot",
    "sessionStorage",
    "localStorage",
    "setTimeout",
    executable,
  )(hot, session, sharedStorage, (callback) => callback());
  return { handlers, sent, session, sharedStorage };
}

test("injects and resolves the virtual HMR client", async () => {
  const plugin = buildSoundMonitor({ discoveryFile: "/missing" });
  assert.equal(plugin.resolveId("virtual:asmr-recorder-build-monitor"), "\0virtual:asmr-recorder-build-monitor");
  assert.match(plugin.load("\0virtual:asmr-recorder-build-monitor"), /vite:afterUpdate/);
  assert.match(plugin.load("\0virtual:asmr-recorder-build-monitor"), /vite:beforeUpdate/);
  assert.match(plugin.load("\0virtual:asmr-recorder-build-monitor"), /vite:beforeFullReload/);
  assert.match(plugin.load("\0virtual:asmr-recorder-build-monitor"), /vite:error/);
  assert.equal(plugin.transformIndexHtml()[0].tag, "script");
  assert.equal(plugin.transformIndexHtml()[0].attrs.src, "/@id/virtual:asmr-recorder-build-monitor");
});

test("requires strictPort for Vite 7 and 8 style resolved configs", async () => {
  for (const version of [7, 8]) {
    const plugin = buildSoundMonitor();
    await assert.rejects(
      plugin.configResolved({ root: process.cwd(), server: { strictPort: false }, viteVersion: version }),
      /strictPort/,
    );
  }
});

test("client acknowledges successful updates and reloads while suppressing errors", () => {
  const source = createClientSource();
  assert.match(source, /report\("hmr"/);
  assert.match(source, /report\("full-reload"/);
  assert.match(source, /if \(sawError\) return/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /localStorage/);

  const client = runClient();
  const update = {
    updates: [{ type: "js-update", path: "/src/main.js", acceptedPath: "/src/main.js", timestamp: 100 }],
  };
  client.handlers.get("vite:error")({});
  assert.equal(client.sent.length, 0);
  client.handlers.get("vite:beforeUpdate")(update);
  client.handlers.get("vite:afterUpdate")(update);
  assert.equal(client.sent.length, 1, "a corrected syntax error reports exactly once");
  assert.equal(client.sent[0].payload.eventType, "hmr");

  client.handlers.get("vite:beforeFullReload")({ path: "/index.html", triggeredBy: "/src/main.js" });
  const reconnected = runClient({ sharedStorage: client.sharedStorage, session: client.session });
  assert.equal(reconnected.sent.length, 1);
  assert.equal(reconnected.sent[0].payload.eventType, "full-reload");
});

test("multiple tabs generate the same full-reload event ID", () => {
  const originalNow = Date.now;
  Date.now = () => 10_000;
  try {
    const sharedStorage = memoryStorage();
    const first = runClient({ sharedStorage });
    const second = runClient({ sharedStorage });
    const payload = { path: "/index.html", triggeredBy: "/src/main.js" };
    first.handlers.get("vite:beforeFullReload")(payload);
    second.handlers.get("vite:beforeFullReload")(payload);
    const firstReload = runClient({ sharedStorage, session: first.session });
    const secondReload = runClient({ sharedStorage, session: second.session });
    assert.equal(firstReload.sent[0].payload.eventId, secondReload.sent[0].payload.eventId);
  } finally {
    Date.now = originalNow;
  }
});

test("reports the actual bound port with bearer auth and reconnectable discovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asmr-plugin-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const discoveryFile = join(directory, "bridge.json");
  const requests = [];
  const bridge = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
    response.writeHead(204).end();
  });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => bridge.close(resolve)));
  const bridgePort = bridge.address().port;
  await writeFile(discoveryFile, JSON.stringify({ protocolVersion: 1, port: bridgePort, token: "secret" }));

  const plugin = buildSoundMonitor({ discoveryFile });
  await plugin.configResolved({ root: directory, server: { strictPort: true, port: 5174 } });
  const httpServer = new EventEmitter();
  httpServer.address = () => ({ port: 61234 });
  const ws = { handlers: new Map(), on(name, handler) { this.handlers.set(name, handler); } };
  plugin.configureServer({ httpServer, ws });
  httpServer.emit("listening");
  ws.handlers.get("asmr-recorder:build-success")({ eventId: "same-in-every-tab", eventType: "hmr", timestamp: 123 });

  await new Promise((resolve) => setTimeout(resolve, 100));
  httpServer.emit("close");
  assert.ok(requests.some((request) => request.url === "/v1/heartbeat"));
  const event = requests.find((request) => request.url === "/v1/events");
  assert.equal(event.authorization, "Bearer secret");
  assert.equal(event.body.port, 61234);
  assert.equal(event.body.eventId, "same-in-every-tab");
  await writeFile(discoveryFile, JSON.stringify({ protocolVersion: 1, port: bridgePort, token: "rotated" }));
  ws.handlers.get("asmr-recorder:build-success")({ eventId: "after-restart", eventType: "hmr", timestamp: 456 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(requests.some((request) => request.authorization === "Bearer rotated"));
  assert.equal(JSON.parse(await readFile(discoveryFile, "utf8")).token, "rotated");
});
