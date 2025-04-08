import crypto from "crypto";

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function blobDigest(blob: Blob) {
  const hash = crypto.createHash("sha256");
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  hash.update(buffer);
  return hash.digest("hex");
}
