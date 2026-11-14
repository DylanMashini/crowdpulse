import { LiveFrame, Reading, SittingSummary } from '@triagecam/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import TriageCapture from 'triage-capture';

import { useTheme } from '@/theme';

// Developer screen for the capture module, shown instead of the app's routes when Metro is
// started with TRIAGECAM_CAPTURE_DEBUG=1 (see app.config.js). It runs one short sitting with
// no server: capture, sitting, live view, face crop, summary and the sitting file, checking
// every payload against the wire schemas. Each step is also written to the Metro log.

const SITTING_SECONDS = 25;
const SITTING_ID = 'capture-debug';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  const coded = error as { code?: string; message?: string };
  return `${coded.code ?? 'error'}: ${coded.message ?? String(error)}`;
}

export default function CaptureDebug() {
  const theme = useTheme('dark');
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  const log = useCallback((line: string) => {
    console.log(`[capture-debug] ${line}`);
    setLines((previous) => [...previous.slice(-60), line]);
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    const counts = { regions: 0, regionsWithFace: 0, previews: 0 };
    const subscriptions = [
      TriageCapture.addListener('onStatus', (status) => log(`status ${JSON.stringify(status)}`)),
      TriageCapture.addListener('onReading', (event) => {
        const checked = Reading.safeParse(event.reading);
        log(`reading ${checked.success ? 'ok' : `INVALID ${checked.error.message}`} ${JSON.stringify(event)}`);
      }),
      TriageCapture.addListener('onFaceRegions', (regions) => {
        counts.regions += 1;
        if (regions.face) counts.regionsWithFace += 1;
        if (counts.regions % 50 === 0) log(`regions ${JSON.stringify(regions)}`);
      }),
      TriageCapture.addListener('onPreviewFrame', (frame) => {
        counts.previews += 1;
        const checked = LiveFrame.safeParse(frame);
        if (!checked.success) log(`preview INVALID ${checked.error.message}`);
        else if (counts.previews % 10 === 1) {
          log(`preview ok ${frame.width}x${frame.height} ${frame.jpegBase64.length} chars at ${frame.t}`);
        }
      }),
      TriageCapture.addListener('onError', (error) => log(`error event ${JSON.stringify(error)}`)),
    ];

    try {
      log(`source ${TriageCapture.getSource()}`);
      let permission = await TriageCapture.getCameraPermission();
      if (permission === 'undetermined') permission = await TriageCapture.requestCameraPermission();
      log(`permission ${permission}`);

      await TriageCapture.startCapture();
      await TriageCapture.startCapture();
      log('capture started (called twice)');
      await wait(3000);

      const sitting = await TriageCapture.startSitting({ sittingId: SITTING_ID });
      log(`sitting started ${JSON.stringify(sitting)}`);
      await TriageCapture.startSitting({ sittingId: SITTING_ID }).then(
        () => log('UNEXPECTED: second startSitting resolved'),
        (error) => log(`second startSitting rejected with ${describe(error)}`),
      );
      await TriageCapture.setLivePreview({ enabled: true, fps: 5, maxLongSide: 320 });
      await wait(SITTING_SECONDS * 1000);

      const crop = await TriageCapture.captureFaceCrop();
      log(`face crop ${crop.width}x${crop.height} ${crop.jpegBase64.length} chars`);
      await TriageCapture.setLivePreview({ enabled: false });

      const result = await TriageCapture.stopSitting();
      const summary = SittingSummary.safeParse(result.summary);
      log(`sitting stopped, summary ${summary.success ? 'ok' : `INVALID ${summary.error.message}`} ${JSON.stringify(result)}`);
      if (result.fileUri) {
        const file = await (await fetch(result.fileUri)).text();
        const fileLines = file.trimEnd().split('\n');
        log(`sitting file ${fileLines.length} lines, header ${fileLines[0]}`);
        log(`sitting file last frame ${fileLines[fileLines.length - 1]}`);
        await TriageCapture.deleteSittingFile(result.fileUri);
        log('sitting file deleted');
      }
      await TriageCapture.stopSitting().then(
        () => log('UNEXPECTED: stopSitting with no sitting resolved'),
        (error) => log(`stopSitting with no sitting rejected with ${describe(error)}`),
      );
      await TriageCapture.stopCapture();
      log(`done: ${counts.regions} region events (${counts.regionsWithFace} with a face), ${counts.previews} preview frames`);
    } catch (error) {
      log(`FAILED ${describe(error)}`);
      await TriageCapture.stopCapture();
    } finally {
      subscriptions.forEach((subscription) => subscription.remove());
      setRunning(false);
    }
  }, [log]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface, padding: theme.space.space4, paddingTop: theme.space.space7 }}>
      <Text style={[theme.type.heading, { color: theme.colors.ink }]}>Capture module check</Text>
      <Text style={[theme.type.caption, { color: theme.colors.inkMuted, marginTop: theme.space.space1 }]}>
        Developer screen. Runs a {SITTING_SECONDS} second sitting with no server.
      </Text>
      <ScrollView style={{ flex: 1, marginVertical: theme.space.space4 }}>
        {lines.map((line, index) => (
          <Text key={index} style={[theme.type.caption, { color: theme.colors.ink, marginBottom: theme.space.space1 }]}>
            {line}
          </Text>
        ))}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        disabled={running}
        onPress={() => void run()}
        style={{
          height: theme.size.controlTouch,
          borderRadius: theme.radius.radiusMd,
          backgroundColor: running ? theme.colors.surfaceRaised : theme.colors.signal,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[theme.type.bodyStrong, { color: running ? theme.colors.inkMuted : theme.colors.onSignal }]}>
          {running ? 'Running' : 'Run again'}
        </Text>
      </Pressable>
    </View>
  );
}
