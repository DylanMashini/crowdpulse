import { NativeTabs } from 'expo-router/native-tabs';

import { useNurse } from '@/lib/nurse/NurseProvider';
import { alertsToAcknowledge } from '@/lib/nurse/nurseFormat';
import { fonts, useTheme } from '@/theme';

/**
 * The nurse role's four tabs on the system tab bar (UITabBarController through
 * react-native-screens), which iOS 26 and later draw as Liquid Glass floating over the
 * content. Icons are SF Symbols so they take the bar's own weight and selection treatment.
 * The Flags tab carries the number of alerts nobody has acknowledged.
 */
export default function NurseTabs() {
  const theme = useTheme();
  const { colors } = theme;
  const { flags } = useNurse();
  const waiting = flags ? alertsToAcknowledge(flags) : 0;

  return (
    <NativeTabs
      tintColor={colors.signal}
      badgeBackgroundColor={colors.flag}
      labelStyle={{ fontFamily: fonts.sans[500] }}
      // The bar stays whole while a list scrolls: a nurse changes tab one-handed, mid-list.
      minimizeBehavior="never"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="list.bullet.clipboard" />
        <NativeTabs.Trigger.Label>Worklist</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="flags">
        <NativeTabs.Trigger.Icon sf={{ default: 'flag', selected: 'flag.fill' }} />
        <NativeTabs.Trigger.Label>Flags</NativeTabs.Trigger.Label>
        {waiting > 0 ? <NativeTabs.Trigger.Badge>{String(waiting)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="patients">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
        <NativeTabs.Trigger.Label>Patients</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="you">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
        <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
