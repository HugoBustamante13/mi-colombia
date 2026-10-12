/**
 * Geometría: ¿en qué municipio cae un punto GPS?
 *
 * Se usa al importar la línea de tiempo de Google Maps, al leer fotos con
 * ubicación y al tocar un parque nacional en el mapa.
 *
 * Índice: rejilla de celdas de 0,25° con la lista de municipios cuya caja
 * envolvente toca cada celda. Una consulta revisa solo esos pocos candidatos
 * con la prueba clásica de "rayo" (par/impar), que respeta huecos y multipolígonos.
 */

const CELDA = 0.25; // grados

function poligonosDe(geometria) {
  return geometria.type === 'Polygon' ? [geometria.coordinates] : geometria.coordinates;
}

function cajaDe(geometria) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const poligono of poligonosDe(geometria)) {
    for (const [x, y] of poligono[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function dentroDeAnillo(x, y, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function dentroDeGeometria(x, y, geometria) {
  for (const poligono of poligonosDe(geometria)) {
    if (!dentroDeAnillo(x, y, poligono[0])) continue;
    // Dentro del borde exterior: descartar si cae en un hueco.
    if (!poligono.slice(1).some((hueco) => dentroDeAnillo(x, y, hueco))) return true;
  }
  return false;
}

const claveCelda = (cx, cy) => `${cx},${cy}`;

/**
 * Construye el índice para una FeatureCollection cuyos features tienen properties.id.
 * @returns {{ buscar: (lon: number, lat: number) => string | null }}
 */
export function crearIndice(coleccion) {
  const celdas = new Map();
  const entradas = coleccion.features.map((f) => ({ id: f.properties.id, geometria: f.geometry, caja: cajaDe(f.geometry) }));

  for (const e of entradas) {
    const { minX, minY, maxX, maxY } = e.caja;
    for (let cx = Math.floor(minX / CELDA); cx <= Math.floor(maxX / CELDA); cx++) {
      for (let cy = Math.floor(minY / CELDA); cy <= Math.floor(maxY / CELDA); cy++) {
        const k = claveCelda(cx, cy);
        if (!celdas.has(k)) celdas.set(k, []);
        celdas.get(k).push(e);
      }
    }
  }

  function buscar(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const candidatos = celdas.get(claveCelda(Math.floor(lon / CELDA), Math.floor(lat / CELDA)));
    if (!candidatos) return null;
    for (const e of candidatos) {
      const { minX, minY, maxX, maxY } = e.caja;
      if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
      if (dentroDeGeometria(lon, lat, e.geometria)) return e.id;
    }
    return null;
  }

  return { buscar };
}

/** Centroide aproximado (promedio ponderado por área del anillo exterior más grande). */
export function centroide(geometria) {
  let mejor = null;
  let mejorArea = -1;
  for (const poligono of poligonosDe(geometria)) {
    const anillo = poligono[0];
    let area = 0; let cx = 0; let cy = 0;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i];
      const [xj, yj] = anillo[j];
      const f = xj * yi - xi * yj;
      area += f;
      cx += (xi + xj) * f;
      cy += (yi + yj) * f;
    }
    if (Math.abs(area) > mejorArea && area !== 0) {
      mejorArea = Math.abs(area);
      mejor = [cx / (3 * area), cy / (3 * area)];
    }
  }
  return mejor ?? poligonosDe(geometria)[0][0][0];
}
