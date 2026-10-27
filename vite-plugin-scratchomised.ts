/**
 * Vite plugin: start the Scratchomised WebSocket bridge with `vite` / `vite preview`.
 *
 * Scratch → ws://127.0.0.1:55125 (subprotocol "scratchomised")
 * Page   → same port (subprotocol "scratchomised-host")
 *
 * See src/scratchomised/index.js for the browser-side module map.
 */
type Plugin = {
  name: string;
  apply?: string;
  configureServer?: (server: ViteDevServer) => void;
  configurePreviewServer?: (server: unknown) => void;
};
type ViteDevServer = {
  httpServer?: { once: (event: string, cb: () => void) => void } | null;
};

import { startScratchomisedBridge, DEFAULT_PORT } from "./scripts/scratchomised-bridge.mjs";

type BridgeHandle = ReturnType<typeof startScratchomisedBridge>;

export function scratchomisedBridgePlugin(options: { port?: number; host?: string } = {}): Plugin {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? "127.0.0.1";
  let bridge: BridgeHandle | null = null;

  const ensureBridge = () => {
    if (bridge) {
      return bridge;
    }
    try {
      bridge = startScratchomisedBridge({ port, host });
    } catch (err: any) {
      console.warn(
        "[Scratchomised] could not start bridge on",
        `${host}:${port}:`,
        err && err.message ? err.message : err
      );
      bridge = null;
    }
    return bridge;
  };

  const attachClose = (viteServer: ViteDevServer) => {
    const httpServer = viteServer.httpServer;
    if (!httpServer) {
      return;
    }
    httpServer.once("close", () => {
      if (bridge) {
        bridge.close().catch(() => undefined);
        bridge = null;
      }
    });
  };

  return {
    name: "scratchomised-bridge",
    apply: "serve",
    configureServer(server) {
      ensureBridge();
      attachClose(server);
    },
    configurePreviewServer(server) {
      ensureBridge();
      attachClose(server as ViteDevServer);
    },
  };
};
