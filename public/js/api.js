/**
 * La lectura publica de un documento, via el proxy de `server.js`.
 *
 * `GET /api/v1/documents/{id}` responde `Access-Control-Allow-Origin: *` y se
 * podria llamar directo desde el browser. Igual pasa por `/proxy` para tener un
 * solo camino: la zona emisor no se puede llamar de otra forma, y asi el front
 * no tiene dos maneras de hablar con la API.
 */

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isDocumentId(id) {
  return typeof id === "string" && UUID.test(id);
}

/** Un error con un mensaje que se puede mostrar tal cual. */
export class ApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchDocument(id) {
  if (!isDocumentId(id)) {
    throw new ApiError(
      "Ese id no tiene forma de UUID, asi que no se consulta la API.",
      { code: "bad_id" }
    );
  }

  let response;
  try {
    response = await fetch(`/proxy/documents/${id}`, {
      headers: { accept: "application/json" },
    });
  } catch (err) {
    throw new ApiError(`No se pudo contactar al servidor local: ${err.message}`, {
      code: "offline",
    });
  }

  const body = await response.json().catch(() => ({}));
  if (response.ok) return body;
  throw new ApiError(messageFor(response.status, body), {
    status: response.status,
    code: body.error || null,
  });
}

function messageFor(status, body) {
  switch (status) {
    case 401:
      // No es una falla: el emisor todavia no lo publico. La API devuelve esto
      // incluso cuando el header traia una API key, porque una key no sustituye
      // una sesion del dashboard.
      return "Este documento es privado. Solo el emisor puede verlo, hasta que lo publique.";
    case 404:
      // La API no distingue entre id inexistente, malformado, o de otro
      // workspace, a proposito: no filtra informacion.
      return "No existe un documento con ese id, o pertenece a otro workspace.";
    case 504:
      return body.message || "La API no respondio en tiempo.";
    case 502:
      return body.message || "No se pudo contactar a la API de Sovra.";
    default:
      return body.message || `La API respondio ${status}.`;
  }
}
