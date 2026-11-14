# Moving a screen to Night Shift

Night Shift replaced the first design system (green accent, light and dark themes, Atkinson Hyperlegible). Old token names were kept wherever a mapping exists, so both apps still compile. This file lists what changed so each screen can be moved off the old names and checked against the new values.

Web classes follow the token name (`bg-surface-2`, `text-ink-faint`, `border-line`, `rounded-lg`, `type-dense`, `h-row`). Mobile names are the same in camel case (`colors.surface2`, `colors.inkFaint`, `type.dense`, `size.row`).

## Themes

- There is one theme, `dark`. The light theme is removed.
- Web: `tokens.css` defines every variable once on `:root`. `data-theme="dark"` and `data-theme="light"` do nothing and can be deleted where they appear (`SideNav.tsx`, `LandingPage.tsx`). `prefers-color-scheme` is not consulted.
- Mobile: `ThemeName` is `'dark'`. `colors.light` and `shadow.light` no longer exist. `useTheme()` and `useTheme('dark')` return the same theme; `apps/mobile/src/theme/index.ts` no longer reads `useColorScheme`. `userInterfaceStyle` in `app.json` is still `automatic`; changing it is a native config change, so leave it and render dark in both appearances.

## Colour

Deprecated names still resolve. Replace them when you touch a screen.

| Old token | Now resolves to | Use instead |
|---|---|---|
| `surface` | `surface-0` | `surface-0` |
| `surface-raised` | `surface-1` | `surface-1` for panels, `surface-2` for cards and the detail pane, `surface-3` for overlays |
| `surface-sunken` | `surface-2` | Split by role: input wells `surface-0`, meter tracks and avatars `surface-4`, score 0 chip `surface-3`, table headers no fill |
| `flag` | `watch` | `watch` or `urgent`, chosen by severity (see the README) |
| `flag-soft` | `watch-soft` | `watch-soft` or `urgent-soft` |
| `critical` | `urgent` | `urgent` |
| `critical-soft` | `urgent-soft` | `urgent-soft` |
| `on-critical` | `on-urgent` | `on-urgent`, or `on-score-3` on the score chip |

Same name, new value or new meaning:

| Token | Was | Is now |
|---|---|---|
| `line`, `line-strong` | Opaque greys; `line-strong` was a 3:1 control border | The text colour at 7% and 14%. A control is told by its fill step as well as its border |
| `ink`, `ink-muted` | The only two text colours | Primary and secondary. Captions, column heads and ages move to the new `ink-faint` |
| `signal` | Green brand colour, used as the primary button fill | Ice, `#a9dcf7`. Not a fill: the primary button is `signal-strong` |
| `signal-soft` | Opaque tint for selected rows and nav | Ice at 11%, for the Live tag and focus halo only. Selected nav is `surface-3`; a selected row is `surface-2` |
| `on-signal` | Text on the green fill | Text on `signal` and `signal-strong` |
| `overdue`, `on-overdue` | `ink` on `surface-raised` | `ink` with `surface-0` text |
| `score-0` | `surface-sunken`, digit in `ink` | `surface-3`, digit in `on-score-0` |
| `score-1` | Opaque amber, digit in `ink` | `watch-soft`, digit in `on-score-1` |
| `score-2` | Solid amber | `watch-strong` (amber at 26%) |
| `on-score-2` | Dark digit on the solid fill | `watch` |
| `score-3` | `critical` | `urgent`, digit in `on-score-3` |
| `series-reference` | `ink` | `ink-muted` |
| `focus` | Blue | Ice, the same value as `signal` |
| `scrim` | 56% | 64%, darker base |

New: `surface-0` to `surface-4`, `line-hover`, `ink-faint`, `ink-bright`, `signal-strong`, `signal-line`, `stable`, `stable-soft`, `watch`, `watch-soft`, `watch-strong`, `urgent`, `urgent-soft`, `urgent-soft-hover`, `urgent-line`, `urgent-line-strong`, `on-urgent`, `on-score-0`, `on-score-1`, `on-score-3`.

Removed: nothing by name. The light value of every token is gone.

The spec page writes some names differently. `text`, `text-2`, `text-3` are `ink`, `ink-muted`, `ink-faint`. `ice`, `ice-strong`, `ice-soft`, `ice-line`, `on-ice` are `signal`, `signal-strong`, `signal-soft`, `signal-line`, `on-signal`. `r-chip`, `r-control`, `r-panel`, `r-window` are `radius-sm`, `radius-md`, `radius-lg`, `radius-xl`. `t-fast`, `t-state`, `t-enter` are `duration-fast`, `duration-state`, `duration-enter`.

## Type

Fonts: Atkinson Hyperlegible Next and Mono are replaced by Geist and Geist Mono on the web, and by the system face and system monospace on mobile.

| Token | Was | Is now |
|---|---|---|
| `title` | 28/34, 600, -0.01em | 28/34, 500, -0.02em |
| `heading` | 20/26, 600 | 20/28, 500, -0.01em |
| `subheading` | 16/22, 600 | 15/22, 500 |
| `body` | 15/22 | 14/22 |
| `body-strong` | 15/22, 600 | 14/22, 500 |
| `body-touch` | 17/24 | 16/24 |
| `label` | 13/16, 500 | 13/20, 500 |
| `caption` | 13/18 | 12/16, +0.01em |
| `readout-xl` | 72/72, 600, -0.02em | 72/72, 400, -0.03em |
| `readout-lg` | 40/44, 600 | 48/48, 400, -0.03em |
| `readout-md` | 22/28, 500 | 28/32, 400, -0.02em |

New: `display`, `dense`, `readout-sm`.

The spec's `heading` (15/22) is the token `subheading`, and the spec's `title-2` (20/28) is the token `heading`. The README has the full map.

Weights: 600 is now for iOS large titles only. On the web, replace `font-semibold` with `font-medium`. Body text on the web was set to 15/22 in `apps/web/src/app/globals.css`; it should become 14/22, and the spec also sets `font-feature-settings: "ss01", "cv11"` on the body.

**Mobile `fonts`.** `fonts.sans[400|500|600]` and `fonts.mono[…]` still exist, but every weight now returns the same family name (`System` or `ui-monospace`), so `fontFamily: fonts.sans[600]` no longer makes text heavier. Replace each of those with a weight from the new `weight` export (`weight.normal`, `weight.medium`, `weight.semibold`) or with a `type` style, which now carries both `fontFamily` and `fontWeight`:

```ts
// before
{ fontFamily: fonts.sans[600] }
// after
{ fontWeight: weight.medium }
```

If `ui-monospace` does not resolve in the simulator, set `type.mobileFamilies.mono` to `Menlo` in `tokens.json` and run `pnpm tokens`. The six Atkinson TTFs in `apps/mobile/assets/fonts` and their `expo-font` entry in `app.json` are no longer referenced by any token; removing the `app.json` entry changes native config, so leave it unless a new development build is planned.

## Spacing

The scale is now `space-N` = N × 4px, which changes the value of three existing steps.

| Token | Was | Is now | Old value is now |
|---|---|---|---|
| `space-1` to `space-4` | 4, 8, 12, 16 | Unchanged | |
| `space-5` (`p-5`, `space.space5`) | 24px | 20px | `space-6` |
| `space-6` (`p-6`, `space.space6`) | 32px | 24px | `space-8` |
| `space-7` (`p-7`, `space.space7`) | 48px | 48px, deprecated | `space-12` |
| `space-8` (`p-8`, `space.space8`) | 64px | 32px | `space-16` |

New: `space-12` (48px), `space-16` (64px). There is no `space-9`, `space-10` or `space-11`.

Every use of step 5, 6 or 8 has shifted. Most of them want the new value (panel padding is 20px in Night Shift), but check each one.

## Size

| Token | Was | Is now |
|---|---|---|
| `control-md` | 36px | 32px |
| `nav-width` (`w-nav`) | 240px | 200px |
| `control-touch`, `phone-width` | 48px, 390px | Unchanged |

New: `control-lg` (40px), `row` (44px), `nav-row` (30px), `icon` (16px), `detail-width` (292px, `w-detail`).

## Radius

| Token | Was | Is now |
|---|---|---|
| `radius-xl` | 16px | 14px |
| `radius-pill` | Status badges and the switch | The switch, dots and avatars. Status chips are `radius-sm` |

`radius-sm`, `radius-md` and `radius-lg` are unchanged.

## Shadow and glow

- `shadow-overlay` is now `0 24px 64px rgba(0, 0, 0, 0.55)` and goes with `surface-3` and a `line-strong` outline.
- New: `glow-live` and `glow-urgent` (`glow-live` and `glow-urgent` utilities on the web, `shadow.dark.glowLive` and `shadow.dark.glowUrgent` on mobile).

## Motion

New. Web: `duration-fast`, `duration-state`, `duration-tick`, `duration-enter` utilities, the `ease-out` utility (now the Night Shift curve; `ease-in`, `ease-in-out` and `ease-linear` no longer exist), and `animate-tick` for a changing reading. `transition-colors` and the other transition utilities default to 120ms on that curve, so `duration-[120ms] ease-out` can be dropped. Mobile: the `motion` export (`motion.durationFast`, …, `motion.easeOut` as four control points).

Reduced motion on the web is handled in `globals.css`, which already removes transitions; it should also stop `animate-tick` and the live trace.

## Web utilities at a glance

`bg-surface-0` … `bg-surface-4`, `text-ink`, `text-ink-muted`, `text-ink-faint`, `border-line`, `border-line-strong`, `text-signal`, `bg-signal-strong`, `text-on-signal`, `bg-watch-soft`, `text-watch`, `bg-urgent`, `text-on-urgent`, `bg-urgent-soft`, `border-urgent-line`, `bg-score-1`, `text-on-score-1`, `outline-focus`, `rounded-sm|md|lg|xl|pill`, `h-control-md`, `h-control-lg`, `h-row`, `h-nav-row`, `size-icon`, `w-nav`, `w-detail`, `shadow-overlay`, `glow-live`, `glow-urgent`, `type-*`, `font-sans`, `font-mono`, `font-normal`, `font-medium`.
