/**
 * El QR del footer: el credential completo, no un link.
 *
 * Es la parte que hace que la hoja no haya que creerla. Quien la recibe escanea
 * y verifica la firma contra la cadena; si este servicio desaparece, el QR
 * impreso sigue sirviendo.
 *
 * El encoder es el de Kazuhiko Arase (`vendor/qrcode-generator.js`, MIT), byte
 * mode y correccion nivel L, la misma combinacion que usa el lambda. La matriz
 * se expone aparte del PNG para poder testearla en Node, donde no hay canvas.
 */

import qrcode from "./vendor/qrcode-generator.js";
import { QR_SIZE } from "./sheet/css.js";

/** Zona quieta, en modulos. Cuatro es lo que pide la norma. */
const QUIET = 4;

/** Nivel L: la correccion mas baja, que es la que deja entrar mas bytes. */
const ECC = "L";

/**
 * La matriz de modulos del QR, con la zona quieta incluida.
 *
 * `0` como version le pide al encoder la mas chica que aguante el payload. Un
 * credential ronda los 900 bytes, asi que caen versiones altas; arriba de ~2.9 KB
 * no entra en ninguna y esto lanza.
 *
 * @returns {boolean[][]} filas de arriba a abajo, `true` = modulo oscuro
 */
export function qrMatrix(data) {
  const qr = qrcode(0, ECC);
  qr.addData(data, "Byte");
  qr.make();

  const count = qr.getModuleCount();
  const side = count + QUIET * 2;
  const matrix = [];

  for (let y = 0; y < side; y += 1) {
    const row = [];
    for (let x = 0; x < side; x += 1) {
      const inside =
        y >= QUIET && y < QUIET + count && x >= QUIET && x < QUIET + count;
      row.push(inside ? qr.isDark(y - QUIET, x - QUIET) : false);
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * El QR como data URI PNG, listo para el `src` del footer.
 *
 * PNG y no SVG: el SVG es un rect por modulo, dos ordenes de magnitud mas
 * pesado. Se dibuja a cuatro veces el tamano de display para que impreso quede
 * nitido.
 *
 * Perder el QR es mejor que perder la pagina, asi que un payload que no entra
 * devuelve null en lugar de lanzar.
 */
export function qrDataUri(data, size = QR_SIZE) {
  try {
    const matrix = qrMatrix(data);
    const side = matrix.length;
    const scale = Math.max(1, Math.round((size * 4) / side));

    const canvas = document.createElement("canvas");
    canvas.width = side * scale;
    canvas.height = side * scale;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        if (matrix[y][x]) ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
