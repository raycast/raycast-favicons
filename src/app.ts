import cors from "cors";
import "dotenv/config";
import express from "express";
import { getFavicon } from "./api/favicon";
import logger from "./lib/logger";
import { installOutboundFetchGuard } from "./lib/network";
import { connectServices } from "./lib/services";
import { startMemoryWatchdog, watchdogOptionsFromEnv } from "./lib/watchdog";

const app = express();
const port = process.env.PORT || 3000;

logger.info(`Starting in environment ${process.env.NODE_ENV}...`);

// Last line of defence: log a stray rejected promise instead of letting Node exit on
// it. Under pm2 (Heroku) a crash was restarted in a second and went unnoticed; on ECS
// it takes the task and its in-flight requests down.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    error: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason),
  });
});

// Every fetch of a user-supplied URL goes through this guard (see lib/network.ts).
installOutboundFetchGuard();

app.use(cors());

const watchdog = startMemoryWatchdog(watchdogOptionsFromEnv());

// Liveness route for the load balancer health check. Reports 503 while the memory
// watchdog drains the process, so the ALB stops routing to it before it exits.
app.get("/up", (_req, res) => {
  if (watchdog.isDraining()) {
    res.status(503).json({ status: "draining" });
    return;
  }
  res.status(200).json({ status: "up" });
});

const services = connectServices();

app.get("/favicon", async (req, res) => {
  await getFavicon(req, res, services);
});

app.listen(port, () => {
  logger.info(`Listening at http://localhost:${port}`);
});
