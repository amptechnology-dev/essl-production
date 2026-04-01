import { loadConfig, saveConfig } from "./config.js";
import indexPage from "../public/index.html";
import ZKLib from "node-zklib";

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
        const { DEVICE_IP, DEVICE_PORT } = await loadConfig();
        
        if (!DEVICE_IP || !DEVICE_PORT) {
          return Response.json({
            success: false,
            message: "Device IP or Port not configured",
          });
        }
 
        const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, 30 * 1000, 80);
        
        try {
          await zk.createSocket();
          const sn = await zk.getSerialNumber();
          await zk.disconnect();
          
          return Response.json({
            success: true,
            message: `Connected to device, SN: ${sn}`,
          });
        } catch (err) {
          await zk.disconnect().catch(() => {}); 
          
          return Response.json({
            success: false,
            message: `Connection failed: ${err.message}`,
          });
        }
      } catch (err) {
        return Response.json({
          success: false,
          message: `Connection failed! Check config.`,
        });
      }
    },
  },
  async fetch(req) {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`GUI available at http://localhost:${server.port}`);
