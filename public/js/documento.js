/**
 * La pagina. Es el unico archivo que sabe que existe un browser, una URL y un
 * usuario; todo lo demas es funciones.
 *
 * Los pasos estan numerados y son los mismos que explica
 * `docs/como-se-arma-el-documento.md`. Si vas a leer un solo archivo del repo
 * para entender como se arma la hoja, es este: los otros son las piezas que
 * este ordena.
 *
 *   PASO 1  leer el `?id=` de la URL y validarlo antes de gastar una llamada
 *   PASO 2  pedir el documento a la API (via el proxy de server.js)
 *   PASO 3  abrir el credential: de ahi salen los valores y el digest
 *   PASO 4  generar el QR con el credential completo
 *   PASO 5  armar el IR de la hoja (toda la geometria pasa aca)
 *   PASO 6  dibujar ese IR como nodos
 *
 * Ninguno de estos pasos decide como se ve la hoja. Eso vive entero en
 * `sheet/build.js`, y por eso este archivo es corto.
 */

import { ApiError, fetchDocument, isDocumentId } from "./api.js";
import { readCredential } from "./credential.js";
import { qrDataUri } from "./qr.js";
import { buildSheet } from "./sheet/build.js";
import { toDom } from "./sheet/to-dom.js";

// Los tres huecos del HTML. Se buscan una vez y no se vuelven a consultar.
const els = {
  status: document.querySelector("#status"),
  stage: document.querySelector("#stage"),
};

main();

async function main() {
  /* ------------------------------------------------------------- PASO 1
   * El id sale de la query string y se valida ACA, antes de tocar la red.
   *
   * No es paranoia: sin esta puerta, un `?id=` cualquiera se convierte en una
   * llamada al proxy que va a rebotar de todas formas. Validando primero, el
   * error se explica mejor y no se gasta un viaje.
   */
  const id = new URL(location.href).searchParams.get("id");

  if (!id) {
    showStatus(
      "Falta el id del documento.",
      'Abri esta pagina como <code>/documento?id=&lt;uuid&gt;</code>, o volve al <a href="/">inicio</a>.'
    );
    return;
  }

  if (!isDocumentId(id)) {
    showStatus(
      "Ese id no tiene forma de UUID.",
      "Un id de documento son 36 caracteres con guiones. No se consulta la API con esto."
    );
    return;
  }

  /* ------------------------------------------------------------- PASO 2
   * Pedir el documento.
   *
   * `fetchDocument` ya traduce los codigos de la API a frases que se pueden
   * mostrar tal cual, asi que aca no hay un `switch` sobre `status`. Un 401 no
   * es un bug: es un documento que el emisor todavia no publico.
   */
  showStatus("Buscando el documento…", `<code>${escapeText(id)}</code>`);

  let payload;
  try {
    payload = await fetchDocument(id);
  } catch (err) {
    // Solo los errores que `api.js` decidio que son mostrables. Cualquier otra
    // excepcion sube y aparece en la consola: es un bug nuestro, no un estado
    // del documento, y esconderlo lo haria mas dificil de encontrar.
    if (err instanceof ApiError) {
      showStatus("No se puede mostrar el documento.", escapeText(err.message));
      return;
    }
    throw err;
  }

  await render(payload);
}

async function render(payload) {
  /* ------------------------------------------------------------- PASO 3
   * Abrir el credential.
   *
   * Aca esta la decision de fondo de todo el render: los valores que se dibujan
   * salen del credential y NO de otro campo de la respuesta. El credential es lo
   * unico firmado; `schema`, `issuer`, `layout` y `anchor` los podria haber
   * cambiado cualquiera en el camino. Una hoja solo puede mostrar lo que cubre
   * la firma.
   *
   * De aca sale tambien el `digest`, que la respuesta publica no trae: es
   * SHA-256 del signing input, o sea exactamente lo que quedo anclado on-chain.
   *
   * `readCredential` no lanza nunca. Un credential ilegible cuesta los campos
   * dinamicos y el digest, no la pagina.
   */
  const read = await readCredential(payload.credential, payload.schema);

  /* ------------------------------------------------------------- PASO 4
   * El QR, con el credential completo adentro.
   *
   * No es un link a esta pagina: es el documento entero. Si este servicio
   * desaparece, el QR impreso sigue siendo verificable contra la cadena. Ese es
   * el unico motivo por el que la hoja no hay que creerla.
   *
   * Si el credential no se pudo leer no hay nada que meter, y si es tan largo
   * que no entra en ninguna version, `qrDataUri` devuelve null. Perder el QR es
   * mejor que perder la pagina.
   */
  const qr = read.ok ? qrDataUri(payload.credential) : null;

  /* ------------------------------------------------------------- PASO 5
   * Armar el IR: el JSON mas los claims, convertido en una lista de cajas con
   * la posicion, el tamano, el color y el saneo ya resueltos.
   *
   * Todo lo que decide como se ve la hoja pasa por esta llamada. `buildSheet` es
   * pura: no toca el DOM, no toca la red, y el QR entra ya generado. Por eso el
   * mismo resultado sirve para dibujar nodos o para escribir un .html suelto, y
   * por eso se puede testear en Node contra la salida real del lambda.
   */
  const ir = buildSheet(payload, read, qr);

  /* ------------------------------------------------------------- PASO 6
   * Dibujar. `toDom` recorre el IR y no calcula nada: si algo se ve corrido, el
   * bug esta en build.js, no aca.
   */
  toDom(ir, els.stage);

  // El "Buscando el documento…" se vacia, no solo se esconde: dejarlo ahi es
  // contenido muerto en el DOM, y el id del documento no tiene por que quedar
  // escrito dos veces en la pagina.
  clearStatus();
  els.stage.hidden = false;
  warnAboutDegradation(payload, read, qr);
}

/**
 * Lo que se degrado, anotado en la consola.
 *
 * La pagina no lo muestra a proposito: cuando hay hoja, se ve la hoja y nada
 * mas. Pero no se descarta, y por un motivo concreto: una hoja a la que le falta
 * el QR se ve casi identica a una completa, y el QR es justamente la parte que
 * permite no creerle a la pagina. Un hueco que nadie sabia que tenia que estar
 * lleno no se nota nunca.
 *
 * Si integras esto en otra pagina y queres el aviso a la vista, este es el lugar
 * de donde sacarlo.
 */
function warnAboutDegradation(payload, read, qr) {
  const warnings = [];
  if (!read.ok) warnings.push(`el credential no se pudo leer (${read.error})`);
  if (read.ok && !qr) warnings.push("el credential no entra en un QR");
  if (payload.anchor?.status !== "anchored") warnings.push("sin anclar on-chain");

  if (warnings.length) {
    console.warn(`[documento ${payload.id}] ${warnings.join(", ")}.`);
  }
}

/**
 * Muestra un estado y esconde la hoja.
 *
 * `detail` entra como HTML porque algunos mensajes llevan un <code> o un link.
 * Todos los `detail` son literales de este archivo; lo que viene de afuera (el
 * id, el mensaje de la API) pasa por `escapeText` en el punto de llamada.
 */
function showStatus(headline, detail) {
  els.status.innerHTML = `<h2>${escapeText(headline)}</h2><p>${detail}</p>`;
  els.status.hidden = false;
  els.stage.hidden = true;
}

/** La operacion inversa. Vaciar y esconder van juntos, o queda basura. */
function clearStatus() {
  els.status.replaceChildren();
  els.status.hidden = true;
}

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}
