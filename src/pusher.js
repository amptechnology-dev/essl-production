import axios from "axios";
import { loadConfig } from "./config.js";

export const pushLogs = async (logs) => {
  const { DEVICE_SN, API_URL, API_KEY, OFFICE_ID } = await loadConfig();

  try {
    const response = await axios.post(
      API_URL,
      {
        officeId: OFFICE_ID,
        deviceSn: DEVICE_SN,
        logs,
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
      }
    );

    if (response.status === 200) {
      console.log(
        "Logs pushed successfully. Accepted:",
        response.data?.data?.length
      );
      return true;
    } else {
      console.error("Push failed with status:", response.status);
      return false;
    }
  } catch (err) {
    console.error("Error pushing logs:", err.message);
    return false;
  }
};
