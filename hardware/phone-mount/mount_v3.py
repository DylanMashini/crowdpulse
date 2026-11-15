"""Triage Cam check-in mount, v3: a printed wedge and sleeve, no MagSafe, no bought parts.

A slim wedge hooks over the top edge of the MacBook Pro lid and hangs behind it.
Its patient-side face is vertical when the lid is open at LID_ANGLE, and carries a
shallow sleeve. The phone drops into the sleeve in portrait, USB-C end down, and
stands with its camera end above the lid. The sleeve only holds the lower
SLEEVE_H of the phone, which has no buttons, no lens and no sensor on either
face, so the same print takes the phone either way round:

  "out": rear camera towards the patient, screen towards the operator.
  "in":  rear camera towards the operator, looking over the lid.

Run:  uv run --python 3.12 --with cadquery --with matplotlib mount_v3.py

Axes: X runs along the lid's top edge; x=0 is the phone's centre line.
      Y is horizontal; y=0 is the back corner of the lid's top edge, +Y points at the patient.
      Z is up (true vertical); z=0 is that same corner.
Lid frame: u is normal to the lid (towards the patient), w runs up the lid. The lid
      leans back by TILT = LID_ANGLE - 90 degrees.

Sources for the numbers are in README.md next to this file.
"""

import math
from pathlib import Path

import cadquery as cq

# ---- iPhone 15 Pro, bare. Apple dimensional drawing, 2023-10-10 ----------------
PHONE_W, PHONE_L, PHONE_D = 70.60, 146.61, 8.25
PHONE_MASS_G = 187.0             # Apple tech specs
PLATEAU_X = (1.04, 45.22)        # camera plateau incl. its blend, from the side edge nearest it
PLATEAU_Z = (1.04, 46.54)        # ... and from the top edge
PLATEAU_H = 2.05                 # back glass to plateau
LENS_H = 3.78                    # back glass to rear camera glass
LENS_D = 16.20
LENSES = ((14.17, 14.17), (14.17, 33.41), (32.16, 23.79))   # (from side, from top)
BUTTON_LOWEST = 65.02            # lowest edge of any button, from the top (volume down
                                 # 59.42 + 5.60, side button 56.17 + 8.85)
USB_KEEPOUT = (12.45, 6.60)      # recommended connector keep-out, centred on the bottom edge
# Keep-out cones: (name, centre from top, aperture half-height at the glass,
#                  apex depth behind the glass, full angle, glass height above the back glass)
REAR_CONES = (
    ("rear camera 1", 14.17, 0.0, 8.29, 123.0, LENS_H),
    ("rear camera 2", 33.41, 0.0, 7.59, 86.0, LENS_H),
    ("rear camera 3", 23.79, 0.0, 3.51, 33.2, LENS_H),
    ("LiDAR", 36.62, 14.37 / 2, 0.0, 80.75, PLATEAU_H),
    ("flash, inner cone", 10.22, 0.0, 8.35, 112.0, PLATEAU_H),
)
FLASH_OUTER = ("flash, outer cone", 10.22, 6.92 / 2, 0.0, 157.0, PLATEAU_H)   # reported, not asserted
FRONT_CONE = ("front camera and sensors", 12.82, 4.16 / 2, 0.0, 94.0, 0.0)

# ---- MacBook Pro 14-inch (2024). Measure LID_T before printing -------------------
LID_T = 4.2          # lid thickness at the top edge. NOT confirmed by an Apple source; carried over from v2
LID_ANGLE = 110.0    # lid opening angle at which the phone stands vertical
LID_BORDER = 5.1     # lid edge to first pixel: (312.6 - 3024 px / 254 ppi * 25.4) / 2, from Apple's specs
LID_W, LID_H = 312.6, 221.2

# ---- Fit -------------------------------------------------------------------------
FIT_W = 0.4          # room each side of the phone across its width
FIT_D = 0.35         # room each side of the phone across its thickness
PROTECTOR_T = 0.0    # screen protector thickness, if fitted
LID_FIT = 0.5        # room in the hook
FELT_T = 0.0         # optional felt or foam strip inside the hook lip; set its thickness here

# ---- Body ------------------------------------------------------------------------
PROTRUDE = 58.0      # how far the phone's top stands above the lid's top edge
SLEEVE_H = 62.0      # how much of the phone's lower end the sleeve holds
WALL = 2.4           # sleeve end walls
SPINE_T = 2.0        # vertical plate between the phone and the lid
FRONT_T = 2.0        # sleeve plate on the patient side
FLOOR_T = 3.0        # under the phone and across the bottom of the wedge
PAD_T = 1.6          # plate lying on the back of the lid
SPINE_Y = 2.4        # y of the spine's phone-side face
SILL_T = 3.2         # bar over the lid's top edge
LIP_T = 2.0          # hook lip on the display side
LIP_D = 4.0          # how far that lip comes down the display side; must stay inside LID_BORDER
USB_SLOT_W = 20.0    # opening under the USB-C port, full depth of the sleeve
END_CHAMFER = 0.6    # on the two end faces (one of them sits on the print bed)

PLA_DENSITY = 1.24   # g/cm3
OUT = Path(__file__).parent / "out"

TILT = math.radians(LID_ANGLE - 90.0)
C, S = math.cos(TILT), math.sin(TILT)


def lid_pt(u, w):
    """Lid frame (u, w) to world (y, z)."""
    return (u * C + w * S, -u * S + w * C)


def dims():
    cav_w = PHONE_W + 2 * FIT_W
    cav_d = PHONE_D + PROTECTOR_T + 2 * FIT_D
    z_pb = PROTRUDE - PHONE_L                 # phone's bottom edge = sleeve floor
    return {
        "cav_w": cav_w,
        "cav_d": cav_d,
        "width": cav_w + 2 * WALL,
        "z_pb": z_pb,
        "z_bot": z_pb - FLOOR_T,
        "z_sleeve_top": z_pb + SLEEVE_H,
        "y_front": SPINE_Y + cav_d + FRONT_T,
        "gap": LID_T + LID_FIT + FELT_T,
    }


def prism(pts, x0, x1):
    """Polygon in the YZ plane, extruded along X from x0 to x1."""
    return cq.Workplane("YZ").polyline(pts).close().extrude(x1 - x0).translate((x0, 0, 0))


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def cyl_y(r, x, z, y0, y1):
    return cq.Workplane("XZ").center(x, z).circle(r).extrude(-(y1 - y0)).translate((0, y0, 0))


def fillet_at(solid, y, z, r, tol=0.25):
    """Fillet the X-parallel edge that passes through (y, z)."""
    sel = cq.selectors.BoxSelector((-500, y - tol, z - tol), (500, y + tol, z + tol))
    return solid.edges(sel).edges("|X").fillet(r)


def build():
    d = dims()
    hw = d["width"] / 2
    gap, z_bot, z_pb, top = d["gap"], d["z_bot"], d["z_pb"], d["z_sleeve_top"]

    # wedge and hook, one outline. Counter-clockwise from the bottom corner on the lid.
    u_sill = (SPINE_Y - SILL_T * S) / C       # where the sill's top meets the spine's face
    outline = [
        (z_bot * S / C, z_bot),                           # foot, on the back of the lid
        (SPINE_Y, z_bot),
        (SPINE_Y, lid_pt(u_sill, SILL_T)[1]),
        lid_pt(-(gap + LIP_T), SILL_T),
        lid_pt(-(gap + LIP_T), -LIP_D),
        lid_pt(-gap, -LIP_D),
        lid_pt(-gap, 0),
        lid_pt(0, 0),
    ]
    body = prism(outline, -hw, hw)
    lip_out_top = lid_pt(-(gap + LIP_T), SILL_T)
    body = fillet_at(body, *lip_out_top, 1.8)
    body = fillet_at(body, *lid_pt(-(gap + LIP_T), -LIP_D), 0.8)
    body = fillet_at(body, *lid_pt(-gap, -LIP_D), 0.8)
    body = fillet_at(body, SPINE_Y, lid_pt(u_sill, SILL_T)[1], 1.0)
    body = fillet_at(body, outline[0][0], z_bot, 1.2)

    # hollow of the wedge: a triangle, open at both ends
    zf = z_bot + FLOOR_T
    ys = SPINE_Y - SPINE_T
    hollow = prism(
        [
            lid_pt(PAD_T, (zf + PAD_T * S) / C),
            (ys, zf),
            lid_pt(PAD_T, (ys - PAD_T * C) / S),
        ],
        -hw - 1, hw + 1,
    ).edges("|X").fillet(1.5)
    body = body.cut(hollow)

    # sleeve: floor, end walls and the patient-side plate
    sleeve = box(-hw, hw, ys, d["y_front"], z_bot, top)
    sleeve = fillet_at(sleeve, d["y_front"], z_bot, 3.0)
    sleeve = fillet_at(sleeve, d["y_front"], top, 1.0)
    mount = body.union(sleeve).clean()
    mount = mount.cut(box(-d["cav_w"] / 2, d["cav_w"] / 2, SPINE_Y, SPINE_Y + d["cav_d"], z_pb, top + 200))
    # USB-C: an opening through the floor, as deep as the sleeve
    mount = mount.cut(box(-USB_SLOT_W / 2, USB_SLOT_W / 2, SPINE_Y, SPINE_Y + d["cav_d"], z_bot - 1, z_pb + 1))
    # lead-in at the sleeve's mouth
    def mouth(e):
        c = e.Center()
        on_front = abs(c.y - (SPINE_Y + d["cav_d"])) < 0.05 and abs(c.x) < 1
        on_end = abs(abs(c.x) - d["cav_w"] / 2) < 0.05 and SPINE_Y < c.y < SPINE_Y + d["cav_d"]
        return abs(c.z - top) < 0.05 and (on_front or on_end)

    mount = mount.newObject([e for e in mount.val().Edges() if mouth(e)]).chamfer(0.6)
    # end faces: a chamfer, not a fillet, because one of them is the first layer
    mount = mount.faces("<X").edges().chamfer(END_CHAMFER)
    mount = mount.faces(">X").edges().chamfer(END_CHAMFER)
    return mount.clean()


def phone_ref(orientation):
    """Reference phone standing in the sleeve. 'out': rear camera at +Y. 'in': rear camera at -Y."""
    d = dims()
    y0 = SPINE_Y + FIT_D + (PROTECTOR_T if orientation == "in" else 0.0)
    z0 = d["z_pb"]
    body = box(-PHONE_W / 2, PHONE_W / 2, y0, y0 + PHONE_D, z0, z0 + PHONE_L)
    body = body.edges("|Y").fillet(9.0)
    if orientation == "out":
        sx, y_back, sy = 1.0, y0 + PHONE_D, 1.0      # camera at +X seen from above, facing +Y
    else:
        sx, y_back, sy = -1.0, y0, -1.0
    xa, xb = sorted((sx * (PHONE_W / 2 - PLATEAU_X[0]), sx * (PHONE_W / 2 - PLATEAU_X[1])))
    za, zb = PROTRUDE - PLATEAU_Z[1], PROTRUDE - PLATEAU_Z[0]
    ya, yb = sorted((y_back, y_back + sy * PLATEAU_H))
    plateau = box(xa, xb, ya, yb, za, zb).edges("|Y").fillet(8.0)
    phone = body.union(plateau)
    la, lb = sorted((y_back, y_back + sy * LENS_H))
    for from_side, from_top in LENSES:
        phone = phone.union(cyl_y(LENS_D / 2, sx * (PHONE_W / 2 - from_side), PROTRUDE - from_top, la, lb))
    return phone


def lid_ref(x_offset=0.0):
    """The lid, with LID_FIT shared between its two faces so that touching is not counted as overlap."""
    g = (LID_FIT + FELT_T) / 2
    pts = [lid_pt(-g, -0.02), lid_pt(-g - LID_T, -0.02), lid_pt(-g - LID_T, -LID_H), lid_pt(-g, -LID_H)]
    return prism(pts, -LID_W / 2 + x_offset, LID_W / 2 + x_offset)


def cone_margin(points, cone, facing, y_glass0):
    """Smallest angle, in degrees, between a keep-out cone and any of `points` (y, z).

    Worked in the YZ plane, which is the worst case: a point off to the side in X is
    further from the axis than its YZ projection says.
    facing: -1 looks towards the operator, +1 towards the patient.
    y_glass0: y of the phone face the sensor sits on.
    """
    name, from_top, r, apex_depth, full_angle, height = cone
    y_glass = y_glass0 + facing * height
    y_apex = y_glass - facing * apex_depth
    zc = PROTRUDE - from_top
    worst = 180.0
    for y, z in points:
        f = (y - y_apex) * facing
        if f <= 1e-6 or (y - y_glass) * facing < -1e-6:
            continue                                  # behind the sensor's glass
        off = max(abs(z - zc) - r, 0.0)
        worst = min(worst, math.degrees(math.atan2(off, f)))
    return worst - full_angle / 2


def check(mount):
    d = dims()
    s = mount.val()
    bb = s.BoundingBox()
    verts, _ = s.tessellate(0.05)
    pts = [(v.y, v.z) for v in verts]
    lid = lid_ref()
    pts_all = pts + [(v.y, v.z) for v in lid.val().tessellate(0.5)[0]]
    phones = {o: phone_ref(o) for o in ("out", "in")}
    mass = s.Volume() / 1000 * PLA_DENSITY
    com = cq.Shape.centerOfMass(s)
    y_phone = SPINE_Y + FIT_D + PHONE_D / 2
    y_cog = (mass * com.y + PHONE_MASS_G * y_phone) / (mass + PHONE_MASS_G)
    z_cog = (mass * com.z + PHONE_MASS_G * (d["z_pb"] + PHONE_L / 2)) / (mass + PHONE_MASS_G)

    r = {
        "solids": len(s.Solids()),
        "valid": s.isValid(),
        "volume_cm3": round(s.Volume() / 1000, 1),
        "mass_pla_g": round(mass),
        "size_mm (along lid, depth, height)": (round(bb.xlen, 1), round(bb.ylen, 1), round(bb.zlen, 1)),
        "sleeve_inside_mm (width, depth)": (round(d["cav_w"], 2), round(d["cav_d"], 2)),
        "hook_gap_mm": round(d["gap"], 2),
        "overlap_with_lid_mm3": round(mount.intersect(lid).val().Volume(), 3),
        "overlap_with_phone_out_mm3": round(mount.intersect(phones["out"]).val().Volume(), 3),
        "overlap_with_phone_in_mm3": round(mount.intersect(phones["in"]).val().Volume(), 3),
        # nothing printed reaches the camera plateau, either way round
        "plateau_above_hook_mm": round(PROTRUDE - PLATEAU_Z[1] - bb.zmax, 2),
        "plateau_above_sleeve_mm": round(PROTRUDE - PLATEAU_Z[1] - d["z_sleeve_top"], 2),
        "lowest_button_above_sleeve_mm": round(PROTRUDE - BUTTON_LOWEST - d["z_sleeve_top"], 2),
        "lowest_button_above_hook_mm": round(PROTRUDE - BUTTON_LOWEST - bb.zmax, 2),
        "usb_opening_mm": (USB_SLOT_W, round(d["cav_d"], 2)),
        "lip_on_display_side_mm": LIP_D,
        "lip_short_of_first_pixel_mm": round(LID_BORDER - LIP_D, 2),
        "phone_and_mount_cog_mm (y, z)": (round(y_cog, 1), round(z_cog, 1)),
        "print_bridge_span_mm": round(d["cav_d"], 2),
    }
    y_face = SPINE_Y + FIT_D
    for cone in REAR_CONES + (FLASH_OUTER,):
        r[f"clear_of_cone_in_deg: {cone[0]}"] = round(cone_margin(pts_all, cone, -1, y_face), 1)
        r[f"clear_of_cone_out_deg: {cone[0]}"] = round(cone_margin(pts_all, cone, +1, y_face + PHONE_D), 1)
    r["clear_of_cone_out_deg: front camera"] = round(cone_margin(pts_all, FRONT_CONE, -1, y_face), 1)
    r["clear_of_cone_in_deg: front camera"] = round(cone_margin(pts_all, FRONT_CONE, +1, y_face + PHONE_D), 1)

    assert r["solids"] == 1 and r["valid"]
    assert r["overlap_with_lid_mm3"] == 0, "the hook cuts into the lid"
    assert r["overlap_with_phone_out_mm3"] == 0 and r["overlap_with_phone_in_mm3"] == 0, "the phone does not fit"
    assert 0.3 <= FIT_W <= 0.5 and 0.3 <= FIT_D <= 0.5
    assert r["plateau_above_hook_mm"] >= 3, "the hook reaches the camera plateau when the camera faces in"
    assert r["plateau_above_sleeve_mm"] >= 3, "the sleeve reaches the camera plateau"
    assert r["lowest_button_above_sleeve_mm"] >= 5, "the sleeve reaches a button"
    assert r["lowest_button_above_hook_mm"] >= 0 or d["width"] / 2 - PHONE_W / 2 < 4, "buttons are walled in"
    assert USB_SLOT_W >= USB_KEEPOUT[0] + 4 and d["cav_d"] >= USB_KEEPOUT[1] + 1, "USB-C opening too small"
    assert r["lip_short_of_first_pixel_mm"] >= 0.5, "the hook lip covers pixels"
    assert y_cog > 0, "the load must hang behind the lid's top edge"
    for k, v in r.items():
        if k.startswith("clear_of_cone") and "outer" not in k:
            assert v >= 5, f"{k}: only {v} degrees"
    return r


def preview(mount, path):
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

    lid = lid_ref(x_offset=-70).intersect(box(-150, 150, -200, 200, -170, 50))
    scenes = [
        ("patient side, camera out", 16, 58, "out"),
        ("operator side, camera out", 16, -122, "out"),
        ("operator side, camera in", 16, -122, "in"),
        ("patient side, camera in", 16, 58, "in"),
        ("patient side, mount only", 16, 58, None),
        ("end on, mount only", 0, 0, None),
    ]
    fig = plt.figure(figsize=(21, 13))
    for n, (title, elev, azim, orient) in enumerate(scenes, 1):
        ax = fig.add_subplot(2, 3, n, projection="3d")
        ax.add_collection3d(mesh(lid, (0.72, 0.74, 0.77), 0.28, 0.5))
        ax.add_collection3d(mesh(mount, (0.16, 0.17, 0.19), 1.0))
        if orient:
            ax.add_collection3d(mesh(phone_ref(orient), (0.55, 0.57, 0.60), 0.55, 0.2))
        ax.set_xlim(-95, 95); ax.set_ylim(-95, 95); ax.set_zlim(-125, 65)
        ax.set_box_aspect((1, 1, 1)); ax.view_init(elev=elev, azim=azim)
        ax.set_title(title, fontsize=15); ax.set_axis_off()
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)


def section(mount, path):
    """Side view, cut a quarter of the way across the sleeve, both ways round, with the keep-out cones."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon

    d = dims()

    slab = mount.intersect(box(d["cav_w"] / 4 - 0.05, d["cav_w"] / 4 + 0.05, -200, 200, -200, 200))
    verts, faces = slab.val().tessellate(0.05)
    tris = [[(verts[i].y, verts[i].z) for i in f] for f in faces]

    fig, axes = plt.subplots(1, 2, figsize=(13, 10))
    for ax, orient in zip(axes, ("out", "in")):
        g = (LID_FIT + FELT_T) / 2
        ax.add_patch(Polygon([lid_pt(-g, 0), lid_pt(-g - LID_T, 0), lid_pt(-g - LID_T, -LID_H), lid_pt(-g, -LID_H)],
                             closed=True, facecolor="#c9ccd1", edgecolor="none"))
        for t in tris:
            ax.add_patch(Polygon(t, closed=True, facecolor="#292b30", edgecolor="#292b30", linewidth=0.3))
        y0 = SPINE_Y + FIT_D
        ax.add_patch(Polygon([(y0, d["z_pb"]), (y0 + PHONE_D, d["z_pb"]), (y0 + PHONE_D, PROTRUDE), (y0, PROTRUDE)],
                             closed=True, facecolor="#8d9197", edgecolor="none", alpha=0.75))
        facing = 1 if orient == "out" else -1
        y_back = y0 + PHONE_D if orient == "out" else y0
        za, zb = PROTRUDE - PLATEAU_Z[1], PROTRUDE - PLATEAU_Z[0]
        ax.add_patch(Polygon([(y_back, za), (y_back + facing * PLATEAU_H, za), (y_back + facing * PLATEAU_H, zb),
                              (y_back, zb)], closed=True, facecolor="#6f7379", edgecolor="none"))
        for cone, col in [(c, "#2f7fd1") for c in REAR_CONES[:4]]:
            _, from_top, r, apex, ang, h = cone
            yg = y_back + facing * h
            zc = PROTRUDE - from_top
            half = math.radians(ang / 2)
            r0 = r + apex * math.tan(half)             # half-height of the cone where it leaves the glass
            for sgn in (1, -1):
                ax.plot([yg, yg + facing * 70 * math.cos(half)],
                        [zc + sgn * r0, zc + sgn * (r0 + 70 * math.sin(half))], color=col, linewidth=0.7)
        _, from_top, r, apex, ang, h = FRONT_CONE
        ff, yg = -facing, (y0 if orient == "out" else y0 + PHONE_D)
        half = math.radians(ang / 2)
        for sgn in (1, -1):
            ax.plot([yg, yg + ff * 70 * math.cos(half)],
                    [PROTRUDE - from_top + sgn * r, PROTRUDE - from_top + sgn * (r + 70 * math.sin(half))],
                    color="#d1802f", linewidth=0.7)
        ax.set_xlim(-75, 55); ax.set_ylim(-110, 75); ax.set_aspect("equal")
        ax.set_title(f"camera {orient}: operator on the left, patient on the right\n"
                     "blue: rear camera and LiDAR keep-out cones, orange: front camera", fontsize=10)
        ax.set_xlabel("mm"); ax.grid(True, linewidth=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=90)
    plt.close(fig)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    mount = build()
    for k, v in check(mount).items():
        print(f"{k}: {v}")

    cq.exporters.export(mount, str(OUT / "triagecam_mount_v3.step"))
    # print orientation: one end face on the bed, so the whole part is its side profile
    # drawn upwards. No supports; the only bridges are the top end wall of the sleeve
    # and the roof of the USB-C opening, both print_bridge_span_mm long.
    printable = mount.rotate((0, 0, 0), (0, 1, 0), -90)
    pbb = printable.val().BoundingBox()
    printable = printable.translate((-pbb.xmin, -pbb.ymin, -pbb.zmin))
    cq.exporters.export(printable, str(OUT / "triagecam_mount_v3_print.stl"), tolerance=0.03)
    pbb = printable.val().BoundingBox()
    print("print_bed_footprint_mm:", round(pbb.xlen, 1), "x", round(pbb.ylen, 1), "height", round(pbb.zlen, 1))
    asm = cq.Assembly()
    asm.add(mount, name="mount", color=cq.Color(0.16, 0.17, 0.19))
    asm.add(phone_ref("out"), name="phone_reference_camera_out", color=cq.Color(0.5, 0.5, 0.55))
    asm.add(lid_ref(x_offset=-70), name="lid_reference", color=cq.Color(0.7, 0.7, 0.7))
    asm.save(str(OUT / "triagecam_mount_v3_assembly.step"))
    preview(mount, OUT / "preview_v3.png")
    section(mount, OUT / "section_v3.png")
    print("wrote", sorted(p.name for p in OUT.iterdir() if "v3" in p.name))
