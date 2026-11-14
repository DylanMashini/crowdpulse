import { useEffect, useState } from 'react';
import TriageCapture, { type FaceRegionsEvent, type ViewfinderState } from 'triage-capture';

import { Viewfinder } from './Viewfinder';

/**
 * The Viewfinder fed by the capture module's outline events. It keeps the ten-per-second
 * updates to itself, so the rest of the screen renders once per second.
 */
export function LiveViewfinder({ state, message }: { state: ViewfinderState; message?: string }) {
  const [regions, setRegions] = useState<FaceRegionsEvent | null>(null);
  useEffect(() => {
    const subscription = TriageCapture.addListener('onFaceRegions', setRegions);
    return () => subscription.remove();
  }, []);
  return <Viewfinder state={state} regions={regions} message={message} />;
}
