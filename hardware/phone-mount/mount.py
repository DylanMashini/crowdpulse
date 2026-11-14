"""Triage Cam check-in mount: iPhone 15 Pro on the back of a MacBook Pro lid.

The phone sits in landscape behind the lid, screen against the mount plate,
rear camera pointing away from the operator (same direction as the lid back).

Run:  uv run --python 3.12 --with cadquery --with matplotlib mount.py

Axes: X runs along the lid's top edge (the phone's long axis), with x=0 at the
      inside of the end stop (the phone's USB-C end).
      Y is normal to the lid; y=0 is the lid's back surface, +Y points at the patient.
      Z is up; z=0 is the lid's top edge.
"""

from pathlib import Path

import cadquery as cq

# ---- Measure these two before printing -------------------------------------
LID_T = 4.2        # MacBook Pro 14" (2021 and later) lid thickness at the top edge
PHONE_D = 8.25     # phone thickness; bare iPhone 15 Pro. Use the cased thickness if cased.
PHONE_W = 70.6     # phone width (short side); bare. Use the cased width if cased.
PHONE_L = 146.6    # phone length; only used for the preview and the report

# ---- Fit --------------------------------------------------------------------
LID_FIT = 0.3      # extra room in the hook so it slides on without scraping
POCKET_CLR_W = 0.5 # extra room across the phone's width
POCKET_CLR_D = 0.6 # extra room across the phone's thickness (screen protector)

# ---- Mount geometry ---------------------------------------------------------
WALL = 3.0         # top bar, ledges and end stop thickness
PLATE_T = 2.4      # plate between the lid and the phone screen
PLATE_LEN = 120.0  # how far the plate and hook run along the lid
GRIP_LEN = 68.0    # how far the gripping channel runs from the USB-C end.
                   # Kept short of the side button and volume buttons, which
                   # start roughly 76 mm from the USB-C end.
LIP_T = 2.0        # thickness of the lips that hold the phone's back
LIP_REACH = 3.5    # how far those lips reach over the phone's back
FRONT_LIP_T = 1.6  # hook lip on the display side
FRONT_LIP_D = 6.0  # how far that lip comes down over the top bezel
USB_SLOT_W = 16.0  # opening in the end stop for a USB-C cable

OUT = Path(__file__).parent / "out"


def box(x0, x1, y0, y1, z0, z1):
    return (
        cq.Workplane("XY")
        .box(x1 - x0, y1 - y0, z1 - z0, centered=False)
        .translate((x0, y0, z0))
    )


def build():
    gap = LID_T + LID_FIT
    pw = PHONE_W + POCKET_CLR_W           # pocket size across the phone's width
    pd = PHONE_D + POCKET_CLR_D           # pocket size across the phone's thickness
    y_in, y_out = PLATE_T, PLATE_T + pd   # pocket faces
    y_max = y_out + LIP_T

    parts = [
        # plate against the lid back
        box(-WALL, PLATE_LEN, 0, PLATE_T, -(pw + WALL), 0),
        # hook: top bar over the lid edge, lip down the display side
        box(-WALL, PLATE_LEN, -gap - FRONT_LIP_T, PLATE_T, 0, WALL),
        box(-WALL, PLATE_LEN, -gap - FRONT_LIP_T, -gap, -FRONT_LIP_D, 0),
        # channel: upper and lower ledges, each with a lip over the phone's back
        box(-WALL, GRIP_LEN, y_in, y_max, 0, WALL),
        box(-WALL, GRIP_LEN, y_in, y_max, -(pw + WALL), -pw),
        box(-WALL, GRIP_LEN, y_out, y_max, -LIP_REACH, 0),
        box(-WALL, GRIP_LEN, y_out, y_max, -pw, -pw + LIP_REACH),
        # end stop at the USB-C end
        box(-WALL, 0, y_in, y_max, -pw, 0),
    ]
    mount = parts[0]
    for p in parts[1:]:
        mount = mount.union(p)

    # cable slot through the end stop, open towards the patient side
    mount = mount.clean().cut(
        box(-WALL - 1, 0, y_in + 0.8, y_max + 1,
            -pw / 2 - USB_SLOT_W / 2, -pw / 2 + USB_SLOT_W / 2)
    ).clean()

    # reference bodies for checking and the preview (not printed)
    phone = box(0.2, 0.2 + PHONE_L, y_in + POCKET_CLR_D / 2, y_in + POCKET_CLR_D / 2 + PHONE_D,
                -pw + POCKET_CLR_W / 2, -POCKET_CLR_W / 2)
    lid = box(-60, PLATE_LEN + 60, -LID_T - LID_FIT / 2, -LID_FIT / 2, -150, -0.01)
    return mount, phone, lid


def check(mount, phone, lid):
    s = mount.val()
    bb = s.BoundingBox()
    report = {
        "solids": len(s.Solids()),
        "valid": s.isValid(),
        "volume_cm3": round(s.Volume() / 1000, 1),
        "size_mm": (round(bb.xlen, 1), round(bb.ylen, 1), round(bb.zlen, 1)),
        "overlap_with_phone_mm3": round(mount.intersect(phone).val().Volume(), 3),
        "overlap_with_lid_mm3": round(mount.intersect(lid).val().Volume(), 3),
        "phone_overhang_past_plate_mm": round(PHONE_L - PLATE_LEN, 1),
    }
    return report


def preview(mount, phone, lid, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    def tris(wp, tol=0.2):
        verts, faces = wp.val().tessellate(tol)
        return [[verts[i].toTuple() for i in f] for f in faces]

    views = [("patient side", 25, 55), ("operator side", 25, -125), ("end on", 0, 180)]
    fig = plt.figure(figsize=(18, 6))
    for n, (title, elev, azim) in enumerate(views, 1):
        ax = fig.add_subplot(1, 3, n, projection="3d")
        for wp, color, alpha in ((lid, "#b8bcc2", 0.25), (phone, "#30343a", 0.35), (mount, "#e8632b", 1.0)):
            ax.add_collection3d(Poly3DCollection(tris(wp), facecolor=color, edgecolor="none", alpha=alpha))
        ax.set_xlim(-40, 160); ax.set_ylim(-100, 100); ax.set_zlim(-140, 60)
        ax.set_box_aspect((1, 1, 1)); ax.view_init(elev=elev, azim=azim)
        ax.set_title(title); ax.set_axis_off()
    fig.tight_layout()
    fig.savefig(path, dpi=110)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    mount, phone, lid = build()
    for k, v in check(mount, phone, lid).items():
        print(f"{k}: {v}")

    cq.exporters.export(mount, str(OUT / "triagecam_mount.step"))
    # print orientation: end stop flat on the bed, channel standing up, no supports
    printable = mount.rotate((0, 0, 0), (0, 1, 0), -90).translate((0, 0, WALL))
    cq.exporters.export(printable, str(OUT / "triagecam_mount_print.stl"), tolerance=0.05)
    asm = cq.Assembly()
    asm.add(mount, name="mount", color=cq.Color(0.9, 0.4, 0.15))
    asm.add(phone, name="phone_reference", color=cq.Color(0.2, 0.2, 0.2))
    asm.add(lid, name="lid_reference", color=cq.Color(0.7, 0.7, 0.7))
    asm.save(str(OUT / "triagecam_mount_assembly.step"))
    preview(mount, phone, lid, OUT / "preview.png")
    print("wrote", sorted(p.name for p in OUT.iterdir()))
