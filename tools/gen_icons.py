#!/usr/bin/env python3
"""
Genera los iconos PNG de la PWA sin depender de ningún conversor externo
(no hay ImageMagick ni rsvg en esta máquina). Escribe PNG a pelo con zlib,
que es stdlib.

El dibujo replica icons/icon.svg: cielo oscuro, corona, disco eclipsado y
silueta de sierra — el relieve es el tema de la app, así que sale en el icono.

Uso:  python3 tools/gen_icons.py
"""

import math
import struct
import zlib
from pathlib import Path

SALIDA = Path(__file__).parent.parent / "icons"


def escribir_png(ruta, ancho, alto, pixeles):
    """pixeles: bytearray RGBA de tamaño ancho*alto*4."""
    filas = bytearray()
    for y in range(alto):
        filas.append(0)  # filtro "None" por fila
        ini = y * ancho * 4
        filas += pixeles[ini:ini + ancho * 4]

    def trozo(tipo, datos):
        c = struct.pack(">I", len(datos)) + tipo + datos
        return c + struct.pack(">I", zlib.crc32(tipo + datos) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += trozo(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 6, 0, 0, 0))
    png += trozo(b"IDAT", zlib.compress(bytes(filas), 9))
    png += trozo(b"IEND", b"")
    ruta.write_bytes(png)
    return len(png)


def mezclar(fondo, frente, alfa):
    return tuple(int(round(f * (1 - alfa) + d * alfa)) for f, d in zip(fondo, frente))


def suavizado(d, borde, ancho=1.5):
    """Cobertura 0..1 para un borde en `borde`, con antialias de `ancho` px."""
    return max(0.0, min(1.0, (borde - d) / ancho + 0.5))


def dibujar(tam, maskable=False):
    px = bytearray(tam * tam * 4)

    # En modo maskable, el sistema recorta hasta un 20% por cada lado; se
    # encoge el contenido para que nada importante quede fuera del círculo seguro.
    escala = 0.76 if maskable else 1.0
    cx = cy_base = tam / 2

    radio_esquina = 0 if maskable else tam * 0.22
    sol_r = tam * 0.188 * escala
    sol_cx = cx
    sol_cy = tam * 0.465
    corona_r = tam * 0.328 * escala
    luna_dx = tam * 0.051 * escala
    luna_dy = -tam * 0.039 * escala

    # Perfil de sierra, en fracciones del tamaño.
    crestas = [(0.00, 0.781), (0.145, 0.668), (0.250, 0.727), (0.383, 0.598),
               (0.512, 0.699), (0.629, 0.621), (0.766, 0.715), (0.875, 0.656),
               (1.00, 0.742)]

    def altura_sierra(xf):
        for i in range(len(crestas) - 1):
            x0, y0 = crestas[i]
            x1, y1 = crestas[i + 1]
            if x0 <= xf <= x1:
                t = (xf - x0) / (x1 - x0)
                return (y0 + (y1 - y0) * t)
        return crestas[-1][1]

    for y in range(tam):
        for x in range(tam):
            fx, fy = x + 0.5, y + 0.5

            # Fondo: degradado vertical de cielo nocturno.
            t = fy / tam
            col = (int(19 + (5 - 19) * t), int(28 + (7 - 28) * t), int(51 + (15 - 51) * t))
            a = 1.0

            # Esquinas redondeadas (solo en el icono normal).
            if radio_esquina:
                dx = max(radio_esquina - fx, fx - (tam - radio_esquina), 0)
                dy = max(radio_esquina - fy, fy - (tam - radio_esquina), 0)
                if dx > 0 and dy > 0:
                    a = suavizado(math.hypot(dx, dy), radio_esquina)
                    if a <= 0:
                        px[(y * tam + x) * 4 + 3] = 0
                        continue

            # Corona solar: halo radial alrededor del disco.
            d_sol = math.hypot(fx - sol_cx, fy - sol_cy)
            if d_sol < corona_r:
                u = d_sol / corona_r
                # Pico de brillo justo fuera del disco, desvaneciendo hacia fuera.
                if u > 0.55:
                    inten = math.exp(-((u - 0.60) ** 2) / 0.045) * 0.85
                    col = mezclar(col, (214, 232, 255), min(1.0, inten))

            # Silueta de la sierra.
            if fy / tam > altura_sierra(fx / tam):
                cob = suavizado((altura_sierra(fx / tam) - fy / tam) * tam, 0, 1.6)
                col = mezclar(col, (10, 17, 32), cob)

            # Disco solar.
            if d_sol < sol_r + 2:
                col = mezclar(col, (255, 178, 56), suavizado(d_sol, sol_r))

            # Disco lunar tapando el Sol.
            d_luna = math.hypot(fx - (sol_cx + luna_dx), fy - (sol_cy + luna_dy))
            if d_luna < sol_r + 2:
                col = mezclar(col, (8, 11, 20), suavizado(d_luna, sol_r))

            i = (y * tam + x) * 4
            px[i], px[i + 1], px[i + 2] = col
            px[i + 3] = int(round(a * 255))

    return px


if __name__ == "__main__":
    SALIDA.mkdir(exist_ok=True)
    for nombre, tam, mask in [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable.png", 512, True),
    ]:
        n = escribir_png(SALIDA / nombre, tam, tam, dibujar(tam, mask))
        print(f"  {nombre:<22} {tam}×{tam}  {n/1024:.1f} kB")
    print("Iconos generados en", SALIDA)
