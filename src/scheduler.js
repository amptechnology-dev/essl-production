import cron from "node-cron";
import { pollAndPushLogs } from "./poller.js";
import { loadConfig } from "./config.js";

export const startScheduler = async () => {
  const { POLL_INTERVAL_SECONDS } = await loadConfig();

  cron.schedule(`*/${POLL_INTERVAL_SECONDS} * * * * *`, async () => {
    console.log("Polling cycle started...");
    await pollAndPushLogs();
  });

  console.log(`Polling every ${POLL_INTERVAL_SECONDS} seconds.`);
};
