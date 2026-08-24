/**
 * Proxy local para la API de documentos firmados de Sovra.
 *
 * Existe por dos razones, ambas verificadas contra la API real:
 *   1. La zona emisor no devuelve Access-Control-Allow-Origin en el preflight,
 *      asi que el browser bloquea cualquier llamada directa.
 *   2. LAMBDA_API_KEY es la clave secreta del workspace. En el JS del front
 *      quedaria a la vista de cualquiera que abra DevTools.
 *
 * La key se lee del .env, vive solo en este proceso y se inyecta al reenviar.
 * Node nativo, sin dependencias.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;

// La emision valida, firma y ancla en una sola llamada: el .md advierte
// que puede tardar hasta ~90s. Damos margen por encima de eso.
const UPSTREAM_TIMEOUT_MS = 120_000;

/* ---------------------------------------------------------------- config */

function loadEnv(file) {
  const env = {};
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = loadEnv(path.join(ROOT, ".env"));
const BASE_URL = (env.LAMBDA_BASE_URL || "").replace(/\/+$/, "");
const API_KEY = env.LAMBDA_API_KEY || "";

const CHAIN = {
  l2RpcUrl: env.CHAIN_L2_RPC_URL || "",
  didRegistryAddress: env.CHAIN_DID_REGISTRY_ADDRESS || "",
  issuerRegistryAddress: env.CHAIN_ISSUER_REGISTRY_ADDRESS || "",
  signatureRegistryAddress: env.CHAIN_SIGNATURE_REGISTRY_ADDRESS || "",
};
const CHAIN_READY = Object.values(CHAIN).every(Boolean);

if (!BASE_URL || !API_KEY) {
  console.error(
    "\n  Falta configuracion. El .env necesita LAMBDA_BASE_URL y LAMBDA_API_KEY.\n" +
      "  Copiá .env.example a .env y completalo.\n"
  );
  process.exit(1);
}

/* --------------------------------------------------------------- indice */

/**
 * Indice en memoria para el portal publico.
 *
 * La API no tiene busqueda: ?digest=, ?nrosorteo=, /by-digest/ y /search fueron
 * probados y o se ignoran o dan 404. Asi que listamos todo y armamos los mapas aca.
 *
 * Solo entran documentos con visibility "public". Si la Loteria marca un sorteo
 * como privado, servirlo igual por busqueda anularia esa decision por la puerta
 * de atras. El indice no es una fuente de confianza: el credential que devuelve
 * se verifica igual del lado del cliente.
 */
const INDEX_REFRESH_MS = 5 * 60 * 1000;
const HEX64 = /^[0-9a-fA-F]{64}$/;

const index = {
  updatedAt: null,
  error: null,
  publicCount: 0,
  totalCount: 0,
  byId: new Map(),
  byDigest: new Map(),
  byDraw: new Map(),      // numero de sorteo -> entrada
  byClaimHash: new Map(), // cualquier claim que sea un sha256 -> entrada
  draws: [],
};

function entryFor(doc) {
  return {
    id: doc.id,
    credential: doc.credential,
    digest: doc.digest,
    txHash: doc.tx_hash,
    signedAt: doc.signed_at,
    anchoredAt: doc.anchored_at,
    revokedAt: doc.revoked_at,
    status: doc.status,
    issuer: doc.issuer,
    schema: doc.schema,
    claims: doc.claims || {},
  };
}

async function refreshIndex() {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/issuer/documents`, {
      headers: { authorization: `Bearer ${API_KEY}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`la API respondio ${res.status}`);
    const { documents = [] } = await res.json();

    const byId = new Map(), byDigest = new Map(), byDraw = new Map(), byClaimHash = new Map();
    const draws = [];

    for (const doc of documents) {
      if (doc.visibility !== "public") continue;   // respetamos la visibilidad
      const e = entryFor(doc);
      byId.set(doc.id, e);
      if (doc.digest) byDigest.set(doc.digest.toLowerCase(), e);

      for (const [key, value] of Object.entries(e.claims)) {
        if (typeof value === "string" && HEX64.test(value)) {
          byClaimHash.set(value.toLowerCase(), e);   // hash de un acta/PDF certificado
        }
        if (/^nro ?sorteo$/i.test(key) || /^n(ro|umero)_?sorteo$/i.test(key)) {
          byDraw.set(String(value), e);
        }
      }
      draws.push({
        id: doc.id,
        nrosorteo: e.claims.nrosorteo ?? null,
        nombre: e.claims.Name ?? e.claims.name ?? doc.schema?.name ?? null,
        fecha: e.claims.fecha ?? null,
        anchoredAt: doc.anchored_at,
      });
    }

    draws.sort((a, b) => String(b.anchoredAt || "").localeCompare(String(a.anchoredAt || "")));

    Object.assign(index, {
      byId, byDigest, byDraw, byClaimHash, draws,
      publicCount: byId.size,
      totalCount: documents.length,
      updatedAt: new Date().toISOString(),
      error: null,
    });
    console.log(`  indice actualizado: ${byId.size} publicos de ${documents.length}`);
  } catch (err) {
    index.error = err.message;
    console.error(`  no se pudo actualizar el indice: ${err.message}`);
  }
}

/** Resuelve una consulta del portal: id, digest, hash de un acta, o numero de sorteo. */
function lookup(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const lower = q.toLowerCase();
  return (
    index.byId.get(q) ||
    index.byDigest.get(lower) ||
    index.byClaimHash.get(lower) ||
    index.byDraw.get(q) ||
    index.byDraw.get(String(Number(q))) ||
    null
  );
}

/* ----------------------------------------------------------- rutas proxy */

const UUID = "[0-9a-fA-F-]{36}";

// Whitelist explicita: el proxy reenvia solo estas rutas. Evita convertirlo
// en un proxy abierto que cualquiera en la maquina pueda usar con la key.
const ROUTES = [
  { method: "GET", re: new RegExp(`^/issuer/documents$`), auth: true },
  { method: "POST", re: new RegExp(`^/issuer/documents$`), auth: true },
  {
    method: "PUT",
    re: new RegExp(`^/issuer/documents/${UUID}/visibility/(public|private)$`),
    auth: true,
  },
  { method: "GET", re: new RegExp(`^/documents/${UUID}$`), auth: false },
  { method: "GET", re: new RegExp(`^/documents/${UUID}/page$`), auth: false },
];

function matchRoute(method, subPath) {
  return ROUTES.find((r) => r.method === method && r.re.test(subPath));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new Error("payload demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function handleProxy(req, res, subPath) {
  const route = matchRoute(req.method, subPath);
  if (!route) {
    sendJson(res, 404, {
      error: "route_not_allowed",
      message: `El proxy no reenvia ${req.method} ${subPath}.`,
    });
    return;
  }

  const target = `${BASE_URL}/api/v1${subPath}`;
  const headers = { accept: "application/json" };
  // "Bearer" se compara literalmente del otro lado: en minuscula da 401.
  if (route.auth) headers.authorization = `Bearer ${API_KEY}`;

  let body;
  if (req.method === "POST" || req.method === "PUT") {
    body = await readBody(req);
    if (body.length) headers["content-type"] = "application/json";
    else body = undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const started = Date.now();

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await upstream.text();
    const ms = Date.now() - started;
    console.log(`  ${req.method} ${subPath} -> ${upstream.status} (${ms}ms)`);

    res.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(text);
  } catch (err) {
    const aborted = err.name === "AbortError";
    console.error(`  ${req.method} ${subPath} -> ${aborted ? "timeout" : "error"}: ${err.message}`);
    sendJson(res, aborted ? 504 : 502, {
      error: aborted ? "upstream_timeout" : "upstream_unreachable",
      message: aborted
        ? `La API no respondio en ${UPSTREAM_TIMEOUT_MS / 1000}s. La emision puede tardar hasta 90s; si esto se repite, revisá el estado del servicio.`
        : `No se pudo contactar a ${BASE_URL}: ${err.message}`,
    });
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------- estatico */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveStatic(req, res, urlPath) {
  // Dos entradas: / es el panel de operador, /consulta es el portal ciudadano.
  const ROUTES_HTML = {
    "/": "index.html",
    "/consulta": "consulta.html",
    "/consulta/": "consulta.html",
    // La hoja de un documento: /documento?id=<uuid>. Sin esta entrada el path
    // cae en el 404 del estatico, porque no hay un archivo llamado "documento".
    "/documento": "documento.html",
    "/documento/": "documento.html",
  };
  const rel = ROUTES_HTML[urlPath] || decodeURIComponent(urlPath).replace(/^\/+/, "");
  const target = path.join(PUBLIC_DIR, rel);

  // Path traversal: el archivo resuelto tiene que quedar dentro de public/.
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404 — no encontrado");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(target)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

/* ----------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === "/api/config") {
    // Solo lo que el front necesita para armar links. Nunca la key.
    sendJson(res, 200, { baseUrl: BASE_URL, chainReady: CHAIN_READY, chain: CHAIN });
    return;
  }

  // Portal publico: sin API key, y solo documentos que el emisor marco public.
  if (p === "/public/status") {
    sendJson(res, 200, {
      updatedAt: index.updatedAt,
      publicCount: index.publicCount,
      totalCount: index.totalCount,
      error: index.error,
    });
    return;
  }

  if (p === "/public/draws") {
    sendJson(res, 200, { draws: index.draws, updatedAt: index.updatedAt });
    return;
  }

  if (p === "/public/lookup") {
    const hit = lookup(url.searchParams.get("q"));
    if (!hit) {
      sendJson(res, 404, {
        error: "not_found",
        message:
          index.publicCount === 0
            ? "No hay sorteos publicados todavia. El emisor tiene que marcarlos como publicos."
            : "No se encontro ningun documento publico con ese numero, id o hash.",
      });
      return;
    }
    sendJson(res, 200, hit);
    return;
  }

  if (p.startsWith("/proxy/")) {
    handleProxy(req, res, p.slice("/proxy".length)).catch((err) => {
      console.error("  error inesperado:", err);
      sendJson(res, 500, { error: "proxy_error", message: err.message });
    });
    return;
  }

  serveStatic(req, res, p);
});

server.listen(PORT, () => {
  const masked = API_KEY.slice(0, 12) + "…" + API_KEY.slice(-4);
  console.log(`
  Documentos firmados — Sovra
  ---------------------------------------------
  Local     http://localhost:${PORT}
  API       ${BASE_URL}
  API key   ${masked}  (server-side, no sale de este proceso)
  Cadena    ${CHAIN_READY ? "configurada — verificacion completa" : "sin configurar — verificacion parcial"}

  Panel     http://localhost:${PORT}/          (operador, usa la API key)
  Consulta  http://localhost:${PORT}/consulta  (publico, solo documentos public)
`);
  refreshIndex();
  setInterval(refreshIndex, INDEX_REFRESH_MS).unref();
});
