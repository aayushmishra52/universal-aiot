import { startServer } from "./server.js";

const handles = await startServer();

console.log(
  `[backend] ready: http=${handles.httpUrl} mqtt=127.0.0.1:${handles.mqttPort} ws=127.0.0.1:${handles.wsPort}`,
);

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[backend] received ${signal}, shutting down`);
  try {
    await handles.stop();
  } catch (err) {
    console.error("[backend] shutdown error:", (err as Error)?.message ?? err);
  }
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
