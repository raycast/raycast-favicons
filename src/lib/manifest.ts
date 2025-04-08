import { map, reduce, switchMap } from "rxjs/operators";
import { fetchManifest$, pageByteLimit } from "./fetch";
import { parseIconSizes } from "./metadata";
import { read$ } from "./stream";
import { ManifestIconSource } from "./types";
import { makeURLWithoutThrowing } from "./url";

export function iconsFromManifest$(url: URL) {
  return fetchManifest$(url).pipe(
    switchMap((response) => {
      if (response.body == null) {
        throw new Error("Missing response body");
      }

      return read$(response.body, pageByteLimit).pipe(
        reduce((acc, chunk) => [...acc, chunk], new Array<Uint8Array>()),
        map((chunks) => {
          const decoder = new TextDecoder();
          const baseURL = makeURLWithoutThrowing(response.url) || url;
          return [decoder.decode(...chunks), baseURL] as const;
        })
      );
    }),
    map(([jsonString, baseURL]) => parseManifest(jsonString, baseURL))
  );
}

function parseManifest(jsonString: string, baseURL: URL) {
  const json = JSON.parse(jsonString);

  if (json == null) {
    throw new Error("Invalid manifest");
  }

  const icons = json["icons"];
  if (icons == null || !Array.isArray(icons)) {
    throw new Error("Invalid manifest");
  }

  return icons
    .map((icon) => parseIcon(icon, baseURL))
    .filter((icon): icon is ManifestIconSource => icon != null);
}

function parseIcon(icon: any, baseURL: URL): ManifestIconSource | null {
  if (typeof icon !== "object") {
    return null;
  }

  const src = icon["src"];
  const sizes = icon["sizes"];
  const url = makeURLWithoutThrowing(src, baseURL);
  if (src == null || typeof src !== "string" || url == null) {
    return null;
  }

  let iconSize = null;
  if (typeof sizes === "string") {
    iconSize = parseIconSizes(sizes);
  }

  return {
    source: "manifest",
    href: src,
    url,
    size: iconSize != null ? iconSize : undefined,
  };
}
