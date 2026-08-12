#!/usr/bin/env python3
"""
Comprueba la geometría de js/shadow.js: el recorrido del eje de la umbra sobre
la Tierra. Si la línea central no entra por Galicia/Asturias y sale por Baleares
alrededor de las 18:30 UTC, algo está mal.

Uso:  python3 test/shadow_check.py
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from validate_astro import moon_position, sun_position, norm360, D2R, R2D, sin, cos  # noqa
from eclipse_check import (centuries_tt, gst_deg, moon_equatorial, jd_from_unix,  # noqa
                           DAY0, AU_KM)

EARTH_A = 6378.137
EARTH_F = 1/298.257223563
EARTH_B = EARTH_A*(1 - EARTH_F)
SUN_R = 696000.0
MOON_R = 0.272281*6378.14  # k2, igual que js/shadow.js


def to_vec(ra, dec, d):
    return (d*cos(dec)*cos(ra), d*cos(dec)*sin(ra), d*sin(dec))


def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def add(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def scl(v, s): return (v[0]*s, v[1]*s, v[2]*s)
def nrm(v): return math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)
def unit(v): return scl(v, 1/nrm(v))


def intersect_ellipsoid(o, d):
    k = EARTH_A/EARTH_B
    oo = (o[0], o[1], o[2]*k)
    dd = (d[0], d[1], d[2]*k)
    a = sum(x*x for x in dd)
    b = 2*sum(oo[i]*dd[i] for i in range(3))
    c = sum(x*x for x in oo) - EARTH_A**2
    disc = b*b - 4*a*c
    if disc < 0:
        return None
    sq = math.sqrt(disc)
    t1, t2 = (-b - sq)/(2*a), (-b + sq)/(2*a)
    t = t1 if t1 >= 0 else t2
    return t if t >= 0 else None


def axis_hit(ms):
    jd = jd_from_unix(ms)
    T = centuries_tt(jd)
    g = gst_deg(jd)
    s = sun_position(T)
    mra, mdec, mdist = moon_equatorial(T)
    sun = to_vec(s["ra"], s["dec"], s["R"]*AU_KM)
    moon = to_vec(mra, mdec, mdist)

    d = unit(sub(moon, sun))
    t = intersect_ellipsoid(moon, d)
    if t is None:
        return None
    hit = add(moon, scl(d, t))

    lon_i = math.atan2(hit[1], hit[0])
    lon = ((lon_i*R2D - g + 540) % 360) - 180
    p = math.hypot(hit[0], hit[1])
    lat_g = math.atan(math.tan(math.atan2(hit[2], p))/(1 - EARTH_F)**2)

    sm = nrm(sub(moon, sun))
    vertex = MOON_R*sm/(SUN_R - MOON_R)
    cone = abs(MOON_R*(1 - t/vertex))

    cl, sl = math.cos(lon_i), math.sin(lon_i)
    cp, sp = math.cos(lat_g), math.sin(lat_g)
    up = (cp*cl, cp*sl, sp)
    east = (-sl, cl, 0.0)
    north = (-sp*cl, -sp*sl, cp)
    to_sun = scl(d, -1)
    sE = sum(to_sun[i]*east[i] for i in range(3))
    sN = sum(to_sun[i]*north[i] for i in range(3))
    sU = sum(to_sun[i]*up[i] for i in range(3))

    return dict(lat=lat_g*R2D, lon=lon, cone=cone, total=t < vertex,
                sun_alt=math.asin(max(-1, min(1, sU)))*R2D,
                sun_az=(math.atan2(sE, sN)*R2D) % 360, sin_alt=sU)


def shadow_point(ms):
    """Añade la anchura de franja, medida perpendicular al avance de la sombra."""
    h = axis_hit(ms)
    if not h:
        return None
    a = axis_hit(ms - 30000) or h
    b = axis_hit(ms + 30000) or h

    kmlon = 111.32*cos(h["lat"])
    mE = 0.0 if abs(b["lon"] - a["lon"]) > 180 else (b["lon"] - a["lon"])*kmlon
    mN = (b["lat"] - a["lat"])*111.32
    ml = math.hypot(mE, mN) or 1.0
    vE, vN = mE/ml, mN/ml
    wE, wN = -vN, vE  # perpendicular al avance

    sin_alt = max(1e-4, abs(h["sin_alt"]))
    semi_minor = h["cone"]
    semi_major = h["cone"]/sin_alt
    uE, uN = sin(h["sun_az"]), cos(h["sun_az"])
    pE, pN = -uN, uE
    half = math.hypot(semi_major*(uE*wE + uN*wN), semi_minor*(pE*wE + pN*wN))

    return dict(lat=h["lat"], lon=h["lon"], width=2*half, total=h["total"],
                sun_alt=h["sun_alt"])


def hhmm(ms):
    s = int((ms - DAY0)/1000)
    return f"{s//3600:02d}:{(s%3600)//60:02d}"


print("Recorrido del eje de la umbra — 12 de agosto de 2026")
print("(la sombra existe donde el eje corta la Tierra)\n")

first = last = None
ms = DAY0
while ms <= DAY0 + 86400000:
    if shadow_point(ms):
        if first is None:
            first = ms
        last = ms
    ms += 60000

print(f"La umbra toca la Tierra de {hhmm(first)} a {hhmm(last)} UTC "
      f"({(last-first)/60000:.0f} min en total)\n")

print(f"{'UTC':<7}{'Lat':>8}{'Lon':>9}  {'Anchura':>9}  {'AltSol':>7}  Dónde")
print("-"*72)


def donde(lat, lon):
    if lat > 70: return "Ártico / Groenlandia"
    if lat > 62: return "Islandia"
    if lat > 48: return "Atlántico Norte"
    if 41 < lat <= 48 and -10 < lon < 4: return "  ← PENÍNSULA IBÉRICA"
    if 38 < lat <= 43 and 0 < lon < 5: return "  ← BALEARES / Mediterráneo"
    if lat <= 48: return "Atlántico / Mediterráneo"
    return ""


ms = first
while ms <= last:
    p = shadow_point(ms)
    if p:
        print(f"{hhmm(ms):<7}{p['lat']:>7.2f}°{p['lon']:>8.2f}°  "
              f"{p['width']:>7.0f} km  {p['sun_alt']:>6.1f}°  {donde(p['lat'], p['lon'])}")
    ms += 5*60000

print("\n--- Paso por España (resolución de 1 min) ---")
print(f"{'UTC':<7}{'Lat':>8}{'Lon':>9}  {'Anchura':>9}  {'AltSol':>7}")
print("-"*48)
ms = DAY0 + 18*3600000
en_espana = []
while ms <= DAY0 + 19*3600000:
    p = shadow_point(ms)
    if p and 35 < p["lat"] < 46 and -12 < p["lon"] < 6:
        en_espana.append((ms, p))
        print(f"{hhmm(ms):<7}{p['lat']:>7.2f}°{p['lon']:>8.2f}°  "
              f"{p['width']:>7.0f} km  {p['sun_alt']:>6.1f}°")
    ms += 60000

if not en_espana:
    print("FALLO: la línea central no pasa por España.")
    sys.exit(1)

lat0, lon0 = en_espana[0][1]["lat"], en_espana[0][1]["lon"]
lat1, lon1 = en_espana[-1][1]["lat"], en_espana[-1][1]["lon"]
print(f"\nEntra por  {lat0:.2f}°N {lon0:.2f}°  a las {hhmm(en_espana[0][0])} UTC")
print(f"Sale por   {lat1:.2f}°N {lon1:.2f}°  a las {hhmm(en_espana[-1][0])} UTC")

# Criterio: la línea central debe cruzar la Península de noroeste a sureste.
cruza_peninsula = any(41 < p["lat"] < 45 and -9 < p["lon"] < 1 for _, p in en_espana)
cruza_baleares = any(38 < p["lat"] < 41 and 1 < p["lon"] < 5 for _, p in en_espana)
va_al_sureste = lat1 < lat0 and lon1 > lon0
ok = cruza_peninsula and cruza_baleares and va_al_sureste
print(f"\n  cruza la Península:        {'sí' if cruza_peninsula else 'NO'}")
print(f"  llega al área balear:      {'sí' if cruza_baleares else 'NO'}")
print(f"  avanza hacia el sureste:   {'sí' if va_al_sureste else 'NO'}")

# Contraste con la tabla oficial de NASA (SE2026Aug12Tpath.html).
NASA = {"18:26": (44.713, -8.398, 311), "18:28": (43.372, -6.188, 304),
        "18:30": (41.817, -3.185, 294)}
print("\n--- Contraste con la línea central publicada por NASA ---")
print(f"{'UTC':<7}{'Δlat':>9}{'Δlon':>9}{'Δdist':>10}{'Anchura mía':>13}{'NASA':>8}{'Δ%':>7}")
peor = 0.0
for _, p in en_espana:
    pass
for ms, p in en_espana:
    k = hhmm(ms)
    if k in NASA:
        nlat, nlon, nw = NASA[k]
        dlat, dlon = p["lat"]-nlat, p["lon"]-nlon
        dist = math.hypot(dlat*111.32, dlon*111.32*cos(p["lat"]))
        dpc = 100*(p["width"]-nw)/nw
        peor = max(peor, dist)
        print(f"{k:<7}{dlat:>+8.3f}°{dlon:>+8.3f}°{dist:>8.1f} km"
              f"{p['width']:>10.0f} km{nw:>6} km{dpc:>+6.1f}%")
print(f"\nDesviación máxima de la línea central: {peor:.1f} km")

# Umbral: 35 km. La serie lunar abreviada de Meeus tiene ~10" de error en
# longitud, y la sombra recorre 2,8 km/s, así que un desfase de ~10 s desplaza
# la línea unos 30 km. Pedir menos sería exigir una precisión que estas
# efemérides no pueden dar. Como referencia, la franja mide ~300 km de ancho:
# 35 km es un 12% de la semianchura, invisible a las escalas del mapa.
ok = ok and peor < 35
print("\nRESULTADO:", "coherente con las efemérides oficiales."
      if ok else "SOSPECHOSO — revisar geometría.")
sys.exit(0 if ok else 1)
