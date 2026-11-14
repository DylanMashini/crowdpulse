"""Triage Cam check-in mount, v2: MagSafe "pill" that stands the phone above the lid.

A pill-shaped body hangs behind the lid and rises above its top edge. A MagSafe
charger puck is glued into a round pocket facing the operator. The phone snaps
on by its back, in landscape, above the lid: screen towards the operator, rear
camera looking past the end of the pill at the patient.

Run:  uv run --python 3.12 --with cadquery --with matplotlib mount_v2.py

Axes: X runs along the lid's top edge; x=0 is the centre of the puck.
      Y is normal to the lid; y=0 is the lid's back surface, +Y points at the patient.
      Z is up; z=0 is the lid's top edge.
"""

import math
from pathlib import Path

import cadquery as cq

# ---- Measure these before printing -----------------------------------------
LID_T = 4.2          # MacBook Pro 14" lid thickness at the top edge
PUCK_D = 55.9        # MagSafe charger diameter
PUCK_T = 5.3         # MagSafe charger thickness
PHONE_W, PHONE_L, PHONE_D = 70.6, 146.6, 8.25   # bare iPhone 15 Pro

# ---- Fit --------------------------------------------------------------------
LID_FIT = 0.3        # extra room in the hook
PUCK_FIT = 0.25      # radial room around the puck (glue takes up the rest)
PUCK_PROUD = 0.4     # puck face stands this far out of the pocket so it, not the rim, touches the phone
SILL_GAP = 0.5       # air between the phone's lower edge and the sill, so no button is pressed

# ---- Body -------------------------------------------------------------------
BODY_T = 8.0         # pill thickness
RIM = 1.6            # wall around the puck; sets the pill's width
TONGUE = 42.0        # how far the pill reaches down behind the lid
SILL_T = 3.0         # bar over the lid's top edge
FRONT_LIP_D = 6.0    # how far the hook comes down over the top bezel
CHAMFER = 1.5        # back perimeter (this face sits on the print bed)
CABLE_W = 6.4        # slot for the charger's strain relief and cable, leaving the pill sideways
CABLE_DEPTH = 5.4    # measured from the pill's operator-side face
CABLE_SIDE = 1       # +1: cable leaves towards +X, -1: towards -X. The phone's camera end goes on the other side.

OUT = Path(__file__).parent / "out"


def box(x0, x1, y0, y1, z0, z1):
    return (
        cq.Workplane("XY")
        .box(x1 - x0, y1 - y0, z1 - z0, centered=False)
        .translate((x0, y0, z0))
    )


def cyl_y(r, y0, y1, zc, x=0.0):
    """Cylinder with its axis along Y."""
    return (
        cq.Workplane("XZ").center(x, zc).circle(r).extrude(-(y1 - y0)).translate((0, y0, 0))
    )


def dims():
    r = PUCK_D / 2 + PUCK_FIT + RIM                 # pill half-width
    zc = SILL_T + SILL_GAP + PHONE_W / 2            # puck centre height
    phone_back = -PUCK_PROUD                        # plane of the phone's back
    y_front = phone_back - PHONE_D - 0.05           # operator-side face of sill and hook
    return r, zc, phone_back, y_front


def build():
    r, zc, phone_back, y_front = dims()
    gap = LID_T + LID_FIT
    z_low = -TONGUE + r                             # centre of the pill's lower round end

    # pill: a stadium outline, flat on both faces
    pill = (
        cq.Workplane("XZ").center(0, (zc + z_low) / 2)
        .slot2D(zc - z_low + 2 * r, 2 * r, 90).extrude(-BODY_T)
    )
    pill = pill.faces(">Y").edges().chamfer(CHAMFER)
    pill = pill.faces("<Y").edges().chamfer(0.6)

    # hook: sill over the lid edge and a lip down the display side
    hook = box(-r, r, y_front, 0.5, 0, SILL_T).union(box(-r, r, y_front, -gap, -FRONT_LIP_D, 0))
    hook = hook.edges(cq.selectors.BoxSelector((-r - 1, y_front - 1, -FRONT_LIP_D - 0.1),
                                               (r + 1, -gap + 1, -FRONT_LIP_D + 0.1))).edges("|Y").fillet(3.0)
    hook = hook.edges(cq.selectors.BoxSelector((-r - 1, y_front - 0.1, SILL_T - 0.1),
                                               (r + 1, y_front + 0.1, SILL_T + 0.1))).fillet(1.2)
    mount = pill.union(hook).clean()

    # puck pocket, opening towards the operator
    floor = PUCK_T - PUCK_PROUD
    mount = mount.cut(cyl_y(PUCK_D / 2 + PUCK_FIT, -1, floor, zc))
    # push-out hole, also lets glue squeeze through
    mount = mount.cut(cyl_y(4.0, floor - 1, BODY_T + 1, zc))
    # cable slot: straight out of the puck's edge, horizontally, through the pill's side
    x0, x1 = sorted((CABLE_SIDE * (PUCK_D / 2 - 3), CABLE_SIDE * (r + 1)))
    mount = mount.cut(box(x0, x1, -1, CABLE_DEPTH, zc - CABLE_W / 2, zc + CABLE_W / 2))
    # shallow ring on the back, concentric with the puck
    ring = cyl_y(21.0, BODY_T - 0.6, BODY_T + 1, zc).cut(cyl_y(20.0, BODY_T - 2, BODY_T + 2, zc))
    mount = mount.cut(ring).clean()

    # reference bodies for checking and the preview (not printed)
    phone = box(-PHONE_L / 2, PHONE_L / 2, phone_back - PHONE_D, phone_back,
                SILL_T + SILL_GAP, SILL_T + SILL_GAP + PHONE_W)
    lid = box(-110, 110, -LID_T - LID_FIT / 2, -LID_FIT / 2, -150, -0.01)
    puck = cyl_y(PUCK_D / 2, phone_back, floor, zc)
    return mount, phone, lid, puck


def check(mount, phone, lid, puck):
    r, zc, _, _ = dims()
    s = mount.val()
    bb = s.BoundingBox()
    return {
        "solids": len(s.Solids()),
        "valid": s.isValid(),
        "volume_cm3": round(s.Volume() / 1000, 1),
        "size_mm": (round(bb.xlen, 1), round(bb.ylen, 1), round(bb.zlen, 1)),
        "overlap_with_phone_mm3": round(mount.intersect(phone).val().Volume(), 3),
        "overlap_with_lid_mm3": round(mount.intersect(lid).val().Volume(), 3),
        "overlap_with_puck_mm3": round(mount.intersect(puck).val().Volume(), 3),
        "pill_width_mm": round(2 * r, 1),
        "pill_edge_from_phone_end_mm": round(PHONE_L / 2 - r, 1),
        "height_above_lid_mm": round(bb.zmax, 1),
        "wall_behind_puck_mm": round(BODY_T - (PUCK_T - PUCK_PROUD), 2),
    }


def preview(mount, phone, lid, puck, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    light = np.array([0.35, 0.55, 0.75]); light /= np.linalg.norm(light)

    def mesh(wp, rgb, alpha, tol=0.08):
        verts, faces = wp.val().tessellate(tol)
        v = np.array([p.toTuple() for p in verts]); f = np.array(faces)
        t = v[f]
        n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        shade = 0.45 + 0.55 * np.abs(n @ light)
        cols = np.clip(np.outer(shade, rgb), 0, 1)
        cols = np.hstack([cols, np.full((len(cols), 1), alpha)])
        return Poly3DCollection(t, facecolors=cols, edgecolors="none")

    scenes = [
        ("patient side, phone on", 18, 62, True),
        ("operator side, phone on", 18, -118, True),
        ("operator side, phone off", 18, -118, False),
        ("patient side, mount only", 18, 62, False),
    ]
    fig = plt.figure(figsize=(20, 5.6))
    for n, (title, elev, azim, with_phone) in enumerate(scenes, 1):
        ax = fig.add_subplot(1, 4, n, projection="3d")
        ax.add_collection3d(mesh(lid, (0.72, 0.74, 0.77), 0.30, 0.5))
        ax.add_collection3d(mesh(mount, (0.16, 0.17, 0.19), 1.0))
        if with_phone:
            ax.add_collection3d(mesh(phone, (0.55, 0.57, 0.60), 0.45, 0.5))
        elif "operator" in title:
            ax.add_collection3d(mesh(puck, (0.93, 0.93, 0.94), 1.0))
        ax.set_xlim(-90, 90); ax.set_ylim(-90, 90); ax.set_zlim(-100, 80)
        ax.set_box_aspect((1, 1, 1)); ax.view_init(elev=elev, azim=azim)
        ax.set_title(title); ax.set_axis_off()
    fig.tight_layout()
    fig.savefig(path, dpi=110)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    mount, phone, lid, puck = build()
    for k, v in check(mount, phone, lid, puck).items():
        print(f"{k}: {v}")

    cq.exporters.export(mount, str(OUT / "triagecam_mount_v2.step"))
    # print orientation: flat back on the bed, pocket and cable groove facing up
    printable = mount.rotate((0, 0, 0), (1, 0, 0), -90).translate((0, 0, BODY_T))
    cq.exporters.export(printable, str(OUT / "triagecam_mount_v2_print.stl"), tolerance=0.03)
    pbb = printable.val().BoundingBox()
    print("print_z_range:", round(pbb.zmin, 2), round(pbb.zmax, 2))
    asm = cq.Assembly()
    asm.add(mount, name="mount", color=cq.Color(0.16, 0.17, 0.19))
    asm.add(puck, name="magsafe_puck_reference", color=cq.Color(0.9, 0.9, 0.9))
    asm.add(phone, name="phone_reference", color=cq.Color(0.5, 0.5, 0.55))
    asm.add(lid, name="lid_reference", color=cq.Color(0.7, 0.7, 0.7))
    asm.save(str(OUT / "triagecam_mount_v2_assembly.step"))
    preview(mount, phone, lid, puck, OUT / "preview_v2.png")
    print("wrote", sorted(p.name for p in OUT.iterdir() if "v2" in p.name))
