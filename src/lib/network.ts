import dns from "dns";
import net from "net";
import { Agent, buildConnector, setGlobalDispatcher } from "undici";

// Outbound fetch guard.
//
// The service fetches arbitrary user-supplied URLs. `isValidURL` rejects IP literals and
// `localhost`, but a hostname can still resolve to a private address, and a public site
// can redirect to one. On AWS the service runs inside our VPC, next to other services'
// Redis and databases, so every connection made by `fetch` is checked at DNS resolution
// time instead: the global undici dispatcher (used by Node's built-in fetch) gets a
// lookup that refuses loopback, private, link-local (including the ECS/EC2 metadata
// endpoints) and other non-public ranges. Because the check runs on the address actually
// connected to, it also covers redirects and DNS rebinding. IP-literal destinations
// (e.g. a redirect to http://169.254.169.254/) skip DNS entirely, so the connector checks
// those itself before connecting.
//
// Only `fetch` is affected: the AWS SDK and ioredis use their own sockets.

const blockedIPv4Ranges: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 and 169.254.170.2
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
];

const blockedIPv6Ranges: Array<[string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 (maps to IPv4, possibly private)
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

const blockList = new net.BlockList();
for (const [address, prefix] of blockedIPv4Ranges) {
  blockList.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of blockedIPv6Ranges) {
  blockList.addSubnet(address, prefix, "ipv6");
}

function ipv4MappedAddress(address: string): string | null {
  const match = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}

export function isPrivateAddress(address: string): boolean {
  const mapped = ipv4MappedAddress(address);
  if (mapped != null) {
    return isPrivateAddress(mapped);
  }

  const family = net.isIP(address);
  if (family === 4) {
    return blockList.check(address, "ipv4");
  }
  if (family === 6) {
    return blockList.check(address, "ipv6");
  }

  // Not an IP address at all: refuse rather than guess.
  return true;
}

// Node's typings declare the `all: true` form (what happy-eyeballs connects use);
// callers without `all` expect (error, address, family), so both are answered below.
type SingleAddressCallback = (
  error: NodeJS.ErrnoException | null,
  address: string,
  family: number
) => void;

export class BlockedAddressError extends Error {
  code = "EBLOCKEDADDRESS";

  constructor(hostname: string, address: string) {
    super(`Refusing to connect to ${hostname}: resolves to non-public address ${address}`);
  }
}

// Same contract as dns.lookup, as used by net.connect: callers may ask for a single
// address or, with `all: true` (Node's happy-eyeballs connect does), for all of them.
export const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  const wantsAll = (options as dns.LookupOptions).all === true;
  const respondError = (error: NodeJS.ErrnoException) =>
    wantsAll ? callback(error, []) : (callback as unknown as SingleAddressCallback)(error, "", 0);

  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      respondError(error);
      return;
    }

    const blocked = addresses.find(({ address }) => isPrivateAddress(address));
    if (blocked != null) {
      respondError(new BlockedAddressError(hostname, blocked.address));
      return;
    }

    if (addresses.length === 0) {
      const notFound: NodeJS.ErrnoException = new Error(`No addresses for ${hostname}`);
      notFound.code = "ENOTFOUND";
      respondError(notFound);
      return;
    }

    if (wantsAll) {
      callback(null, addresses);
    } else {
      (callback as unknown as SingleAddressCallback)(null, addresses[0].address, addresses[0].family);
    }
  });
};

export function guardedConnector(): buildConnector.connector {
  const connect = buildConnector({ lookup: safeLookup });
  return (options, callback) => {
    const hostname = options.hostname.replace(/^\[(.*)\]$/, "$1");
    if (net.isIP(hostname) !== 0 && isPrivateAddress(hostname)) {
      callback(new BlockedAddressError(hostname, hostname), null);
      return;
    }
    return connect(options, callback);
  };
}

// undici's Agent keeps one connection pool per origin in an internal map and only empties
// that map in close()/destroy(): idle origins are never evicted. This service fetches
// thousands of distinct hosts an hour, so the map (and heap) grows until the process
// runs out of memory -- every few hours on ECS. On Heroku, pm2's max_memory_restart hid
// it. The dispatcher is therefore replaced on a timer: new requests go to a fresh Agent,
// and the previous one is closed gracefully (in-flight requests finish first, then its
// pools are released). Memory stays bounded by roughly one interval's worth of origins.
export const DISPATCHER_ROTATION_MS = 60_000;

export interface Closable {
  close(): Promise<void>;
}

export function rotatingDispatcher<T extends Closable>(
  create: () => T,
  install: (dispatcher: T) => void,
  intervalMs: number = DISPATCHER_ROTATION_MS
) {
  let current = create();
  install(current);

  const rotate = () => {
    const previous = current;
    current = create();
    install(current);
    previous.close().catch(() => {});
  };

  const timer = setInterval(rotate, intervalMs);
  timer.unref();

  return {
    current: () => current,
    rotate,
    stop: () => clearInterval(timer),
  };
}

export function installOutboundFetchGuard(intervalMs: number = DISPATCHER_ROTATION_MS) {
  return rotatingDispatcher(
    () => new Agent({ connect: guardedConnector() }),
    (agent) => setGlobalDispatcher(agent),
    intervalMs
  );
}
