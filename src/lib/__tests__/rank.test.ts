import { LinkIconSource } from "@/lib/types";
import { bestIcon } from "../rank";

describe("Ranking large icons", () => {
  test("single no-size link icon is returned", async () => {
    const favicon: LinkIconSource = {
      source: "link",
      type: "icon",
      href: "/favicon.ico",
      url: new URL("https://example.com/favicon.ico"),
    };
    const icon = bestIcon([favicon], 64);
    expect(icon).toEqual(favicon);
  });

  test("icon with exact size takes precedence over smaller icons", async () => {
    const favicon: LinkIconSource = {
      source: "link",
      type: "shortcut icon",
      href: "/favicon.ico",
      url: new URL("https://example.com/favicon.ico"),
    };
    const mediumIcon: LinkIconSource = {
      source: "link",
      type: "icon",
      href: "/favicon32.png",
      url: new URL("https://example.com/favicon32.png"),
      size: { type: "single", width: 32, height: 32 },
    };
    const largeIcon: LinkIconSource = {
      source: "link",
      type: "icon",
      href: "/favicon.png",
      url: new URL("https://example.com/favicon32.png"),
      size: { type: "single", width: 64, height: 64 },
    };
    const icon = bestIcon([favicon, mediumIcon, largeIcon], 64);
    expect(icon).toEqual(largeIcon);
  });

  test("icon with exact size takes precedence over larger icons", async () => {
    const favicon: LinkIconSource = {
      source: "link",
      type: "shortcut icon",
      href: "/favicon.ico",
      url: new URL("https://example.com/favicon.ico"),
    };
    const largeIcon: LinkIconSource = {
      source: "link",
      type: "icon",
      href: "/favicon.png",
      url: new URL("https://example.com/favicon32.png"),
      size: { type: "single", width: 64, height: 64 },
    };
    const appleTouchIcon: LinkIconSource = {
      source: "link",
      type: "icon",
      href: "/apple-touch.png",
      url: new URL("https://example.com/apple-touch.png"),
      size: { type: "single", width: 180, height: 180 },
    };
    const icon = bestIcon([favicon, largeIcon, appleTouchIcon], 64);
    expect(icon).toEqual(largeIcon);
  });
});
