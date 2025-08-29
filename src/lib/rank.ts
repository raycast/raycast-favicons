import { IconLoadResult, smallestIconDimension } from "./favicon";
import {
  DevicePixelRatioParam,
  LinkIconSource,
  LinkIconType,
  ManifestIconSource,
  SizeParam,
  ThemeParam,
} from "./types";

function filterSourcesByTheme(
  sources: (LinkIconSource | ManifestIconSource)[],
  theme?: ThemeParam
): (LinkIconSource | ManifestIconSource)[] {
  if (!theme) {
    // If no theme preference, prefer icons without media queries
    const noMediaIcons = sources.filter((source) => {
      if (source.source === "link") {
        return !source.media;
      }
      return true;
    });
    
    // If we have icons without media queries, use those
    if (noMediaIcons.length > 0) {
      return noMediaIcons;
    }
    
    // Otherwise return all icons
    return sources;
  }

  // First, try to find icons matching the specific theme
  const themeSpecificIcons = sources.filter((source) => {
    if (source.source === "link" && source.media) {
      // Check if media query matches theme preference
      const mediaLower = source.media.toLowerCase();
      if (theme === "dark") {
        return mediaLower.includes("prefers-color-scheme") && mediaLower.includes("dark");
      } else if (theme === "light") {
        return mediaLower.includes("prefers-color-scheme") && mediaLower.includes("light");
      }
    }
    return false;
  });

  // If we found theme-specific icons, use those
  if (themeSpecificIcons.length > 0) {
    return themeSpecificIcons;
  }

  // Otherwise, fall back to icons without media queries
  const noMediaIcons = sources.filter((source) => {
    if (source.source === "link") {
      return !source.media;
    }
    return true;
  });

  if (noMediaIcons.length > 0) {
    return noMediaIcons;
  }

  // If all else fails, return all icons
  return sources;
}

export function bestReferencedIcon(
  sources: (LinkIconSource | ManifestIconSource)[],
  size: SizeParam,
  dpr: DevicePixelRatioParam,
  theme?: ThemeParam
) {
  switch (size) {
    case "favicon":
      return bestFavicon(sources, dpr, theme);
    case "32":
      return bestIcon(sources, 32 * dpr, theme);
    case "64":
      return bestIcon(sources, 64 * dpr, theme);
  }
}

export function bestFavicon(
  sources: (LinkIconSource | ManifestIconSource)[],
  dpr: DevicePixelRatioParam,
  theme?: ThemeParam
): LinkIconSource | ManifestIconSource | null {
  const linkIconsWithType = (type: LinkIconType) =>
    sources.filter((icon) => {
      if (icon.source === "link") {
        return icon.type === type;
      } else {
        return false;
      }
    });

  // Prioritise small icons for favicons since usually these are redrawn to look good at small sizes.
  const targetDimension = Math.min(16 * dpr, 32);
  const icon = bestIcon(linkIconsWithType("icon"), targetDimension, theme);
  if (icon != null) {
    return icon;
  }

  const shortcutIcon = bestIcon(
    linkIconsWithType("shortcut icon"),
    targetDimension,
    theme
  );
  if (shortcutIcon != null) {
    return shortcutIcon;
  }

  const appleTouchIcon = bestIcon(
    linkIconsWithType("apple-touch-icon"),
    targetDimension,
    theme
  );
  if (appleTouchIcon != null) {
    return appleTouchIcon;
  }

  const appleTouchIconPrecomposed = bestIcon(
    linkIconsWithType("apple-touch-icon-precomposed"),
    targetDimension,
    theme
  );
  if (appleTouchIconPrecomposed != null) {
    return appleTouchIconPrecomposed;
  }

  return null;
}

export function bestIcon(
  sources: (LinkIconSource | ManifestIconSource)[],
  dimension: number,
  theme?: ThemeParam
) {
  // Filter sources based on theme preference
  const themeFilteredSources = filterSourcesByTheme(sources, theme);
  // Where the delta (the amount the smallest dimension of the icon source is larger than our
  // target dimension) is positive, we want to prioritise values that are closest to but larger than
  // the target dimension. Where they are equal the rank will be +Infinity as we want to rank this
  // icon source the highest. The more larger the source icons are than the target value the rank will
  // decrease (but still be +ve), and tend towards zero. y=1/x exhibits this behaviour perfectly.
  //
  // Where the delta is -ve, we have icons that are smaller than the target dimension. We want to rank
  // these icons where the closest (but smaller) icons have a smaller negative value than the ones which
  // are smaller than but further away from the target value.
  //
  // From these two computations we can rank icons such that the icons which are larger will have a positive
  // rank value > 0 (and those which are closest to the target dimension will be the biggest). For icons
  // which are smaller they will have a rank value < 0, and those which are closest to the target dimension
  // will also be the biggest.
  //
  // Icons with no sizing information will be considered last because we don't know how big they are.
  const rank = (source: LinkIconSource | ManifestIconSource) => {
    const smallestDimension = smallestIconDimension(source);
    if (smallestDimension == null) {
      return -Infinity;
    }

    const delta = smallestDimension - dimension;
    if (delta >= 0) {
      return 1 / delta;
    } else {
      return delta;
    }
  };

  const iconsWithRank = themeFilteredSources.map((source) => {
    return { source, rank: rank(source) };
  });

  const first = iconsWithRank.sort((a, b) => b.rank - a.rank)[0];
  if (first == null) {
    return null;
  }

  return first.source;
}

type IconLoadResults = {
  favicon: IconLoadResult;
  page: IconLoadResult;
};

export function bestResult(url: URL, results: IconLoadResults, theme?: ThemeParam): IconLoadResult {
  const exception = ruleBasedDecision(url, results, theme);
  if (exception != null) {
    return exception;
  }

  return defaultDecision(url, results, theme);
}

function ruleBasedDecision(
  url: URL,
  results: IconLoadResults,
  theme?: ThemeParam
): IconLoadResult | undefined {
  const { favicon, page } = results;
  const foundIcons = foundIconsFromResults(results);

  // For GitHub with theme preference, prefer SVG for tinting capability
  if (url.host.toLowerCase().includes("github") && theme) {
    // Check if we have an SVG icon from the page
    if (page.icon && page.icon.image.blob.type === "image/svg+xml") {
      return page;
    }
  }

  // Favicon for developer.apple.com looks better
  if (url.host.toLowerCase() === "developer.apple.com") {
    return {
      icon: favicon.icon || page.icon,
      foundIcons,
    };
  }
}

function defaultDecision(url: URL, results: IconLoadResults, theme?: ThemeParam): IconLoadResult {
  const { favicon, page } = results;

  // For sites that might have monochrome icons, prefer SVG when theme is specified
  if (theme) {
    // If we have both icons, check if one is SVG
    if (page.icon && favicon.icon) {
      const pageIsSVG = page.icon.image.blob.type === "image/svg+xml";
      const faviconIsSVG = favicon.icon.image.blob.type === "image/svg+xml";
      
      // Prefer SVG for theme processing
      if (pageIsSVG && !faviconIsSVG) {
        return page;
      } else if (faviconIsSVG && !pageIsSVG) {
        return { icon: favicon.icon, foundIcons: foundIconsFromResults(results) };
      }
    }
  }

  // Always favour the results from loading the original HTML page since this gives us
  // richer information.
  return {
    icon: page.icon || favicon.icon,
    foundIcons: foundIconsFromResults(results),
  };
}

function foundIconsFromResults(results: IconLoadResults) {
  const { favicon, page } = results;
  return [...favicon.foundIcons, ...page.foundIcons];
}
