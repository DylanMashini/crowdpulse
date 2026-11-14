import Svg, { Circle, Path, Rect } from 'react-native-svg';

// The design system's 21 line glyphs, copied from design-system/components/bundle.js:
// a 24px grid, 1.5 stroke, round caps and joins, drawn in the colour of the text beside them.

type Shape =
  | { el: 'path'; d: string; dash?: string; strokeWidth?: number }
  | { el: 'circle'; cx: number; cy: number; r: number; dash?: string }
  | { el: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const GLYPHS = {
  clock: [
    { el: 'circle', cx: 12, cy: 12, r: 9 },
    { el: 'path', d: 'M12 7v5l3 2' },
  ],
  flag: [{ el: 'path', d: 'M5 21V4h11l-2 4 2 4H5' }],
  check: [{ el: 'path', d: 'M5 12.5l4.5 4.5L19 7.5' }],
  bell: [
    { el: 'path', d: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z' },
    { el: 'path', d: 'M10 21h4' },
  ],
  camera: [
    { el: 'path', d: 'M4 8h3l1.5-2h7L17 8h3v11H4z' },
    { el: 'circle', cx: 12, cy: 13.5, r: 3.5 },
  ],
  lock: [
    { el: 'rect', x: 5, y: 11, width: 14, height: 9, rx: 2 },
    { el: 'path', d: 'M8 11V8a4 4 0 0 1 8 0v3' },
  ],
  'no-reading': [
    { el: 'circle', cx: 12, cy: 12, r: 9, dash: '3 3' },
    { el: 'path', d: 'M8 12h8' },
  ],
  pulse: [{ el: 'path', d: 'M3 12h4l2-6 4 12 2-6h6' }],
  breath: [
    { el: 'path', d: 'M4 9c3-3 5 3 8 0s5 3 8 0' },
    { el: 'path', d: 'M4 15c3-3 5 3 8 0s5 3 8 0' },
  ],
  list: [
    { el: 'path', d: 'M9 6h11M9 12h11M9 18h11' },
    { el: 'path', d: 'M4.5 6h.01M4.5 12h.01M4.5 18h.01', strokeWidth: 2.5 },
  ],
  sliders: [
    { el: 'path', d: 'M4 7h10M18 7h2M4 17h2M10 17h10' },
    { el: 'circle', cx: 16, cy: 7, r: 2 },
    { el: 'circle', cx: 8, cy: 17, r: 2 },
  ],
  chart: [
    { el: 'path', d: 'M4 4v16h16' },
    { el: 'path', d: 'M7 15l4-4 3 3 5-6' },
  ],
  ticket: [
    {
      el: 'path',
      d: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z',
    },
    { el: 'path', d: 'M14 6v12', dash: '2 2.5' },
  ],
  draft: [
    { el: 'path', d: 'M4 20l1-4L16 5l3 3L8 19z' },
    { el: 'path', d: 'M14 7l3 3' },
  ],
  trash: [{ el: 'path', d: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13' }],
  scan: [
    { el: 'path', d: 'M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3' },
    { el: 'circle', cx: 12, cy: 10.5, r: 2.5 },
    { el: 'path', d: 'M8 16.5c1-2.5 7-2.5 8 0' },
  ],
  user: [
    { el: 'circle', cx: 12, cy: 8, r: 3.5 },
    { el: 'path', d: 'M5 20c1-5 13-5 14 0' },
  ],
  video: [
    { el: 'rect', x: 3, y: 7, width: 12, height: 10, rx: 2 },
    { el: 'path', d: 'M15 11l6-3v8l-6-3' },
  ],
  thermal: [{ el: 'path', d: 'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z' }],
  chevron: [{ el: 'path', d: 'M9 6l6 6-6 6' }],
  'eye-off': [
    { el: 'path', d: 'M3 3l18 18' },
    { el: 'path', d: 'M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4 9.5 6-.4.8-1.2 2-2.4 3.1' },
    { el: 'path', d: 'M6.5 7.7C4.5 9 3.1 10.8 2.5 12c1 2 4.5 6 9.5 6 1.3 0 2.5-.3 3.6-.7' },
    { el: 'path', d: 'M9.9 10a3 3 0 0 0 4.2 4.2' },
  ],
  // The glyphs below are not in the design system's set. They are drawn on the same grid with
  // the same stroke, for things only the phone has: the camera flip, search, and the tab icons'
  // in-screen twins.
  'flip-camera': [
    { el: 'path', d: 'M4.5 10.5A8 8 0 0 1 18 6.5' },
    { el: 'path', d: 'M18.5 3v4h-4' },
    { el: 'path', d: 'M19.5 13.5A8 8 0 0 1 6 17.5' },
    { el: 'path', d: 'M5.5 21v-4h4' },
    { el: 'circle', cx: 12, cy: 12, r: 2.5 },
  ],
  search: [
    { el: 'circle', cx: 11, cy: 11, r: 6.5 },
    { el: 'path', d: 'M16 16l4.5 4.5' },
  ],
  close: [{ el: 'path', d: 'M6 6l12 12M18 6L6 18' }],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof GLYPHS;

type Props = {
  name: IconName;
  size?: 16 | 18 | 20;
  /** The colour of the text beside it. */
  color: string;
  /** Read out by VoiceOver. Leave out when the icon sits beside its word. */
  label?: string;
  /** Mirrors the glyph, for the back chevron. */
  flip?: boolean;
};

export function Icon({ name, size = 20, color, label, flip }: Props) {
  const shapes: readonly Shape[] = GLYPHS[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={Boolean(label)}
      accessibilityLabel={label}
      accessibilityRole={label ? 'image' : undefined}
      style={flip ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      {shapes.map((shape, index) => {
        if (shape.el === 'circle') {
          return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} strokeDasharray={shape.dash} />;
        }
        if (shape.el === 'rect') {
          return <Rect key={index} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />;
        }
        return <Path key={index} d={shape.d} strokeDasharray={shape.dash} strokeWidth={shape.strokeWidth} />;
      })}
    </Svg>
  );
}
