import { fetchImage$ } from "@/lib/fetch";
import { mockFetch, mockReadableStream, testImageData } from "@/lib/mocks";
import { firstValueFrom } from "rxjs";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Image fetch", () => {
  test("successful fetch returns result", async () => {
    mockFetch(jest, {
      "https://example.com/image.png": () => ({
        headers: new Headers({ "content-type": "image/png" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = fetchImage$(new URL("https://example.com/image.png"));
    const result = await firstValueFrom(image$);

    expect(result.source.toString()).toEqual("https://example.com/image.png");

    expect(result.source.toString()).toEqual("https://example.com/image.png");
    expect(result.blob.size).toEqual(5);
    expect(result.blob.type).toEqual("image/png");
  });

  test("fetch with invalid content type throws error", async () => {
    mockFetch(jest, {
      "https://example.com/image.png": () => ({
        headers: new Headers({ "content-type": "text/html" }),
        body: mockReadableStream(testImageData),
      }),
    });

    const image$ = fetchImage$(new URL("https://example.com/image.png"));
    expect(async () => {
      await firstValueFrom(image$);
    }).rejects.toThrow();
  });

  test("fetch with failure throws error", async () => {
    mockFetch(jest, {
      "https://example.com/image.png": () => {
        throw new Error();
      },
    });

    const image$ = fetchImage$(new URL("https://example.com/image.png"));
    expect(async () => {
      await firstValueFrom(image$);
    }).rejects.toThrow();
  });
});
