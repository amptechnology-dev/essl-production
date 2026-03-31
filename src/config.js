const CONFIG_FILE = "./config.json";

export const loadConfig = async () => {
  const file = Bun.file(CONFIG_FILE);
  return JSON.parse(await file.text());
};

export const saveConfig = async (newConfig) => {
  await Bun.write(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
};
