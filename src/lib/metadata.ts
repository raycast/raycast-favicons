import * as htmlparser2 from "htmlparser2";
import { Observable, Subscription } from "rxjs";
// Import node's definition since we won't be using this on the client.
import { IconSize, LinkIconSource, LinkIconType } from "@/lib/types";
import { pageByteLimit } from "./fetch";
import { read$ } from "./stream";
import { isBase64DataURL, isValidURL, makeURLWithoutThrowing } from "./url";

function isLinkIconType(type: string): type is LinkIconType {
  return [
    "apple-touch-icon",
    "apple-touch-icon-precomposed",
    "shortcut icon",
    "icon",
  ].includes(type.toLowerCase());
}

export function metadataFromHTMLPage$(
  body: ReadableStream<Uint8Array>,
  baseURL: URL
): Observable<{
  linkIcons: LinkIconSource[];
  manifestURL: URL | null;
}> {
  return new Observable((observer) => {
    let sources: LinkIconSource[] = [];
    let manifestURL: URL | null;
    let finished = false;

    const parser = new htmlparser2.Parser({
      onopentag(name, attributes) {
        if (name === "link") {
          const rel = attributes["rel"];
          const href = attributes["href"];
          const sizes = attributes["sizes"];

          if (
            href == null ||
            typeof href !== "string" ||
            rel == null ||
            typeof rel !== "string"
          ) {
            return;
          }

          const result = processLinkTag(rel, href, sizes, baseURL);
          if (result == null) {
            return;
          }

          switch (result.type) {
            case "icon":
              sources.push(result.source);
              break;
            case "manifest":
              // If there are multiple manifest <link /> tags specified the last one
              // will always take precedence.
              manifestURL = result.url;
              break;
          }
        }
      },
      onclosetag(name) {
        if (name === "head") {
          finished = true;
        }
      },
      onend() {
        finished = true;
      },
    });

    const decoder = new TextDecoder();

    let subscription: Subscription;
    let completed = false;

    const complete = () => {
      if (!completed) {
        completed = true;
        observer.next({ linkIcons: sources, manifestURL });
        observer.complete();
      }
    };

    subscription = read$(body, pageByteLimit).subscribe({
      next(chunk) {
        const string = decoder.decode(chunk);
        parser.write(string);
        if (finished) {
          complete();
          if (subscription != null) {
            subscription.unsubscribe();
          }
        }
      },
      error(err) {
        parser.end();
        observer.error(err);
      },
      complete() {
        parser.end();
        complete();
      },
    });

    return () => subscription.unsubscribe();
  });
}

function processLinkTag(
  rel: string,
  href: string,
  sizes: string,
  baseURL: URL
):
  | { type: "icon"; source: LinkIconSource }
  | { type: "manifest"; url: URL }
  | null {
  if (isLinkIconType(rel)) {
    const url = makeURLWithoutThrowing(href, baseURL);
    const parsedSizes = sizes ? parseIconSizes(sizes) : null;
    if (url == null) {
      return null;
    }

    if (isBase64DataURL(href)) {
      return {
        type: "icon",
        source: {
          source: "link",
          type: rel,
          url,
          href: "", // Use empty href otherwise we will store the data twice
          data: true,
          size: parsedSizes || undefined,
        },
      };
    } else {
      if (!isValidURL(url)) {
        return null;
      }

      return {
        type: "icon",
        source: {
          source: "link",
          type: rel,
          url,
          href,
          size: parsedSizes || undefined,
        },
      };
    }
  }

  if (rel.toLowerCase() === "manifest") {
    const url = makeURLWithoutThrowing(href, baseURL);
    if (url == null) {
      return null;
    }

    return { type: "manifest", url };
  }

  return null;
}

export function parseIconSizes(string: string): IconSize | null {
  string = string.toLowerCase().trim();
  if (string === "any") {
    return { type: "any" };
  }

  const sizes = string
    .split(" ")
    .map((value) => {
      const match = value.match(/(\d+)x(\d+)/);
      if (match == null) {
        return null;
      }

      const width = parseInt(match[1]);
      const height = parseInt(match[2]);

      if (isNaN(width) || isNaN(height)) {
        return null;
      }

      return { width, height };
    })
    .filter(
      (value): value is { width: number; height: number } => value != null
    );

  if (sizes.length === 0) {
    return null;
  }

  if (sizes.length === 1) {
    return { type: "single", ...sizes[0] };
  }

  return { type: "multiple", sizes };
}
