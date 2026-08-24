/**
 * El IR como nodos, dentro de un contenedor de una pagina que ya existe.
 *
 * El otro adaptador. No comparte una linea de geometria con `to-html.js`: todo
 * lo que decide posiciones, tamanos y colores ya vino resuelto en el IR.
 *
 * El texto entra por `textContent` y nunca por `innerHTML`, asi que el saneo del
 * core es una segunda linea de defensa y no la unica.
 */

/** Reemplaza el contenido de `container` por la hoja. Devuelve el `.sheet`. */
export function toDom(ir, container) {
  const style = document.createElement("style");
  style.textContent = ir.css;

  const sheet = document.createElement("div");
  sheet.className = "sheet";

  if (ir.background) {
    const bg = document.createElement("img");
    bg.className = "bg";
    bg.src = ir.background;
    bg.alt = "";
    sheet.append(bg);
  }

  for (const el of ir.elements) {
    const node = element(el);
    if (node) sheet.append(node);
  }

  sheet.append(footer(ir.footer));

  container.replaceChildren(style, sheet);
  return sheet;
}

function element(el) {
  if (el.kind === "dropped") return null;

  const node = document.createElement(el.tag);
  node.className = el.className;
  node.setAttribute("style", el.style);

  if (el.kind === "image") {
    node.src = el.src;
    node.alt = "";
  } else if (el.kind === "text") {
    node.textContent = el.text;
  }
  return node;
}

function footer(data) {
  const fields = document.createElement("div");
  fields.className = "fields";
  for (const row of data.rows) fields.append(fieldRow(row));

  const qr = document.createElement("div");
  qr.className = "qr";
  if (data.qr) {
    const img = document.createElement("img");
    img.src = data.qr;
    img.alt = "";
    img.width = 130;
    img.height = 130;
    qr.append(img);
  }

  const cols = document.createElement("div");
  cols.className = "cols";
  cols.append(fields, qr);

  const rule = document.createElement("div");
  rule.className = "rule";

  const node = document.createElement("div");
  node.className = "footer";
  node.append(rule, cols);
  return node;
}

function fieldRow({ key, kind, text, href }) {
  const k = document.createElement("span");
  k.className = "k";
  k.textContent = key;

  const v = document.createElement("span");
  v.className = "v";
  if (kind === "link") {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = text;
    v.append(a);
  } else {
    v.textContent = text;
  }

  const row = document.createElement("div");
  row.className = "row";
  row.append(k, v);
  return row;
}
