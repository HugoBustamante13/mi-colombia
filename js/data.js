/**
 * Módulo de DATOS geográficos.
 *
 * Fuente: DANE – Marco Geoestadístico Nacional (MGN) 2025, capa "Municipio"
 *   https://geoportal.dane.gov.co/mparcgis/rest/services/MGN2025/Serv_CapasMGN_2025/FeatureServer/317
 * 1.122 entidades: 1.103 municipios, 1 isla (San Andrés) y 18 áreas no municipalizadas.
 * El identificador de cada entidad es su código DIVIPOLA de 5 dígitos (MPIO_CDPMP).
 *
 * El archivo data/municipios.topo.json se generó con scripts/construir-datos.sh:
 * simplificación topológica con mapshaper (Visvalingam ponderado, intervalo 100 m).
 * Al ser TopoJSON, los municipios vecinos comparten arcos: no hay huecos ni solapes
 * entre límites, y los bordes departamentales se derivan de esos mismos arcos.
 */
import { titulo, normalizar } from './utils.js';

const RUTA_TOPOJSON = 'data/municipios.topo.json';

const NOMBRES_CORTOS = { '88': 'San Andrés y Providencia' };

const TIPOS = {
  'MUNICIPIO': 'Municipio',
  'ISLA': 'Isla',
  'ÁREA NO MUNICIPALIZADA': 'Área no municipalizada',
};

/**
 * Descarga el TopoJSON y construye:
 *  - municipios: FeatureCollection GeoJSON (para Leaflet y la exportación PNG)
 *  - limitesDeptos: MultiLineString con los límites departamentales
 *  - porId: Map DIVIPOLA → { id, nombre, dpto, dptoNombre, tipo, clave }
 *  - deptos / listaDeptos: departamentos con sus municipios
 */
export async function cargarDatos() {
  const respuesta = await fetch(RUTA_TOPOJSON);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar ${RUTA_TOPOJSON} (HTTP ${respuesta.status})`);
  }
  const topo = await respuesta.json();
  const objeto = topo.objects.municipios;

  const municipios = topojson.feature(topo, objeto);
  // Arcos que separan municipios de distinto departamento, más el borde exterior (a === b).
  const limitesDeptos = topojson.mesh(
    topo, objeto,
    (a, b) => a === b || a.properties.dpto !== b.properties.dpto,
  );

  const porId = new Map();
  const deptos = new Map();
  for (const f of municipios.features) {
    const p = f.properties;
    const municipio = {
      id: p.id,
      nombre: titulo(p.nombre),
      dpto: p.dpto,
      dptoNombre: NOMBRES_CORTOS[p.dpto] ?? titulo(p.dpto_nombre),
      tipo: TIPOS[p.tipo] ?? titulo(p.tipo),
      clave: normalizar(p.nombre),
    };
    porId.set(municipio.id, municipio);
    if (!deptos.has(municipio.dpto)) {
      deptos.set(municipio.dpto, { id: municipio.dpto, nombre: municipio.dptoNombre, ids: [] });
    }
    deptos.get(municipio.dpto).ids.push(municipio.id);
  }

  const listaDeptos = [...deptos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return { municipios, limitesDeptos, porId, deptos, listaDeptos, total: porId.size };
}

/**
 * Búsqueda tolerante a tildes y mayúsculas.
 * Prioriza: código DIVIPOLA → nombre que empieza por la consulta → palabra que empieza → contiene.
 */
export function buscarMunicipios(datos, consulta, limite = 8) {
  const q = normalizar(consulta);
  if (!q) return [];

  if (/^\d{2,5}$/.test(q)) {
    return [...datos.porId.values()].filter((m) => m.id.startsWith(q)).slice(0, limite);
  }
  if (q.length < 2) return [];

  const grupos = [[], [], []];
  for (const m of datos.porId.values()) {
    const i = m.clave.indexOf(q);
    if (i === 0) grupos[0].push(m);
    else if (i > 0 && m.clave[i - 1] === ' ') grupos[1].push(m);
    else if (i > 0) grupos[2].push(m);
  }
  const orden = (a, b) => a.nombre.length - b.nombre.length || a.nombre.localeCompare(b.nombre, 'es');
  return grupos.flatMap((g) => g.sort(orden)).slice(0, limite);
}
