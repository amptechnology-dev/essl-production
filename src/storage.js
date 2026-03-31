const backupFile = "./logs/backupLogs.json";

export const saveBackup = async (logs) => {
  await Bun.write(backupFile, JSON.stringify(logs, null, 2));
};

export const loadBackup = async () => {
  const file = Bun.file(backupFile);
  if (!(await file.exists())) return [];
  const raw = (await file.text()).trim();
  if (!raw) return [];
  return JSON.parse(raw);
};

export const deleteBackup = async () => {
  try {
    await Bun.file(backupFile).delete();
  } catch (error) {
    console.log("Error deleting backup:", error);
  }
};
