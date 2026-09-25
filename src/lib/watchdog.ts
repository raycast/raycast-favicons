import v8 from "v8";
import logger from "./logger";

// Memory watchdog: a safety net for leaks, replacing what pm2's max_memory_restart did on
// Heroku. When the V8 heap passes `thresholdRatio` of its limit, the process reports
// itself unhealthy (GET /up answers 503) so the load balancer stops sending it new
// requests and ECS starts a replacement, waits `drainMs` for in-flight requests to finish,
// then exits cleanly. Without it, a leak ends in "JavaScript heap out of memory" and every
// in-flight request on the task fails.

export type WatchdogOptions = {
  thresholdRatio: number;
  checkIntervalMs: number;
  drainMs: number;
  heapStats?: () => { used: number; limit: number };
  onExit?: () => void;
};

export function startMemoryWatchdog(options: WatchdogOptions) {
  const heapStats =
    options.heapStats ??
    (() => {
      const stats = v8.getHeapStatistics();
      return { used: stats.used_heap_size, limit: stats.heap_size_limit };
    });
  const onExit = options.onExit ?? (() => process.exit(0));
  let draining = false;

  const check = () => {
    if (draining) {
      return;
    }
    const { used, limit } = heapStats();
    if (used / limit < options.thresholdRatio) {
      return;
    }
    draining = true;
    logger.warn("Memory watchdog: heap above threshold, draining before restart", {
      heapUsedMB: Math.round(used / 1e6),
      heapLimitMB: Math.round(limit / 1e6),
      thresholdRatio: options.thresholdRatio,
      drainMs: options.drainMs,
    });
    const exitTimer = setTimeout(onExit, options.drainMs);
    exitTimer.unref?.();
  };

  const timer = setInterval(check, options.checkIntervalMs);
  timer.unref();

  return {
    isDraining: () => draining,
    check,
    stop: () => clearInterval(timer),
  };
}

export function watchdogOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): WatchdogOptions {
  const number = (name: string, fallback: number) => {
    const value = parseFloat(env[name] ?? "");
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    thresholdRatio: number("RAYCAST_MEMORY_WATCHDOG_RATIO", 0.75),
    checkIntervalMs: number("RAYCAST_MEMORY_WATCHDOG_INTERVAL_MS", 15_000),
    // Long enough for the ALB to see /up fail (health check interval x unhealthy
    // threshold) and for in-flight lookups (5s fetch timeout) to finish.
    drainMs: number("RAYCAST_MEMORY_WATCHDOG_DRAIN_MS", 60_000),
  };
}
