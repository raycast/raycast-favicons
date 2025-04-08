import cors from "cors";
import "dotenv/config";
import express from "express";
import { getFavicon } from "./api/favicon";
import logger from "./lib/logger";
import { connectServices } from "./lib/services";

const app = express();
const port = process.env.PORT || 3000;

logger.info(`Starting in environment ${process.env.NODE_ENV}...`);

app.use(cors());

const services = connectServices();

app.get("/favicon", async (req, res) => {
  await getFavicon(req, res, services);
});

app.listen(port, () => {
  logger.info(`Listening at http://localhost:${port}`);
});
