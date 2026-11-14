// Where the capture module's outlines land on screen. The native preview fills its box and
// crops the overflow (AVLayerVideoGravity.resizeAspectFill); this is the same arithmetic, so an
// outline sits on the part of the picture it was measured from.

export type Box = { width: number; height: number };
export type Frame = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

/**
 * The camera frame scaled to cover `box` and centred on it, in the box's coordinates. Parts of
 * the frame outside the box (negative `x` or `y`) are the cropped overflow.
 */
export function coverFrame(box: Box | null, aspectRatio: number): Frame {
  if (!box || box.width <= 0 || box.height <= 0 || !(aspectRatio > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  const width = Math.max(box.width, box.height * aspectRatio);
  const height = width / aspectRatio;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/**
 * A point of the frame as captured (0 to 1, origin top-left) in box coordinates. `mirrored`
 * flips it left to right, for the front camera, whose picture is shown mirrored.
 */
export function placePoint(point: Point, frame: Frame, mirrored: boolean): Point {
  const x = mirrored ? 1 - point.x : point.x;
  return { x: frame.x + x * frame.width, y: frame.y + point.y * frame.height };
}

/** A rectangle of the frame as captured, in box coordinates. Mirroring keeps its size. */
export function placeRect(rect: Frame, frame: Frame, mirrored: boolean): Frame {
  const x = mirrored ? 1 - rect.x - rect.width : rect.x;
  return {
    x: frame.x + x * frame.width,
    y: frame.y + rect.y * frame.height,
    width: rect.width * frame.width,
    height: rect.height * frame.height,
  };
}
