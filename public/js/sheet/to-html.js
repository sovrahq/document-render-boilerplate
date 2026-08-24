/**
 * El IR como un documento HTML autocontenido: exactamente lo que devuelve
 * `GET /api/v1/documents/{id}/page`, generado en el browser.
 *
 * La pagina NO usa este adaptador — dibuja con `to-dom.js`. Este esta por otras
 * tres razones, y las tres importan mas que un boton:
 *
 *   1. Es el que se puede comparar. `test/page.test.mjs` corre esto contra la
 *      respuesta real del lambda y exige igualdad byte a byte. Es la unica forma
 *      de saber que nuestro render y el del backend siguen coincidiendo, y por
 *      eso es el test que sostiene todo lo demas.
 *   2. Es la salida para guardar o servir: un .html suelto que se abre sin este
 *      servidor y sin JS.
 *   3. Es la prueba de que el core sirve. Si la geometria estuviera metida en el
 *      adaptador del DOM, no habria un segundo adaptador que escribir.
 *
 * ATENCION CON EL WHITESPACE. Los saltos de linea y las tres lineas en blanco de
 * esta plantilla no son cosmeticos: replican los que deja el heredoc de Elixir
 * en `SovraWeb.DocumentPage.render/2`, y el test golden los compara. Reformatear
 * este archivo, aunque se vea mejor, rompe el test. Si el lambda cambia, se baja
 * el fixture de nuevo y el diff dice que se movio.
 */

/** Igual que `Plug.HTML.html_escape/1`. El `&` primero, o se re-escapa. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toHtml(ir) {
  // El CSS ya viene armado en el IR, con el tamano de pagina del layout dentro.
  // Los `\n` de los bordes son parte de lo que emite el lambda.
  const styles = `<style>\n${ir.css}\n</style>\n`;
  const background = ir.background
    ? `<img class="bg" src="${ir.background}" alt="">`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ir.title)}</title>
${styles}
</head>
<body>
<div class="sheet">
${background}
${ir.elements.map(element).join("\n")}
${footer(ir.footer)}
</div>

</body>
</html>
`;
}

/**
 * Un elemento del IR como una etiqueta.
 *
 * No hay una sola decision de estilo aca: `el.style` llega armado desde
 * `build.js`. Esta funcion elige la etiqueta y escapa el texto, nada mas.
 */
function element(el) {
  switch (el.kind) {
    case "dropped":
      return "";
    case "image":
      return `<img class="${el.className}" src="${el.src}" alt="" style="${el.style}">`;
    case "text":
      return `<div class="${el.className}" style="${el.style}">${escapeHtml(el.text)}</div>`;
    default:
      return `<div class="${el.className}" style="${el.style}"></div>`;
  }
}

/**
 * La franja de procedencia. No es un elemento del layout: el emisor no la puede
 * mover ni sacar, porque es lo que permite verificar la hoja.
 *
 * La indentacion desparaja (cuatro espacios en la primera fila y ninguno en las
 * otras) es la que produce el heredoc del lambda. Esta fea y es correcta.
 */
function footer(data) {
  const rows = data.rows.map(row).join("\n");
  const qr = data.qr
    ? `<img src="${data.qr}" alt="" width="130" height="130">`
    : "";

  return `<div class="footer">
  <div class="rule"></div>
  <div class="cols">
    <div class="fields">
    ${rows}
    </div>
    <div class="qr">${qr}</div>
  </div>
</div>
`;
}

function row({ key, kind, text, href }) {
  const value =
    kind === "link"
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`
      : escapeHtml(text);

  return `<div class="row"><span class="k">${escapeHtml(key)}</span><span class="v">${value}</span></div>`;
}
