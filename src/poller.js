import ZKLib from "node-zklib";
import { loadConfig } from "./config.js";
import { pushLogs } from "./pusher.js";
import { saveBackup, deleteBackup } from "./storage.js";

export const pollAndPushLogs = async () => {
  const { DEVICE_SN, DEVICE_IP, DEVICE_PORT } = await loadConfig();
  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, 30 * 1000, 80);

  try {
    await zk.createSocket();
    const sl_no = await zk.getSerialNumber();
    if (sl_no?.replace(/\u0000/g, "").trim() !== DEVICE_SN) {
      console.error("Device serial number mismatch.");
      return zk.disconnect();
    }
    // Handeling edge case where decvice has no logs.
    if ((await zk.getAttendanceSize()) < 1) {
      console.log("No logs found on device.");
      return zk.disconnect();
    }
    const logs = await zk.getAttendances();
    const logData = logs?.data || [];
    if (logData.length < 1) {
      console.log("No logs found on device.");
      return zk.disconnect();
    }
    console.log(`${logData.length} logs pulled.`);

    // Backup logs before push
    saveBackup(logData);

    const success = await pushLogs(logData);
    if (success) {
      console.log("Deleting logs from device...");
      await zk.clearAttendanceLog();
      deleteBackup();
      console.log("Logs deleted from device.");
    } else {
      console.log("Push failed. Logs remain on device and backup retained.");
    }
    await zk.disconnect();
  } catch (error) {
    console.error("Error during device polling:", error);
  }
};
