import { redirect } from 'next/navigation';

/** The dashboard opens on the nurse view. The app shell sends anyone signed out to sign-in. */
export default function Home() {
  redirect('/waiting-room');
}
