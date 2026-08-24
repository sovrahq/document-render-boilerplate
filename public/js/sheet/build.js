/**
 * EL CORE. Si vas a cambiar como se ve la hoja, se cambia aca y en ningun otro
 * lugar.
 *
 * Que hace: toma la respuesta de `/api/v1/documents/{id}` mas lo que se leyo del
 * credential, y devuelve una lista de cajas con la posicion, el tamano, el color
 * y el saneo ya resueltos. Nada mas. Ese resultado es lo que este repo llama el
 * IR (representacion intermedia).
 *
 *   { title, page, css, background, elements: [...], footer: {...} }
 *
 * Por que existe un IR y no dos renderers: los dos adaptadores (`to-dom.js` y
 * `to-html.js`) solo recorren esto. No calculan una posicion, no eligen un
 * color, no aplican una regla. Asi la geometria existe una sola vez y la hoja de
 * la pantalla no puede diferir del .html que se genera. Con un renderer por
 * salida, la primera vez que alguien cambie un margen va a cambiarlo en uno.
 *
 * Por que es puro: no toca el DOM, no toca la red, y el QR entra ya generado
 * como data URI en vez de generarse adentro. Gracias a eso corre en Node, y por
 * eso el test golden puede comparar la salida contra la del lambda de verdad.
 *
 * Paridad: cada regla de aca esta en `SovraWeb.DocumentPage` del lambda, con el
 * mismo motivo. El layout lo controla el emisor pero termina dentro de un
 * atributo `style`, asi que lo que no se reconoce se descarta.
 */

import { DEFAULT_COLOR, MARGIN, PAGE, sheetCss } from "./css.js";

/** Donde se mira una transaccion. El lambda lo tiene configurable; aca es fijo. */
const EXPLORER_URL = "https://explorer.testnet.sovra.io";

/*
 * Las dos expresiones que hacen de frontera.
 *
 * IMAGE_URI: solo data URIs base64, y solo los dos tipos que acepta el editor.
 * Nada mas llega a un `src`. Sin esto, un layout con `src: "javascript:…"` o con
 * una URL a un tracker externo se dibuja igual, y la hoja pasaria a depender de
 * un servidor de terceros.
 *
 * HEX_COLOR: los colores terminan en un `style`, asi que un valor como
 * `"#fff; position:fixed; top:0"` podria despegar un elemento de la hoja. Solo
 * pasa un hex plano.
 */
const IMAGE_URI = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/**
 * El IR de la hoja.
 *
 * @param {object} document   la respuesta de `/api/v1/documents/{id}`
 * @param {object} read       el resultado de `readCredential` (claims y digest)
 * @param {string|null} qr    el QR del credential como data URI, o null
 * @param {string} explorerUrl  la base del explorer, para el link de la tx
 */
export function buildSheet(document, read, qr = null, explorerUrl = EXPLORER_URL) {
  // `|| {}` y no un throw: un documento sin layout tiene que dar una hoja vacia
  // con su footer, no una pagina caida.
  const layout = document?.layout || {};
  const page = pageSize(layout);
  const claims = read?.claims || {};

  return {
    title: text(document?.schema?.name),
    page,
    // El CSS entra en el IR porque depende del tamano de pagina, y los dos
    // adaptadores lo necesitan igual.
    css: sheetCss(page),
    background: imageSrc(layout.background),
    elements: elementsOf(layout).map((element) => box(element, claims, page)),
    footer: footer(document, read, qr, explorerUrl),
  };
}

/* ------------------------------------------------------------- elementos */

/**
 * Los elementos que se pueden dibujar.
 *
 * Lo que no es un objeto se descarta y no se avisa: el renderer no confia en la
 * forma del layout, asi que uno roto cuesta un elemento y no la pagina entera.
 * Un `null` en el array llegaria a `element.type` y tiraria todo.
 */
function elementsOf(layout) {
  return Array.isArray(layout.elements) ? layout.elements.filter(isObject) : [];
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Un elemento del layout como una caja del IR.
 *
 * Cinco tipos, los mismos que produce el canvas del emisor
 * (frontend/issuer/src/lib/document-layout.ts): `text`, `field`, `line`, `box` e
 * `image`. Un `type` desconocido cae en el default y se trata como texto, que es
 * lo mismo que hace el lambda: es mejor dibujar el `value` que no dibujar nada.
 */
function box(element, claims, page) {
  switch (element.type) {
    // Una regla. Siempre 1px de alto: el grosor no es configurable.
    case "line":
      return {
        kind: "line",
        tag: "div",
        className: "el",
        style:
          `${at(element)}width:${num(element.width)}px;height:1px;` +
          `background:${color(element.color)}`,
      };

    // Un rectangulo de fondo. Va antes en el layout que lo que se apoya encima:
    // no hay z-index, el orden del array es el orden de pintado.
    case "box":
      return {
        kind: "box",
        tag: "div",
        className: "el",
        style:
          `${at(element)}width:${num(element.width)}px;height:${num(element.height)}px;` +
          `background:${color(element.color)};border-radius:${num(element.radius)}px`,
      };

    // Un logo o un sello. Si el src no pasa el filtro se descarta el elemento
    // entero, no se dibuja una caja vacia: un hueco es mas honesto.
    case "image": {
      const src = imageSrc(element.src);
      if (!src) return { kind: "dropped" };
      return {
        kind: "image",
        tag: "img",
        className: "el",
        src,
        style:
          `${at(element)}width:${num(element.width)}px;` +
          `height:${num(element.height)}px;object-fit:contain`,
      };
    }

    default:
      return textBox(element, claims, page);
  }
}

/**
 * Texto: `text` dibuja su `value`, `field` resuelve el claim que dice su `bind`.
 *
 * Es la unica diferencia entre los dos tipos. Un `field` cuyo `bind` no existe
 * entre los claims declarados dibuja vacio, y eso incluye a proposito los claims
 * registrados: un layout que bindea a `iss` no filtra el emisor, dibuja nada.
 * Ver `credential.js`.
 */
function textBox(element, claims, page) {
  const value = element.type === "field" ? claims[element.bind] : element.value;

  const size = isNumber(element.size) ? element.size : 14;

  // El espacio que queda desde la x del elemento hasta el margen derecho. El
  // layout no trae este numero: es derivado, y es el que hace que un texto largo
  // corte en el margen en vez de irse fuera de la hoja.
  const room = Math.max(0, page.width - MARGIN - num2(element.x));

  // Un ancho fijo mantiene la caja quieta sea cual sea el valor que llegue. Sin
  // uno, el elemento se ajusta a su texto: dos documentos del mismo schema con
  // contenidos distintos quedan maquetados distinto. El `width` del layout se
  // recorta a `room` para que nunca se pase del margen.
  const width =
    typeof element.width === "number"
      ? `width:${num(Math.min(element.width, room))}px;`
      : `max-width:${num(room)}px;`;

  return {
    kind: "text",
    tag: "div",
    className: "el text",
    // El texto crudo. Escapar es tarea del adaptador: `to-html.js` lo escapa,
    // `to-dom.js` usa textContent y no necesita escaparlo.
    text: text(value),
    // El orden de las propiedades no es libre: el test golden compara el string
    // completo contra el del lambda.
    style:
      `${at(element)}${width}text-align:${align(element.align)};` +
      `font-size:${num(size)}px;font-weight:${element.bold ? 700 : 400};` +
      `color:${color(element.color)};${fill(element, size)}`,
  };
}

/** La posicion. Todo elemento es absoluto respecto de la hoja. */
function at(element) {
  return `left:${num(element.x)}px;top:${num(element.y)}px;`;
}

/**
 * El relleno detras de un texto, cuando el elemento trae `bg`.
 *
 * El padding es proporcional al cuerpo de la letra en vez de fijo, asi la
 * pastilla se ajusta al contenido y entra cualquier valor sin que el emisor
 * tenga que medirla. El 0.45 y el 1.6 son los mismos que usa el canvas.
 */
function fill(element, size) {
  if (typeof element.bg !== "string") return "";
  const pad = Math.round(size * 0.45);
  return (
    `background:${color(element.bg)};padding:${pad}px ${Math.round(pad * 1.6)}px;` +
    `border-radius:${num(element.radius, 4)}px;`
  );
}

/* --------------------------------------------------------------- footer */

/**
 * La franja de procedencia: quien emitio, en que transaccion, y sobre que bytes.
 *
 * No es un elemento del layout y el emisor no la puede mover ni sacar. Es lo que
 * permite ir a verificar en lugar de creerle a la hoja, asi que si fuera
 * opcional el documento no serviria para nada.
 */
function footer(document, read, qr, explorerUrl) {
  const txHash = document?.anchor?.tx_hash || null;

  return {
    rows: [
      { key: "Issued by", kind: "text", text: issuer(document) },

      txHash
        ? {
            key: "Transaction",
            kind: "link",
            text: txHash,
            // Linkeado al explorer en pantalla, y el hash completo queda escrito
            // igual, asi que en papel tambien se puede seguir a mano.
            href: `${explorerUrl}/tx/${txHash}`,
          }
        // Sin hash no se inventa un link: se dice que no esta anclado.
        : { key: "Transaction", kind: "text", text: "not anchored" },

      {
        key: "Digest",
        kind: "text",
        // Este valor no viene en la respuesta: lo calculo `credential.js`. Si el
        // credential no se pudo leer, se dice, y no se pone un hash cualquiera.
        text: read?.digest || "unavailable",
      },
    ],
    qr,
  };
}

/**
 * El emisor como una linea: nombre y DID separados por un punto medio.
 *
 * El nombre es informativo y no esta firmado; el DID si (sale de `iss`). Van
 * juntos porque el nombre es lo que un humano reconoce y el DID es lo que se
 * puede comprobar. Si falta uno, no queda el separador colgando.
 */
function issuer(document) {
  return [document?.issuer?.name, document?.issuer?.did]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join(" · ");
}

/* ----------------------------------------------------------------- saneo */

/**
 * El tamano de la hoja.
 *
 * Se exige que las dos medidas sean numeros: un `"794"` como string se cuela
 * hasta el CSS y despues rompe la aritmetica del margen. Si no cumple, A4 a
 * 96dpi, que es lo que produce el canvas.
 */
function pageSize(layout) {
  const page = layout.page;
  if (isObject(page) && isNumber(page.width) && isNumber(page.height)) {
    return { width: page.width, height: page.height };
  }
  return { ...PAGE };
}

/** Tres valores y nada mas. Cualquier otra cosa es `left`. */
function align(value) {
  return value === "center" || value === "right" || value === "left"
    ? value
    : "left";
}

/** Un hex plano o el default. Ver el comentario de HEX_COLOR. */
function color(value) {
  return typeof value === "string" && HEX_COLOR.test(value)
    ? value
    : DEFAULT_COLOR;
}

/** Una data URI png o jpeg, o null. Ver el comentario de IMAGE_URI. */
function imageSrc(value) {
  return typeof value === "string" && IMAGE_URI.test(value) ? value : null;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Un numero como lo escribe el lambda, listo para pegar en un `style`.
 *
 * Los enteros tal cual; los flotantes redondeados a dos decimales. El detalle
 * raro: Elixir imprime `12.0` donde JS imprime `12`, asi que el punto se fuerza
 * para que el golden coincida. El canvas del emisor solo produce enteros, pero un
 * layout escrito a mano puede traer decimales.
 *
 * Devuelve un string, no un numero, y el fallback tambien: nunca sale `NaNpx` ni
 * `undefinedpx` de aca.
 */
function num(value, fallback = 0) {
  if (!isNumber(value)) return String(fallback);
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}.0` : String(rounded);
}

/** Lo mismo, pero como numero, para cuando hay que seguir calculando. */
function num2(value, fallback = 0) {
  return isNumber(value) ? value : fallback;
}

/**
 * Un valor de claim como texto.
 *
 * Igual que `to_text/1` del lambda: nada de `undefined`, `null` ni
 * `[object Object]` impreso en un documento firmado. Un claim ausente es cadena
 * vacia, no la palabra "undefined".
 */
function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Un objeto o un array en un claim es un schema mal usado. Se imprime algo
  // legible en lugar de romper.
  return JSON.stringify(value);
}
