import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type HeaderAction = { icon: IconName; label: string; onPress: () => void };

type Props = {
  /** The one title of the screen. */
  title: string;
  /** A caption under the title. */
  subtitle?: string;
  onBack?: () => void;
  action?: HeaderAction;
  /** False when the screen brings its own scrolling list. */
  scroll?: boolean;
  children: ReactNode;
};

/** The frame of a portrait screen: safe area, the screen gutter, an optional back row and the title. */
export function Screen({ title, subtitle, onBack, action, scroll = true, children }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const header = (
    <View style={{ gap: space.space1 }}>
      {onBack || action ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', minHeight: theme.size.controlTouch }}>
          {onBack ? <HeaderButton icon="chevron" flip label="Back" onPress={onBack} /> : <View />}
          {action ? <HeaderButton {...action} /> : null}
        </View>
      ) : null}
      <Text accessibilityRole="header" style={[theme.type.title, { color: colors.ink }]}>
        {title}
      </Text>
      {subtitle ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{subtitle}</Text> : null}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: space.space4,
              paddingBottom: space.space7,
              gap: space.space5,
              width: '100%',
              maxWidth: 560,
              alignSelf: 'center',
            }}
          >
            {header}
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: space.space4, paddingTop: space.space4, paddingBottom: space.space3 }}>
              {header}
            </View>
            {children}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function HeaderButton({ icon, label, onPress, flip }: HeaderAction & { flip?: boolean }) {
  const theme = useScopedTheme();
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.space1,
        minWidth: theme.size.controlTouch,
        height: theme.size.controlTouch,
        paddingRight: theme.space.space2,
        borderRadius: theme.radius.radiusMd,
        backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
      })}
    >
      <Icon name={icon} size={20} color={theme.colors.ink} flip={flip} />
      <Text style={[theme.type.bodyTouch, { color: theme.colors.ink }]}>{label}</Text>
    </Touchable>
  );
}
