import { type ReactNode, useState } from 'react';
import { type LayoutRectangle, StyleSheet, View } from 'react-native';
import Svg, { Ellipse, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import type { FaceRegionsEvent, Point, ViewfinderState } from 'triage-capture';

import { coverFrame, placePoint, placeRect } from '@/lib/capture/viewfinderGeometry';
import { hairline, weight } from '@/theme';

import { Icon } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

const MESSAGES: Record<ViewfinderState, string> = {
  searching: 'Looking for a face. Sit 0.6 to 0.9 m from the phone.',
  locking: 'Face found. Locking exposure, keep still.',
  measuring: 'Measuring. Keep still and breathe normally.',
  lost: 'No reading. Face not in view.',
};

type Props = {
  state: ViewfinderState;
  /** Outlines from the capture module, in 0 to 1 coordinates of the upright frame as captured. */
  regions: FaceRegionsEvent | null;
  /** Replaces the default sentence for the state. */
  message?: string;
  /**
   * The live picture, filling the frame behind the outlines (`CapturePreview`). Left out, the
   * outlines are drawn on a dark field and the caption says that no picture is shown.
   */
  picture?: ReactNode;
  /** The picture is mirrored (the front camera), so the outlines are mirrored to match it. */
  mirrored?: boolean;
  /** A small control in the top right corner, such as the camera flip. */
  control?: ReactNode;
};

const CORNER = 28;
const INSET = 12;

/**
 * The framing view: the live picture with the framing template and the outlines of what is
 * measured drawn over it. The picture fills the box and its overflow is cropped; the outlines
 * are placed with the same arithmetic, so they sit on the face they belong to.
 */
export function Viewfinder({ state, regions, message, picture, mirrored = false, control }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const lost = state === 'lost';
  const tracking = (state === 'measuring' || state === 'locking') && regions?.face != null;
  const hasPicture = picture != null;

  const frame = coverFrame(box, regions?.aspectRatio ?? 16 / 9);
  const at = (point: Point) => placePoint(point, frame, mirrored);
  const polygon = (points: Point[] | null | undefined) =>
    points ? points.map((point) => `${at(point).x},${at(point).y}`).join(' ') : null;
  const labelAt = (points: Point[] | null | undefined) => {
    if (!points || points.length === 0) return null;
    const placed = points.map(at);
    const right = Math.max(...placed.map((point) => point.x));
    const middle = placed.reduce((sum, point) => sum + point.y, 0) / placed.length;
    return { x: right + 8, y: middle + 5 };
  };

  const forehead = polygon(regions?.forehead);
  const cheeks = [polygon(regions?.leftCheek), polygon(regions?.rightCheek)];
  const chest = regions?.chest ? placeRect(regions.chest, frame, mirrored) : null;
  const foreheadLabel = labelAt(regions?.forehead);
  // The label goes beside whichever cheek is on the right of the screen.
  const cheekLabel = labelAt(mirrored ? regions?.leftCheek : regions?.rightCheek);

  return (
    <View
      style={{
        flex: 1,
        borderRadius: theme.radius.radiusLg,
        borderWidth: hairline,
        // The outline turns ice while the camera is measuring, and at no other time.
        borderColor: state === 'measuring' ? colors.signalLine : colors.line,
        overflow: 'hidden',
        backgroundColor: colors.surface1,
      }}
    >
      <View style={{ flex: 1, overflow: 'hidden', backgroundColor: colors.surface0 }} onLayout={(event) => setBox(event.nativeEvent.layout)}>
        {hasPicture ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {picture}
          </View>
        ) : null}
        {box ? (
          <Svg width={box.width} height={box.height} style={StyleSheet.absoluteFill}>
            <Path
              d={cornerPath(box.width, box.height)}
              fill="none"
              stroke={lost ? colors.watch : colors.ink}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={lost ? '6 6' : undefined}
            />
            {tracking ? (
              <>
                {[forehead, ...cheeks].map((points, index) =>
                  points ? (
                    <Polygon
                      key={index}
                      points={points}
                      // Over the picture the skin stays visible; on the dark field the regions are filled.
                      fill={hasPicture ? 'none' : colors.signalSoft}
                      stroke={colors.signal}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                    />
                  ) : null,
                )}
                {chest ? (
                  <Rect {...chest} rx={theme.radius.radiusMd} fill="none" stroke={colors.signal} strokeWidth={1.5} strokeDasharray="6 4" />
                ) : null}
                {foreheadLabel ? <Label {...foreheadLabel} text="Forehead" halo={hasPicture} /> : null}
                {cheekLabel ? <Label {...cheekLabel} text="Cheeks" halo={hasPicture} /> : null}
                {chest ? (
                  <Label
                    x={chest.x + chest.width / 2}
                    y={Math.min(chest.y + chest.height + 18, box.height - 6)}
                    text="Chest motion"
                    anchor="middle"
                    halo={hasPicture}
                  />
                ) : null}
              </>
            ) : (
              // The framing template: where the face should be.
              <Ellipse
                cx={box.width / 2}
                cy={box.height * 0.4}
                rx={Math.min(box.width, box.height) * 0.2}
                ry={Math.min(box.width, box.height) * 0.26}
                fill="none"
                stroke={hasPicture ? colors.ink : colors.lineHover}
                strokeWidth={1.5}
                strokeDasharray="6 6"
              />
            )}
          </Svg>
        ) : null}
        {/* Tucked inside the elbow of the corner mark. */}
        {control ? <View style={{ position: 'absolute', top: INSET + 6, right: INSET + 6 }}>{control}</View> : null}
      </View>
      {/* The words sit under the picture, not on it: nothing covers the chest region. */}
      <View
        style={{
          gap: space.space1,
          paddingHorizontal: space.space4,
          paddingVertical: space.space3,
          borderTopWidth: hairline,
          borderTopColor: colors.line,
        }}
      >
        <Text
          accessibilityLiveRegion="polite"
          style={[theme.type.bodyTouch, { textAlign: 'center', fontWeight: weight.medium, color: lost ? colors.watch : colors.ink }]}
        >
          {message ?? MESSAGES[state]}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.space2 }}>
          <Icon name={hasPicture ? 'video' : 'eye-off'} size={16} color={colors.inkFaint} />
          <Text style={[theme.type.caption, { flexShrink: 1, color: colors.inkFaint }]}>
            {hasPicture ? 'Live picture. Video is not stored.' : 'Outlines only. This screen shows no picture.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

type LabelProps = { x: number; y: number; text: string; anchor?: 'start' | 'middle'; halo: boolean };

/** A region's name. Over the picture it is drawn twice, the first time as a dark edge to read against. */
function Label({ x, y, text, anchor = 'start', halo }: LabelProps) {
  const { colors, type } = useScopedTheme();
  const common = { x, y, textAnchor: anchor, fontSize: type.caption.fontSize, fontWeight: halo ? weight.medium : weight.normal };
  return (
    <>
      {halo ? (
        <SvgText {...common} fill="none" stroke={colors.surface0} strokeWidth={3} strokeLinejoin="round">
          {text}
        </SvgText>
      ) : null}
      <SvgText {...common} fill={halo ? colors.ink : colors.inkMuted}>
        {text}
      </SvgText>
    </>
  );
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
