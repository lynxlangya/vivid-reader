"""Project Natural Earth GeoJSON into the SVG path data embedded in vivid-reader-prototype-v2.html.

Usage:
  1. Download ne_50m_land, ne_50m_lakes, ne_50m_admin_0_boundary_lines_land and ne_110m_land
     (.geojson, public domain) from github.com/nvkelso/natural-earth-vector into <src_dir>.
  2. python3 -I project_natural_earth.py <src_dir> geo.json
  3. Replace the GEO constant in the prototype with the contents of geo.json.
"""
import json, math, sys
src = sys.argv[1]; OUT = sys.argv[2]
def load(n): return json.load(open(f"{src}/{n}.geojson"))
def polys(fc):
    for f in fc["features"]:
        g = f["geometry"]
        if g is None: continue
        if g["type"] == "Polygon": yield g["coordinates"]
        elif g["type"] == "MultiPolygon":
            for p in g["coordinates"]: yield p
def lines(fc):
    for f in fc["features"]:
        g = f["geometry"]
        if g["type"] == "LineString": yield g["coordinates"]
        elif g["type"] == "MultiLineString":
            for l in g["coordinates"]: yield l

def merc_y(lat): return math.log(math.tan(math.pi/4 + math.radians(lat)/2))

class Merc:
    def __init__(s, lon0, lon1, lat0, lat1, W, H):
        s.lon0, s.lon1, s.W, s.H = lon0, lon1, W, H
        s.y0, s.y1 = merc_y(lat1), merc_y(lat0)   # top, bottom
        s.kx = W / math.radians(lon1 - lon0)
        s.ky = H / (s.y0 - s.y1)
    def __call__(s, lon, lat):
        return (math.radians(lon - s.lon0) * s.kx, (s.y0 - merc_y(lat)) * s.ky)

def ring_path(pts, W, H, pad=12, closed=True):
    out = []; prev = None
    for x, y in pts:
        x = min(max(x, -pad), W + pad); y = min(max(y, -pad), H + pad)
        p = (round(x, 1), round(y, 1))
        if p != prev: out.append(p); prev = p
    if len(out) < 3 and closed: return ""
    if all(p[0] in (-pad, W + pad) or p[1] in (-pad, H + pad) for p in out): return ""
    d = "M" + " L".join(f"{x:g} {y:g}" for x, y in out)
    return d + ("Z" if closed else "")

def bbox_hit(ring, lon0, lon1, lat0, lat1, m=2):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return not (max(xs) < lon0 - m or min(xs) > lon1 + m or max(ys) < lat0 - m or min(ys) > lat1 + m)

def regional(lon0, lon1, lat0, lat1, W, H, step):
    P = Merc(lon0, lon1, lat0, lat1, W, H)
    land = []
    for poly in polys(load("ne_50m_land")):
        if not bbox_hit(poly[0], lon0, lon1, lat0, lat1): continue
        d = "".join(ring_path([P(*c) for c in r], W, H) for r in poly)
        if d: land.append(d)
    lakes = []
    for poly in polys(load("ne_50m_lakes")):
        if not bbox_hit(poly[0], lon0, lon1, lat0, lat1, 0): continue
        d = "".join(ring_path([P(*c) for c in r], W, H) for r in poly)
        if d: lakes.append(d)
    borders = []
    for l in lines(load("ne_50m_admin_0_boundary_lines_land")):
        if not bbox_hit(l, lon0, lon1, lat0, lat1, 0): continue
        d = ring_path([P(*c) for c in l], W, H, closed=False)
        if d: borders.append(d)
    grat = []
    lon = math.ceil(lon0 / step) * step
    while lon <= lon1:
        x = round(P(lon, 0)[0], 1); grat.append({"axis": "lon", "v": lon, "p": x}); lon += step
    lat = math.ceil(lat0 / step) * step
    while lat <= lat1:
        y = round(P(lon0, lat)[1], 1); grat.append({"axis": "lat", "v": lat, "p": y}); lat += step
    # px per km at map centre
    latc = (lat0 + lat1) / 2
    x1 = P(lon0, latc)[0]; x2 = P(lon0 + 1, latc)[0]
    km_per_deg = 111.32 * math.cos(math.radians(latc))
    return P, {"land": land, "lakes": lakes, "borders": borders, "grat": grat,
               "pxPerKm": (x2 - x1) / km_per_deg, "W": W, "H": H}

def hav(a, b):
    (lo1, la1), (lo2, la2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    dl = math.radians(lo2 - lo1); dp = p2 - p1
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * 6371 * math.asin(math.sqrt(h))

PLACES = {"cajamarca": (-78.51, -7.16), "lima": (-77.04, -12.05), "cusco": (-71.97, -13.53)}
W, H = 360, 200
P, peru = regional(-89.0, -61.0, -17.0, -1.0, W, H, 5)
peru["places"] = {k: [round(v, 1) for v in P(*c)] for k, c in PLACES.items()}
peru["distCajCusco"] = round(hav(PLACES["cajamarca"], PLACES["cusco"]))

# orthographic globe, radius 1 (scaled in CSS/SVG)
def ortho(lon0, lat0):
    l0, p0 = math.radians(lon0), math.radians(lat0)
    def f(lon, lat):
        l, p = math.radians(lon), math.radians(lat)
        cosc = math.sin(p0)*math.sin(p) + math.cos(p0)*math.cos(p)*math.cos(l - l0)
        x = math.cos(p)*math.sin(l - l0)
        y = math.cos(p0)*math.sin(p) - math.sin(p0)*math.cos(p)*math.cos(l - l0)
        if cosc < 0:
            n = math.hypot(x, y) or 1; x, y = x/n, y/n
        return (x, -y)
    return f
G = ortho(-62, -12); R = 19
globe = []
for poly in polys(load("ne_110m_land")):
    pts = [G(*c) for c in poly[0]]
    out = []; prev = None
    for x, y in pts:
        p = (round(20 + x*R, 1), round(20 + y*R, 1))
        if p != prev: out.append(p); prev = p
    xs = [p[0] for p in out]; ys = [p[1] for p in out]
    if max(xs) - min(xs) < 0.6 and max(ys) - min(ys) < 0.6: continue
    # drop rings that lie entirely on the horizon (back side)
    if all(abs(math.hypot(x-20, y-20) - R) < 0.15 for x, y in out): continue
    globe.append("M" + " L".join(f"{x:g} {y:g}" for x, y in out) + "Z")
gx, gy = G(*PLACES["cajamarca"])
globe_pt = [round(20 + gx*R, 1), round(20 + gy*R, 1)]

# world, equirectangular
world = []
for poly in polys(load("ne_110m_land")):
    d = "M" + " L".join(f"{round((lo+180)/360*W,1):g} {round((90-la)/180*H,1):g}" for lo, la in poly[0]) + "Z"
    world.append(d)

json.dump({"peru": peru, "globe": {"land": globe, "pt": globe_pt, "r": R}, "world": world},
          open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
print("peru land", len(peru["land"]), "lakes", len(peru["lakes"]), "borders", len(peru["borders"]),
      "pxPerKm", round(peru["pxPerKm"], 4), "dist", peru["distCajCusco"], peru["places"], "globe", len(globe), globe_pt)

# label anchors (lon, lat) projected with the same regional projection
LABELS = {"pacific": (-85.0, -11.0), "peru": (-73.0, -5.5), "brazil": (-66.0, -9.5)}
geo = json.load(open(OUT))
geo["peru"]["labels"] = {k: [round(v, 1) for v in P(*c)] for k, c in LABELS.items()}
json.dump(geo, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
print(geo["peru"]["labels"])
