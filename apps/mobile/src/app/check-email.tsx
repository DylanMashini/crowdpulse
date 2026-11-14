import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { api, errorMessage } from '@/lib/api';
import { clockTime } from '@/lib/format';
import { useTheme } from '@/theme';
import { Text } from '@/components/Text';

type Progress =
  | { step: 'idle' }
  | { step: 'sending' | 'verifying' }
  | { step: 'sent'; at: string }
  | { step: 'failed'; title: string; message: string };

export default function CheckEmail() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; devToken?: string }>();
  const email = params.email ?? '';
  // Only a development server without an email key returns the token to the app.
  const [devToken, setDevToken] = useState<string | null>(params.devToken ?? null);
  const [progress, setProgress] = useState<Progress>({ step: 'idle' });
  const busy = progress.step === 'sending' || progress.step === 'verifying';

  const toSignIn = () => router.replace({ pathname: '/sign-in', params: { email } });

  const resend = async () => {
    setProgress({ step: 'sending' });
    try {
      const response = await api.resendVerification(email);
      if (response.devVerificationToken) setDevToken(response.devVerificationToken);
      setProgress({ step: 'sent', at: new Date().toISOString() });
    } catch (error) {
      setProgress({ step: 'failed', title: 'The email was not sent', message: errorMessage(error) });
    }
  };

  const verifyNow = async (token: string) => {
    setProgress({ step: 'verifying' });
    try {
      await api.verifyEmail(token);
      toSignIn();
    } catch (error) {
      setProgress({ step: 'failed', title: 'The address was not verified', message: errorMessage(error) });
    }
  };

  return (
    <Screen title="Check your email" onBack={() => router.back()}>
      <Text style={[theme.type.bodyTouch, { color: theme.colors.inkMuted }]}>
        A verification link was sent to {email || 'your address'}. Open it on any device, then sign in here. The link
        works for 24 hours.
      </Text>
      {progress.step === 'sent' ? (
        <Notice title={`Sent again at ${clockTime(progress.at)}`} body="Look in the spam folder if it does not arrive" />
      ) : null}
      {progress.step === 'failed' ? <Notice title={progress.title} body={progress.message} /> : null}
      <View style={{ gap: theme.space.space2 }}>
        <Button variant="primary" block label="I have verified, sign in" onPress={toSignIn} />
        <Button
          variant="secondary"
          block
          label={progress.step === 'sending' ? 'Sending' : 'Send the email again'}
          disabled={busy || email === ''}
          onPress={() => void resend()}
        />
      </View>
      {devToken ? (
        <Notice
          title="Development server"
          body="This server has no email key, so it sent no email and returned the link to the app instead"
        >
          <Button
            variant="secondary"
            block
            label={progress.step === 'verifying' ? 'Verifying' : 'Verify this address now'}
            disabled={busy}
            onPress={() => void verifyNow(devToken)}
          />
        </Notice>
      ) : null}
    </Screen>
  );
}
