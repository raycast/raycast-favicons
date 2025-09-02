import { cacheFavicon, getCachedImage, setMetadataPartial } from "@/lib/cache";
import { APIError, makeInternalError } from "@/lib/error";
import {
  IconLoadResult,
  loadFaviconFromHTMLPage$,
  loadFaviconIco$,
} from "@/lib/favicon";
import { processImageForTheme } from "@/lib/imageProcessing";
import { bestResult } from "@/lib/rank";
import { errorResponse, responseHeaders } from "@/lib/response";
import {
  DevicePixelRatioParam,
  Icon,
  IconMetadata,
  IconSource,
  Services,
  SizeParam,
  ThemeParam,
  allSizes,
} from "@/lib/types";
import { isValidURL, parseURL } from "@/lib/url";
import { Request, Response } from "express";
import {
  Observable,
  combineLatest,
  firstValueFrom,
  from,
  merge,
  of,
  partition,
} from "rxjs";
import { catchError, map, share, switchMap, tap } from "rxjs/operators";

export async function getFavicon(
  req: Request,
  res: Response,
  services: Services,
) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { redis } = services;
  const defer = () => {};

  const urlParam$ = getURLParam$(url);
  const sizeParam$ = getSizeParam$(url);
  const dprParam$ = getDevicePixelRatioParam$(url);
  const themeParam$ = getThemeParam$(url);
  const validatedURL$ = urlParam$.pipe(switchMap(parsedAndValidatedURL$));
  const params$ = combineLatest([
    urlParam$,
    validatedURL$,
    sizeParam$,
    dprParam$,
    themeParam$,
  ]).pipe(
    map(([urlParam, validatedURL, size, dpr, theme]) => ({
      url: validatedURL,
      urlParam,
      size,
      dpr: dpr || 1,
      theme,
    })),
  );

  const cachedImage$ = params$.pipe(
    switchMap(({ url, size, dpr, theme }) => {
      const key = { url, size, dpr, theme };
      // Skip cache in development if Redis is not available
      if (process.env.NODE_ENV === "development" && !redis) {
        return of(null);
      }
      return from(getCachedImage(key, redis));
    }),
    share(),
  );

  const [cached$, uncached$] = partition(
    cachedImage$,
    (cachedImage): cachedImage is IconMetadata => cachedImage != null,
  );

  const response$ = merge(
    combineLatest([cached$, params$]).pipe(
      switchMap(([cachedImage, params]) =>
        cachedFaviconResponse$(params, cachedImage, services, defer),
      ),
      tap(({ expiry, objectKey }) => {
        const faviconHost = process.env.RAYCAST_FAVICON_HOST;
        if (objectKey == null || faviconHost == null) {
          throw makeInternalError();
        } else {
          res.set(responseHeaders({ expiry }));
          res.redirect(`https://${faviconHost}/${objectKey}`);
        }
      }),
    ),
    combineLatest([uncached$, params$]).pipe(
      switchMap(([_, params]) =>
        combineLatest([
          of(params),
          uncachedFaviconResponse$(params, services, defer),
        ]),
      ),
      tap(async ([{ size, dpr, url, theme }, result]) => {
        if (result.found) {
          const { blob, expiry } = result;
          res.type(blob.type);
          const buffer = await blob.arrayBuffer();
          res.set(responseHeaders({ size: blob.size, expiry }));
          res.send(Buffer.from(buffer));
        } else {
          res.status(404).send("Not found");
        }
      }),
    ),
  );

  try {
    await firstValueFrom(response$);
  } catch (error) {
    if (error instanceof APIError) {
      const { status, json } = errorResponse(error);
      res.status(status).json(json);
    } else {
      const { status, json } = errorResponse(makeInternalError());
      res.status(status).json(json);
    }
  }
}

function cachedFaviconResponse$(
  params: {
    url: URL;
    size: SizeParam;
    dpr: DevicePixelRatioParam;
    theme?: ThemeParam;
  },
  icon: IconMetadata,
  services: Services,
  defer: (work: Promise<any>) => void,
) {
  const { redis } = services;
  return combineLatest([of(params), of(icon)]).pipe(
    tap(([params, { objectKey }]) => {
      if (redis) {
        defer(
          setMetadataPartial(
            params,
            {
              lastAccess: new Date(),
            },
            redis,
          ),
        );
      }
    }),
    switchMap(([_, cachedImage]) => {
      const { objectKey } = cachedImage;
      return combineLatest([of(cachedImage), of(objectKey)]);
    }),
    map(([{ expiry }, objectKey]) => ({ expiry, objectKey })),
  );
}

function uncachedFaviconResponse$(
  params: {
    url: URL;
    size: SizeParam;
    dpr: DevicePixelRatioParam;
    theme?: ThemeParam;
  },
  services: Services,
  defer: (work: Promise<any>) => void,
): Observable<{ found: true; blob: Blob; expiry: Date } | { found: false }> {
  const loadResult$ = of(params).pipe(
    switchMap(({ url, size, dpr, theme }) =>
      loadIconsForValidatedURL$(url, size, dpr, theme),
    ),
    share(),
  );

  const [foundIcon$, notFoundIcon$] = partition(
    loadResult$,
    (loadResult): loadResult is { icon: Icon; foundIcons: IconSource[] } =>
      loadResult.icon != null,
  );

  return merge(
    combineLatest([foundIcon$, of(params)]).pipe(
      switchMap(async ([{ icon, foundIcons }, { url, size, dpr, theme }]) => {
        const { image } = icon;
        let { blob, expiry } = image;

        try {
          blob = await processImageForTheme(blob, theme, url);
        } catch (error) {
          console.error(
            "Error processing image for theme before caching:",
            error,
          );
        }

        const processedIcon = {
          ...icon,
          image: { ...image, blob },
        };

        const key = { url, size, dpr, theme };
        defer(cacheFavicon(key, processedIcon, services));
        return { found: true, blob, expiry } as const;
      }),
    ),
    combineLatest([notFoundIcon$, of(params)]).pipe(
      switchMap(([_, params]) => {
        const { url, size, dpr } = params;
        return of({ found: false } as const);
      }),
    ),
  );
}

function loadIconsForValidatedURL$(
  url: URL,
  size: SizeParam,
  dpr: DevicePixelRatioParam,
  theme?: ThemeParam,
): Observable<IconLoadResult> {
  const results$ = of({ url, size, theme }).pipe(
    switchMap(({ url, size, theme }) =>
      combineLatest([
        loadFaviconIco$(url),
        loadFaviconFromHTMLPage$(url, size, dpr, theme),
      ]),
    ),
  );

  return combineLatest([of(url), of(theme), results$]).pipe(
    map(([url, theme, [favicon, page]]) =>
      bestResult(url, { favicon: favicon, page: page }, theme),
    ),
  );
}

export function getURLParam$(url: URL) {
  return of(url).pipe(
    map((urlString) => new URL(urlString)),
    catchError(() => {
      throw makeInternalError();
    }),
    map((url) => {
      const urlParam = url.searchParams.get("url");
      if (urlParam == null) {
        throw new APIError(400, "missing_url", "Missing 'url' query parameter");
      }
      return urlParam;
    }),
  );
}

export function getSizeParam$(url: URL) {
  return of(url).pipe(
    map((urlString) => new URL(urlString)),
    catchError(() => {
      throw makeInternalError();
    }),
    map((url): SizeParam => {
      const sizeParam = url.searchParams.get("size");
      if (sizeParam == null) {
        return "favicon";
      }

      return SizeParam.parse(sizeParam);
    }),
    catchError(() => {
      throw new APIError(
        400,
        "invalid_size",
        `Invalid 'size' query parameter. Valid sizes are ${allSizes.join(", ")}`,
      );
    }),
  );
}

export function getDevicePixelRatioParam$(url: URL) {
  return of(url).pipe(
    map((urlString) => new URL(urlString)),
    map((url) => {
      const param = url.searchParams.get("dpr");
      if (param == null) {
        return null;
      }

      const dpr = parseFloat(param);
      if (isNaN(dpr)) {
        throw new APIError(
          400,
          "invalid_dpr",
          `Invalid 'dpr' query parameter. This should be a number`,
        );
      }

      // Round to the closest integer ratio.
      const rounded = Math.round(dpr);
      return DevicePixelRatioParam.parse(Math.min(Math.max(rounded, 1), 3));
    }),
    catchError(() => {
      throw makeInternalError();
    }),
  );
}

export function getThemeParam$(url: URL) {
  return of(url).pipe(
    map((urlString) => new URL(urlString)),
    map((url) => {
      const param = url.searchParams.get("theme");
      if (param == null) {
        return undefined;
      }

      return ThemeParam.parse(param);
    }),
    catchError(() => {
      throw new APIError(
        400,
        "invalid_theme",
        "Invalid 'theme' query parameter. Valid values are 'light' or 'dark'",
      );
    }),
  );
}

export function parsedAndValidatedURL$(urlString: string) {
  const validatedURL = (url: URL) => {
    const isValid = isValidURL(url);
    if (!isValid) {
      throw new APIError(400, "invalid_url", "Invalid 'url' query parameter");
    }
    return url;
  };

  return of(urlString).pipe(
    map(parseURL),
    map(validatedURL),
    catchError(() => {
      throw new APIError(400, "invalid_url", "Invalid 'url' query parameter");
    }),
  );
}
