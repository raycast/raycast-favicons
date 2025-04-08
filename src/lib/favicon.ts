import { combineLatest, Observable, of } from "rxjs";
import { catchError, map, share, switchMap } from "rxjs/operators";
// Import node's definition since we won't be using this on the client.
import {
  DevicePixelRatioParam,
  IconSource,
  ManifestIconSource,
  ReferenceIconSource,
  SizeParam,
} from "@/lib/types";
import { fetchFirstValidImage$, fetchHTMLPage$ } from "./fetch";
import { iconsFromManifest$ } from "./manifest";
import { metadataFromHTMLPage$ } from "./metadata";
import { bestReferencedIcon } from "./rank";
import { cacheExpiryFromResponse, minimumExpiryDate } from "./response";
import { isReferencedIcon, isSameReferencedIcon } from "./source";
import { Icon } from "./types";
import {
  baseURLs,
  faviconURL,
  isRelativeURL,
  makeURLWithoutThrowing,
  obfuscateURL,
  parseBase64DataURL,
  resolvedURLsFromRelative,
} from "./url";

export interface IconLoadResult {
  icon: Icon | null;
  foundIcons: IconSource[];
}

// Load /favicon.ico for a given URL. This also loads /favicon.ico for any higher-level
// domains, e.g. for https://docs.google.com it will load https://docs.google.com/favicon.ico
// and https://google.com/favicon.ico.
//
// If favicons exist at multiple subdomains, precedence is given to the deepest subdomain
// (e.g. in the example above, https://docs.google.com/favicon.ico will take precedence over
// https://docs.google.com/favicon.ico)
export function loadFaviconIco$(baseURL: URL): Observable<IconLoadResult> {
  const faviconURLs = baseURLs(baseURL, 3).map(faviconURL);

  return of(faviconURLs).pipe(
    switchMap((faviconURLs) => fetchFirstValidImage$(faviconURLs)),
    map(({ image, url }): IconLoadResult => {
      return {
        icon: {
          image,
          source: { source: "favicon.ico", url },
        },
        foundIcons: faviconURLs.map((url) => ({
          source: "favicon.ico",
          url,
        })),
      };
    }),
    catchError((error: Error) => {
      return of({ icon: null, foundIcons: [] });
    })
  );
}

export function loadFaviconFromHTMLPage$(
  url: URL,
  size: SizeParam,
  dpr: DevicePixelRatioParam
): Observable<IconLoadResult> {
  const result$ = of(url).pipe(
    switchMap((url) => fetchHTMLPage$(url)),
    switchMap((response) => {
      return of(response).pipe(
        switchMap((response) => {
          if (response.body == null) {
            throw new Error("Missing response body");
          }

          const pageExpiry = minimumExpiryDate(
            cacheExpiryFromResponse(response) || new Date()
          );

          // Use the URL from the response to handle any redirects.
          const baseURL = new URL(response.url);

          return combineLatest([
            metadataFromHTMLPage$(response.body, baseURL),
            of(baseURL),
            of(pageExpiry),
          ]);
        }),
        map(([metadata, baseURL, pageExpiry]) => ({
          metadata,
          baseURL,
          pageURL: makeURLWithoutThrowing(response.url) || url,
          pageExpiry,
        }))
      );
    }),
    share()
  );

  const metadata$ = result$.pipe(map(({ metadata }) => metadata));
  const manifestIcons$ = metadata$.pipe(
    switchMap(({ manifestURL }) => {
      if (manifestURL == null) {
        throw new Error("Missing manifest URL");
      }

      return iconsFromManifest$(manifestURL);
    }),
    catchError((error: Error) => {
      return of([] as ManifestIconSource[]);
    })
  );

  return combineLatest([result$, manifestIcons$]).pipe(
    map(([result, manifestIcons]) => {
      const { metadata, baseURL, pageURL, pageExpiry } = result;
      const { linkIcons } = metadata;
      const icon = bestReferencedIcon(
        [...linkIcons, ...manifestIcons],
        size,
        dpr
      );

      if (icon == null) {
        throw new Error(`No icon found for page ${obfuscateURL(url)}`);
      } else {
        return {
          icon,
          linkIcons,
          manifestIcons,
          baseURL,
          pageURL,
          pageExpiry,
        };
      }
    }),
    switchMap(
      ({ icon, linkIcons, manifestIcons, baseURL, pageURL, pageExpiry }) => {
        if (icon.source === "link" && icon.data) {
          const parsed = parseBase64DataURL(icon.url);
          if (parsed == null) {
            throw new Error("Invalid icon data");
          }

          const { base64, type } = parsed;
          const buffer = Buffer.from(base64, "base64");
          const blob = new Blob([buffer], { type });

          return of({
            icon: {
              image: {
                source: pageURL,
                blob,
                expiry: pageExpiry,
              },
              source: icon,
            },
            foundIcons: [...linkIcons, ...manifestIcons],
          });
        }

        const urls = flexibleRelativeIconSourceURLs(icon, baseURL);
        return fetchFirstValidImage$(urls).pipe(
          map(({ url, image }): IconLoadResult => {
            return {
              icon: {
                image: {
                  ...image,
                  expiry: pageExpiry,
                },
                source: {
                  ...icon,
                  // Ensure we replace `url` here as this may be different to the
                  // original URL we are given.
                  url,
                },
              },
              // And here
              foundIcons: rewriteIconURLs(
                [...linkIcons, ...manifestIcons],
                icon,
                url
              ),
            };
          })
        );
      }
    ),
    catchError((error: Error) => {
      return of({ icon: null, foundIcons: [] });
    })
  );
}

// Gives us potential icon source URLs where sites incorrectly reference URLs relatively
// (e.g. if "favicon.png" is specified where it should be "/favicon.png")
function flexibleRelativeIconSourceURLs(icon: IconSource, baseURL: URL) {
  if (isReferencedIcon(icon) && isRelativeURL(icon.href)) {
    return resolvedURLsFromRelative(icon.href, baseURL);
  }

  return [icon.url];
}

// Rewrites the URLs for `icon` in `icons` with `url`
function rewriteIconURLs(icons: IconSource[], icon: IconSource, url: URL) {
  return icons.map((source) => {
    if (!isReferencedIcon(source) || !isReferencedIcon(icon)) {
      return source;
    }

    if (isSameReferencedIcon(source, icon)) {
      return {
        ...source,
        url,
      };
    }

    return source;
  });
}

export function smallestIconDimension(source: ReferenceIconSource) {
  const { size } = source;
  if (size == null) {
    return null;
  }

  switch (size.type) {
    case "any":
      return null;
    case "single":
      const { width, height } = size;
      return Math.min(width, height);
    case "multiple":
      const { sizes } = size;
      return sizes.reduce((smallest, { width, height }) => {
        const minDimension = Math.min(width, height);
        if (smallest == null) {
          return minDimension;
        }
        return Math.min(smallest, minDimension);
      }, null as null | number);
  }
}
