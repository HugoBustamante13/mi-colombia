/**
 * Enlace público de solo lectura, sin servidor: el mapa viaja dentro de la URL.
 *
 *   https://…/mi-colombia/?ver=<código>&n=<nombre>
 *
 * El código es binario en base64url:
 *   versión (1 byte) · total de municipios del conjunto de datos (varint)
 *   · N visitados (varint) · por cada uno: salto de índice (varint) + año − 1900 (1 byte)
 *   · M deseos (varint) · por cada uno: salto de índice (varint)
 * Los índices son la posición en la lista ordenada de códigos DIVIPOLA.
 * 300 municipios ocupan unos 800 caracteres.
 *
 * Si el usuario usa la nube y marcó su perfil como público, hay además un enlace
 * en vivo (?mapa=<id>) que siempre muestra los datos actuales (ver nube.js).
 */
const VERSION = 1;

function escribirVarint(bytes, n) {
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
}

function lector(bytes) {
  let i = 0;
  return {
    byte() {
      if (i >= bytes.length) throw new Error('Código incompleto');
      return bytes[i++];
    },
    varint() {
      let n = 0;
      let desplazamiento = 0;
      let b;
      do {
        b = this.byte();
        n |= (b & 0x7f) << desplazamiento;
        desplazamiento += 7;
      } while (b & 0x80);
      return n >>> 0;
    },
  };
}

const aBase64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function deBase64url(texto) {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const ordenIds = (datos) => [...datos.porId.keys()].sort();

/**
 * @param {object} datos
 * @param {Map<string,string>} ultimas  DIVIPOLA → fecha de la última visita
 * @param {Set<string>} deseos
 */
export function codificarMapa(datos, ultimas, deseos) {
  const ids = ordenIds(datos);
  const indice = new Map(ids.map((id, i) => [id, i]));
  const bytes = [VERSION];
  escribirVarint(bytes, ids.length);

  const visitados = [...ultimas].filter(([id]) => indice.has(id))
    .map(([id, fecha]) => [indice.get(id), Math.min(255, Math.max(0, Number(fecha.slice(0, 4)) - 1900))])
    .sort((a, b) => a[0] - b[0]);
  escribirVarint(bytes, visitados.length);
  let anterior = 0;
  for (const [i, anio] of visitados) {
    escribirVarint(bytes, i - anterior);
    bytes.push(anio);
    anterior = i;
  }

  const listaDeseos = [...deseos].filter((id) => indice.has(id) && !ultimas.has(id))
    .map((id) => indice.get(id)).sort((a, b) => a - b);
  escribirVarint(bytes, listaDeseos.length);
  anterior = 0;
  for (const i of listaDeseos) {
    escribirVarint(bytes, i - anterior);
    anterior = i;
  }
  return aBase64url(bytes);
}

/**
 * @returns {{ visitas: { divipola, fecha }[], deseos: Set<string> }}
 *   fecha es solo el año ("2024"): el enlace no lleva días ni notas.
 */
export function decodificarMapa(datos, codigo) {
  const ids = ordenIds(datos);
  const l = lector(deBase64url(codigo));
  if (l.byte() !== VERSION) throw new Error('Versión de enlace no compatible.');
  if (l.varint() !== ids.length) throw new Error('El enlace se creó con otra versión del mapa.');

  const visitas = [];
  let i = 0;
  for (let n = l.varint(); n > 0; n--) {
    i += l.varint();
    const divipola = ids[i];
    if (!divipola) throw new Error('Enlace dañado.');
    visitas.push({ divipola, fecha: String(1900 + l.byte()) });
  }
  const deseos = new Set();
  i = 0;
  for (let n = l.varint(); n > 0; n--) {
    i += l.varint();
    if (ids[i]) deseos.add(ids[i]);
  }
  return { visitas, deseos };
}

/** Construye la URL para compartir. */
export function urlCompartida(codigo, nombre) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('ver', codigo);
  if (nombre) url.searchParams.set('n', nombre.slice(0, 60));
  return url.toString();
}
