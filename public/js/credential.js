/**
 * Lo que se le puede sacar al `credential` sin confiar en el resto de la
 * respuesta.
 *
 * El endpoint publico devuelve `schema`, `issuer`, `layout` y `anchor`, pero de
 * todo eso lo unico firmado es el credential. Los valores que se dibujan en la
 * hoja salen de aca y no de otro campo, igual que en el lambda
 * (`Sovra.Documents.Attestation.claims/2`): una hoja solo puede mostrar lo que
 * cubre la firma.
 *
 * El digest tampoco viene en la respuesta publica. Es `SHA-256` del signing
 * input, o sea `header.payload`, que es exactamente lo que queda anclado
 * on-chain, asi que se calcula y no se pide.
 */

/**
 * Abre el credential en sus tres partes.
 *
 * El artefacto es `<jwt>~`: un SD-JWT VC sin disclosures y sin key binding. Ese
 * `~` final solo, sin nada despues, es una lista de disclosures vacia — no es un
 * error ni sobra. Un documento firmado no tiene holder, asi que no hay nada
 * selectivamente divulgable que negociar: todos los claims van en el payload.
 *
 * Lanza si el credential no tiene forma de JWT. Quien lo llama decide que hacer
 * con eso; `readCredential`, mas abajo, lo convierte en una degradacion.
 */
export function parseCredential(credential) {
  if (typeof credential !== "string" || !credential) {
    throw new Error("el credential esta vacio");
  }

  const [jwt] = credential.split("~");
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("el credential no tiene tres partes");
  }

  const [header, payload, signature] = parts;
  return {
    header: decodeSegment(header),
    payload: decodeSegment(payload),
    signature,
    // Sobre esto se firma y sobre esto se calcula el digest anclado.
    signingInput: `${header}.${payload}`,
  };
}

/**
 * Un segmento del JWT como objeto.
 *
 * Es base64**url** (con `-` y `_` en vez de `+` y `/`) y sin padding, que es lo
 * que pide JWS. `atob` solo entiende base64 comun, asi que hay que traducir los
 * dos caracteres antes. El padding no hace falta agregarlo: atob lo tolera.
 *
 * El paso por Uint8Array y TextDecoder no es adorno: `atob` devuelve una cadena
 * de bytes, y un claim con acentos o eñes sale mal si se lee como si fuera texto.
 */
function decodeSegment(segment) {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Los claims declarados por el schema, leidos del payload.
 *
 * Se filtra por las keys del schema y no al revés: asi los claims registrados
 * (`iss`, `vct`, `jti`, `iat`, `exp`) no llegan nunca a la hoja, y un layout que
 * bindea a `iss` dibuja vacio en lugar de filtrar el emisor por la ventana.
 */
export function declaredClaims(payload, schema) {
  // Si el schema no trae claims, no se dibuja ningun campo. Preferible a caer en
  // "entonces muestro todo el payload", que es como se filtra un `iss`.
  const declared = Array.isArray(schema?.claims) ? schema.claims : [];
  const claims = {};
  for (const claim of declared) {
    const key = claim?.key;
    if (typeof key === "string" && key in payload) claims[key] = payload[key];
  }
  return claims;
}

/**
 * El digest: `0x` + sha-256 del signing input, en minuscula.
 *
 * ESTE VALOR NO VIENE EN LA RESPUESTA. La lectura publica de la API no lo trae
 * (la de emision si). No hace falta pedirlo: el digest anclado on-chain es el
 * sha-256 de `header.payload`, que son bytes que ya tenemos.
 *
 * Se calcula sobre el signing input y no sobre el credential completo: sobre eso
 * se firmo, y sobre eso se ancla. Incluir la firma o el `~` da otro hash, que no
 * coincide con nada de lo que hay en la cadena.
 */
export async function digestOf(signingInput) {
  const bytes = new TextEncoder().encode(signingInput);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

/**
 * Todo lo que la hoja necesita del credential, o el motivo por el que no se
 * pudo leer.
 *
 * Nunca lanza: un credential ilegible tiene que costar los campos dinamicos y
 * el digest, no la pagina. El resto del layout se dibuja igual.
 */
export async function readCredential(credential, schema) {
  try {
    const parsed = parseCredential(credential);
    return {
      ok: true,
      claims: declaredClaims(parsed.payload, schema),
      digest: await digestOf(parsed.signingInput),
      payload: parsed.payload,
      error: null,
    };
  } catch (err) {
    return { ok: false, claims: {}, digest: null, payload: null, error: err.message };
  }
}
