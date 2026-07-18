import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const PUBLIC_ID = "virtual:asmr-recorder-build-monitor";
const RESOLVED_ID = `\0${PUBLIC_ID}`;
const CLIENT_EVENT = "asmr-recorder:build-success";
const PROTOCOL_VERSION = 1;
const HEARTBEAT_INTERVAL = 5_000;

export function defaultDiscoveryFile(
  platform = process.platform,
  environment = process.env,
) {
  let dataRoot;
  if (platform === "darwin") {
    dataRoot = join(homedir(), "Library", "Application Support");
  } else if (platform === "win32") {
    dataRoot = environment.APPDATA || join(homedir(), "AppData", "Roaming");
  } else {
    dataRoot = environment.XDG_DATA_HOME || join(homedir(), ".local", "share");
  }
  return join(dataRoot, "com.asmrrecorder.app", "build-sound-bridge.json");
}

function stableProjectId(root) {
  return createHash("sha256").update(root).digest("hex").slice(0, 24);
}

async function projectName(root) {
  try {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (typeof packageJson.name === "string" && packageJson.name.trim()) {
      return packageJson.name.trim();
    }
  } catch {
    // A package.json is optional for Vite projects.
  }
  return basename(root);
}

async function sendToRecorder(discoveryFile, route, payload) {
  try {
    const discovery = JSON.parse(await readFile(discoveryFile, "utf8"));
    if (
      discovery.protocolVersion !== PROTOCOL_VERSION ||
      !Number.isInteger(discovery.port) ||
      typeof discovery.token !== "string"
    ) {
      return false;
    }
    const response = await fetch(`http://127.0.0.1:${discovery.port}${route}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${discovery.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    // Recorder may be closed or restarting. Every heartbeat rereads discovery,
    // so a new port/token is picked up automatically without disturbing Vite.
    return false;
  }
}

export function createClientSource() {
  return String.raw`
const hot = import.meta.hot;
if (hot) {
  const PENDING_KEY = "asmr-recorder:pending-full-reload";
  const SHARED_RELOAD_KEY = "asmr-recorder:shared-full-reload";
  let sawError = false;
  let lastReportedUpdateId;
  const hash = (value) => {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) {
      result ^= value.charCodeAt(i);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };
  const report = (eventType, eventId) => hot.send(${JSON.stringify(CLIENT_EVENT)}, {
    eventType,
    eventId,
    timestamp: Date.now(),
  });
  const updateEventId = (payload) => {
    const updates = Array.isArray(payload?.updates) ? payload.updates : [];
    const signature = updates
      .map((update) => [update.type, update.path, update.acceptedPath, update.timestamp].join(":"))
      .sort()
      .join("|");
    const timestamp = updates[0]?.timestamp ?? payload?.timestamp ?? 0;
    return "hmr-" + hash(signature + ":" + timestamp);
  };

  hot.on("vite:error", () => {
    sawError = true;
    sessionStorage.removeItem(PENDING_KEY);
  });

  hot.on("vite:beforeUpdate", (payload) => {
    if (!sawError) return;
    // Vite reloads immediately when the first valid update clears its error
    // overlay, so that path never reaches vite:afterUpdate. Receiving this
    // transformed update from the server is the successful correction signal.
    lastReportedUpdateId = updateEventId(payload);
    report("hmr", lastReportedUpdateId);
    sawError = false;
  });

  hot.on("vite:afterUpdate", (payload) => {
    sawError = false;
    const eventId = updateEventId(payload);
    if (eventId !== lastReportedUpdateId) report("hmr", eventId);
    lastReportedUpdateId = eventId;
  });

  hot.on("vite:beforeFullReload", (payload) => {
    const signature = [payload?.path ?? "*", payload?.triggeredBy ?? "*"].join(":");
    // localStorage is shared by tabs on the Vite origin. Reuse the first tab's
    // ID during this reload cycle, but create a new one for a later reload of
    // the same path.
    const now = Date.now();
    let eventId;
    try {
      const shared = JSON.parse(localStorage.getItem(SHARED_RELOAD_KEY) || "null");
      if (shared?.signature === signature && now - shared.createdAt < 750) {
        eventId = shared.eventId;
      }
    } catch {
      // Storage may be unavailable; the deterministic fallback still works for
      // tabs processing the same millisecond-scale Vite reload.
    }
    eventId ||= "reload-" + hash(signature + ":" + now);
    try {
      localStorage.setItem(SHARED_RELOAD_KEY, JSON.stringify({ signature, eventId, createdAt: now }));
    } catch {
      // sessionStorage below is still enough to acknowledge this tab.
    }
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      eventId,
      timestamp: now,
    }));
  });

  const pendingRaw = sessionStorage.getItem(PENDING_KEY);
  if (pendingRaw) {
    sessionStorage.removeItem(PENDING_KEY);
    setTimeout(() => {
      if (sawError) return;
      try {
        const pending = JSON.parse(pendingRaw);
        report("full-reload", pending.eventId);
      } catch {
        // Ignore stale/corrupt session data.
      }
    }, 250);
  }
}
`;
}

export default function buildSoundMonitor(options = {}) {
  const discoveryFile = options.discoveryFile || defaultDiscoveryFile();
  let resolvedConfig;
  let identity;

  return {
    name: "vite-plugin-asmr-recorder",
    apply: "serve",
    enforce: "post",

    async configResolved(config) {
      resolvedConfig = config;
      if (config.server.strictPort !== true) {
        throw new Error(
          "vite-plugin-asmr-recorder requires server.strictPort: true so ASMR Recorder can safely filter the monitored project.",
        );
      }
      identity = {
        protocolVersion: PROTOCOL_VERSION,
        projectId: stableProjectId(config.root),
        projectName: await projectName(config.root),
      };
    },

    configureServer(server) {
      let interval;
      let actualPort;

      const payload = (extra = {}) => ({
        ...identity,
        port: actualPort,
        timestamp: Date.now(),
        ...extra,
      });
      const heartbeat = () => {
        if (!actualPort || !identity) return;
        void sendToRecorder(discoveryFile, "/v1/heartbeat", payload());
      };

      server.httpServer?.on("listening", () => {
        const address = server.httpServer.address();
        actualPort = typeof address === "object" && address ? address.port : resolvedConfig.server.port;
        heartbeat();
        interval = setInterval(heartbeat, HEARTBEAT_INTERVAL);
        interval.unref?.();
      });
      server.httpServer?.on("close", () => clearInterval(interval));
      server.ws.on(CLIENT_EVENT, (event) => {
        if (
          !actualPort ||
          !event ||
          typeof event.eventId !== "string" ||
          !["hmr", "full-reload"].includes(event.eventType)
        ) {
          return;
        }
        void sendToRecorder(
          discoveryFile,
          "/v1/events",
          payload({
            eventId: event.eventId,
            eventType: event.eventType,
            timestamp: Number.isFinite(event.timestamp) ? event.timestamp : Date.now(),
          }),
        );
      });
    },

    resolveId(id) {
      return id === PUBLIC_ID ? RESOLVED_ID : undefined;
    },

    load(id) {
      return id === RESOLVED_ID ? createClientSource() : undefined;
    },

    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: {
            type: "module",
            src: `/@id/${PUBLIC_ID}`,
          },
          injectTo: "head",
        },
      ];
    },
  };
}
