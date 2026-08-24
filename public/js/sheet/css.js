/**
 * Las constantes y el CSS de la hoja, en paridad con el renderer del lambda
 * (backend/lib/sovra_web/documents/document_page.ex) y con el canvas del emisor
 * (frontend/issuer/src/lib/document-layout.ts).
 *
 * El CSS es una funcion y no un archivo .css porque depende del tamano de la
 * pagina: `.sheet` lleva el width/height del layout y `.footer` lleva el ancho
 * menos los dos margenes. Una sola fuente para el DOM y para el HTML suelto.
 */

/** A4 a 96dpi. El default cuando el layout no trae `page`. */
export const PAGE = { width: 794, height: 1123 };

/** Margen de la hoja. El texto corta aca. */
export const MARGIN = 48;

/** Donde arranca la franja de procedencia. No es un elemento del layout. */
export const FOOTER_TOP = 920;

export const QR_SIZE = 130;

export const DEFAULT_COLOR = "#111827";

// No son las webfonts del dashboard: esta pagina no puede cargarlas, y otras
// metricas mueven todos los textos. Helvetica y Arial son metric compatible,
// asi que la hoja mide lo mismo en cualquier sistema.
export const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
export const FONT_MONO =
  'ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace';

/**
 * El contenido del <style> de la hoja, sin las etiquetas.
 *
 * Byte a byte lo que emite `SovraWeb.DocumentPage.styles/1`, incluida la
 * continuacion indentada de `.sheet`: el test golden compara contra la salida
 * real de `/page`, asi que cualquier retoque cosmetico aca lo hace fallar.
 */
export function sheetCss(page = PAGE) {
  return `*{box-sizing:border-box}
body{margin:0;background:#f3f4f6;font-family:${FONT}}
.sheet{position:relative;width:${page.width}px;height:${page.height}px;margin:24px auto;background:#fff;
       box-shadow:0 1px 3px rgba(0,0,0,.2);overflow:hidden}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.el{position:absolute;white-space:nowrap;line-height:1.2}
.el.text{white-space:pre-wrap;overflow-wrap:break-word}
.footer{position:absolute;left:${MARGIN}px;top:${FOOTER_TOP}px;width:${page.width - MARGIN * 2}px}
.rule{height:1px;background:#d1d5db}
.cols{display:flex;gap:16px;margin-top:16px}
.fields{flex:1;min-width:0;display:grid;gap:10px}
.row{display:flex;gap:10px;font-size:13px;line-height:1.35}
.row .k{width:86px;flex:0 0 auto;color:#6b7280}
.row .v{font-family:${FONT_MONO};color:#374151;word-break:break-all}
.row .v a{color:#1d4ed8}
@media print{.row .v a{color:#374151;text-decoration:none}}
.qr{flex:0 0 auto;width:${QR_SIZE}px;height:${QR_SIZE}px}
@page{size:A4;margin:0}
@media print{body{background:#fff}.sheet{margin:0;box-shadow:none}}`;
}
