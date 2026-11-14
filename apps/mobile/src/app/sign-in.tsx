import { PROTOTYPE_NOTICE } from '@triagecam/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { type TextInputInstance } from 'react-native';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { errorMessage, isApiError } from '@/lib/api';
import { useSession } from '@/lib/session/SessionProvider';
import { emailError } from '@/lib/session/validation';
import { useTheme } from '@/theme';
import { Text } from '@/components/Text';

export default function SignIn() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { signIn } = useSession();
  const passwordInput = useRef<TextInputInstance>(null);

  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email: string | null; password: string | null }>({ email: null, password: null });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next = { email: emailError(email), password: password === '' ? 'Enter your password' : null };
    setErrors(next);
    setFailure(null);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (error) {
      if (isApiError(error) && error.code === 'email_not_verified') {
        router.push({ pathname: '/check-email', params: { email: email.trim() } });
      } else if (isApiError(error) && error.code === 'invalid_credentials') {
        setErrors({ email: null, password: 'That email and password do not match an account' });
      } else {
        setFailure(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Sign in" subtitle="Triage Cam staff account">
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordInput.current?.focus()}
      />
      <Field
        ref={passwordInput}
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        textContentType="password"
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {failure ? <Notice title="Not signed in" body={failure} /> : null}
      <Button variant="primary" block label={busy ? 'Signing in' : 'Sign in'} disabled={busy} onPress={() => void submit()} />
      <Button variant="quiet" block label="Create an account" onPress={() => router.push('/sign-up')} />
      <Text style={[theme.type.caption, { color: theme.colors.inkMuted }]}>{PROTOTYPE_NOTICE}</Text>
    </Screen>
  );
}
