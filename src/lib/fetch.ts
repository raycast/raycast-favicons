import { Observable, of } from "rxjs";
import { fromFetch } from "rxjs/fetch";
import {
  catchError,
  filter,
  map,
  mergeMap,
  reduce,
  scan,
  switchMap,
  timeout,
} from "rxjs/operators";

import { isHTMLContentType, isImageContentType } from "@/lib/contentType";
import { cacheExpiryFromResponse, minimumExpiryDate } from "./response";
import { read$ } from "./stream";
import { IconImage } from "./types";

export const imageByteLimit = 1024 * 1024;
export const pageByteLimit = 2 * 1024 * 1024;
const defaultTimeoutMs = 5000;

function fetchTimeout() {
  const timeoutMs = parseInt(process.env["RAYCAST_FETCH_TIMEOUT_MS"] || "");
  if (isNaN(timeoutMs)) {
    return defaultTimeoutMs;
  }

  return timeoutMs;
}

namespace BatchImageLoad {
  export type ImageResult = { type: "image"; url: URL; image: IconImage };
  export type ErrorResult = { type: "error"; error: Error };
  export type LoadingResult = { type: "loading" };
  export type EmptyResult = { type: "none" };

  export type FetchState = Array<ImageResult | ErrorResult | LoadingResult>;
}

// Load multiple images in order of precedence and return the first which returns
// a valid result.
export function fetchFirstValidImage$(
  imageURLs: URL[]
): Observable<{ image: IconImage; url: URL }> {
  const urlsWithPrecedence = imageURLs.map((url, index) => ({
    url,
    precedence: index,
  }));

  return of(...urlsWithPrecedence).pipe(
    // Fetch all of the image URLs in parallel
    mergeMap(({ url, precedence }) => {
      return fetchImage$(url).pipe(
        map(
          (image): BatchImageLoad.ImageResult => ({ type: "image", url, image })
        ),
        catchError((error): Observable<BatchImageLoad.ErrorResult> => {
          return of({ type: "error", error: error as Error });
        }),
        map((result) => ({ result, precedence }))
      );
    }),

    // Scan the results into an array of `imageURLs` length that contains null (no result),
    // the returned IconImage value, or the Error returned from loading the image.
    scan((acc, { result, precedence }) => {
      acc[precedence] = result;
      return acc;
    }, new Array(imageURLs.length).fill({ type: "loading" }) as BatchImageLoad.FetchState),

    // Find the first successful result
    map((results: BatchImageLoad.FetchState) => {
      for (const result of results) {
        switch (result.type) {
          // Ignore leading null values as we want to return the highest-precedence image.
          case "loading":
            return { type: "loading" };
          case "image":
            const { url, image } = result;
            return { type: "image", url, image };
          case "error":
            break;
        }
      }

      return { type: "none" };
    }),

    // // Don't emit values while we're loading.
    filter(
      (
        result
      ): result is BatchImageLoad.ImageResult | BatchImageLoad.EmptyResult =>
        result.type !== "loading"
    ),

    // Return the final result.
    map((result) => {
      switch (result.type) {
        case "image":
          return { image: result.image, url: result.url };
        case "none":
          throw new Error(
            `No valid image found from ${JSON.stringify(
              urlsWithPrecedence.map(({ url }) => url)
            )}`
          );
      }
    })
  );
}

export function fetchImage$(imageURL: URL): Observable<IconImage> {
  return fromFetch(imageURL.toString()).pipe(
    switchMap((response) => {
      const contentType = response.headers.get("content-type");
      const expiry = minimumExpiryDate(
        cacheExpiryFromResponse(response) || new Date()
      );

      if (contentType == null || !isImageContentType(contentType)) {
        throw new Error(`Invalid content type ${contentType}`);
      }

      if (response.body == null) {
        throw new Error("Missing response body");
      }

      return read$(response.body, imageByteLimit).pipe(
        reduce((acc, chunk) => [...acc, chunk], new Array<Uint8Array>()),
        map((chunks) => ({
          source: imageURL,
          blob: new Blob(chunks, { type: contentType }),
          expiry,
        }))
      );
    }),
    timeout(fetchTimeout())
  );
}

export function fetchHTMLPage$(url: URL) {
  return of(url).pipe(
    switchMap((url) =>
      fromFetch(url.toString(), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
        },
      })
    ),
    map((response) => {
      const contentType = response.headers.get("content-type");
      if (contentType == null || !isHTMLContentType(contentType)) {
        throw new Error(`Invalid content type ${contentType}`);
      }

      return response;
    }),
    timeout(fetchTimeout())
  );
}

export function fetchManifest$(url: URL) {
  return fromFetch(url.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    },
  }).pipe(timeout(fetchTimeout()));
}
