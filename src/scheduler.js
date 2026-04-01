import { pollAndPushLogs } from "./poller.js";
import { loadConfig } from "./config.js";

export const startScheduler = async () => {
  const { POLL_INTERVAL_SECONDS } = await loadConfig();
  const intervalSeconds = Number(POLL_INTERVAL_SECONDS) || 120;
  const intervalMs = Math.max(5, intervalSeconds) * 1000;
  let inProgress = false;

  const runCycle = async () => {
    if (inProgress) {
      console.log("Polling skipped: previous cycle is still running");
      return;
    }

    inProgress = true;
    try {
      console.log("Polling cycle started...");
      await pollAndPushLogs();
    } catch (err) {
      console.error("Polling cycle failed:", err?.message || err);
    } finally {
      inProgress = false;
    }
  };

  setInterval(runCycle, intervalMs);
  runCycle();

  console.log(`Polling every ${Math.max(5, intervalSeconds)} seconds.`);
};
