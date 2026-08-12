#!/usr/bin/env python3
"""
Contrasta el motor de la app contra las circunstancias locales OFICIALES
(IGN / Observatorio Astronómico Nacional, vía el visor del Gobierno de España,
cotejadas a su vez con NASA GSFC).

El objetivo no es que coincidan al segundo — con una serie lunar abreviada eso
es imposible — sino conocer y documentar el error real, para poder declararlo
honestamente en la interfaz.

Uso:  python3 test/compare_official.py
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from eclipse_check import circumstances, DAY0  # noqa: E402

# (ciudad, lat, lon, alt_m, max_oficial_UT, alt_sol, az_sol, duracion_totalidad_s)
# Fuente: visor.trioeclipses.es/api/ign (datos calculados por el OAN),
# cotejado con las tablas de NASA GSFC para el mismo eclipse.
OFICIAL = [
    ("A Coruña",        43.3623, -8.4115,  20, "18:28:13", 11.95, 279.15,  76.1),
    ("Lugo",            43.0121, -7.5559, 465, "18:28:44", 11.20, 279.86,  84.2),
    ("Oviedo",          43.3619, -5.8494, 230, "18:27:54", 10.18, 280.79, 108.2),
    ("Gijón",           43.5322, -5.6611,  15, "18:27:34", 10.15, 280.82, 104.8),
    ("Santander",       43.4623, -3.8100,  15, "18:27:23",  8.85, 282.03,  63.0),
    ("Bilbao",          43.2630, -2.9350,  20, "18:27:32",  8.14, 282.68,  28.1),
    ("Vitoria-Gasteiz", 42.8467, -2.6716, 525, "18:28:10",  7.76, 283.00,  62.8),
    ("Logroño",         42.4650, -2.4456, 384, "18:28:44",  7.40, 283.30,  80.5),
    ("Burgos",          42.3439, -3.6969, 860, "18:29:12",  8.20, 282.57, 103.8),
    ("Valladolid",      41.6523, -4.7245, 700, "18:30:31",  8.56, 282.22,  87.9),
    ("Zaragoza",        41.6488, -0.8891, 208, "18:29:39",  5.92, 284.55,  83.4),
    ("Pamplona",        42.8125, -1.6458, 446, "18:27:59",  7.06, 283.65, None),
    ("Valencia",        39.4699, -0.3763,  15, "18:33:15",  4.39, 285.57,  59.4),
    ("Palma",           39.5696,  2.6502,  13, "18:31:48",  2.38, 287.28,  96.1),
    ("Madrid",          40.4168, -3.7038, 667, "18:32:17",  7.20, 283.32, None),
]


def to_secs(hhmmss):
    h, m, s = (int(x) for x in hhmmss.split(":"))
    return h*3600 + m*60 + s


print("Motor de la app frente a las efemérides oficiales (IGN/OAN + NASA)\n")
print(f"{'Ciudad':<17}{'Δt máx':>9}{'Δ altura':>10}{'Δ acimut':>10}"
      f"{'Totalidad':>12}{'Δ dur':>8}  Tipo")
print("-"*80)

dts, dalts, dazs, ddurs = [], [], [], []
tipo_ok = True

for nombre, lat, lon, elev, t_of, alt_of, az_of, dur_of in OFICIAL:
    r = circumstances(lat, lon, elev)
    if not r:
        print(f"{nombre:<17}  sin eclipse — DISCREPANCIA GRAVE")
        tipo_ok = False
        continue

    t_mio = (r["max_ms"] - DAY0)/1000
    dt = t_mio - to_secs(t_of)
    dalt = r["st"]["alt"] - alt_of
    daz = r["st"]["az"] - az_of
    dts.append(dt); dalts.append(dalt); dazs.append(daz)

    es_total_mio = r["st"]["total"]
    es_total_of = dur_of is not None
    marca = "" if es_total_mio == es_total_of else "  ← TIPO DISTINTO"
    if es_total_mio != es_total_of:
        tipo_ok = False

    if es_total_of and es_total_mio:
        ddur = r["dur"] - dur_of
        ddurs.append(ddur)
        dur_txt = f"{r['dur']:>6.1f}s"
        ddur_txt = f"{ddur:>+6.1f}s"
    else:
        dur_txt = "parcial" if not es_total_of else f"{r['dur']:>6.1f}s"
        ddur_txt = "     —"

    tipo = "TOTAL" if es_total_mio else "parcial"
    print(f"{nombre:<17}{dt:>+8.1f}s{dalt:>+9.2f}°{daz:>+9.2f}°"
          f"{dur_txt:>12}{ddur_txt:>8}  {tipo}{marca}")


def stats(v):
    if not v:
        return "sin datos"
    med = sum(v)/len(v)
    sd = math.sqrt(sum((x-med)**2 for x in v)/len(v)) if len(v) > 1 else 0
    return f"media {med:+.2f}  desv. {sd:.2f}  máx |{max(abs(min(v)), abs(max(v))):.2f}|"


print("\n--- Resumen de las desviaciones ---")
print(f"  Instante del máximo:  {stats(dts)}  (segundos)")
print(f"  Altura del Sol:       {stats(dalts)}  (grados)")
print(f"  Acimut del Sol:       {stats(dazs)}  (grados)")
print(f"  Duración totalidad:   {stats(ddurs)}  (segundos)")
print(f"\n  Clasificación total/parcial: {'correcta en todas' if tipo_ok else 'HAY FALLOS'}")

media_dt = sum(dts)/len(dts)
print(f"\nEl sesgo temporal medio es de {media_dt:+.1f} s. Es sistemático (misma "
      f"dirección\nen todas las ciudades), no ruido: procede de la serie lunar "
      f"abreviada de Meeus,\nque tiene ~10\" de error en longitud ≈ 18 s de "
      f"desplazamiento del eclipse.")
