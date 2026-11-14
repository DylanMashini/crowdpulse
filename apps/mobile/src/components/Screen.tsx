import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { weight } from '@/theme';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type HeaderAction = { icon: IconName; label: string; onPress: () => void };

type Props = {
  /** The one title of the screen. */
  title: string;
  /** A line under the title. */
  subtitle?: string;
  /** Sits above the title: the wordmark on the first screen of the app. */
  lead?: ReactNode;
  onBack?: () => void;
  action?: HeaderAction;
  /** False when the screen brings its own scrolling list. */
  scroll?: boolean;
  children: ReactNode;
};

/** The frame of a portrait screen: safe area, the screen gutter, an optional back row and the title. */
export function Screen({ title, subtitle, lead, onBack, action, scroll = true, children }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const header = (
    <View>
      {onBack || action ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', minHeight: theme.size.controlTouch }}>
          {onBack ? <HeaderButton icon="chevron" flip label="Back" onPress={onBack} /> : <View />}
          {action ? <HeaderButton {...action} /> : null}
        </View>
      ) : null}
      {lead ? <View style={{ paddingTop: space.space8, paddingBottom: space.space6 }}>{lead}</View> : null}
      <ScreenTitle title={title} subtitle={subtitle} />
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface0 }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            indicatorStyle="white"
            contentContainerStyle={{
              paddingHorizontal: space.space4,
              paddingTop: onBack || action ? 0 : space.space4,
              paddingBottom: space.space12,
              gap: space.space6,
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
            <View style={{ paddingHorizontal: space.space4, paddingTop: onBack || action ? 0 : space.space4, paddingBottom: space.space3 }}>
              {header}
            </View>
            {children}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The large title of a screen and the line under it. The only text in the app set at weight 600. */
export function ScreenTitle({ title, subtitle, muted }: { title: string; subtitle?: string; muted?: boolean }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  return (
    <View style={{ gap: 2, flexShrink: 1 }}>
      <Text accessibilityRole="header" style={[theme.type.title, { fontWeight: weight.semibold, color: muted ? colors.inkMuted : colors.ink }]}>
        {title}
      </Text>
      {subtitle ? <Text style={[theme.type.dense, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>{subtitle}</Text> : null}
    </View>
  );
}

/** A text button in the header row: the way back on the left, one action on the right. Ice, as links are. */
export function HeaderButton({ icon, label, onPress, flip }: HeaderAction & { flip?: boolean }) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: flip ? 2 : space.space2,
        minWidth: theme.size.controlTouch,
        height: theme.size.controlTouch,
        // The chevron's own side bearing would otherwise set it in from the gutter.
        marginLeft: flip ? -space.space1 : 0,
        paddingRight: flip ? space.space2 : 0,
        borderRadius: theme.radius.radiusLg,
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Icon name={icon} size={20} color={colors.signal} flip={flip} />
      <Text style={[theme.type.bodyTouch, { color: colors.signal }]}>{label}</Text>
    </Touchable>
  );
}
