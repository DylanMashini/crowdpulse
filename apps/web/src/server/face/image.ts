import sharp from "sharp";

import { ApiError } from "../http.ts";

/** Interleaved 8-bit RGB. Lives in memory for the length of one request and is never stored. */
export type RgbImage = { data: Uint8Array; width: number; height: number };

const MAX_PIXELS = 2048 * 2048;

/** Decodes a base64 JPEG. Anything that is not a readable JPEG is an invalid request. */
export async function decodeJpeg(jpegBase64: string): Promise<RgbImage> {
  const bytes = Buffer.from(jpegBase64, "base64");
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new ApiError("invalid_request", "jpegBase64 is not a JPEG image");
  }
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ApiError("invalid_request", "jpegBase64 could not be read as a JPEG image");
  }
}

/** Scales the image to fit a square canvas of `size`, centred on black. Returns the canvas and how to map back. */
export async function letterbox(
  image: RgbImage,
  size: number,
  longSide: number,
): Promise<{ canvas: Uint8Array; scale: number; offsetX: number; offsetY: number }> {
  const scale = longSide / Math.max(image.width, image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const offsetX = Math.floor((size - width) / 2);
  const offsetY = Math.floor((size - height) / 2);
  const canvas = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } })
    .resize(width, height, { fit: "fill" })
    .extend({
      left: offsetX,
      top: offsetY,
      right: size - width - offsetX,
      bottom: size - height - offsetY,
      background: { r: 0, g: 0, b: 0 },
    })
    .raw()
    .toBuffer();
  return { canvas, scale, offsetX, offsetY };
}
