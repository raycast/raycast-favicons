import { describe, expect, it } from "@jest/globals";
import { guardedConnector, isPrivateAddress } from "../network";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254",
    "169.254.170.2",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "172.32.0.1",
    "13.227.192.28",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("guardedConnector", () => {
  it.each(["169.254.169.254", "127.0.0.1", "[::1]", "10.0.0.5"])(
    "refuses IP-literal destination %s without connecting",
    async (hostname) => {
      const connect = guardedConnector();
      const error = await new Promise<Error | null>((resolve) => {
        connect(
          { hostname, host: hostname, protocol: "http:", port: "80" } as any,
          ((err: Error | null) => resolve(err)) as any
        );
      });
      expect(error?.message).toMatch(/non-public address/);
    }
  );
});
