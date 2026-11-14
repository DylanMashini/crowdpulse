# SideNav

The dashboard's navigation. The shipped component is `apps/web/src/components/ds/SideNav.tsx`; the copy in `bundle.js` is the earlier, simpler rail and is kept only as a reference.

## Forms

- **Rail** (window 768px and wider). `nav-width` (240px) wide, full height, sticky. Always on the dark theme (`data-theme="dark"`), whatever the page uses, so the rail reads as the instrument's frame and the page as its content.
- **Collapsed rail.** 60px wide, icons only. Each control shows its name beside it on hover and on keyboard focus. The dashboard collapses the rail by default under 1120px and remembers the nurse's own choice.
- **Bar** (window under 768px). Brand, connection state and account on one line, the destinations in one row below that scrolls sideways and keeps the current one in view.

## Props

| Prop | Meaning |
|---|---|
| `groups` | `{ id, label?, items }[]`. A group is a short labelled list: "Triage", "Station". |
| `groups[].items` | `{ id, label, icon, href, count?, countLabel?, alert?, alertLabel?, live? }`. |
| `active` | The `id` of the current destination. |
| `homeHref` | Where the brand lockup leads. |
| `descriptor` | One or two words under the product name: "Vitals station". |
| `station` | The live state card: `{ stream, title, stats?, statsHref, device, deviceHref }`. |
| `account` | `{ name, note?, onSignOut, busy?, error? }`. Opens a menu with the full name and Sign out. |
| `collapsed`, `onToggleCollapsed` | Icons only, and the control that switches. Leave `onToggleCollapsed` out to hide the control. |

## Rules

- Destinations are data. Relabel, reorder or regroup them where `groups` is built; the component holds no labels of its own.
- **Active** is one surface step up with a hairline outline, and its icon in `signal`. No stripe on an edge.
- **`alert`** is a count of things waiting for the nurse (tickets with an unacknowledged trend flag). It is a `flag` chip, shown only above zero. In the collapsed rail it is a `flag` dot, and the tooltip carries the number.
- **`count`** is a plain total in `ink-muted` mono. Use it for how much a destination holds, never for urgency.
- **`live`** is a `signal` dot with its words for screen readers: "Sitting in progress" on Check-in.
- **Station card.** Up to three numbers from the worklist (waiting, flagged, overdue) and the camera phone with its state: "Live view on", "Online", "Offline since 14:12". The connection word is "Live", "Connecting" or "Reconnecting"; reconnecting is in `flag`. Nothing pulses.
- A filled dot means connected. A hollow dot means not. The words beside it always say which.
- Every control is reachable by keyboard and shows the standard focus ring. The account menu closes on Escape and returns focus to its button.
