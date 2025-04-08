import { mockReadableStream } from "@/lib/mocks";
import { firstValueFrom } from "rxjs";
import { metadataFromHTMLPage$ } from "../metadata";

describe("Metadata parsing", () => {
  test("finds simple link icon", async () => {
    const page = `
    <html>
    <head>
      <link rel="icon" href="/favicon.ico" />
    </head>
    </html>
    <head>
    `;

    const metadata$ = metadataFromHTMLPage$(
      mockReadableStream(page),
      new URL("https://example.com")
    );
    const { linkIcons } = await firstValueFrom(metadata$);
    expect(linkIcons).toEqual([
      {
        source: "link",
        href: "/favicon.ico",
        type: "icon",
        url: new URL("https://example.com/favicon.ico"),
      },
    ]);
  });

  test("finds multiple link icons", async () => {
    const page = `
    <html>
    <head>
      <link rel="icon" sizes="16x16" href="/favicon-16x16.png" />
      <link rel="icon" sizes="32x32" href="/favicon-32x32.png" />
      <link rel="icon" sizes="64x64" href="/favicon-64x64.png" />
    </head>
    </html>
    <head>
    `;

    const metadata$ = metadataFromHTMLPage$(
      mockReadableStream(page),
      new URL("https://example.com")
    );
    const { linkIcons } = await firstValueFrom(metadata$);
    expect(linkIcons).toEqual([
      {
        source: "link",
        href: "/favicon-16x16.png",
        type: "icon",
        url: new URL("https://example.com/favicon-16x16.png"),
        size: { type: "single", width: 16, height: 16 },
      },
      {
        source: "link",
        href: "/favicon-32x32.png",
        type: "icon",
        url: new URL("https://example.com/favicon-32x32.png"),
        size: { type: "single", width: 32, height: 32 },
      },
      {
        source: "link",
        href: "/favicon-64x64.png",
        type: "icon",
        url: new URL("https://example.com/favicon-64x64.png"),
        size: { type: "single", width: 64, height: 64 },
      },
    ]);
  });

  test("finds shortcut icons", async () => {
    const page = `
    <html>
    <head>
      <link rel="shortcut icon" href="/shortcut.png" />
    </head>
    </html>
    <head>
    `;

    const metadata$ = metadataFromHTMLPage$(
      mockReadableStream(page),
      new URL("https://example.com")
    );
    const { linkIcons } = await firstValueFrom(metadata$);
    expect(linkIcons).toEqual([
      {
        source: "link",
        href: "/shortcut.png",
        type: "shortcut icon",
        url: new URL("https://example.com/shortcut.png"),
      },
    ]);
  });

  test("finds apple touch icons", async () => {
    const page = `
    <html>
    <head>
      <link rel="apple-touch-icon" href="apple-touch-icon.png" />
      <link rel="apple-touch-icon-precomposed" href="apple-touch-icon-precomposed.png" />
    </head>
    </html>
    <head>
    `;

    const metadata$ = metadataFromHTMLPage$(
      mockReadableStream(page),
      new URL("https://example.com")
    );
    const { linkIcons } = await firstValueFrom(metadata$);
    expect(linkIcons).toEqual([
      {
        source: "link",
        href: "apple-touch-icon.png",
        type: "apple-touch-icon",
        url: new URL("https://example.com/apple-touch-icon.png"),
      },
      {
        source: "link",
        href: "apple-touch-icon-precomposed.png",
        type: "apple-touch-icon-precomposed",
        url: new URL("https://example.com/apple-touch-icon-precomposed.png"),
      },
    ]);
  });

  test("finds base64-encoded icons", async () => {
    const page = `
    <html>
    <head>
      <link rel="icon" sizes="32x32" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABEVBMVEVHcEz///////////////////////////////////////////////////8AGziAjZtgcIKgqrT/JW+/xs3/BFmcC0vf4+b/DV//Dl//GWb/GWf/M3i+B08jGDyJDUh1EEZ1D0Zvf4+gqbSfqbSvuMD/3+r/v9X/oMD/IWz/MXb/U43/gq0gOFH/h7D/aZzv8fL6IWuufZr/GGfti68NGTo0Fj4TGTrwF2OYDEsjFz0MGjnAB1AIGjl+Dkc+FEBME0H/MnitCU2JDUl5D0b3LXLrIGidC0s1FT8zFj6uCk3/UY30SITfNXPlK22KDkn2OntgEUP/QYIVGTpgEkNCFUD/QoKWGVPRO3RfEUNBFT/kS4MXVO28AAAADXRSTlMAn2Cg78+Q3yAQMI9fslpvQQAAAUBJREFUOMuFk2dDwyAQhklCaGhL1IwO7XLvvWfV1r33+P8/REwiHCS270fugTvu3kNIiJqGjRnDtlGkKC2H8KCQ4WhhWmCaCur1HEspBx7JZ8Q5kdfu+6ODUj54g8bxARdqKHoj/k1cX8lNA3GlTpxxPAtgv0ksBjPUj9qbWxIgvAIGgIPXz+ZpuLMrAEyRCYGvl1YjPKntbyyUkmPzL0MEPD82379vHror68ui58gGwGXr/uP6acQbXhLdshEGwEUjvH3j8fKcADBiAKifX90de9VKMC0brgBup3bmVcvBDJiIksLdO9xeqwSzkwykgEVyrS7OT8GR2so3ZQeltdRGpYEiorgnwAdOegGGHHc2EHmK/A8QYLkE8BXbUmDaicirY9nG72f7/ovD6yB6nOgL7FggiomTsd/UtJL1N8HtHzDFNkJWpxq9AAAAAElFTkSuQmCC" />
    </head>
    </html>
    <head>
    `;

    const metadata$ = metadataFromHTMLPage$(
      mockReadableStream(page),
      new URL("https://example.com")
    );
    const { linkIcons } = await firstValueFrom(metadata$);
    expect(linkIcons).toEqual([
      {
        source: "link",
        href: "",
        type: "icon",
        url: new URL(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABEVBMVEVHcEz///////////////////////////////////////////////////8AGziAjZtgcIKgqrT/JW+/xs3/BFmcC0vf4+b/DV//Dl//GWb/GWf/M3i+B08jGDyJDUh1EEZ1D0Zvf4+gqbSfqbSvuMD/3+r/v9X/oMD/IWz/MXb/U43/gq0gOFH/h7D/aZzv8fL6IWuufZr/GGfti68NGTo0Fj4TGTrwF2OYDEsjFz0MGjnAB1AIGjl+Dkc+FEBME0H/MnitCU2JDUl5D0b3LXLrIGidC0s1FT8zFj6uCk3/UY30SITfNXPlK22KDkn2OntgEUP/QYIVGTpgEkNCFUD/QoKWGVPRO3RfEUNBFT/kS4MXVO28AAAADXRSTlMAn2Cg78+Q3yAQMI9fslpvQQAAAUBJREFUOMuFk2dDwyAQhklCaGhL1IwO7XLvvWfV1r33+P8/REwiHCS270fugTvu3kNIiJqGjRnDtlGkKC2H8KCQ4WhhWmCaCur1HEspBx7JZ8Q5kdfu+6ODUj54g8bxARdqKHoj/k1cX8lNA3GlTpxxPAtgv0ksBjPUj9qbWxIgvAIGgIPXz+ZpuLMrAEyRCYGvl1YjPKntbyyUkmPzL0MEPD82379vHror68ui58gGwGXr/uP6acQbXhLdshEGwEUjvH3j8fKcADBiAKifX90de9VKMC0brgBup3bmVcvBDJiIksLdO9xeqwSzkwykgEVyrS7OT8GR2so3ZQeltdRGpYEiorgnwAdOegGGHHc2EHmK/A8QYLkE8BXbUmDaicirY9nG72f7/ovD6yB6nOgL7FggiomTsd/UtJL1N8HtHzDFNkJWpxq9AAAAAElFTkSuQmCC"
        ),
        data: true,
        size: {
          type: "single",
          width: 32,
          height: 32,
        },
      },
    ]);
  });
});
