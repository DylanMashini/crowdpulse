import { createElement, type SVGAttributes } from 'react';

import { cx } from '@/lib/cx';

type Shape = [tag: 'path' | 'circle' | 'rect', attributes: SVGAttributes<SVGElement>];

const GLYPHS = {
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  flag: [['path', { d: 'M5 21V4h11l-2 4 2 4H5' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  bell: [['path', { d: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z' }], ['path', { d: 'M10 21h4' }]],
  camera: [['path', { d: 'M4 8h3l1.5-2h7L17 8h3v11H4z' }], ['circle', { cx: 12, cy: 13.5, r: 3.5 }]],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]],
  'no-reading': [['circle', { cx: 12, cy: 12, r: 9, strokeDasharray: '3 3' }], ['path', { d: 'M8 12h8' }]],
  pulse: [['path', { d: 'M3 12h4l2-6 4 12 2-6h6' }]],
  breath: [['path', { d: 'M4 9c3-3 5 3 8 0s5 3 8 0' }], ['path', { d: 'M4 15c3-3 5 3 8 0s5 3 8 0' }]],
  list: [['path', { d: 'M9 6h11M9 12h11M9 18h11' }], ['path', { d: 'M4.5 6h.01M4.5 12h.01M4.5 18h.01', strokeWidth: 3.5 }]],
  sliders: [
    ['path', { d: 'M4 7h10M18 7h2M4 17h2M10 17h10' }],
    ['circle', { cx: 16, cy: 7, r: 2 }],
    ['circle', { cx: 8, cy: 17, r: 2 }],
  ],
  chart: [['path', { d: 'M4 4v16h16' }], ['path', { d: 'M7 15l4-4 3 3 5-6' }]],
  ticket: [
    ['path', { d: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z' }],
    ['path', { d: 'M14 6v12', strokeDasharray: '2 2.5' }],
  ],
  draft: [['path', { d: 'M4 20l1-4L16 5l3 3L8 19z' }], ['path', { d: 'M14 7l3 3' }]],
  trash: [['path', { d: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13' }]],
  scan: [
    ['path', { d: 'M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3' }],
    ['circle', { cx: 12, cy: 10.5, r: 2.5 }],
    ['path', { d: 'M8 16.5c1-2.5 7-2.5 8 0' }],
  ],
  user: [['circle', { cx: 12, cy: 8, r: 3.5 }], ['path', { d: 'M5 20c1-5 13-5 14 0' }]],
  video: [['rect', { x: 3, y: 7, width: 12, height: 10, rx: 2 }], ['path', { d: 'M15 11l6-3v8l-6-3' }]],
  thermal: [['path', { d: 'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z' }]],
  chevron: [['path', { d: 'M9 6l6 6-6 6' }]],
  back: [['path', { d: 'M15 6l-6 6 6 6' }]],
  selector: [['path', { d: 'M8 9.5l4-4 4 4M8 14.5l4 4 4-4' }]],
  panel: [['rect', { x: 3, y: 4.5, width: 18, height: 15, rx: 2.5 }], ['path', { d: 'M9 4.5v15' }]],
  phone: [['rect', { x: 7, y: 3, width: 10, height: 18, rx: 2.5 }], ['path', { d: 'M11 17.5h2' }]],
  'sign-out': [['path', { d: 'M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10' }], ['path', { d: 'M15 8l4 4-4 4M19 12H9.5' }]],
  'eye-off': [
    ['path', { d: 'M3 3l18 18' }],
    ['path', { d: 'M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4 9.5 6-.4.8-1.2 2-2.4 3.1' }],
    ['path', { d: 'M6.5 7.7C4.5 9 3.1 10.8 2.5 12c1 2 4.5 6 9.5 6 1.3 0 2.5-.3 3.6-.7' }],
    ['path', { d: 'M9.9 10a3 3 0 0 0 4.2 4.2' }],
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof GLYPHS;

export interface IconProps {
  name: IconName;
  size?: 12 | 14 | 16 | 18 | 20 | 24;
  /** Give a label only when the icon stands alone. Beside its word it is decoration. */
  label?: string;
  className?: string;
}

/**
 * A line glyph in the colour of the text beside it. Glyphs are drawn on a 24px grid; the stroke is
 * scaled so it lands at 1.5px on screen at every size (1.25px at 14 and under), and 16 is the default.
 */
export function Icon({ name, size = 16, label, className }: IconProps) {
  const shapes: Shape[] = GLYPHS[name];
  const stroke = ((size <= 14 ? 1.25 : 1.5) * 24) / size;
  return (
    <svg
      className={cx('block flex-none', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {shapes.map(([tag, attributes], index) => createElement(tag, { key: index, ...attributes }))}
    </svg>
  );
}
