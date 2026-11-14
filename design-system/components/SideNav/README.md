# SideNav

The dashboard's navigation. The shipped component is `apps/web/src/components/ds/SideNav.tsx`; the copy in `bundle.js` is the earlier, simpler rail and is kept only as a reference.

## Forms

- **Rail** (window 768px and wider). `nav-width` (200px) wide, full height, sticky, on `surface-0` with a `line` on its inner edge. Items are `nav-row` (30px) tall, 2px apart, at `dense`, with a 16px icon and a 10px gap.
- **Collapsed rail.** 60px wide, icons only. Each control shows its name beside it on hover and on keyboard focus. The dashboard collapses the rail by default under 1120px and remembers the nurse's own choice.
- **Bar** (window under 768px). Brand, connection state and account on one line, the destinations in one row below that scrolls sideways and keeps the current one in view.

## Props

| Prop | Meaning |
|---|---|
| `groups` | `{ id, label?, items }[]`. A group is a short labelled list: "Triage", "Station". |
| `groups[].items` | `{ id, label, icon, href, alert?, alertWord?, alertLabel?, live? }`. |
| `active` | The `id` of the current destination. |
| `homeHref` | Where the brand lockup leads. |
| `descriptor` | One or two words under the product name: "Vitals station". |
| `station` | The live state card: `{ stream, title, stats?, statsHref, device, deviceHref }`. |
| `account` | `{ name, note?, onSignOut, busy?, error? }`. Opens a menu with the full name and Sign out. |
| `collapsed`, `onToggleCollapsed` | Icons only, and the control that switches. Leave `onToggleCollapsed` out to hide the control. |

## Rules

- Destinations are data. Relabel, reorder or regroup them where `groups` is built; the component holds no labels of its own.
- **Hover** is `surface-2` with `ink` text. **Active** is `surface-3` with a 1px `line` highlight along its top edge, and its icon in `signal`. No stripe on an edge.
- A group label is `caption` in `ink-faint`, 16px above it and 6px below.
- **`alert`** is a count of things waiting for the nurse (patients with a flag, trend or overdue, that nobody has acknowledged). It is a plain tabular number at `caption`, in `urgent` when any of them is urgent and `ink-faint` otherwise, shown only above zero. `alertWord` puts one word after the number ("2 new") so it is not read as the total on the station card. In the collapsed rail it is a 6px dot in the same colour, and the tooltip carries the number.
- **`live`** is a 6px `signal` dot with `glow-live` and its words for screen readers: "Sitting in progress" on Check-in.
- **Station card.** Up to three numbers from the worklist (waiting, flagged, overdue) and the camera phone with its state: "Live view on", "Online", "Offline, last seen 12 min ago", the words Check-in uses. The connection word is "Live", "Connecting" or "Reconnecting"; reconnecting is in `watch`. Nothing pulses.
- A filled dot means connected. A hollow dot means not. The words beside it always say which.
- Every control is reachable by keyboard and shows the standard focus ring. The account menu closes on Escape and returns focus to its button. It stays open while sign-out runs, and shows the error there if sign-out fails.
