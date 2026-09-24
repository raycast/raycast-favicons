import cors from "cors";
import "dotenv/config";
import express from "express";
import { getFavicon } from "./api/favicon";
import logger from "./lib/logger";
import { installOutboundFetchGuard } from "./lib/network";
import { connectServices } from "./lib/services";

const app = express();
const port = process.env.PORT || 3000;

logger.info(`Starting in environment ${process.env.NODE_ENV}...`);

// Every fetch of a user-supplied URL goes through this guard (see lib/network.ts).
installOutboundFetchGuard();

app.use(cors());

// Dependency-free liveness route for the load balancer health check.
app.get("/up", (_req, res) => {
  res.status(200).json({ status: "up" });
});

const services = connectServices();

app.get("/favicon", async (req, res) => {
  await getFavicon(req, res, services);
});

app.listen(port, () => {
  logger.info(`Listening at http://localhost:${port}`);
});
