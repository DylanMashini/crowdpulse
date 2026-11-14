import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/** True while this screen is the one on top, so it can stop polling when it is covered. */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
