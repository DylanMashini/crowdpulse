import { useState } from 'react';
import { type LayoutRectangle, Text, View } from 'react-native';
import Svg, { Ellipse, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import type { FaceRegionsEvent, Point, ViewfinderState } from 'triage-capture';

import { fonts } from '@/theme';

import { Icon } from './Icon';
import { useScopedTheme } from './ThemeScope';

const MESSAGES: Record<ViewfinderState, string> = {
  searching: 'Looking for a face. Sit 0.6 to 0.9 m from the phone.',
  locking: 'Face found. Locking exposure, keep still.',
  measuring: 'Measuring. Keep still and breathe normally.',
  lost: 'No reading. Face not in view.',
};

type Props = {
  state: ViewfinderState;
  /** Outlines from the capture module, in 0 to 1 coordinates of the upright frame. */
  regions: FaceRegionsEvent | null;
  /** Replaces the default sentence for the state. */
  message?: string;
};

const CORNER = 28;
const INSET = 12;

/**
 * The framing view: outlines of what is measured on a dark field, never the picture. The
 * regions are drawn where the capture module says they are; nothing here renders a frame.
 */
export function Viewfinder({ state, regions, message }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const lost = state === 'lost';
  const tracking = (state === 'measuring' || state === 'locking') && regions?.face != null;

  // The camera frame, fitted inside the art area the way the picture would be.
  const frame = fitFrame(box, regions?.aspectRatio ?? 3 / 4);
  const px = (point: Point) => `${frame.x + point.x * frame.width},${frame.y + point.y * frame.height}`;
  const polygon = (points: Point[] | null | undefined) => (points ? points.map(px).join(' ') : null);
  const labelAt = (points: Point[] | null | undefined) => {
    if (!points || points.length === 0) return null;
    const right = Math.max(...points.map((p) => p.x));
    const middle = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    return { x: frame.x + right * frame.width + 8, y: frame.y + middle * frame.height + 5 };
  };

  const forehead = polygon(regions?.forehead);
  const leftCheek = polygon(regions?.leftCheek);
  const rightCheek = polygon(regions?.rightCheek);
  const chest = regions?.chest;
  const foreheadLabel = labelAt(regions?.forehead);
  const cheekLabel = labelAt(regions?.rightCheek);
  const labelStyle = { fill: colors.inkMuted, fontSize: 13, fontFamily: fonts.sans[400] };

  return (
    <View
      style={{
        flex: 1,
        borderRadius: theme.radius.radiusLg,
        overflow: 'hidden',
        backgroundColor: colors.surfaceSunken,
      }}
    >
      <View style={{ flex: 1 }} onLayout={(event) => setBox(event.nativeEvent.layout)}>
        {box ? (
          <Svg width={box.width} height={box.height}>
            <Path
              d={cornerPath(box.width, box.height)}
              fill="none"
              stroke={lost ? colors.flag : colors.ink}
              strokeWidth={2}
              strokeDasharray={lost ? '6 6' : undefined}
            />
            {tracking ? (
              <>
                {[forehead, leftCheek, rightCheek].map((points, index) =>
                  points ? (
                    <Polygon
                      key={index}
                      points={points}
                      fill={colors.signalSoft}
                      stroke={colors.signal}
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  ) : null,
                )}
                {chest ? (
                  <Rect
                    x={frame.x + chest.x * frame.width}
                    y={frame.y + chest.y * frame.height}
                    width={chest.width * frame.width}
                    height={chest.height * frame.height}
                    rx={6}
                    fill="none"
                    stroke={colors.signal}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                ) : null}
                {foreheadLabel ? (
                  <SvgText {...foreheadLabel} {...labelStyle}>
                    Forehead
                  </SvgText>
                ) : null}
                {cheekLabel ? (
                  <SvgText {...cheekLabel} {...labelStyle}>
                    Cheeks
                  </SvgText>
                ) : null}
                {chest ? (
                  <SvgText
                    x={frame.x + (chest.x + chest.width / 2) * frame.width}
                    y={Math.min(frame.y + (chest.y + chest.height) * frame.height + 18, box.height - 6)}
                    textAnchor="middle"
                    {...labelStyle}
                  >
                    Chest motion
                  </SvgText>
                ) : null}
              </>
            ) : (
              <Ellipse
                cx={box.width / 2}
                cy={box.height * 0.4}
                rx={Math.min(box.width, box.height) * 0.2}
                ry={Math.min(box.width, box.height) * 0.26}
                fill="none"
                stroke={colors.lineStrong}
                strokeWidth={2}
                strokeDasharray="6 6"
              />
            )}
          </Svg>
        ) : null}
      </View>
      <Text
        accessibilityLiveRegion="polite"
        style={[
          theme.type.bodyTouch,
          {
            paddingHorizontal: space.space4,
            paddingTop: space.space2,
            textAlign: 'center',
            fontFamily: fonts.sans[600],
            color: lost ? colors.flag : colors.ink,
          },
        ]}
      >
        {message ?? MESSAGES[state]}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.space2,
          paddingHorizontal: space.space4,
          paddingTop: space.space2,
          paddingBottom: space.space3,
        }}
      >
        <Icon name="eye-off" size={16} color={colors.inkMuted} />
        <Text style={[theme.type.caption, { color: colors.inkMuted }]}>Outlines only. This screen shows no picture.</Text>
      </View>
    </View>
  );
}

function fitFrame(box: LayoutRectangle | null, aspectRatio: number) {
  if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const width = Math.min(box.width, box.height * aspectRatio);
  const height = width / aspectRatio;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

function cornerPath(width: number, height: number): string {
  const left = INSET;
  const top = INSET;
  const right = width - INSET;
  const bottom = height - INSET;
  return [
    `M${left} ${top + CORNER}V${top}h${CORNER}`,
    `M${right - CORNER} ${top}h${CORNER}v${CORNER}`,
    `M${right} ${bottom - CORNER}v${CORNER}h${-CORNER}`,
    `M${left + CORNER} ${bottom}h${-CORNER}v${-CORNER}`,
  ].join('');
}
