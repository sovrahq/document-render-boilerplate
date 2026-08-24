# Documentos firmados — Sovra

Renderiza un documento firmado de Sovra en el browser, a partir del JSON que devuelve
`GET /api/v1/documents/{id}`.

HTML + CSS + JS vanilla. Sin frameworks, sin build, sin dependencias: el server usa solo
módulos nativos de Node y los tests corren con `node --test`.

Es un **boilerplate**: no está atado a un schema ni a un layout. Un schema nuevo con campos
nuevos se dibuja sin cambiar una línea.

---

## Índice

1. [Qué hace y qué no](#1-qué-hace-y-qué-no)
2. [Correr](#2-correr)
3. [Estructura de carpetas](#3-estructura-de-carpetas)
4. [El pipeline](#4-el-pipeline)
5. [Las partes importantes del código](#5-las-partes-importantes-del-código)
6. [El servidor](#6-el-servidor)
7. [Los tests](#7-los-tests)
8. [Seguridad](#8-seguridad)
9. [Lo que no está](#9-lo-que-no-está)

---

## 1. Qué hace y qué no

Abrís `/documento?id=<uuid>` y aparece la hoja A4 del documento: el layout del emisor, los
valores de sus campos, y una franja de procedencia con quién lo emitió, en qué transacción
quedó anclado, el digest, y un QR.

**Qué hace**

- Dibuja la hoja desde el `layout` que devuelve la API, con el saneo que hace falta para que
  un layout hostil o roto no rompa la página.
- Saca los valores y el digest **del `credential`**, que es lo único firmado de la respuesta.
- Genera el QR con el credential completo adentro, no un link.
- Produce la misma hoja en dos formatos: nodos en la página, o un `.html` autocontenido.

**Qué no hace**

- No verifica la firma. Eso necesita la clave pública del emisor, que vive on-chain. Ver
  [§9](#9-lo-que-no-está).
- No emite documentos. Eso es la zona emisor de la API, y necesita la API key.
- No busca. La API no tiene búsqueda: se entra por id.

---

## 2. Correr

```bash
cp .env.example .env    # y completar LAMBDA_BASE_URL y LAMBDA_API_KEY
npm start               # o: node server.js
PORT=3100 npm start     # si 3000 está ocupado
```

| Ruta | Qué es |
|---|---|
| `/` | Un formulario: pegás un id y entra. |
| `/documento?id=<uuid>` | La hoja. |

```bash
npm test                # 20 tests, sin dependencias
```

Node >= 18. No hay `npm install`: no hay dependencias.

---

## 3. Estructura de carpetas

```
.
├── server.js                    405 líneas. Sirve public/ y hace de proxy a la API.
│                                Node nativo, cero dependencias. Ver §6.
├── package.json                 dos scripts: start y test. Sin dependencies.
├── .env                         LAMBDA_BASE_URL y LAMBDA_API_KEY. NO se commitea.
├── .env.example                 la plantilla.
│
├── public/                      todo lo que se sirve al browser
│   ├── index.html                42  el formulario de entrada
│   ├── documento.html            48  el esqueleto de la hoja: dos huecos y un <script>
│   ├── css/
│   │   └── app.css               75  el bloque de estado. NO es la hoja (ver §5.3)
│   └── js/
│       ├── package.json           1  {"type":"module"} — ver la nota al final de §3
│       ├── documento.js         189  la orquestación: los 6 pasos, numerados
│       ├── api.js                71  la lectura pública vía el proxy, y los errores
│       ├── credential.js        123  los claims declarados y el digest
│       ├── qr.js                 85  el credential como QR
│       ├── sheet/
│       │   ├── build.js         341  ★ EL CORE. Toda la geometría y todo el saneo
│       │   ├── to-dom.js        105  el resultado como nodos
│       │   ├── to-html.js       113  el resultado como .html autocontenido
│       │   └── css.js            58  el CSS de la hoja, como función
│       └── vendor/
│           └── qrcode-generator.js   Kazuhiko Arase, MIT, + una línea de export
│
├── test/                        node --test. 20 tests en 3 archivos
│   ├── page.test.mjs             65  5 tests. El golden: igualdad byte a byte
│   ├── qr.test.mjs               63  4 tests. La matriz del QR contra la referencia
│   ├── build.test.mjs           145  11 tests. El saneo, regla por regla
│   ├── helpers/
│   │   └── fixtures.mjs          83  los fixtures y un decodificador de PNG
│   └── fixtures/
│       ├── document.json             respuesta real de GET /api/v1/documents/{id}
│       └── page.html                 la salida de referencia contra la que se compara
│
└── docs/                        documentación de la API, no de este repo
    ├── Sovra - Documentos Firmados.postman_collection.json
    ├── docs_api.pdf
    └── Presentation - Sovra ID - Documents.pdf
```

### Por qué hay un `package.json` dentro de `public/js/`

Contiene una sola línea: `{ "type": "module" }`.

Todo el front son módulos ES y se importan entre sí. Pero `server.js` es CommonJS (usa
`require`), así que poner `"type": "module"` en el `package.json` de la raíz lo rompería. Y
sin eso, Node trata los `.js` como CommonJS y los tests no pueden importarlos.

Un `package.json` en la carpeta cambia el modo **solo de ese subárbol**. El browser lo
ignora, `server.js` sigue en CommonJS, y los tests importan los módulos del front
directamente. Un archivo de una línea que resuelve las tres cosas.

---

## 4. El pipeline

```
  ?id=<uuid>
      │
      │  PASO 1   documento.js — validar el id antes de gastar una llamada
      ▼
  GET /proxy/documents/{id}                                        api.js
      │
      │  PASO 2   el JSON, o un mensaje que se puede mostrar tal cual
      ▼
  ┌────────────────────────────────────────────────────────────┐
  │  PASO 3   credential.js                                    │
  │           credential → claims declarados + digest          │
  └────────────────────────────────────────────────────────────┘
      │
      │  PASO 4   qr.js — el credential completo como PNG
      ▼
  ┌────────────────────────────────────────────────────────────┐
  │  PASO 5   sheet/build.js   ← TODA la geometría vive acá     │
  │           JSON + claims + digest + QR → IR                 │
  └────────────────────────────────────────────────────────────┘
      │                              │
      │  PASO 6                      │
      ▼                              ▼
  sheet/to-dom.js              sheet/to-html.js
  nodos en la página           un .html autocontenido
```

Los pasos están numerados en los comentarios de `documento.js`, con los mismos números.

### Las tres cosas que el JSON no trae

Esto es lo que sorprende al integrar, así que va temprano:

| Lo que falta | De dónde sale |
|---|---|
| **Los valores de los campos** | `schema.claims` trae solo *definiciones* (`key`, `label`, `type`, `required`). El `1234567` y el `"Contenido de Prueba"` están dentro del `credential`. |
| **El `digest`** | No viene en la lectura pública. Es `SHA-256(header.payload)` del credential, y se calcula con WebCrypto. |
| **El ancho de cada elemento** | `layout.elements[]` trae `x` e `y`, no el ancho. Es derivado: `page.width - 48 - x`. |

Y una decisión que no es un campo que falte:

> Los valores se leen **del credential** y no de ningún otro campo, aunque estuvieran ahí.
> El credential es lo único firmado de toda la respuesta: `schema`, `issuer`, `layout` y
> `anchor` los podría haber cambiado cualquiera en el camino. **Una hoja solo puede mostrar
> lo que cubre la firma.**

---

## 5. Las partes importantes del código

### 5.1 El core — `public/js/sheet/build.js`

**Si vas a cambiar cómo se ve la hoja, se cambia acá y en ningún otro lugar.**

Toma la respuesta de la API más lo que se leyó del credential, y devuelve una lista de cajas
con la posición, el tamaño, el color y el saneo ya resueltos. Este repo lo llama el **IR**
(representación intermedia):

```js
{
  title:      "Document Example",
  page:       { width: 794, height: 1123 },
  css:        "*{box-sizing:border-box}\n…",     // ya con el tamaño de página dentro
  background: null,                              // o una data URI
  elements: [
    { kind: "text", tag: "div", className: "el text",
      text: "Document Example",
      style: "left:283px;top:56px;max-width:463px;text-align:left;font-size:26px;…" },
    …
  ],
  footer: {
    rows: [ { key: "Issued by",   kind: "text", text: "…" },
            { key: "Transaction", kind: "link", text: "0x9c93…", href: "…" },
            { key: "Digest",      kind: "text", text: "0x1043…" } ],
    qr: "data:image/png;base64,…"
  }
}
```

Fijate que `style` ya es **un string armado**, no un objeto que el adaptador tenga que
serializar. Es el atributo final.

**Por qué un IR y no dos renderers.** Los dos adaptadores solo recorren esto: no calculan
una posición, no eligen un color, no aplican una regla. Así la geometría existe una sola vez
y la hoja de la pantalla no puede diferir del `.html` generado. Con un renderer por salida,
la primera vez que alguien cambie un margen lo va a cambiar en uno solo.

**Por qué es pura.** No toca el DOM, no toca la red, y el QR **entra ya generado** como
parámetro en vez de generarse adentro. Gracias a eso corre en Node, y por eso el golden
puede compararla contra la salida de referencia. Si `build.js` generara su propio QR, no
habría test.

#### Los cinco tipos de elemento

| `type` | Qué dibuja |
|---|---|
| `text` | Su `value`. Títulos, etiquetas. |
| `field` | El claim que dice su `bind`. Es la única diferencia con `text`. |
| `line` | Una regla. Siempre 1px de alto: el grosor no es configurable. |
| `box` | Un rectángulo de fondo. |
| `image` | Un logo o un sello, como data URI. |

No hay `z-index`: **el orden del array es el orden de pintado**, así que un `box` de fondo
va antes que lo que se apoya encima. Un `type` desconocido cae en el default y se trata como
texto — es mejor dibujar el `value` que no dibujar nada.

#### La geometría derivada

```js
room  = max(0, page.width - MARGIN - x)                       // MARGIN = 48
width = element.width ? min(element.width, room) : "max-width: room"
```

`room` es el espacio desde la `x` del elemento hasta el margen derecho, y es lo que hace que
un texto largo **corte en el margen** en vez de irse fuera de la hoja. El título en `x=283`
da `794 - 48 - 283 = 463`, y ahí sale `max-width:463px`.

Un ancho fijo mantiene la caja quieta sea cual sea el valor que llegue: sin uno el elemento
se ajusta a su texto, y dos documentos del mismo schema con contenidos distintos quedan
maquetados distinto.

#### El saneo, y qué pasa sin cada regla

El layout lo controla el emisor, pero termina dentro de un atributo `style`:

| Regla | Sin ella |
|---|---|
| `color` solo `/^#[0-9a-fA-F]{3,8}$/` | Un valor como `"#fff; position:fixed; top:0"` despega el elemento de la hoja. |
| `src` solo `data:image/(png\|jpeg);base64,…` | Un `src: "javascript:…"`, o una URL a un tracker: la hoja pasa a depender de un servidor de terceros. |
| Lo que no es objeto en `elements[]` se descarta | Un `null` en el array llega a `element.type` y tira la página entera. |
| `align` solo `left`/`center`/`right` | Cualquier string entra al CSS. |
| `page.width`/`height` tienen que ser **números** | Un `"794"` string se cuela hasta el CSS y rompe la aritmética del margen. |
| Todo texto se escapa | Un claim con `<img src=x onerror=…>` se ejecuta. |

Un layout roto cuesta **un elemento**, nunca la página. Los 11 tests de
`test/build.test.mjs` son exactamente esta tabla.

#### El footer

No es un elemento del layout, y **el emisor no lo puede mover ni sacar**. Es lo que permite
ir a verificar en lugar de creerle a la hoja: si fuera opcional, el documento no serviría
para nada.

- **Issued by** — nombre `·` DID. El nombre es informativo y no está firmado; el DID sí
  (sale de `iss`). Van juntos porque el nombre es lo que un humano reconoce y el DID es lo
  que se puede comprobar.
- **Transaction** — linkeada al explorer en pantalla, con el hash completo escrito igual,
  así que en papel también se puede seguir a mano. Sin `tx_hash` dice `not anchored` y **no
  inventa un link**.
- **Digest** — el calculado, o `unavailable`.

### 5.2 Los dos adaptadores — `to-dom.js` y `to-html.js`

Los dos recorren el IR y **no calculan nada**. Si algo se ve corrido, el bug está en
`build.js`.

**`to-dom.js`** es el que usa la página. El texto entra por `textContent` y **nunca** por
`innerHTML`, así que el escapado del core es una segunda línea de defensa y no la única.

**`to-html.js`** no lo usa nadie desde la página, y está por tres razones que importan más
que un botón:

1. **Es el que se puede comparar.** El golden corre esto y exige igualdad byte a byte contra
   la referencia. Es el test que sostiene todo lo demás.
2. **Es la salida para guardar o servir:** un `.html` suelto que se abre sin este servidor y
   sin JS.
3. **Es la prueba de que el core sirve.** Si la geometría estuviera metida en el adaptador
   del DOM, no habría un segundo adaptador que escribir.

```js
import { buildSheet } from "./sheet/build.js";
import { toHtml } from "./sheet/to-html.js";

const html = toHtml(buildSheet(payload, read, qr));   // un documento completo
```

> **Cuidado con el whitespace de `to-html.js`.** Los saltos de línea y las líneas en blanco
> de esa plantilla no son cosméticos: el golden los compara. Reformatear el archivo, aunque
> se vea mejor, rompe el test. La indentación desparaja del footer está fea y es correcta.

### 5.3 El CSS de la hoja es una función — `sheet/css.js`

No hay un `sheet.css`, y no puede haberlo: el CSS depende del tamaño de página que trae el
layout.

```js
.sheet  { width: page.width;  height: page.height }
.footer { width: page.width - 48 * 2 }
```

`sheetCss(page)` devuelve ese string, y es la **única** fuente: `to-dom.js` lo inyecta en un
`<style>`, `to-html.js` lo pega en el `<head>`. Una sola copia, imposible que divergan.

`css/app.css` es otra cosa: el bloque de estado, o sea el cromo para cuando **no** hay
documento. Si tocás `app.css` la hoja no se mueve; si tocás `css.js`, el golden falla.

### 5.4 Los valores y el digest — `credential.js`

El credential es un SD-JWT VC:

```
eyJhbGciOiJFUzI1NiIsInR5cCI6InZjK3NkLWp3dCJ9 . eyJjb250ZW50Ijoi… . FEArm9ydMri… ~
└──────────────── header ────────────────────┘ └─── payload ───┘ └── firma ──┘  │
                                                                                └─ lista de
                                                                                   disclosures
                                                                                   vacía
```

Ese `~` final solo, sin nada después, **no es un error ni sobra**: un documento firmado no
tiene holder, así que no hay nada selectivamente divulgable que negociar y todos los claims
van en el payload.

**Los claims se filtran por las keys del schema, no al revés:**

```js
for (const claim of schema.claims) {
  if (claim.key in payload) claims[claim.key] = payload[claim.key];
}
```

La dirección del filtro es lo que importa. El payload trae también los claims registrados
del JWT (`iss`, `vct`, `jti`, `iat`, `exp`), y así no llegan nunca a la hoja: **un layout
que bindea a `iss` dibuja vacío** en lugar de filtrar el emisor por la ventana. Hay un test
que lo comprueba con un layout hostil.

**El digest** se calcula sobre el *signing input* (`header.payload`), no sobre el credential
completo: sobre eso se firmó y sobre eso se ancla. Incluir la firma o el `~` da otro hash,
que no coincide con nada de lo que hay en la cadena.

**`readCredential` no lanza nunca.** Un credential ilegible cuesta los campos dinámicos y el
digest, no la página: los `text` del layout se dibujan igual, los `field` quedan vacíos y el
footer dice `unavailable` en lugar de un hash inventado.

### 5.5 El QR — `qr.js`

Lleva **el credential completo**, no un link a esta página. Ese es el único motivo por el
que la hoja no hay que creerla: quien la recibe escanea, verifica la firma contra la cadena,
y si este servicio desapareció el QR impreso sigue sirviendo.

- **Encoder:** el de Kazuhiko Arase (`qrcode-generator` 1.4.4, MIT), vendorizado. Byte mode,
  corrección nivel L — la más baja, que es la que deja entrar más bytes.
- **Versión:** la más chica que aguante el payload. El credential del ejemplo son 520 bytes
  y cae en la **versión 15** (77 módulos). Un link a la misma hoja son ~90 bytes y entraría
  en una versión mucho más chica.
- **Techo:** ~2953 bytes en nivel L. Arriba de eso `qrDataUri` devuelve `null` en vez de
  lanzar. **Perder el QR es mejor que perder la página.**
- **PNG y no SVG:** el SVG es un `<rect>` por módulo, dos órdenes de magnitud más pesado. Se
  dibuja a cuatro veces el tamaño de display para que impreso quede nítido.

Expone dos funciones a propósito: `qrMatrix(data)` (pura, sin canvas, testeable en Node) y
`qrDataUri(data)` (la que usa la página).

**La única modificación al archivo vendorizado.** El original trae un tail UMD que cubre AMD
y CommonJS pero **no** módulos ES, así que importado como módulo no exportaba nada. Se le
agregó una línea al final —`export default qrcode;`— con un comentario que dice exactamente
eso. Nada arriba se tocó.

### 5.6 La API y los errores — `api.js`

```js
await fetch(`/proxy/documents/${id}`)
```

`api.js` traduce los códigos a frases mostrables, así que `documento.js` no tiene un `switch`
sobre `status`:

| Código | Qué se dice, y por qué |
|---|---|
| `401` | *"Este documento es privado. Solo el emisor puede verlo, hasta que lo publique."* No es una falla: todo documento nace privado. La API devuelve 401 **incluso con la API key en el header**, porque una key no sustituye una sesión del dashboard. |
| `404` | *"No existe un documento con ese id, o pertenece a otro workspace."* La API no distingue entre los tres casos a propósito: no filtra información. El mensaje tampoco pretende distinguirlos. |
| `502` / `504` | El mensaje del proxy. El 504 existe porque una emisión puede tardar ~90 s. |

Cualquier excepción que **no** sea un `ApiError` sube y aparece en la consola: es un bug
nuestro, no un estado del documento, y taparlo lo haría más difícil de encontrar.

### 5.7 La orquestación — `documento.js`

Es el único archivo que sabe que existe un browser, una URL y un usuario. Todo lo demás son
funciones. Los 6 pasos del [§4](#4-el-pipeline) están ahí, numerados en los comentarios.

El esqueleto de `documento.html` son **dos huecos**, y el JS no crea ninguno:

| | |
|---|---|
| `#status` | El motivo por el que **no** se puede mostrar el documento. Ocupa el lugar de la hoja, porque cuando aparece no hay hoja. |
| `#stage` | Donde se dibuja la hoja. El `<style>` y el `.sheet` van adentro. |

Son mutuamente excluyentes: o hay hoja, o hay un motivo por el que no la hay.

**Cuando hay hoja, se ve la hoja y nada más.** Sin encabezado, sin id, sin botones. El
título ya está dibujado dentro del papel —es un elemento del layout, con su posición— así
que repetirlo afuera solo agrega ruido, y el id lo tiene quien abrió la URL en su barra.

Tampoco hay un botón de imprimir: la hoja ya está maquetada en A4 y el CSS trae
`@page{size:A4;margin:0}`, así que el diálogo del browser escribe un PDF correcto sin ayuda.
`[data-chrome]` esconde el bloque de estado al imprimir.

**Lo que se degradó no se muestra, pero no se pierde.** Un credential ilegible, un QR que no
entró, un documento sin anclar: `warnAboutDegradation` lo escribe en la **consola**. Está
ahí por un motivo concreto: una hoja a la que le falta el QR se ve casi idéntica a una
completa, y el QR es justamente la parte que permite no creerle a la página. Si querés el
aviso a la vista, esa función es el lugar de donde sacarlo.

---

## 6. El servidor

`server.js`, 405 líneas, Node nativo, cero dependencias. Hace dos cosas: sirve `public/` y
expone `/proxy/*`.

### 6.1 Por qué existe y no es solo estático

La zona emisor de la API no se puede llamar desde el browser, por dos razones independientes
y las dos verificadas contra la API real:

| | |
|---|---|
| **CORS** | El preflight `OPTIONS /api/v1/issuer/documents` devuelve `204` con `Access-Control-Allow-Headers` y `-Methods`, pero **sin** `Access-Control-Allow-Origin`. El navegador bloquea la llamada. |
| **Secreto** | `LAMBDA_API_KEY` es la clave del workspace. En un `.js` servido al browser queda a la vista de cualquiera que abra DevTools. |

La zona pública sí responde `Access-Control-Allow-Origin: *`, así que
`GET /api/v1/documents/{id}` **se podría llamar directo**. Igual pasa por el proxy, para que
el front tenga un solo camino a la API: dos maneras de hablar con la misma API es una de
más.

### 6.2 El proxy y su whitelist

La key se lee del `.env`, vive solo en ese proceso, y se inyecta al reenviar. El proxy
reenvía **únicamente** las rutas de una lista explícita, así que no funciona como proxy
abierto:

```js
GET  /issuer/documents                                   con key
POST /issuer/documents                                   con key
PUT  /issuer/documents/{uuid}/visibility/(public|private) con key
GET  /documents/{uuid}                                   sin key   ← la que usa esta app
```

Hay una quinta entrada en la lista, de la zona pública, que esta app no usa. Cualquier ruta
que no esté en la lista da `404 route_not_allowed` sin tocar la API. El timeout está en 120 s
porque una emisión puede tardar ~90 s: el techo depende de la congestión de la cadena, no
del caso feliz.

Detalle que produce 401 en la primera integración: **`Bearer` se compara literalmente.**
`bearer` en minúscula devuelve `401 invalid_api_key`.

### 6.3 Las rutas estáticas

`serveStatic` mapea las rutas sin extensión a un archivo, y el resto sale de `public/`:

```js
"/"            → index.html
"/documento"   → documento.html
```

El archivo resuelto tiene que quedar **dentro** de `public/`, o devuelve `403`: es la
defensa contra path traversal hacia el `.env`.

### 6.4 Lo que `server.js` tiene y hoy nadie usa

`server.js` viene de una app anterior y trae código que ningún archivo de `public/`
consume. Está listado acá para que no sorprenda al leerlo:

| | |
|---|---|
| `refreshIndex()` | Lista los documentos del workspace al arrancar y cada 5 min, y arma mapas por id, digest, hash de claim y número de sorteo. **Solo entran los `visibility: "public"`**: servir un privado por búsqueda anularía esa decisión por la puerta de atrás. |
| `/public/status`, `/public/draws`, `/public/lookup` | La API de ese índice. La API de Sovra no tiene búsqueda (`?digest=`, `/by-digest/` y `/search` fueron probados: los query params se ignoran y las rutas dan 404), así que el índice existía para suplirla. |
| `/api/config` | Devuelve la base URL y si la cadena está configurada. Nunca la key. |
| `"/consulta"` en `ROUTES_HTML` | Mapea a un `consulta.html` que **no existe** en `public/`. Hoy devuelve 404 igual que cualquier ruta desconocida. |

Si no los vas a usar, se pueden borrar sin tocar nada de `public/`. No los saqué porque
borrar código que no pedí tocar es una decisión tuya, no mía.

---

## 7. Los tests

```bash
npm test        # node --test, sin dependencias
```

**20 tests en 3 archivos.** Los fixtures de `test/fixtures/` son respuestas reales de
`test-api-sovra` bajadas con curl, no transcripciones a mano.

### El golden — `test/page.test.mjs` (5 tests)

El que sostiene todo lo demás:

```js
assert.equal(toHtml(buildSheet(document_, read, pageQr)), page);
```

Igualdad **exacta** contra la salida de referencia. Si la referencia cambia, se vuelve a
bajar el fixture y el diff dice exactamente qué se movió. Los otros cuatro tests cubren las
degradaciones: sin QR, credential ilegible, y que los claims registrados no se puedan
dibujar.

### El QR — `test/qr.test.mjs` (4 tests)

El PNG **no puede** coincidir byte a byte: el de referencia lo escribe EQRCode en Elixir y
el nuestro sale de un canvas. Lo que sí tiene que coincidir es la matriz, que es lo que un
lector escanea.

El test decodifica el PNG a mano —inflate con `node:zlib` y des-filtrar; un PNG sin
entrelazado son dos pasos y no hay dependencias en este repo— y compara módulo a módulo:

```
5929 de 5929 módulos idénticos · versión 15 · misma máscara
```

Dato necesario para leer ese código: **la referencia usa zona quieta de 2 módulos a 6px por
módulo** (486 = 81 × 6). El nuestro usa 4, que es lo que pide la norma, así que el test
compara solo los 77×77 del núcleo.

### El saneo — `test/build.test.mjs` (11 tests)

La tabla de [§5.1](#el-saneo-y-qué-pasa-sin-cada-regla), regla por regla: colores, imágenes,
layouts rotos, el recorte al margen, el escapado, el footer sin `tx_hash`.

---

## 8. Seguridad

- **La key no sale del servidor.** Verificado: no aparece en `/`, `/documento`, ningún
  `/js/*.js`, ni `/api/config`.
- **`.gitignore` cubre `.env`** con `.env` y `.env.*`, y exceptúa `.env.example`.
- **El proxy no es abierto:** solo reenvía rutas de la whitelist ([§6.2](#62-el-proxy-y-su-whitelist)).
- **Path traversal:** el archivo estático resuelto tiene que quedar dentro de `public/`.
- **El layout está saneado**, y el texto escapado, en el core ([§5.1](#el-saneo-y-qué-pasa-sin-cada-regla)).
- **El QR es la única prueba en la hoja.** Todo lo demás que se dibuja es *nuestro
  renderizado* de los claims. El QR es lo que permite que un lector verifique la firma en
  lugar de confiar en la página.

Si el `.env` llegó por un canal compartido, conviene rotar la key igual.

---

## 9. Lo que no está

**La verificación de la firma.** Es la ausencia importante, y hay que decirla clara: **sin
el check de firma, un documento adulterado se ve igual que uno legítimo.** Esta app dibuja
lo que dice el credential; no comprueba que el credential esté firmado por quien dice.

Cuatro checks se pueden correr solo con WebCrypto, y cinco necesitan la cadena:

| Corre local | Necesita la cadena |
|---|---|
| `parse` — estructura, ES256, ausencia de `cnf` | `key` — la clave pública del DID registry |
| `digest` — `SHA-256(header.payload)` | `signature` — la firma ES256 |
| `issuer` — la dirección extraída de `iss` | `trust` — emisor autorizado para el `vct` |
| `expiry` — `exp` vs ahora | `anchor` y `anchor-match` |

De los cuatro locales, esta app usa **`digest`**: lo calcula y lo escribe en el footer.

Para encender los otros hace falta `@sovra/verification-sdk` (no publicado en npm) y la
configuración de la cadena: el RPC de la L2 y las direcciones de los registries de DID, de
emisores y de firmas. `.env.example` no los lista, porque nada de este repo los usa todavía.