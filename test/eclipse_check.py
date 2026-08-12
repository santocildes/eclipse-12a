#!/usr/bin/env python3
"""
Calcula las circunstancias locales del eclipse del 12-ago-2026 para ciudades
españolas, replicando la lógica de js/eclipse.js (mismo método vectorial
topocéntrico) y reutilizando las tablas extraídas de js/astro.js.

Sirve para dos cosas:
  1. Comprobar que los resultados son físicamente coherentes (Sol bajo, franja
     de totalidad en el norte, duraciones de ~1-2 min).
  2. Tener una tabla de referencia contra la que contrastar los datos oficiales
     del IGN / NASA.

Uso:  python3 test/eclipse_check.py
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from validate_astro import moon_position, sun_position, norm360, D2R, R2D, sin, cos  # noqa: E402

AU_KM = 149597870.7
RE_KM = 6378.14
SUN_R = 696000.0
MOON_R = 0.2725076 * RE_KM

EPOCH_JD = 2440587.5  # 1970-01-01T00:00:00Z


def jd_from_unix(ms):
    return ms / 86400000.0 + EPOCH_JD


def delta_t(year=2026):
    return 71.4  # mismo valor que js/astro.js (tablas oficiales NASA/IGN)


def centuries_tt(jd_ut):
    return (jd_ut + delta_t() / 86400 - 2451545.0) / 36525


def nutation(T):
    omega = 125.04452 - 1934.136261 * T
    L = 280.4665 + 36000.7698 * T
    Lp = 218.3165 + 481267.8813 * T
    dpsi = (-17.2*sin(omega) - 1.32*sin(2*L) - 0.23*sin(2*Lp) + 0.21*sin(2*omega))/3600
    deps = (9.2*cos(omega) + 0.57*cos(2*L) + 0.1*cos(2*Lp) - 0.09*cos(2*omega))/3600
    eps0 = 23 + 26/60 + 21.448/3600 - (46.815*T + 0.00059*T*T - 0.001813*T**3)/3600
    return dpsi, eps0 + deps


def gst_deg(jd_ut):
    T = (jd_ut - 2451545.0) / 36525
    th = (280.46061837 + 360.98564736629*(jd_ut - 2451545.0)
          + 0.000387933*T*T - T**3/38710000)
    dpsi, eps = nutation(T)
    return norm360(th + dpsi*cos(eps))


def moon_equatorial(T):
    m = moon_position(T)
    dpsi, eps = nutation(T)
    lam = m["lambda"] + dpsi
    beta = m["beta"]
    ra = norm360(math.atan2(sin(lam)*cos(eps) - math.tan(beta*D2R)*sin(eps), cos(lam)) * R2D)
    dec = math.asin(sin(beta)*cos(eps) + cos(beta)*sin(eps)*sin(lam)) * R2D
    return ra, dec, m["dist"]


def observer_vec(lat, lon, elev, gst):
    u = math.atan(0.99664719 * math.tan(lat*D2R))
    rs = 0.99664719*math.sin(u) + (elev/6378140)*sin(lat)
    rc = math.cos(u) + (elev/6378140)*cos(lat)
    lst = (gst + lon) * D2R
    return (rc*RE_KM*math.cos(lst), rc*RE_KM*math.sin(lst), rs*RE_KM)


def to_vec(ra, dec, dist):
    cd = cos(dec)
    return (dist*cd*cos(ra), dist*cd*sin(ra), dist*sin(dec))


def from_vec(v):
    x, y, z = v
    d = math.sqrt(x*x + y*y + z*z)
    return norm360(math.atan2(y, x)*R2D), math.asin(z/d)*R2D, d


def refraction(alt):
    if alt < -2:
        return 0.0
    a = max(alt, -0.5)
    return 1.02 / math.tan((a + 10.3/(a + 5.11))*D2R) / 60


def horizontal(ra, dec, lat, lon, gst):
    H = norm360(gst + lon - ra)
    alt = math.asin(sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(H)) * R2D
    az_s = math.atan2(sin(H), cos(H)*sin(lat) - math.tan(dec*D2R)*cos(lat)) * R2D
    return alt, norm360(az_s + 180)


def state(ms, lat, lon, elev=0.0):
    jd = jd_from_unix(ms)
    T = centuries_tt(jd)
    g = gst_deg(jd)
    s = sun_position(T)
    mra, mdec, mdist = moon_equatorial(T)

    o = observer_vec(lat, lon, elev, g)
    sv = to_vec(s["ra"], s["dec"], s["R"]*AU_KM)
    mv = to_vec(mra, mdec, mdist)
    st = from_vec((sv[0]-o[0], sv[1]-o[1], sv[2]-o[2]))
    mt = from_vec((mv[0]-o[0], mv[1]-o[1], mv[2]-o[2]))

    sun_sd = math.asin(SUN_R/st[2])*R2D
    moon_sd = math.asin(MOON_R/mt[2])*R2D
    cs = (cos(st[1])*cos(mt[1])*cos(st[0]-mt[0]) + sin(st[1])*sin(mt[1]))
    sep = math.acos(max(-1, min(1, cs)))*R2D

    alt, az = horizontal(st[0], st[1], lat, lon, g)
    mag = max(0.0, (sun_sd + moon_sd - sep)/(2*sun_sd))

    if sep >= sun_sd + moon_sd:
        obsc = 0.0
    elif sep <= abs(sun_sd - moon_sd):
        obsc = min(sun_sd, moon_sd)**2 / sun_sd**2
    else:
        r1, r2, d = sun_sd, moon_sd, sep
        a1 = r1*r1*math.acos((d*d + r1*r1 - r2*r2)/(2*d*r1))
        a2 = r2*r2*math.acos((d*d + r2*r2 - r1*r1)/(2*d*r2))
        a3 = 0.5*math.sqrt((-d+r1+r2)*(d+r1-r2)*(d-r1+r2)*(d+r1+r2))
        obsc = (a1 + a2 - a3)/(math.pi*r1*r1)

    return dict(sep=sep, sun_sd=sun_sd, moon_sd=moon_sd, mag=mag, obsc=obsc,
                alt=alt, az=az, alt_app=alt + refraction(alt),
                total=sep < moon_sd - sun_sd)


DAY0 = (2461264.5 - EPOCH_JD) * 86400000.0  # 2026-08-12T00:00:00Z en ms


def bisect(f, a, b, tol=100.0):
    fa = f(a)
    for _ in range(60):
        if b - a <= tol:
            break
        m = (a + b)/2
        fm = f(m)
        if (fa <= 0) == (fm <= 0):
            a, fa = m, fm
        else:
            b = m
    return (a + b)/2


def fmt(ms):
    """ms UTC → 'HH:MM:SS UTC (HH:MM:SS CEST)'. CEST = UTC+2 en agosto."""
    secs = (ms - DAY0)/1000
    def hms(s):
        s = int(round(s))
        return f"{s//3600:02d}:{(s%3600)//60:02d}:{s%60:02d}"
    return f"{hms(secs)}z / {hms(secs + 7200)}"


def circumstances(lat, lon, elev=0.0):
    f = lambda ms: state(ms, lat, lon, elev)["sep"] - (state(ms, lat, lon, elev)["sun_sd"]
                                                       + state(ms, lat, lon, elev)["moon_sd"])
    best, best_ms = 1e9, DAY0
    ms = DAY0 + 14*3600000
    while ms <= DAY0 + 22*3600000:
        v = f(ms)
        if v < best:
            best, best_ms = v, ms
        ms += 120000
    if best >= 0:
        return None

    lo, hi = best_ms - 120000, best_ms + 120000
    sep_of = lambda t: state(t, lat, lon, elev)["sep"]
    for _ in range(80):
        if hi - lo <= 100:
            break
        m1, m2 = lo + (hi-lo)/3, hi - (hi-lo)/3
        if sep_of(m1) < sep_of(m2):
            hi = m2
        else:
            lo = m1
    mx = (lo+hi)/2
    st = state(mx, lat, lon, elev)
    c1 = bisect(f, mx - 4*3600000, mx)
    c4 = bisect(lambda t: -f(t), mx, mx + 4*3600000)

    dur = 0.0
    if st["total"]:
        g = lambda t: (state(t, lat, lon, elev)["sep"]
                       - abs(state(t, lat, lon, elev)["moon_sd"]
                             - state(t, lat, lon, elev)["sun_sd"]))
        c2 = bisect(g, c1, mx)
        c3 = bisect(lambda t: -g(t), mx, c4)
        dur = (c3 - c2)/1000
    return dict(max_ms=mx, st=st, c1=c1, c4=c4, dur=dur)


CIUDADES = [
    ("A Coruña",        43.3623, -8.4115,   20),
    ("Oviedo",          43.3619, -5.8494,  230),
    ("Gijón",           43.5322, -5.6611,   15),
    ("Santander",       43.4623, -3.8100,   15),
    ("Bilbao",          43.2630, -2.9350,   20),
    ("Burgos",          42.3439, -3.6969,  860),
    ("Valladolid",      41.6523, -4.7245,  700),
    ("Palencia",        42.0096, -4.5288,  740),
    ("Logroño",         42.4650, -2.4456,  384),
    ("Pamplona",        42.8125, -1.6458,  446),
    ("Zaragoza",        41.6488, -0.8891,  208),
    ("Huesca",          42.1401, -0.4089,  488),
    ("Lleida",          41.6176,  0.6200,  155),
    ("Tarragona",       41.1189,  1.2445,   68),
    ("Castellón",       39.9864, -0.0513,   30),
    ("Palma",           39.5696,  2.6502,   13),
    ("Maó (Menorca)",   39.8885,  4.2658,   50),
    ("Valencia",        39.4699, -0.3763,   15),
    ("Madrid",          40.4168, -3.7038,  667),
    ("Barcelona",       41.3874,  2.1686,   12),
    ("Sevilla",         37.3891, -5.9845,   11),
    ("Málaga",          36.7213, -4.4214,   11),
    ("Tenerife",        28.4636, -16.2518,  50),
]

print("Eclipse total de Sol — 12 de agosto de 2026")
print("Circunstancias locales calculadas con el motor de la app\n")
print(f"{'Ciudad':<16}{'Máximo (UTC/CEST)':<24}{'Tipo':<9}{'Mag':>6}{'Obsc':>7}"
      f"{'Alt':>7}{'Az':>7}{'Totalidad':>11}")
print("-"*88)

for nombre, lat, lon, elev in CIUDADES:
    r = circumstances(lat, lon, elev)
    if not r:
        print(f"{nombre:<16}{'—':<24}{'ninguno':<9}")
        continue
    st = r["st"]
    tipo = "TOTAL" if st["total"] else "parcial"
    dur = f"{int(r['dur']//60)}m {int(r['dur']%60):02d}s" if r["dur"] else "—"
    alt_flag = "" if st["alt_app"] > 0 else " (bajo horiz.)"
    print(f"{nombre:<16}{fmt(r['max_ms']):<24}{tipo:<9}{st['mag']:>6.3f}"
          f"{st['obsc']*100:>6.1f}%{st['alt']:>6.1f}°{st['az']:>6.1f}°{dur:>11}{alt_flag}")

print("\nAlt = altura geométrica del Sol sobre el horizonte en el máximo.")
print("Az  = acimut (0=N, 90=E, 180=S, 270=O) — hacia dónde mirar.")
