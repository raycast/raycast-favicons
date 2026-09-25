import { describe, expect, it } from "@jest/globals";
import { startMemoryWatchdog, watchdogOptionsFromEnv } from "../watchdog";

describe("startMemoryWatchdog", () => {
  it("stays healthy below the threshold", () => {
    let exited = false;
    const watchdog = startMemoryWatchdog({
      thresholdRatio: 0.75,
      checkIntervalMs: 1_000_000,
      drainMs: 10,
      heapStats: () => ({ used: 50, limit: 100 }),
      onExit: () => (exited = true),
    });
    watchdog.check();
    watchdog.stop();
    expect(watchdog.isDraining()).toBe(false);
    expect(exited).toBe(false);
  });

  it("drains, then exits once, when the heap passes the threshold", async () => {
    let exits = 0;
    let used = 50;
    const watchdog = startMemoryWatchdog({
      thresholdRatio: 0.75,
      checkIntervalMs: 1_000_000,
      drainMs: 20,
      heapStats: () => ({ used, limit: 100 }),
      onExit: () => exits++,
    });
    used = 80;
    watchdog.check();
    watchdog.check();
    expect(watchdog.isDraining()).toBe(true);
    expect(exits).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    watchdog.stop();
    expect(exits).toBe(1);
  });
});

describe("watchdogOptionsFromEnv", () => {
  it("uses defaults and accepts overrides", () => {
    expect(watchdogOptionsFromEnv({})).toEqual({ thresholdRatio: 0.75, checkIntervalMs: 15000, drainMs: 60000 });
    expect(
      watchdogOptionsFromEnv({ RAYCAST_MEMORY_WATCHDOG_RATIO: "0.6", RAYCAST_MEMORY_WATCHDOG_DRAIN_MS: "abc" })
    ).toEqual({ thresholdRatio: 0.6, checkIntervalMs: 15000, drainMs: 60000 });
  });
});
