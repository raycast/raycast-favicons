import { parse } from "cache-control-parser";
import { OutgoingHttpHeaders } from "http";
import { APIError } from "./error";

const oneDay = 24 * 60 * 60 * 1000;

export function cacheExpiryFromResponse(response: Response) {
  const now = new Date();

  const cacheControl = response.headers.get("cache-control");
  if (cacheControl != null) {
    const directives = parse(cacheControl);
    const maxAge = directives["s-maxage"] || directives["max-age"];
    if (maxAge != null) {
      return new Date(now.getTime() + maxAge * 1000);
    }
  }

  const expires = response.headers.get("expires");
  if (expires != null) {
    try {
      return new Date(expires);
    } catch {}
  }

  return null;
}

export function minimumExpiryDate(date: Date) {
  const now = new Date();
  const minimumTimestamp = now.getTime() + oneDay;

  if (date.getTime() < minimumTimestamp) {
    return new Date(minimumTimestamp);
  } else {
    return date;
  }
}

export function responseHeaders({
  size,
  expiry,
}: {
  size?: number;
  expiry: Date;
}): OutgoingHttpHeaders {
  const now = new Date();
  const delta = Math.max(expiry.getTime() - now.getTime(), 0);
  const maxAge = Math.ceil(delta / 1000);

  return {
    "Content-Disposition": "inline",
    ...(size != null ? { "Content-Length": size.toFixed(0) } : {}),
    "Cache-Control": `public, max-age=${maxAge}`,
  };
}

export function errorResponse(error: APIError) {
  return {
    json: { code: error.code, message: error.message },
    status: error.status,
  };
}
