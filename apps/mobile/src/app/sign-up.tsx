import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { type TextInputInstance, View } from 'react-native';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { api, errorMessage, isApiError } from '@/lib/api';
import { emailError, newPasswordError } from '@/lib/session/validation';
import { useTheme } from '@/theme';

export default function SignUp() {
  const theme = useTheme();
  const router = useRouter();
  const passwordInput = useRef<TextInputInstance>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email: string | null; password: string | null }>({ email: null, password: null });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next = { email: emailError(email), password: newPasswordError(password) };
    setErrors(next);
    setFailure(null);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      const { devVerificationToken } = await api.signUp(email.trim(), password);
      router.replace({
        pathname: '/check-email',
        params: devVerificationToken ? { email: email.trim(), devToken: devVerificationToken } : { email: email.trim() },
      });
    } catch (error) {
      if (isApiError(error) && error.code === 'email_taken') {
        setErrors({ email: 'This address already has an account. Sign in instead.', password: null });
      } else {
        setFailure(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Create an account" subtitle="For staff who run the camera or the worklist" onBack={() => router.back()}>
      <View style={{ gap: theme.space.space4 }}>
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        hint="A verification link is sent to this address"
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
        hint="8 characters or more"
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      </View>
      {failure ? <Notice title="Account not created" body={failure} /> : null}
      <Button
        variant="primary"
        block
        label={busy ? 'Creating account' : 'Create account'}
        disabled={busy}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
