import { describe, expect, it } from "@jest/globals";
import { rotatingDispatcher } from "../network";

class FakeDispatcher {
  closed = false;
  constructor(public id: number) {}
  async close() {
    this.closed = true;
  }
}

describe("rotatingDispatcher", () => {
  it("installs a fresh dispatcher and closes the previous one on each rotation", async () => {
    let n = 0;
    const installed: FakeDispatcher[] = [];
    const rotation = rotatingDispatcher(
      () => new FakeDispatcher(++n),
      (d) => installed.push(d),
      1_000_000
    );
    rotation.rotate();
    rotation.rotate();
    rotation.stop();
    await Promise.resolve();

    expect(installed.map((d) => d.id)).toEqual([1, 2, 3]);
    expect(installed.map((d) => d.closed)).toEqual([true, true, false]);
    expect(rotation.current().id).toBe(3);
  });

  it("rotates on its timer", async () => {
    let n = 0;
    const rotation = rotatingDispatcher(() => new FakeDispatcher(++n), () => {}, 20);
    await new Promise((resolve) => setTimeout(resolve, 75));
    rotation.stop();
    expect(rotation.current().id).toBeGreaterThanOrEqual(3);
  });
});
