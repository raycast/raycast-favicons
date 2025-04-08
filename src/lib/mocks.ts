export const testImageData = new Uint8Array([72, 101, 108, 108, 111]);

type FetchMock = (
  input: RequestInfo | URL,
  init?: RequestInit | undefined
) => Partial<Response>;
type FetchResponses = Record<string, FetchMock>;

export function mockFetch(
  jestInstance: typeof jest,
  mock: FetchMock | FetchResponses
) {
  jestInstance.spyOn(global, "fetch").mockImplementation(
    jestInstance.fn(
      (input: RequestInfo | URL, init?: RequestInit | undefined) => {
        const url = toURL(input);

        try {
          if (typeof mock === "function") {
            return Promise.resolve(mock(input, init));
          } else {
            const fn = mock[url.toString()];
            if (fn == null) {
              return Promise.reject(
                `Missing mock response for ${url.toString()}`
              );
            }
            return Promise.resolve(fn(input, init));
          }
        } catch (error) {
          return Promise.reject(error);
        }
      }
    ) as jest.Mock
  );
}

export function mockReadableStream(data: Uint8Array | string) {
  return new ReadableStream({
    start(controller) {
      if (data instanceof Uint8Array) {
        controller.enqueue(data);
      } else {
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(data);
        controller.enqueue(uint8Array);
      }
      controller.close();
    },
  });
}

function toURL(input: RequestInfo | URL) {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === "string") {
    return new URL(input);
  }

  return new URL(input.url);
}
