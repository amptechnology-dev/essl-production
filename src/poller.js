import Zkteco from "zkteco-js";
import os from "node:os";
import { loadConfig } from "./config.js";
import { pushLogs } from "./pusher.js";
import { saveBackup, deleteBackup, loadBackup } from "./storage.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeAttendances = (result) => {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
};

const toLogKey = (log) => {
  const user = log?.uid ?? log?.userId ?? log?.deviceUserId ?? "unknown";
  const stamp =
    log?.recordTime ?? log?.timestamp ?? log?.time ?? log?.date ?? "unknown";
  const state = log?.state ?? log?.status ?? log?.type ?? "unknown";
  return `${user}|${stamp}|${state}`;
};

const dedupeLogs = (logs) => {
  const seen = new Map();
  for (const log of logs) {
    if (!log || typeof log !== "object") continue;
    seen.set(toLogKey(log), log);
  }
  return [...seen.values()];
};

const safeErrorMessage = (err) => {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err?.message) return err.message;
  if (err?.err?.message) return err.err.message;
  return JSON.stringify(err);
};

const isTimeoutLikeError = (err) => {
  const text = `${safeErrorMessage(err)} ${JSON.stringify(err)}`.toUpperCase();
  return text.includes("TIMEOUT") || text.includes("ETIMEDOUT");
};

const createDevice = (config) =>
  new Zkteco(
    config.DEVICE_IP,
    Number(config.DEVICE_PORT),
    Number(config.DEVICE_TIMEOUT_MS) || 30000,
    Number(config.DEVICE_INPORT) || 5200
  );

const getLocalIPv4s = () => {
  const nets = os.networkInterfaces();
  const ips = new Set();

  for (const name of Object.keys(nets)) {
    for (const item of nets[name] || []) {
      if (item.family === "IPv4" && !item.internal) {
        ips.add(item.address);
      }
    }
  }

  return ips;
};

const buildCandidateIps = (config) => {
  const candidates = new Set();
  const primary = String(config.DEVICE_IP || "").trim();
  if (primary) candidates.add(primary);

  const alternateList = String(config.DEVICE_IP_ALTERNATES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  for (const ip of alternateList) {
    candidates.add(ip);
  }

  const match = primary.match(/^(\d+\.\d+\.\d+)\.(\d+)$/);
  if (match) {
    const base = match[1];
    const lastOctet = Number(match[2]);
    if (lastOctet === 200) candidates.add(`${base}.201`);
    if (lastOctet === 201) candidates.add(`${base}.200`);
  }

  return [...candidates];
};

const connectByMode = async (device, mode) => {
  if (mode === "tcp") {
    await device.ztcp.createSocket();
    await device.ztcp.connect();
    device.connectionType = "tcp";
    return;
  }

  if (mode === "udp") {
    await device.zudp.createSocket();
    await device.zudp.connect();
    device.connectionType = "udp";
    return;
  }

  await device.createSocket();
};

const connectAndReadAttendances = async (device, mode) => {
  await connectByMode(device, mode);
  await sleep(250);

  try {
    await device.disableDevice();
  } catch {
    // Some devices do not allow disable and still return logs.
  }

  const logs = normalizeAttendances(await device.getAttendances());

  try {
    await device.enableDevice();
  } catch {
    // Ignore cleanup failure.
  }

  return logs;
};

const pullWithRetry = async (config, retries = 3) => {
  const preferredMode = String(config.DEVICE_CONNECTION_MODE || "tcp").toLowerCase();
  const modeOrder =
    preferredMode === "udp"
      ? ["udp", "tcp", "auto"]
      : preferredMode === "auto"
        ? ["tcp", "auto"]
        : ["tcp", "auto"];
  const candidateIps = buildCandidateIps(config);
  let bestLogs = [];
  let lastError = null;

  console.log(`Candidate device IPs: ${candidateIps.join(", ")}`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    for (const ip of candidateIps) {
      for (const mode of modeOrder) {
        const deviceConfig = { ...config, DEVICE_IP: ip };
        const device = createDevice(deviceConfig);
        try {
          console.log(`Connecting to biometric device (attempt ${attempt}/${retries}, ip=${ip}, mode=${mode})...`);
          const logs = await connectAndReadAttendances(device, mode);
          console.log(`Read success (ip=${ip}, mode=${mode}, logs=${logs.length})`);

          if (logs.length > bestLogs.length) {
            bestLogs = logs;
          }
          if (logs.length > 0) {
            return logs;
          }
        } catch (err) {
          lastError = err;
          console.error(`Attempt ${attempt} (ip=${ip}, mode=${mode}) failed: ${safeErrorMessage(err)}`);
          if (mode === "auto" && !isTimeoutLikeError(err)) {
            break;
          }
        } finally {
          try {
            await device.disconnect();
          } catch {
            // Ignore disconnect failure.
          }
        }
      }
    }

    if (attempt < retries) {
      await sleep(1500 * attempt);
    }
  }

  if (bestLogs.length > 0) {
    return bestLogs;
  }

  if (lastError) {
    throw lastError;
  }

  return [];
};

export const pollAndPushLogs = async () => {
  const config = await loadConfig();
  if (!config.DEVICE_IP || !config.DEVICE_PORT) {
    console.error("Device IP or Port not configured.");
    return [];
  }

  console.log(
    `Device config => SN=${config.DEVICE_SN}, IP=${config.DEVICE_IP}, PORT=${config.DEVICE_PORT}, MODE=${config.DEVICE_CONNECTION_MODE || "tcp"}`
  );

  const localIps = getLocalIPv4s();
  if (localIps.has(String(config.DEVICE_IP))) {
    console.warn(
      `IP conflict detected: configured device IP ${config.DEVICE_IP} matches this PC network adapter IP. Please set a different IP on device or config.`
    );
  }

  try {
    const pulledLogs = await pullWithRetry(config, 3);
    const backupLogs = await loadBackup();
    const mergedLogs = dedupeLogs([...backupLogs, ...pulledLogs]);

    console.log(`Total logs pulled: ${pulledLogs.length}`);
    console.log(`Total pending for push: ${mergedLogs.length}`);

    if (pulledLogs.length > 0) {
      const preview = Math.min(3, pulledLogs.length);
      console.log(`Sample logs (${preview}/${pulledLogs.length}):`);
      for (let i = 0; i < preview; i++) {
        console.log(JSON.stringify(pulledLogs[i]));
      }
    }

    if (mergedLogs.length === 0) {
      console.log("No attendance data found on device in this cycle.");
      return [];
    }

    await saveBackup(mergedLogs);
    const success = await pushLogs(mergedLogs);

    if (success) {
      await deleteBackup();
      console.log("Push successful. Backup cleared.");

      if (String(config.CLEAR_DEVICE_LOGS_AFTER_PUSH || "true").toLowerCase() === "true") {
        const cleanDevice = createDevice(config);
        try {
          await connectByMode(cleanDevice, String(config.DEVICE_CONNECTION_MODE || "tcp").toLowerCase());
          await cleanDevice.clearAttendanceLog();
          console.log("Attendance logs cleared from device.");
        } catch (clearErr) {
          console.warn(`Could not clear device logs: ${safeErrorMessage(clearErr)}`);
        } finally {
          try {
            await cleanDevice.disconnect();
          } catch {
            // Ignore disconnect failure.
          }
        }
      }
    } else {
      console.log("Push failed. Backup retained for next retry.");
    }

    return mergedLogs;
  } catch (error) {
    console.error("Device polling error:", safeErrorMessage(error));
    return [];
  }
};

export const testDeviceConnection = async () => {
  const config = await loadConfig();
  if (!config.DEVICE_IP || !config.DEVICE_PORT) {
    throw new Error("Device IP or Port not configured");
  }

  const preferredMode = String(config.DEVICE_CONNECTION_MODE || "tcp").toLowerCase();
  const modeOrder =
    preferredMode === "udp"
      ? ["udp", "tcp", "auto"]
      : preferredMode === "auto"
        ? ["tcp", "auto"]
        : ["tcp", "auto"];
  const candidateIps = buildCandidateIps(config);

  let lastError = null;
  for (const ip of candidateIps) {
    for (const mode of modeOrder) {
      const device = createDevice({ ...config, DEVICE_IP: ip });
      try {
        await connectByMode(device, mode);
        return { mode, ip, port: config.DEVICE_PORT, sn: config.DEVICE_SN || "N/A" };
      } catch (err) {
        lastError = err;
      } finally {
        try {
          await device.disconnect();
        } catch {
          // Ignore disconnect failure.
        }
      }
    }
  }

  throw new Error(safeErrorMessage(lastError));
};