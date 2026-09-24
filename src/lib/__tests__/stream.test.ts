import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { firstValueFrom, timeout } from "rxjs";
import { read$ } from "../stream";

// A stream whose read() never resolves: like a slow site that stops sending mid-body.
function stalledStream() {
  return new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
}

describe("read$", () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  it("does not leave an unhandled rejection when unsubscribed during a pending read", async () => {
    const subscription = read$(stalledStream(), 1024).subscribe({ error: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    subscription.unsubscribe(); // what rxjs timeout()/switchMap do to an in-flight fetch
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unhandled).toEqual([]);
  });

  it("errors (not crashes) when a timeout cancels a stalled read", async () => {
    await expect(firstValueFrom(read$(stalledStream(), 1024).pipe(timeout(20)))).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unhandled).toEqual([]);
  });

  it("still reads a complete body", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4]));
        controller.close();
      },
    });
    const chunks: number[] = [];
    await new Promise<void>((resolve, reject) =>
      read$(stream, 1024).subscribe({ next: (c) => chunks.push(...c), error: reject, complete: resolve })
    );
    expect(chunks).toEqual([1, 2, 3, 4]);
  });

  it("errors when the byte limit is exceeded", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
      },
    });
    await expect(firstValueFrom(read$(stream, 5))).rejects.toThrow(/Maximum size limit/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unhandled).toEqual([]);
  });
});
