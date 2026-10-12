/**
 * Capas geográficas opcionales (se descargan solo cuando se necesitan).
 *
 *  - data/centros-poblados.json: cabeceras municipales y centros poblados (DANE, MGN 2025)
 *  - data/parques.topo.json: áreas del Sistema de Parques Nacionales Naturales
 *
 * Ambos archivos se generan con scripts/construir-capas.sh.
 */
import { titulo } from './utils.js';
import { centroide } from './geo.js';

let promesaCentros = null;
let promesaParques = null;

async function leerJSON(ruta) {
  const respuesta = await fetch(ruta);
  if (!respuesta.ok) throw new Error(`No se pudo cargar ${ruta} (HTTP ${respuesta.status})`);
  return respuesta.json();
}

/**
 * @returns {Promise<{ lon, lat, nombre, divipola, cabecera: boolean, altitud: number|null }[]>}
 */
export function cargarCentrosPoblados() {
  promesaCentros ??= leerJSON('data/centros-poblados.json')
    .then(({ filas }) => filas.map(([lon, lat, nombre, divipola, clase, altitud]) => ({
      lon, lat, nombre: titulo(nombre), divipola, cabecera: clase === 1, altitud,
    })))
    .catch((error) => { promesaCentros = null; throw error; });
  return promesaCentros;
}

/** @returns {Promise<object>} FeatureCollection con properties { nombre, categoria, id } */
export function cargarParques() {
  promesaParques ??= leerJSON('data/parques.topo.json')
    .then((topo) => topojson.feature(topo, topo.objects.parques))
    .catch((error) => { promesaParques = null; throw error; });
  return promesaParques;
}

/**
 * Punto representativo de cada municipio, [lat, lon]: su cabecera municipal o,
 * si no tiene (áreas no municipalizadas), el centroide del polígono.
 * Se usa para el mapa de calor y para dibujar rutas.
 */
export async function puntosDeMunicipios(datos) {
  const puntos = new Map();
  try {
    for (const c of await cargarCentrosPoblados()) {
      if (c.cabecera && !puntos.has(c.divipola)) puntos.set(c.divipola, [c.lat, c.lon]);
    }
  } catch (error) {
    console.warn('Sin cabeceras; se usan centroides.', error);
  }
  for (const f of datos.municipios.features) {
    if (puntos.has(f.properties.id)) continue;
    const [lon, lat] = centroide(f.geometry);
    puntos.set(f.properties.id, [lat, lon]);
  }
  return puntos;
}
