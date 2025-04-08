import {
  baseURLs,
  isRelativeURL,
  isValidURL,
  obfuscateURL,
  parseURL,
  resolvedURLsFromRelative,
} from "@/lib/url";
import { describe, expect, test } from "@jest/globals";

describe("URL parsing", () => {
  test("URL with http is upgraded to https", () => {
    expect(parseURL("http://google.com")?.toString()).toBe(
      new URL("https://google.com").toString()
    );
  });

  test("URL without protocol is parsed to https", () => {
    expect(parseURL("google.com")?.toString()).toBe(
      new URL("https://google.com").toString()
    );
  });
});

describe("URL obfuscation", () => {
  test("simple URLs are not obfuscated", async () => {
    const url = new URL("https://google.com");
    expect(await obfuscateURL(url)).toBe("https://google.com/");
  });

  test("simple components aren't obfuscated", async () => {
    const url = new URL("https://google.com/a/b/c");
    expect(await obfuscateURL(url)).toBe("https://google.com/a/b/c");
  });

  test("longer components are obfuscated", async () => {
    const url = new URL("https://google.com/something-sensitive");
    expect(await obfuscateURL(url)).toBe("https://google.com/***");
  });
});

describe("URL validation", () => {
  test("URL with http protocol is invalid", () => {
    const url = new URL("http://google.com");
    expect(isValidURL(url)).toBe(false);
  });

  test("https://localhost is invalid", () => {
    const url = new URL("https://localhost");
    expect(isValidURL(url)).toBe(false);
  });

  test("https://localhost:80 is invalid", () => {
    const url = new URL("https://localhost:80");
    expect(isValidURL(url)).toBe(false);
  });

  test("https://127.0.0.1 is invalid", () => {
    const url = new URL("https://127.0.0.1");
    expect(isValidURL(url)).toBe(false);
  });

  test("https://127.0.0.1:80 is invalid", () => {
    const url = new URL("https://127.0.0.1:80");
    expect(isValidURL(url)).toBe(false);
  });

  test("https://172.16.0.0 is invalid", () => {
    const url = new URL("https://172.16.0.0");
    expect(isValidURL(url)).toBe(false);
  });

  test("https://192.168.1.0 is invalid", () => {
    const url = new URL("https://192.168.1.0");
    expect(isValidURL(url)).toBe(false);
  });

  test("https://127.0.0.1 is invalid", () => {
    const url = new URL("https://127.0.0.1");
    expect(isValidURL(url)).toBe(false);
  });

  test("Non-443 port is invalid", () => {
    const url = new URL("https://1.2.3.4:22");
    expect(isValidURL(url)).toBe(false);
  });

  test("URL with port 443 specified is valid", () => {
    const url = new URL("https://google.com:443");
    expect(isValidURL(url)).toBe(true);
  });
});

describe("relative URLs", () => {
  test("absolute URL is not relative", () => {
    expect(isRelativeURL("https://google.com")).toBe(false);
  });

  test("scheme-relative URL is not relative", () => {
    expect(isRelativeURL("//google.com")).toBe(false);
  });

  test("URL with trailing slash is relative", () => {
    expect(isRelativeURL("/image.png")).toBe(true);
  });

  test("URL without trailing slash is relative", () => {
    expect(isRelativeURL("image.png")).toBe(true);
  });

  test("resolved relative URL which is actually absolute", () => {
    const url = new URL("https://example.com/");
    const urlStrings = resolvedURLsFromRelative(
      "https://example2.com/image.png",
      url
    ).map((url) => url.toString());
    expect(urlStrings).toEqual(["https://example2.com/image.png"]);
  });

  test("resolved relative URL with no preceding slash and top-level base", () => {
    const url = new URL("https://example.com/");
    const urlStrings = resolvedURLsFromRelative("image.png", url).map((url) =>
      url.toString()
    );
    expect(urlStrings).toEqual(["https://example.com/image.png"]);
  });

  test("resolved relative URL with no preceding slash and top-level base path", () => {
    const url = new URL("https://example.com/123");
    const urlStrings = resolvedURLsFromRelative("image.png", url).map((url) =>
      url.toString()
    );
    expect(urlStrings).toEqual(["https://example.com/image.png"]);
  });

  test("resolved relative URL with no preceding slash and subdirectory-level base", () => {
    const url = new URL("https://example.com/path/");
    const urlStrings = resolvedURLsFromRelative("image.png", url).map((url) =>
      url.toString()
    );
    expect(urlStrings).toEqual([
      "https://example.com/path/image.png",
      "https://example.com/image.png",
    ]);
  });

  test("resolved relative URL with preceding slash and top-level base", () => {
    const url = new URL("https://example.com/");
    const urlStrings = resolvedURLsFromRelative("/image.png", url).map((url) =>
      url.toString()
    );
    expect(urlStrings).toEqual(["https://example.com/image.png"]);
  });

  test("resolved relative URL with preceding slash and subdirectory-level base", () => {
    const url = new URL("https://example.com/path/");
    const urlStrings = resolvedURLsFromRelative("/image.png", url).map((url) =>
      url.toString()
    );
    expect(urlStrings).toEqual(["https://example.com/image.png"]);
  });
});

describe("URL utilities", () => {
  test("base URLs for single-level domain", () => {
    const url = new URL("https://google.com");
    const urlStrings = baseURLs(url, 3).map((url) => url.toString());
    expect(urlStrings).toEqual(["https://google.com/"]);
  });

  test("base URLs for two-level domain", () => {
    const url = new URL("https://docs.google.com");
    const urlStrings = baseURLs(url, 3).map((url) => url.toString());
    expect(urlStrings).toEqual([
      "https://docs.google.com/",
      "https://google.com/",
    ]);
  });

  test("base URLs for N-level domain", () => {
    const url = new URL("https://a.b.example.com");
    const urlStrings = baseURLs(url, 3).map((url) => url.toString());
    expect(urlStrings).toEqual([
      "https://a.b.example.com/",
      "https://b.example.com/",
      "https://example.com/",
    ]);
  });

  test("base URLs are capped with parameter", () => {
    const url = new URL("https://a.b.example.com");
    const urlStrings = baseURLs(url, 2).map((url) => url.toString());
    expect(urlStrings).toEqual([
      "https://a.b.example.com/",
      "https://b.example.com/",
    ]);
  });
});
