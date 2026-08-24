/**
 * El test que sostiene todo lo demas: lo que genera `to-html.js` tiene que ser,
 * byte a byte, lo que devuelve `GET /api/v1/documents/{id}/page`.
 *
 * El fixture es la respuesta real del lambda, no una transcripcion. Si el
 * renderer del backend cambia, se vuelve a bajar el fixture y este test dice
 * exactamente que se movio.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSheet } from "../public/js/sheet/build.js";
import { toHtml } from "../public/js/sheet/to-html.js";
import { readCredential } from "../public/js/credential.js";
import { document_, page, pageQr } from "./helpers/fixtures.mjs";

test("la hoja generada es identica al /page del lambda", async () => {
  const read = await readCredential(document_.credential, document_.schema);
  // El QR del fixture, para que la comparacion cubra todo lo demas. Que nuestro
  // encoder produzca esta misma matriz lo prueba qr.test.mjs.
  const ours = toHtml(buildSheet(document_, read, pageQr));

  assert.equal(ours, page);
});

test("el HTML suelto lleva el digest calculado, que no viene en la respuesta", async () => {
  const read = await readCredential(document_.credential, document_.schema);
  const html = toHtml(buildSheet(document_, read, null));

  assert.equal(read.digest, `0x${"1043b72377323a01dfea31a2eaa2499712146b6104d365de782c9229072cb6ec"}`);
  assert.match(html, /<span class="k">Digest<\/span><span class="v">0x1043b723/);
  assert.ok(!("digest" in document_), "la respuesta publica no trae digest");
});

test("sin QR el hueco queda vacio y la hoja sigue entera", async () => {
  const read = await readCredential(document_.credential, document_.schema);
  const html = toHtml(buildSheet(document_, read, null));

  assert.match(html, /<div class="qr"><\/div>/);
  assert.match(html, /Contenido de Prueba/);
});

test("un credential ilegible cuesta los campos y el digest, no la pagina", async () => {
  const read = await readCredential("roto", document_.schema);
  const html = toHtml(buildSheet(document_, read, null));

  assert.equal(read.ok, false);
  // Los `text` del layout siguen ahi; los `field` quedan vacios.
  assert.match(html, />Content<\/div>/);
  assert.ok(!html.includes("Contenido de Prueba"));
  assert.match(html, /<span class="v">unavailable<\/span>/);
});

test("los claims registrados no se pueden dibujar", async () => {
  const read = await readCredential(document_.credential, document_.schema);

  for (const registered of ["iss", "vct", "jti", "iat", "exp"]) {
    assert.ok(!(registered in read.claims), `${registered} llego a los claims`);
  }
  // Un layout que bindea a `iss` dibuja vacio, no el emisor.
  const layout = { page: document_.layout.page, elements: [{ id: "x", type: "field", bind: "iss", x: 10, y: 10, size: 14 }] };
  const html = toHtml(buildSheet({ ...document_, layout }, read, null));
  assert.ok(!html.includes("test-api-sovra.flagonsa.com/did:sovra"));
});
