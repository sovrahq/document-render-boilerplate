/**
 * El saneo del core.
 *
 * El layout lo controla el emisor y termina dentro de un atributo `style`, asi
 * que cada regla de aca existe para que un layout hostil o roto cueste un
 * elemento y no la pagina. Mismas reglas que `SovraWeb.DocumentPage`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSheet } from "../public/js/sheet/build.js";
import { toHtml } from "../public/js/sheet/to-html.js";
import { document_ } from "./helpers/fixtures.mjs";

const read = { ok: true, claims: { content: "hola" }, digest: "0xabc", error: null };

function sheet(elements, extra = {}) {
  return buildSheet(
    { ...document_, layout: { page: { width: 794, height: 1123 }, elements, ...extra } },
    read,
    null
  );
}

test("un color que no es hex plano cae al default", () => {
  const ir = sheet([
    { id: "a", type: "text", value: "x", x: 10, y: 10, size: 14, color: "red" },
    { id: "b", type: "text", value: "x", x: 10, y: 10, size: 14, color: "#fff; position:fixed" },
    { id: "c", type: "text", value: "x", x: 10, y: 10, size: 14, color: "#1d4ed8" },
  ]);

  assert.match(ir.elements[0].style, /color:#111827;/);
  assert.match(ir.elements[1].style, /color:#111827;/);
  assert.match(ir.elements[2].style, /color:#1d4ed8;/);
});

test("una imagen que no es data:png|jpeg base64 se descarta entera", () => {
  const ir = sheet([
    { id: "a", type: "image", src: "https://example.com/logo.png", x: 0, y: 0, width: 10, height: 10 },
    { id: "b", type: "image", src: "javascript:alert(1)", x: 0, y: 0, width: 10, height: 10 },
    { id: "c", type: "image", src: "data:image/svg+xml;base64,AAAA", x: 0, y: 0, width: 10, height: 10 },
    { id: "d", type: "image", src: "data:image/png;base64,AAAA", x: 0, y: 0, width: 10, height: 10 },
  ]);

  assert.deepEqual(ir.elements.map((e) => e.kind), ["dropped", "dropped", "dropped", "image"]);
  const html = toHtml(ir);
  assert.ok(!html.includes("example.com"));
  assert.ok(!html.includes("javascript:"));
});

test("un fondo que no es data URI no llega al src", () => {
  assert.equal(sheet([], { background: "https://example.com/bg.png" }).background, null);
  assert.equal(sheet([], { background: "data:image/jpeg;base64,AAAA" }).background, "data:image/jpeg;base64,AAAA");
});

test("lo que no es un objeto en elements se descarta", () => {
  const ir = sheet([null, "texto", 42, ["a"], { id: "ok", type: "text", value: "x", x: 1, y: 1, size: 14 }]);
  assert.equal(ir.elements.length, 1);
});

test("un layout sin page cae en A4 a 96dpi", () => {
  const ir = buildSheet({ ...document_, layout: { elements: [] } }, read, null);
  assert.deepEqual(ir.page, { width: 794, height: 1123 });

  const bad = buildSheet({ ...document_, layout: { page: { width: "794" }, elements: [] } }, read, null);
  assert.deepEqual(bad.page, { width: 794, height: 1123 });
});

test("sin layout la hoja sale vacia, con footer, sin caerse", () => {
  const ir = buildSheet({ ...document_, layout: undefined }, read, null);
  assert.deepEqual(ir.elements, []);
  assert.match(toHtml(ir), /<div class="footer">/);
});

test("el ancho se recorta al margen derecho", () => {
  const ir = sheet([
    { id: "a", type: "text", value: "x", x: 700, y: 10, size: 14 },
    { id: "b", type: "text", value: "x", x: 100, y: 10, size: 14, width: 5000 },
    { id: "c", type: "text", value: "x", x: 100, y: 10, size: 14, width: 200 },
  ]);

  assert.match(ir.elements[0].style, /max-width:46px;/);   // 794 - 48 - 700
  assert.match(ir.elements[1].style, /width:646px;/);      // recortado
  assert.match(ir.elements[2].style, /width:200px;/);
});

test("align solo acepta los tres valores, y el resto es left", () => {
  const ir = sheet([
    { id: "a", type: "text", value: "x", x: 0, y: 0, size: 14, align: "center" },
    { id: "b", type: "text", value: "x", x: 0, y: 0, size: 14, align: "justify" },
  ]);
  assert.match(ir.elements[0].style, /text-align:center;/);
  assert.match(ir.elements[1].style, /text-align:left;/);
});

test("el texto se escapa: nada de HTML del emisor ni de los claims", () => {
  const ir = buildSheet(
    {
      ...document_,
      layout: {
        page: { width: 794, height: 1123 },
        elements: [
          { id: "a", type: "text", value: '<script>alert(1)</script>', x: 0, y: 0, size: 14 },
          { id: "b", type: "field", bind: "content", x: 0, y: 0, size: 14 },
        ],
      },
    },
    { ...read, claims: { content: '"><img src=x onerror=alert(1)>' } },
    null
  );

  const html = toHtml(ir);
  // `onerror=alert(1)` sigue apareciendo como texto plano, y esta bien: lo que
  // importa es que ni `<script` ni `<img` lleguen sin escapar, asi que el
  // browser no ve una etiqueta en ningun caso.
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("un valor que no es string se dibuja como lo escribe el lambda", () => {
  const ir = buildSheet(
    { ...document_, layout: { page: { width: 794, height: 1123 }, elements: [
      { id: "a", type: "field", bind: "n", x: 0, y: 0, size: 14 },
      { id: "b", type: "field", bind: "b", x: 0, y: 0, size: 14 },
      { id: "c", type: "field", bind: "falta", x: 0, y: 0, size: 14 },
    ] } },
    { ...read, claims: { n: 1234567, b: false } },
    null
  );

  assert.equal(ir.elements[0].text, "1234567");
  assert.equal(ir.elements[1].text, "false");
  assert.equal(ir.elements[2].text, "");
});

test("sin tx_hash el footer dice not anchored y no inventa un link", () => {
  const ir = buildSheet({ ...document_, anchor: { status: "pending" } }, read, null);
  const html = toHtml(ir);

  assert.match(html, /<span class="k">Transaction<\/span><span class="v">not anchored<\/span>/);
  assert.ok(!html.includes("explorer.testnet.sovra.io"));
});
