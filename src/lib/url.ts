import net from "net";
import { ParsedDomain, ParseError, parse as parseHost } from "psl";

export function makeURLWithoutThrowing(urlString: string, base?: string | URL) {
  try {
    return new URL(urlString, base);
  } catch {
    return null;
  }
}

export function parseURL(urlString: string) {
  if (!urlString.match(/^[A-z]+:\/\//)) {
    urlString = `https://${urlString}`;
  }

  // Upgrade http to https
  if (urlString.startsWith("http://")) {
    urlString = urlString.replace("http://", "https://");
  }

  return new URL(urlString);
}

export function obfuscateURL(url: URL) {
  const pathComponents = url.pathname.split("/");
  const obfuscatedComponents = pathComponents.map((component) =>
    component.length <= 6 ? component : "***"
  );
  const obfuscatedPath = obfuscatedComponents.join("/");
  return `${url.protocol}//${url.host}${obfuscatedPath}`;
}

export function isValidURL(url: URL) {
  if (url.protocol.toLowerCase() !== "https:") {
    return false;
  }

  const host = url.host.split(":")[0].toLowerCase();
  if (host == null) {
    return false;
  }

  if (net.isIP(host) !== 0) {
    return false;
  }

  // Disallowing http should be enough but also block localhost to be safe.
  if (host === "localhost") {
    return false;
  }

  // If a port is specified only allow 443 for https.
  if (url.port.length > 0 && url.port !== "443") {
    return false;
  }

  return true;
}

export function isRelativeURL(string: string) {
  return string.match(/^([A-z]+:)?\/\//) == null;
}

export function isBase64DataURL(string: string) {
  // Use basic pattern for MIME type.
  return string.match(/^data:([a-zA-Z]+\/[a-zA-Z0-9\-+.]+);base64,/) != null;
}

export function parseBase64DataURL(url: URL) {
  const components = url.toString().split(",");
  if (components.length !== 2) {
    return null;
  }

  const match = components[0].match(
    /^data:([a-zA-Z]+\/[a-zA-Z0-9\-+.]+);base64/
  );
  const mimeType = (match || [])[1];
  if (match == null || mimeType == null || mimeType.length == 0) {
    return null;
  }

  return { base64: components[1], type: mimeType };
}

export function faviconURL(baseURL: URL) {
  const url = baseURL;
  url.pathname = "/favicon.ico";
  return url;
}

function getTLD(host: string) {
  const parsed = parseHost(host);
  if (parsed == null || isParseError(parsed)) {
    return null;
  }

  return parsed.tld;
}

function isParseError(result: ParsedDomain | ParseError): result is ParseError {
  return (result as ParseError).error !== undefined;
}

export function baseURLs(url: URL, maximumSubdomains: number) {
  const host = url.host;
  const tld = getTLD(host);
  const suffix = tld != null ? `.${tld}` : null;

  if (suffix == null || !host.endsWith(suffix)) {
    const baseURL = url;
    url.pathname = "";
    return [baseURL];
  }

  const domainWithoutTLD = host.slice(0, -suffix.length);
  const domainComponents = domainWithoutTLD
    .split(".")
    .filter((component) => component.length > 0);

  const urls = [];

  for (var i = 0; i < domainComponents.length; i++) {
    const subdomain = domainComponents
      .slice(i, domainComponents.length)
      .join(".");
    const host = `${subdomain}.${tld}`;
    const baseURL = makeURLWithoutThrowing(`${url.protocol}//${host}`);
    if (baseURL != null) {
      urls.push(baseURL);
    }
  }

  return urls.slice(0, Math.max(maximumSubdomains, 1));
}

export function resolvedURLsFromRelative(url: string, baseURL: URL) {
  if (!isRelativeURL(url)) {
    return [new URL(url)];
  }

  const pathComponents = baseURL.pathname.replace(/^\//, "").split("/");
  if (!url.startsWith("/") && pathComponents.length > 1) {
    return [new URL(url, baseURL), new URL(`/${url}`, baseURL)];
  }

  return [new URL(url, baseURL)];
}
