/**
 * Scratchomised WebSocket bridge for SweetHome3DJS.
 *
 * The browser cannot open a listening socket, so Scratch talks to this Node
 * process (port 55125 by default, subprotocol "scratchomised") while the
 * SweetHome3DJS page connects as a host (subprotocol "scratchomised-host").
 * Messages are relayed both ways.
 *
 * Compatible with https://github.com/LyceeLivet/Scratchomised (MIT).
 */
import { WebSocketServer } from "ws";
import { pathToFileURL } from "node:url";
import path from "node:path";

const DEFAULT_PORT = 55125;
const SCRATCH_PROTOCOL = "scratchomised";
const HOST_PROTOCOL = "scratchomised-host";

/**
 * @param {{ port?: number, host?: string, log?: (...args: any[]) => void }} [options]
 * @returns {{ port: number, close: () => Promise<void>, getStats: () => { scratch: number, hosts: number } }}
 */
export function startScratchomisedBridge(options = {}) {
  const port = Number(options.port) > 0 ? Number(options.port) : DEFAULT_PORT;
  const host = options.host == null || options.host === "" ? "127.0.0.1" : options.host;
  const log = typeof options.log === "function" ? options.log : (...args) => console.log("[Scratchomised]", ...args);

  /** @type {Set<import('ws').WebSocket>} */
  const scratchClients = new Set();
  /** @type {Set<import('ws').WebSocket>} */
  const hostClients = new Set();

  const wss = new WebSocketServer({
    host,
    port,
    handleProtocols(protocols) {
      const list = Array.from(protocols || []);
      if (list.includes(SCRATCH_PROTOCOL)) {
        return SCRATCH_PROTOCOL;
      }
      if (list.includes(HOST_PROTOCOL)) {
        return HOST_PROTOCOL;
      }
      // Accept bare connections (compatibility mode of the Java plugin).
      return false;
    },
  });

  function roleOf(ws) {
    if (ws.protocol === HOST_PROTOCOL) {
      return "host";
    }
    // Default: Scratch client (including empty protocol).
    return "scratch";
  }

  function broadcast(targets, data, except) {
    for (const client of targets) {
      if (client !== except && client.readyState === 1) {
        try {
          client.send(data);
        } catch (err) {
          log("relay send failed:", err && err.message ? err.message : err);
        }
      }
    }
  }

  wss.on("connection", (ws, req) => {
    const role = roleOf(ws);
    const bucket = role === "host" ? hostClients : scratchClients;
    bucket.add(ws);
    const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "?";
    log(`${role} connected from ${remote} (protocol=${ws.protocol || "none"}) — scratch=${scratchClients.size} hosts=${hostClients.size}`);

    // If a host joins while Scratch is already connected, nudge Scratch so it
    // re-acks; the host still needs client_ready (Reconnect in Scratch / reload).
    if (role === "host" && scratchClients.size > 0) {
      broadcast(scratchClients, JSON.stringify({ action: "welcome", args: {} }));
    }

    ws.on("message", (raw) => {
      const data = typeof raw === "string" ? raw : raw.toString("utf8");
      if (role === "host") {
        broadcast(scratchClients, data);
      } else {
        broadcast(hostClients, data);
      }
    });

    ws.on("close", () => {
      bucket.delete(ws);
      log(`${role} disconnected — scratch=${scratchClients.size} hosts=${hostClients.size}`);
    });

    ws.on("error", (err) => {
      log(`${role} error:`, err && err.message ? err.message : err);
    });
  });

  wss.on("listening", () => {
    log(`bridge listening on ws://${host}:${port} (Scratch: ${SCRATCH_PROTOCOL}, SH3DJS: ${HOST_PROTOCOL})`);
  });

  wss.on("error", (err) => {
    log("server error:", err && err.message ? err.message : err);
  });

  return {
    port,
    getStats() {
      return { scratch: scratchClients.size, hosts: hostClients.size };
    },
    close() {
      return new Promise((resolve) => {
        for (const client of [...scratchClients, ...hostClients]) {
          try {
            client.close();
          } catch (_) {
            /* ignore */
          }
        }
        scratchClients.clear();
        hostClients.clear();
        wss.close(() => resolve());
      });
    },
  };
}

export { DEFAULT_PORT, SCRATCH_PROTOCOL, HOST_PROTOCOL };

// CLI: node scripts/scratchomised-bridge.mjs [port]
const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  const portArg = Number(process.argv[2]);
  startScratchomisedBridge({
    port: Number.isFinite(portArg) && portArg > 0 ? portArg : DEFAULT_PORT,
  });
}
