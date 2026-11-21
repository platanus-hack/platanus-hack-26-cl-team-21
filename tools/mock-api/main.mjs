import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockApi } from "./server.mjs";

const port = Number(process.env.PORT ?? 4010);
const dataDir = process.env.MOCK_API_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".data");
const processingDelayMs = Number(process.env.MOCK_API_PROCESSING_DELAY_MS ?? 3000);

const lanAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => `http://${address.address}:${port}`);

createMockApi({ dataDir, processingDelayMs }).listen(port, "0.0.0.0", () => {
  console.log(`Mock API listening on http://localhost:${port} ${lanAddresses.join(" ")}`);
  console.log(`Saving uploaded files under ${dataDir}`);
});
