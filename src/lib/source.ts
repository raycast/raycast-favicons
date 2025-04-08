import { IconSource, ReferenceIconSource } from "./types";

export function isReferencedIcon(
  icon: IconSource
): icon is ReferenceIconSource {
  return icon.source === "link" || icon.source === "manifest";
}

export function isSameReferencedIcon(
  target: ReferenceIconSource,
  icon: IconSource
) {
  if (!isReferencedIcon(icon)) {
    return false;
  }

  if (target.source === "link" && icon.source === "link") {
    const { href, type, size } = target;
    return href === icon.href && type === icon.type && size === icon.size;
  }

  if (target.source === "manifest" && icon.source === "manifest") {
    const { href, size } = target;
    return href === icon.href && size === icon.size;
  }

  return false;
}
