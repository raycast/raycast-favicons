import { parse as parseContentType } from "content-type";

export const isTextContentType = (contentType: string) => {
  const { type } = parseContentType(contentType);
  return type === "text/plain";
};

export const isHTMLContentType = (contentType: string) => {
  const { type } = parseContentType(contentType);
  return type === "text/html";
};

export const isImageContentType = (contentType: string) => {
  const { type } = parseContentType(contentType);
  return [
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
    "image/tiff",
    "image/vnd.microsoft.icon",
    "image/webp",
    "image/x-icon",
  ].includes(type);
};
