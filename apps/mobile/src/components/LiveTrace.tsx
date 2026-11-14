import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { type Trace, traceRuns } from '@/lib/capture/trace';

import { useScopedTheme } from './ThemeScope';

type Props = {
  /** One value per second of the sitting, as the engine reported them. */
  trace: Trace;
  /** How many seconds the full width stands for. */
  capacity: number;
  /** The smallest range the height stands for, in the value's unit. */
  minSpan: number;
};

const HEIGHT = 40;
const PAD = 4;
const HEAD = 6;

/**
 * The reading over the sitting so far, drawn as it is measured: a thin ice line that grows by
 * one point a second, with a lit head on the newest reading. It is the readings the screen
 * already prints, not a waveform, and it moves only when a new one arrives.
 */
export function LiveTrace({ trace, capacity, minSpan }: Props) {
  const { colors, shadow } = useScopedTheme();
  const [width, setWidth] = useState(0);
  const runs = traceRuns(trace, { width, height: HEIGHT, pad: PAD }, capacity, minSpan);
  const lastRun = runs[runs.length - 1];
  // The head sits on the newest second only while that second has a reading.
  const head = trace[trace.length - 1] != null ? lastRun?.[lastRun.length - 1] : undefined;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ height: HEIGHT }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          <Line x1={PAD} x2={width - PAD} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} stroke={colors.line} strokeWidth={1} />
          {runs.map((run, index) => (
            <Polyline
              key={index}
              points={run.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={colors.seriesEstimate}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </Svg>
      ) : null}
      {head ? (
        <View
          style={{
            position: 'absolute',
            left: head.x - HEAD / 2,
            top: head.y - HEAD / 2,
            width: HEAD,
            height: HEAD,
            borderRadius: HEAD / 2,
            backgroundColor: colors.signalStrong,
            boxShadow: shadow.glowLive,
          }}
        />
      ) : null}
    </View>
  );
}
