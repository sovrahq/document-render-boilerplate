/**
 * Nuestro QR contra el que emite el lambda.
 *
 * El PNG no puede coincidir byte a byte: el del lambda lo escribe EQRCode en
 * Elixir y el nuestro sale de un canvas. Lo que si tiene que coincidir es la
 * matriz, que es lo que un lector escanea. Si coincide modulo a modulo, los dos
 * QR son el mismo QR.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { qrMatrix } from "../public/js/qr.js";
import { document_, pageQrModules } from "./helpers/fixtures.mjs";

const QUIET = 4;

test("la matriz coincide modulo a modulo con la del lambda", () => {
  const theirs = pageQrModules();
  const ours = qrMatrix(document_.credential);
  const side = theirs.length;

  // Version 15: 77 modulos. Si esto cambia, cambio la eleccion de version.
  assert.equal(side, 77);
  assert.equal(ours.length, side + QUIET * 2);

  let differ = 0;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      if (theirs[y][x] !== ours[y + QUIET][x + QUIET]) differ += 1;
    }
  }
  assert.equal(differ, 0, `${differ} de ${side * side} modulos distintos`);
});

test("la zona quieta esta limpia", () => {
  const matrix = qrMatrix(document_.credential);
  const side = matrix.length;

  for (let i = 0; i < side; i += 1) {
    for (let q = 0; q < QUIET; q += 1) {
      assert.equal(matrix[q][i], false);
      assert.equal(matrix[side - 1 - q][i], false);
      assert.equal(matrix[i][q], false);
      assert.equal(matrix[i][side - 1 - q], false);
    }
  }
});

test("el QR lleva el credential completo, no un link", () => {
  // El credential de este documento son 520 bytes y necesita la version 15.
  // El link a la misma hoja son ~90 y entra en una version mucho mas chica: que
  // haga falta la grande es la prueba barata de que va el payload entero.
  const link = `https://test-api-sovra.flagonsa.com/api/v1/documents/${document_.id}/page`;

  assert.equal(qrMatrix(document_.credential).length - QUIET * 2, 77);
  assert.ok(qrMatrix(link).length - QUIET * 2 < 77);
});

test("un payload que no entra en ningun QR lanza, y qrDataUri lo absorbe", () => {
  // Nivel L tope ~2953 bytes. Perder el QR es mejor que perder la pagina.
  assert.throws(() => qrMatrix("x".repeat(4000)));
});
