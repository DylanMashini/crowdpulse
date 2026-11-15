# Phone mount

Printed mount that holds the check-in iPhone on the lid of the laptop running the dashboard.
Each version is one CadQuery script; outputs go to `out/`.

| Version | Script | What it is |
|---|---|---|
| v1 | `mount.py` | Landscape channel on the back of the lid. |
| v2 | `mount_v2.py` | MagSafe "pill": needs a MagSafe charger puck glued in. |
| v3 | `mount_v3.py` | Wedge and sleeve. No MagSafe, no bought parts. Current. |

```bash
cd hardware/phone-mount
uv run --python 3.12 --with cadquery --with matplotlib mount_v3.py
```

The script prints its fit checks, stops with an assertion if one fails, and writes:

- `out/triagecam_mount_v3_print.stl`: already in print orientation
- `out/triagecam_mount_v3.step`, `out/triagecam_mount_v3_assembly.step` (mount, phone and lid)
- `out/preview_v3.png`, `out/section_v3.png`

## v3

### What changed from v2

- **No MagSafe puck.** The phone stands in a printed sleeve and is held by gravity and the sleeve walls.
- **Portrait, behind the lid.** The phone hangs behind the lid with its USB-C end down and its top 58 mm above the lid's edge. v2 stood the whole phone above the lid in landscape.
- **The phone stands vertical.** The body is a hollow wedge: one face lies on the back of the lid, the other is vertical when the lid is open at 110 degrees (`LID_ANGLE`). v2 held the phone parallel to the lid, so it leaned back 20 degrees.
- **Either way round, same print.** See below.
- One piece, 76.2 mm along the lid, 46.2 mm deep, 96.4 mm tall, 50 cm3, about 62 g in PLA.

### Both orientations

The sleeve holds only the lowest 62 mm of the phone. On an iPhone 15 Pro that stretch has no button, lens or sensor on either face, so the phone drops in facing either way and nothing is reprinted or adjusted.

- **Camera out:** rear camera towards the patient, screen towards the operator. The front camera looks at the operator over the lid.
- **Camera in:** rear camera towards the operator, looking over the lid. The camera plateau sits 6.7 mm above the top of the hook, and the plateau never passes the hook when the phone slides in.

The script checks both: no overlap between mount and phone (plateau and lenses included), and every printed point and the lid stay outside Apple's keep-out cones for the three rear cameras, the LiDAR scanner, the flash's inner cone and the front camera, by at least 9 degrees. One exception, reported and not asserted: with the camera in, the flash's 157 degree outer cone grazes the top of the hook by 6 degrees. The flash is not used for a sitting.

Buttons: the sleeve's top is 19.6 mm below the lowest button edge. Both sides stay open above it. The SIM tray is inside the sleeve.
USB-C: a 20 x 8.95 mm opening through the sleeve floor, centred on the port (Apple's connector keep-out is 12.45 x 6.60 mm). Dock the phone, then plug the cable in from below.

### Dimensions and where they come from

iPhone 15 Pro, from Apple's dimensional drawing dated 2023-10-10 (`developer.apple.com/accessories/dimensional-drawings/`, `iphone-15-pro.pdf`):

| Dimension | Value (mm) |
|---|---|
| Width, length, thickness | 70.60, 146.61, 8.25 |
| Camera plateau with its blend | 1.04 to 45.22 from the side, 1.04 to 46.54 from the top |
| Back glass to plateau, to camera glass | 2.05, 3.78 |
| Rear lens centres (from side, from top), diameter | (14.17, 14.17), (14.17, 33.41), (32.16, 23.79), 16.20 |
| Action button, volume up, volume down centres from the top | 31.67, 45.22, 59.42 |
| Side button centre from the top, half length | 56.17, 8.85 |
| Lowest button edge from the top | 65.02 |
| USB-C | centred on the bottom edge; connector keep-out 12.45 x 6.60 |
| Keep-out cones | camera 1: 123 degrees, camera 2: 86, camera 3: 33.2, LiDAR: 80.75, flash: 112 inner and 157 outer, front camera: 94 |

Phone weight 187 g: Apple's iPhone 15 Pro technical specifications.

MacBook Pro 14-inch (2024), from Apple's technical specifications (`support.apple.com/en-us/121552`): 312.6 x 221.2 x 15.5 mm closed, display 3024 x 1964 at 254 ppi.

- **Lid edge to first pixel: 5.1 mm**, derived for the sides: (312.6 - 3024 / 254 x 25.4) / 2. Assumed the same at the top. The hook's lip comes 4.0 mm down the display side, so it stays on the border.
- **Lid thickness at the top edge: 4.2 mm. Not confirmed.** Apple publishes no drawing for this lid and no measured figure was found. The value is carried over from v2. It is the parameter `LID_T`; the hook leaves 0.5 mm more (`LID_FIT`).
- **Notch size: not confirmed.** The mount is 76 mm wide and the lid 312.6 mm, so hang it to one side, clear of the notch and the laptop's camera.

Apple's Accessory Design Guidelines (section 22.3, MacBook mount) say a mount shall not scratch the MacBook, shall not prevent closing it, and should not touch the display glass. v3, like v2, has a lip resting on the display border: the lid leans back, so about a third of the load (roughly 0.9 N) sits on that lip. `FELT_T` makes room for a felt strip there.

Fit: 0.4 mm each side across the phone's width, 0.35 mm each side across its thickness (`FIT_W`, `FIT_D`). `PROTECTOR_T` adds room for a screen protector.

### Printing

- Orientation: as exported, one end face on the bed (footprint 96 x 46 mm, 76 mm tall). The part is its side profile drawn upwards.
- No supports. Two bridges of 9 mm: the upper end wall of the sleeve and the roof of the USB-C opening.
- 0.2 mm layers, 0.4 mm nozzle, 3 perimeters, 15% infill. PLA or PETG; PETG if it will sit in a warm room for days.
- The bed-side edges are chamfered 0.6 mm, so no elephant-foot trimming should be needed in the sleeve.

### Needs a test fit by a person

Nothing here has been printed or tried on the hardware.

1. Measure the lid's thickness at the top edge with calipers and set `LID_T`.
2. Check the phone slides into the sleeve without force and without rattling, both ways round. Adjust `FIT_W` and `FIT_D`.
3. Check the lip does not cover pixels or the menu bar, and that the mount sits clear of the notch.
4. With the lid at the usual angle, check the phone stands vertical and the lid does not sag under about 250 g. Set `LID_ANGLE` to the angle actually used.
5. Camera in: look at the phone's picture and confirm no edge of the hook or lid is in frame, on the wide camera too.
6. Plug in the charge cable used on the day and confirm its plug fits the opening.
7. The app's sitting screen is locked to landscape and the phone stands in portrait here. Confirm the picture and the face outlines are the right way up on the dashboard.
8. Take the mount off before closing the laptop.
