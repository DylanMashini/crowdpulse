'use client';

import { AuthFrame } from '@/components/auth/AuthFrame';
import { Button } from '@/components/ds';

export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <AuthFrame title="This page stopped working" lead="Something failed while drawing the page. Nothing was saved or deleted by the failure.">
      <Button block size="lg" onClick={reset}>
        Try again
      </Button>
    </AuthFrame>
  );
}
