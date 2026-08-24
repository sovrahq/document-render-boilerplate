/** Los dos fixtures son respuestas reales de test-api-sovra, no inventadas. */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export const document_ = JSON.parse(
  readFileSync(here("../fixtures/document.json"), "utf8")
);

/** La salida literal de `GET /api/v1/documents/{id}/page`. */
export const page = readFileSync(here("../fixtures/page.html"), "utf8");

/** El QR que emitio el lambda, como data URI. */
export const pageQr = page.match(/src="(data:image\/png;base64,[^"]+)"/)[1];

/**
 * Los modulos del QR del lambda.
 *
 * El PNG lo genera EQRCode a 6px por modulo con zona quieta de 2 (486 = 81x6),
 * asi que se puede volver a la matriz muestreando el centro de cada modulo.
 * Se decodifica a mano: no hay dependencias en este repo y un PNG sin
 * entrelazado son dos pasos, inflate y des-filtrar.
 */
export function pageQrModules() {
  const png = Buffer.from(pageQr.split(",")[1], "base64");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6) {
    throw new Error("el fixture dejo de ser un PNG RGBA de 8 bits");
  }

  const idat = [];
  for (let off = 8; off < png.length; ) {
    const length = png.readUInt32BE(off);
    if (png.toString("ascii", off + 4, off + 8) === "IDAT") {
      idat.push(png.subarray(off + 8, off + 8 + length));
    }
    off += 12 + length;
  }

  const bpp = 4;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const img = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? img[y * stride + x - bpp] : 0;
      const b = y > 0 ? img[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? img[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      img[y * stride + x] = v & 0xff;
    }
  }

  const scale = 6;
  const quiet = 2;
  const side = width / scale - quiet * 2;
  const modules = [];
  for (let y = 0; y < side; y += 1) {
    const row = [];
    for (let x = 0; x < side; x += 1) {
      const px = (quiet + x) * scale + 3;
      const py = (quiet + y) * scale + 3;
      row.push(img[py * stride + px * bpp] < 128);
    }
    modules.push(row);
  }
  return modules;
}
