import { mockFetch, mockReadableStream, testImageData } from "@/lib/mocks";
import { firstValueFrom } from "rxjs";
import { loadFaviconFromHTMLPage$, loadFaviconIco$ } from "../favicon";

describe("Loading favicons from favicon.ico", () => {
  test("successful favicon.ico fetch returns result", async () => {
    mockFetch(jest, {
      "https://example.com/favicon.ico": () => ({
        headers: new Headers({ "content-type": "image/x-icon" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = loadFaviconIco$(new URL("https://example.com"));
    const result = await firstValueFrom(image$);

    expect(result.icon).toBeTruthy();
    expect(result.icon!.image.source.toString()).toEqual(
      "https://example.com/favicon.ico"
    );
    expect(result.icon!.image.blob.size).toEqual(5);
    expect(result.icon!.image.blob.type).toEqual("image/x-icon");
  });

  test("invalid favicon.ico content type returns null", async () => {
    mockFetch(jest, {
      "https://example.com/favicon.ico": () => ({
        headers: new Headers({ "content-type": "text/html" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = loadFaviconIco$(new URL("https://example.com"));
    const result = await firstValueFrom(image$);

    expect(result.icon).toBe(null);
  });

  test("favicon.ico fetch uses higher-level subdomain on failure", async () => {
    mockFetch(jest, {
      "https://google.com/favicon.ico": () => ({
        headers: new Headers({ "content-type": "image/x-icon" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = loadFaviconIco$(new URL("https://docs.google.com"));
    const result = await firstValueFrom(image$);

    expect(result.icon).toBeTruthy();
    expect(result.icon!.image.source.toString()).toEqual(
      "https://google.com/favicon.ico"
    );
    expect(result.icon!.image.blob.size).toEqual(5);
    expect(result.icon!.image.blob.type).toEqual("image/x-icon");
  });

  test("favicon.ico fetch from multiple subdomains prefers outermost host", async () => {
    mockFetch(jest, {
      "https://docs.google.com/favicon.ico": () => ({
        headers: new Headers({ "content-type": "image/x-icon" }),
        body: mockReadableStream(testImageData),
      }),
      "https://google.com/favicon.ico": () => ({
        headers: new Headers({ "content-type": "image/x-icon" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = loadFaviconIco$(new URL("https://docs.google.com"));
    const result = await firstValueFrom(image$);

    expect(result.icon).toBeTruthy();
    expect(result.icon!.image.source.toString()).toEqual(
      "https://docs.google.com/favicon.ico"
    );
    expect(result.icon!.image.blob.size).toEqual(5);
    expect(result.icon!.image.blob.type).toEqual("image/x-icon");
  });

  test("favicon.ico fetch only fetches up to 3 subdomains deep", async () => {
    const mockResponse = {
      headers: new Headers({ "content-type": "image/x-icon" }),
      body: mockReadableStream(testImageData),
    };

    mockFetch(jest, {
      "https://d.com/favicon.ico": () => mockResponse,
    });

    const image$ = loadFaviconIco$(new URL("https://a.b.c.d.com"));
    const result = await firstValueFrom(image$);

    expect(result.icon).toBeFalsy();
  });
});

describe("Loading favicons from HTML page", () => {
  test("finds single <link /> icon", async () => {
    const page = `
    <html>
    <head>
      <link rel="icon" href="/favicon.ico" />
    </head>
    </html>
    <head>
    `;

    mockFetch(jest, {
      "https://example.com/": () => ({
        headers: new Headers({ "content-type": "text/html" }),
        body: mockReadableStream(page),
        url: "https://example.com/",
      }),
      "https://example.com/favicon.ico": () => ({
        headers: new Headers({ "content-type": "image/x-icon" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = loadFaviconFromHTMLPage$(
      new URL("https://example.com"),
      "favicon",
      1
    );
    const result = await firstValueFrom(image$);

    expect(result.icon).toBeTruthy();
    expect(result.icon!.image.source).toEqual(
      new URL("https://example.com/favicon.ico")
    );
    expect(result.icon!.image.blob.size).toEqual(5);
    expect(result.icon!.source).toEqual({
      source: "link",
      type: "icon",
      href: "/favicon.ico",
      url: new URL("https://example.com/favicon.ico"),
    });
    expect(result.foundIcons).toEqual([
      {
        source: "link",
        type: "icon",
        href: "/favicon.ico",
        url: new URL("https://example.com/favicon.ico"),
      },
    ]);
  });

  test("finds multiple <link /> icon", async () => {
    const page = `
    <html>
    <head>
      <link rel="icon" href="/favicon.ico" />
      <link rel="shortcut icon" href="/favicon.ico" />
    </head>
    </html>
    <head>
    `;

    mockFetch(jest, {
      "https://example.com/": () => ({
        headers: new Headers({ "content-type": "text/html" }),
        body: mockReadableStream(page),
        url: "https://example.com/",
      }),
      "https://example.com/favicon.ico": () => ({
        headers: new Headers({ "content-type": "image/x-icon" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = loadFaviconFromHTMLPage$(
      new URL("https://example.com"),
      "favicon",
      1
    );
    const result = await firstValueFrom(image$);

    expect(result.icon).toBeTruthy();
    expect(result.icon!.image.source).toEqual(
      new URL("https://example.com/favicon.ico")
    );
    expect(result.icon!.image.blob.size).toEqual(5);
    expect(result.icon!.source).toEqual({
      source: "link",
      type: "icon",
      href: "/favicon.ico",
      url: new URL("https://example.com/favicon.ico"),
    });
    expect(result.foundIcons).toEqual([
      {
        source: "link",
        type: "icon",
        href: "/favicon.ico",
        url: new URL("https://example.com/favicon.ico"),
      },
      {
        source: "link",
        type: "shortcut icon",
        href: "/favicon.ico",
        url: new URL("https://example.com/favicon.ico"),
      },
    ]);
  });

  // Test case for https://www.thesaurus.com/browse/Word which references relative URL incorrectly.
  test("uses flexible relative URLs for icons referenced in HTML", async () => {
    const page = `
    <html>
    <head>
      <link rel="icon" href="favicon.ico" />
    </head>
    </html>
    <head>
    `;

    mockFetch(jest, {
      "https://example.com/some/path": () => ({
        headers: new Headers({ "content-type": "text/html" }),
        body: mockReadableStream(page),
        url: "https://example.com/some/path",
      }),
      "https://example.com/favicon.ico": () => ({
        headers: new Headers({ "content-type": "image/x-icon" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = loadFaviconFromHTMLPage$(
      new URL("https://example.com/some/path"),
      "favicon",
      1
    );
    const result = await firstValueFrom(image$);

    expect(result.icon).toBeTruthy();
    expect(result.icon!.image.source).toEqual(
      new URL("https://example.com/favicon.ico")
    );
    expect(result.icon!.image.blob.size).toEqual(5);
    expect(result.icon!.source).toEqual({
      href: "favicon.ico",
      source: "link",
      type: "icon",
      url: new URL("https://example.com/favicon.ico"),
    });
    expect(result.foundIcons).toEqual([
      {
        source: "link",
        type: "icon",
        href: "favicon.ico",
        url: new URL("https://example.com/favicon.ico"),
      },
    ]);
  });

  // Test case for https://www.bt.com/sport/watch/live-now/bt-sport-1 which redirects.
  test("uses correct base URL when HTML page redirects", async () => {
    const page = `
    <html>
    <head>
      <link rel="icon" href="/favicon.ico" />
    </head>
    </html>
    <head>
    `;

    mockFetch(jest, {
      "https://example.com/": () => ({
        headers: new Headers({ "content-type": "text/html" }),
        body: mockReadableStream(page),
        url: "https://redirected.example.com/",
      }),
      "https://redirected.example.com/favicon.ico": () => ({
        headers: new Headers({ "content-type": "image/x-icon" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = loadFaviconFromHTMLPage$(
      new URL("https://example.com"),
      "favicon",
      1
    );
    const result = await firstValueFrom(image$);

    expect(result.icon).toBeTruthy();
    expect(result.icon!.image.source).toEqual(
      new URL("https://redirected.example.com/favicon.ico")
    );
    expect(result.icon!.image.blob.size).toEqual(5);
    expect(result.icon!.source).toEqual({
      source: "link",
      type: "icon",
      href: "/favicon.ico",
      url: new URL("https://redirected.example.com/favicon.ico"),
    });
    expect(result.foundIcons).toEqual([
      {
        source: "link",
        type: "icon",
        href: "/favicon.ico",
        url: new URL("https://redirected.example.com/favicon.ico"),
      },
    ]);
  });

  test("uses base64-encoded image referenced in page", async () => {
    const page = `
    <html>
    <head>
      <link rel="icon" sizes="32x32" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABEVBMVEVHcEz///////////////////////////////////////////////////8AGziAjZtgcIKgqrT/JW+/xs3/BFmcC0vf4+b/DV//Dl//GWb/GWf/M3i+B08jGDyJDUh1EEZ1D0Zvf4+gqbSfqbSvuMD/3+r/v9X/oMD/IWz/MXb/U43/gq0gOFH/h7D/aZzv8fL6IWuufZr/GGfti68NGTo0Fj4TGTrwF2OYDEsjFz0MGjnAB1AIGjl+Dkc+FEBME0H/MnitCU2JDUl5D0b3LXLrIGidC0s1FT8zFj6uCk3/UY30SITfNXPlK22KDkn2OntgEUP/QYIVGTpgEkNCFUD/QoKWGVPRO3RfEUNBFT/kS4MXVO28AAAADXRSTlMAn2Cg78+Q3yAQMI9fslpvQQAAAUBJREFUOMuFk2dDwyAQhklCaGhL1IwO7XLvvWfV1r33+P8/REwiHCS270fugTvu3kNIiJqGjRnDtlGkKC2H8KCQ4WhhWmCaCur1HEspBx7JZ8Q5kdfu+6ODUj54g8bxARdqKHoj/k1cX8lNA3GlTpxxPAtgv0ksBjPUj9qbWxIgvAIGgIPXz+ZpuLMrAEyRCYGvl1YjPKntbyyUkmPzL0MEPD82379vHror68ui58gGwGXr/uP6acQbXhLdshEGwEUjvH3j8fKcADBiAKifX90de9VKMC0brgBup3bmVcvBDJiIksLdO9xeqwSzkwykgEVyrS7OT8GR2so3ZQeltdRGpYEiorgnwAdOegGGHHc2EHmK/A8QYLkE8BXbUmDaicirY9nG72f7/ovD6yB6nOgL7FggiomTsd/UtJL1N8HtHzDFNkJWpxq9AAAAAElFTkSuQmCC" />
    </head>
    </html>
    <head>
    `;

    mockFetch(jest, {
      "https://example.com/": () => ({
        headers: new Headers({ "content-type": "text/html" }),
        body: mockReadableStream(page),
        url: "https://example.com/",
      }),
    });

    const image$ = loadFaviconFromHTMLPage$(
      new URL("https://example.com"),
      "32",
      1
    );
    const result = await firstValueFrom(image$);

    expect(result.icon).toBeTruthy();
    expect(result.icon!.image.source).toEqual(new URL("https://example.com"));
    expect(result.icon!.image.blob.size).toEqual(687);
    expect(result.icon!.source).toEqual({
      source: "link",
      type: "icon",
      href: "",
      data: true,
      url: new URL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABEVBMVEVHcEz///////////////////////////////////////////////////8AGziAjZtgcIKgqrT/JW+/xs3/BFmcC0vf4+b/DV//Dl//GWb/GWf/M3i+B08jGDyJDUh1EEZ1D0Zvf4+gqbSfqbSvuMD/3+r/v9X/oMD/IWz/MXb/U43/gq0gOFH/h7D/aZzv8fL6IWuufZr/GGfti68NGTo0Fj4TGTrwF2OYDEsjFz0MGjnAB1AIGjl+Dkc+FEBME0H/MnitCU2JDUl5D0b3LXLrIGidC0s1FT8zFj6uCk3/UY30SITfNXPlK22KDkn2OntgEUP/QYIVGTpgEkNCFUD/QoKWGVPRO3RfEUNBFT/kS4MXVO28AAAADXRSTlMAn2Cg78+Q3yAQMI9fslpvQQAAAUBJREFUOMuFk2dDwyAQhklCaGhL1IwO7XLvvWfV1r33+P8/REwiHCS270fugTvu3kNIiJqGjRnDtlGkKC2H8KCQ4WhhWmCaCur1HEspBx7JZ8Q5kdfu+6ODUj54g8bxARdqKHoj/k1cX8lNA3GlTpxxPAtgv0ksBjPUj9qbWxIgvAIGgIPXz+ZpuLMrAEyRCYGvl1YjPKntbyyUkmPzL0MEPD82379vHror68ui58gGwGXr/uP6acQbXhLdshEGwEUjvH3j8fKcADBiAKifX90de9VKMC0brgBup3bmVcvBDJiIksLdO9xeqwSzkwykgEVyrS7OT8GR2so3ZQeltdRGpYEiorgnwAdOegGGHHc2EHmK/A8QYLkE8BXbUmDaicirY9nG72f7/ovD6yB6nOgL7FggiomTsd/UtJL1N8HtHzDFNkJWpxq9AAAAAElFTkSuQmCC"
      ),
      size: {
        type: "single",
        width: 32,
        height: 32,
      },
    });
    expect(result.foundIcons).toEqual([
      {
        source: "link",
        type: "icon",
        href: "",
        data: true,
        url: new URL(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABEVBMVEVHcEz///////////////////////////////////////////////////8AGziAjZtgcIKgqrT/JW+/xs3/BFmcC0vf4+b/DV//Dl//GWb/GWf/M3i+B08jGDyJDUh1EEZ1D0Zvf4+gqbSfqbSvuMD/3+r/v9X/oMD/IWz/MXb/U43/gq0gOFH/h7D/aZzv8fL6IWuufZr/GGfti68NGTo0Fj4TGTrwF2OYDEsjFz0MGjnAB1AIGjl+Dkc+FEBME0H/MnitCU2JDUl5D0b3LXLrIGidC0s1FT8zFj6uCk3/UY30SITfNXPlK22KDkn2OntgEUP/QYIVGTpgEkNCFUD/QoKWGVPRO3RfEUNBFT/kS4MXVO28AAAADXRSTlMAn2Cg78+Q3yAQMI9fslpvQQAAAUBJREFUOMuFk2dDwyAQhklCaGhL1IwO7XLvvWfV1r33+P8/REwiHCS270fugTvu3kNIiJqGjRnDtlGkKC2H8KCQ4WhhWmCaCur1HEspBx7JZ8Q5kdfu+6ODUj54g8bxARdqKHoj/k1cX8lNA3GlTpxxPAtgv0ksBjPUj9qbWxIgvAIGgIPXz+ZpuLMrAEyRCYGvl1YjPKntbyyUkmPzL0MEPD82379vHror68ui58gGwGXr/uP6acQbXhLdshEGwEUjvH3j8fKcADBiAKifX90de9VKMC0brgBup3bmVcvBDJiIksLdO9xeqwSzkwykgEVyrS7OT8GR2so3ZQeltdRGpYEiorgnwAdOegGGHHc2EHmK/A8QYLkE8BXbUmDaicirY9nG72f7/ovD6yB6nOgL7FggiomTsd/UtJL1N8HtHzDFNkJWpxq9AAAAAElFTkSuQmCC"
        ),
        size: {
          type: "single",
          width: 32,
          height: 32,
        },
      },
    ]);
  });
});
