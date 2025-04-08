import { mockFetch, mockReadableStream } from "@/lib/mocks";
import { firstValueFrom } from "rxjs";
import { iconsFromManifest$ } from "../manifest";

describe("Manifest parsing", () => {
  test("manifest with missing icons array throws error", async () => {
    const manifest = `{}`;

    mockFetch(jest, {
      "https://example.com/manifest.json": () => ({
        headers: new Headers({ "content-type": "application/json" }),
        body: mockReadableStream(manifest),
      }),
    });

    const icons$ = iconsFromManifest$(
      new URL("https://example.com/manifest.json")
    );
    expect(async () => {
      await firstValueFrom(icons$);
    }).rejects.toThrow();
  });

  test("manifest with invalid icons key throws error", async () => {
    const manifest = `{
      "icons": 5
    }`;

    mockFetch(jest, {
      "https://example.com/manifest.json": () => ({
        headers: new Headers({ "content-type": "application/json" }),
        body: mockReadableStream(manifest),
      }),
    });

    const icons$ = iconsFromManifest$(
      new URL("https://example.com/manifest.json")
    );
    expect(async () => {
      await firstValueFrom(icons$);
    }).rejects.toThrow();
  });

  test("manifest with single icon is parsed correctly", async () => {
    const manifest = `{
      "icons": [
        { "src": "/android-chrome-192x192.png" }
      ]
    }`;

    mockFetch(jest, {
      "https://example.com/manifest.json": () => ({
        headers: new Headers({ "content-type": "application/json" }),
        body: mockReadableStream(manifest),
      }),
    });

    const icons$ = iconsFromManifest$(
      new URL("https://example.com/manifest.json")
    );

    const icons = await firstValueFrom(icons$);
    expect(icons).toEqual([
      {
        source: "manifest",
        href: "/android-chrome-192x192.png",
        url: new URL("https://example.com/android-chrome-192x192.png"),
      },
    ]);
  });

  test("manifest with multiple icons are parsed correctly", async () => {
    const manifest = `{
      "icons": [
        { "src": "/android-chrome-192x192.png" },
        { "src": "/android-chrome-256x256.png" }
      ]
    }`;

    mockFetch(jest, {
      "https://example.com/manifest.json": () => ({
        headers: new Headers({ "content-type": "application/json" }),
        body: mockReadableStream(manifest),
      }),
    });

    const icons$ = iconsFromManifest$(
      new URL("https://example.com/manifest.json")
    );

    const icons = await firstValueFrom(icons$);
    expect(icons).toEqual([
      {
        source: "manifest",
        href: "/android-chrome-192x192.png",
        url: new URL("https://example.com/android-chrome-192x192.png"),
      },
      {
        source: "manifest",
        href: "/android-chrome-256x256.png",
        url: new URL("https://example.com/android-chrome-256x256.png"),
      },
    ]);
  });

  test("manifest with icons with single sizes are parsed correctly", async () => {
    const manifest = `{
      "icons": [
        { "src": "/android-chrome-192x192.png", "sizes": "192x192" },
        { "src": "/android-chrome-256x256.png", "sizes": "256x256" }
      ]
    }`;

    mockFetch(jest, {
      "https://example.com/manifest.json": () => ({
        headers: new Headers({ "content-type": "application/json" }),
        body: mockReadableStream(manifest),
      }),
    });

    const icons$ = iconsFromManifest$(
      new URL("https://example.com/manifest.json")
    );

    const icons = await firstValueFrom(icons$);
    expect(icons).toEqual([
      {
        source: "manifest",
        href: "/android-chrome-192x192.png",
        url: new URL("https://example.com/android-chrome-192x192.png"),
        size: {
          type: "single",
          width: 192,
          height: 192,
        },
      },
      {
        source: "manifest",
        href: "/android-chrome-256x256.png",
        url: new URL("https://example.com/android-chrome-256x256.png"),
        size: {
          type: "single",
          width: 256,
          height: 256,
        },
      },
    ]);
  });

  test("manifest with icons with multiple sizes are parsed correctly", async () => {
    const manifest = `{
      "icons": [
        { "src": "/favicon.ico", "sizes": "16x16 32x32 64x64" },
        { "src": "/android-chrome-256x256.png", "sizes": "256x256" }
      ]
    }`;

    mockFetch(jest, {
      "https://example.com/manifest.json": () => ({
        headers: new Headers({ "content-type": "application/json" }),
        body: mockReadableStream(manifest),
      }),
    });

    const icons$ = iconsFromManifest$(
      new URL("https://example.com/manifest.json")
    );

    const icons = await firstValueFrom(icons$);
    expect(icons).toEqual([
      {
        source: "manifest",
        href: "/favicon.ico",
        url: new URL("https://example.com/favicon.ico"),
        size: {
          type: "multiple",
          sizes: [
            { width: 16, height: 16 },
            { width: 32, height: 32 },
            { width: 64, height: 64 },
          ],
        },
      },
      {
        source: "manifest",
        href: "/android-chrome-256x256.png",
        url: new URL("https://example.com/android-chrome-256x256.png"),
        size: {
          type: "single",
          width: 256,
          height: 256,
        },
      },
    ]);
  });

  test("manifest with individual icon type error doesn't affect parsing of other icons", async () => {
    // E.g. for invalid 'src' tag in first icon
    const manifest = `{
      "icons": [
        { "sr": "/favicon.ico", "sizes": "16x16 32x32 64x64" },
        { "src": "/android-chrome-256x256.png", "sizes": "256x256" }
      ]
    }`;

    mockFetch(jest, {
      "https://example.com/manifest.json": () => ({
        headers: new Headers({ "content-type": "application/json" }),
        body: mockReadableStream(manifest),
      }),
    });

    const icons$ = iconsFromManifest$(
      new URL("https://example.com/manifest.json")
    );

    const icons = await firstValueFrom(icons$);
    expect(icons).toEqual([
      {
        source: "manifest",
        href: "/android-chrome-256x256.png",
        url: new URL("https://example.com/android-chrome-256x256.png"),
        size: {
          type: "single",
          width: 256,
          height: 256,
        },
      },
    ]);
  });
});
