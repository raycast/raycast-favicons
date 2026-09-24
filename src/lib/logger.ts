import winston from "winston";

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transports: [
    new winston.transports.Console({
      // Plain JSON lines outside development: container logs go to CloudWatch (and on
      // to New Relic), where ANSI colour codes are noise.
      format:
        process.env.NODE_ENV === "development"
          ? winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
          : winston.format.combine(
              winston.format.timestamp(),
              winston.format.json()
            ),
    }),
  ],
});

export default logger;
