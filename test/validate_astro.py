#!/usr/bin/env python3
"""
Valida js/astro.js contra los ejemplos publicados de Meeus.

No hay runtime de JS en esta máquina, así que en vez de re-teclear las tablas
(lo que validaría una copia, no el código real) este script las EXTRAE del
propio js/astro.js con regex y ejecuta el mismo algoritmo en Python. Si un
coeficiente de la tabla ELP está mal transcrito, el resultado se desvía de los
valores publicados por Meeus y el test falla.

Uso:  python3 test/validate_astro.py
"""

import math
import re
import sys
from pathlib import Path

JS = (Path(__file__).parent.parent / "js" / "astro.js").read_text(encoding="utf-8")

D2R = math.pi / 180
R2D = 180 / math.pi
sin = lambda d: math.sin(d * D2R)
cos = lambda d: math.cos(d * D2R)


def norm360(x):
    return x % 360.0


def extract_table(name, ncols):
    """Extrae un array de arrays numéricos declarado como `const NAME = [...]`."""
    m = re.search(r"const\s+" + name + r"\s*=\s*\[(.*?)\n\];", JS, re.S)
    if not m:
        sys.exit(f"FALLO: no encuentro la tabla {name} en js/astro.js")
    rows = re.findall(r"\[([^\[\]]+)\]", m.group(1))
    table = []
    for r in rows:
        vals = [int(v.strip()) for v in r.split(",") if v.strip()]
        if len(vals) != ncols:
            sys.exit(f"FALLO: fila con {len(vals)} columnas (esperaba {ncols}): {r}")
        table.append(vals)
    return table


MOON_LR = extract_table("MOON_LR", 6)
MOON_B = extract_table("MOON_B", 5)


def moon_position(T):
    T2, T3, T4 = T * T, T**3, T**4
    Lp = norm360(218.3164477 + 481267.88123421*T - 0.0015786*T2 + T3/538841 - T4/65194000)
    Dm = norm360(297.8501921 + 445267.1114034*T - 0.0018819*T2 + T3/545868 - T4/113065000)
    M  = norm360(357.5291092 + 35999.0502909*T - 0.0001536*T2 + T3/24490000)
    Mp = norm360(134.9633964 + 477198.8675055*T + 0.0087414*T2 + T3/69699 - T4/14712000)
    F  = norm360(93.2720950 + 483202.0175233*T - 0.0036539*T2 - T3/3526000 + T4/863310000)
    A1 = norm360(119.75 + 131.849*T)
    A2 = norm360(53.09 + 479264.290*T)
    A3 = norm360(313.45 + 481266.484*T)
    E = 1 - 0.002516*T - 0.0000074*T2

    sumL = sumR = sumB = 0.0
    for d, m, mp, f, cl, cr in MOON_LR:
        arg = d*Dm + m*M + mp*Mp + f*F
        ecc = 1 if m == 0 else (E if abs(m) == 1 else E*E)
        sumL += cl * ecc * sin(arg)
        sumR += cr * ecc * cos(arg)
    for d, m, mp, f, cb in MOON_B:
        arg = d*Dm + m*M + mp*Mp + f*F
        ecc = 1 if m == 0 else (E if abs(m) == 1 else E*E)
        sumB += cb * ecc * sin(arg)

    sumL += 3958*sin(A1) + 1962*sin(Lp - F) + 318*sin(A2)
    sumB += (-2235*sin(Lp) + 382*sin(A3) + 175*sin(A1 - F) + 175*sin(A1 + F)
             + 127*sin(Lp - Mp) - 115*sin(Lp + Mp))

    return {
        "Lp": Lp, "D": Dm, "M": M, "Mp": Mp, "F": F, "E": E,
        "sumL": sumL, "sumB": sumB, "sumR": sumR,
        "lambda": norm360(Lp + sumL/1e6),
        "beta": sumB/1e6,
        "dist": 385000.56 + sumR/1000,
        "parallax": math.asin(6378.14/(385000.56 + sumR/1000)) * R2D,
    }


def sun_position(T):
    L0 = 280.46646 + 36000.76983*T + 0.0003032*T*T
    M = 357.52911 + 35999.05029*T - 0.0001537*T*T
    e = 0.016708634 - 0.000042037*T - 0.0000001267*T*T
    C = ((1.914602 - 0.004817*T - 0.000014*T*T)*sin(M)
         + (0.019993 - 0.000101*T)*sin(2*M) + 0.000289*sin(3*M))
    true_lon = L0 + C
    true_anom = M + C
    R = (1.000001018*(1 - e*e))/(1 + e*cos(true_anom))
    omega = 125.04 - 1934.136*T
    lam = true_lon - 0.00569 - 0.00478*sin(omega)
    eps0 = 23 + 26/60 + 21.448/3600 - (46.815*T + 0.00059*T*T - 0.001813*T**3)/3600
    eps = eps0 + 0.00256*cos(omega)
    ra = norm360(math.atan2(cos(eps)*sin(lam), cos(lam)) * R2D)
    dec = math.asin(sin(eps)*sin(lam)) * R2D
    return {"L0": norm360(L0), "M": norm360(M), "C": C,
            "true_lon": norm360(true_lon), "R": R, "lambda": norm360(lam),
            "ra": ra, "dec": dec}


# ---------------------------------------------------------------------------

FAILS = []


def check(label, got, expected, tol, unit=""):
    ok = abs(got - expected) <= tol
    mark = "ok  " if ok else "FALLO"
    print(f"  [{mark}] {label:<28} obtenido={got:>14.6f}  esperado={expected:>14.6f}"
          f"  Δ={got-expected:+.6f}{unit}")
    if not ok:
        FAILS.append(label)


print(f"Tablas extraídas de js/astro.js: MOON_LR={len(MOON_LR)} filas, "
      f"MOON_B={len(MOON_B)} filas")
if len(MOON_LR) != 60 or len(MOON_B) != 60:
    print("  AVISO: Meeus tabula 60 filas en cada tabla (47.A y 47.B).")

print("\n=== Ejemplo 47.a de Meeus — Luna, 1992 abril 12.0 TD ===")
T = (2448724.5 - 2451545.0) / 36525
m = moon_position(T)
check("L' (long. media)", m["Lp"], 134.290182, 1e-4, "°")
check("D (elongación)", m["D"], 113.842304, 1e-4, "°")
check("M (anom. Sol)", m["M"], 97.643514, 1e-4, "°")
check("M' (anom. Luna)", m["Mp"], 5.150833, 1e-4, "°")
check("F (arg. latitud)", m["F"], 219.889721, 1e-4, "°")
check("E", m["E"], 1.000194, 1e-6)
check("Sigma_l", m["sumL"], -1127527, 2.0)
check("Sigma_b", m["sumB"], -3229126, 2.0)
check("Sigma_r", m["sumR"], -16590875, 20.0)
check("lambda (long. eclip.)", m["lambda"], 133.162655, 1e-5, "°")
check("beta (lat. eclip.)", m["beta"], -3.229126, 1e-5, "°")
check("Delta (distancia km)", m["dist"], 368409.7, 0.1, " km")
check("pi (paralaje)", m["parallax"], 0.991990, 1e-5, "°")

print("\n=== Ejemplo 25.a/b de Meeus — Sol, 1992 octubre 13.0 TD ===")
Ts = (2448908.5 - 2451545.0) / 36525
s = sun_position(Ts)
check("L0 (long. media)", s["L0"], 201.80720, 1e-4, "°")
check("M (anom. media)", s["M"], 278.99397, 1e-4, "°")
check("C (ec. del centro)", s["C"], -1.89732, 1e-4, "°")
check("theta (long. verdadera)", s["true_lon"], 199.90988, 1e-4, "°")
check("R (UA)", s["R"], 0.99766, 1e-5, " UA")
check("lambda (long. aparente)", s["lambda"], 199.90895, 1e-4, "°")
check("alpha (ascensión recta)", s["ra"], 360 - 161.61917, 2e-3, "°")
check("delta (declinación)", s["dec"], -7.78507, 2e-3, "°")

print("\n=== Cordura: novilunio del 2026-08-12 ===")
# Si las efemérides son correctas, cerca del máximo del eclipse la longitud
# eclíptica del Sol y la de la Luna deben coincidir (conjunción) y la latitud
# de la Luna debe ser casi nula (por eso hay eclipse).
jd = 2461264.5 + 17.75/24  # 2026-08-12 ~17:45 UTC
Te = (jd + 72/86400 - 2451545.0) / 36525
ms, ss = moon_position(Te), sun_position(Te)
dlon = (ms["lambda"] - ss["lambda"] + 180) % 360 - 180
print(f"  long. Sol  = {ss['lambda']:.4f}°")
print(f"  long. Luna = {ms['lambda']:.4f}°")
print(f"  diferencia de longitud = {dlon:+.4f}°  (debe ser ~0 en conjunción)")
print(f"  latitud de la Luna     = {ms['beta']:+.4f}°  (debe ser ~0 para que haya eclipse)")
print(f"  distancia lunar        = {ms['dist']:.1f} km")
if abs(dlon) > 1.0:
    FAILS.append("conjunción 2026-08-12")
    print("  FALLO: no hay conjunción — las efemérides no cuadran.")
if abs(ms["beta"]) > 1.5:
    FAILS.append("latitud lunar 2026-08-12")
    print("  FALLO: latitud lunar demasiado alta para un eclipse total.")

print("\n" + "=" * 70)
if FAILS:
    print(f"RESULTADO: {len(FAILS)} comprobación(es) FALLIDA(S): {', '.join(FAILS)}")
    sys.exit(1)
print("RESULTADO: todas las comprobaciones pasan. Las tablas de js/astro.js son correctas.")
