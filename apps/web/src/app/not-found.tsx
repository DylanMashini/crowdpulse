import Link from 'next/link';

import { AuthFrame } from '@/components/auth/AuthFrame';
import { buttonClass } from '@/components/ds';

export default function NotFound() {
  return (
    <AuthFrame title="There is no page at this address" lead="The address may be mistyped, or the page may have moved.">
      <Link href="/waiting-room" className={buttonClass('secondary', 'md', true)}>
        Go to the waiting room
      </Link>
    </AuthFrame>
  );
}
