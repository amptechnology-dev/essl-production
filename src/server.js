import { loadConfig, saveConfig } from "./config.js";
import indexPage from "../public/index.html";
import { testDeviceConnection } from "./poller.js";

const server = Bun.serve({
  port: 3001,
  routes: {
    "/": indexPage,
    "/login": {
      POST: async (req) => {
        const { password } = await req.json();
        if (password === "admin") {
          return Response.json({ success: true, token: "dummy-session" });
        } else {
          return new Response("Unauthorized", { status: 401 });
        }
      },
    },
    "/config": {
      GET: async () => {
        return Response.json(await loadConfig());
      },
      POST: async (req) => {
        const body = await req.json();
        const current = await loadConfig();
        const updated = { ...current, ...body };
        await saveConfig(updated);
        return Response.json({ success: true, config: updated });
      },
    },
    "/test": async () => {
      try {
        const details = await testDeviceConnection();
        return Response.json({
          success: true,
          message: `Connected! SN=${details.sn}, IP=${details.ip}, PORT=${details.port}, MODE=${details.mode}`,
        });

      } catch (err) {
        return Response.json({
          success: false,
          message: `Connection failed: ${err?.message || err}`,
        });
      }
    },
  },
  async fetch(req) {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`GUI available at http://localhost:${server.port}`);