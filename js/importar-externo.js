/**
 * Importa visitas desde fuentes externas con ubicación:
 *
 * 1. Línea de tiempo de Google Maps. Formatos aceptados:
 *    - Exportación del teléfono (2024+): Android "Timeline.json" con `semanticSegments`
 *      (coordenadas "6.2442°, -75.5812°") e iOS, un arreglo con "geo:6.2442,-75.5812".
 *    - Google Takeout antiguo, "Semantic Location History" (`timelineObjects`, latitudeE7).
 *    - Google Takeout antiguo, "Records.json" (`locations`, puntos crudos).
 * 2. Fotos con ubicación GPS en sus metadatos EXIF (JPEG, HEIC, etc.; lee con exifr).
 *
 * Cada punto se ubica en un municipio (geo.js) y se agrupa en visitas: días
 * consecutivos en el mismo municipio cuentan como una sola visita (la del primer día).
 */
import { hoyISO } from './utils.js';

/* ---------- Fechas ---------- */

const p2 = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** Fecha local AAAA-MM-DD de una marca de tiempo (texto ISO, milisegundos o Date). */
function fechaDe(valor) {
  if (valor == null) return null;
  if (typeof valor === 'string') {
    // Con desfase explícito (-05:00) el texto ya trae la fecha local del lugar.
    if (/^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}:?\d{2}$/.test(valor)) return valor.slice(0, 10);
    if (/^\d+$/.test(valor)) valor = Number(valor);
  }
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : isoLocal(d);
}

const sumarDia = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  return isoLocal(new Date(a, m - 1, d + 1));
};

/* ---------- Coordenadas ---------- */

/** "6.2442°, -75.5812°" o "geo:6.2442,-75.5812" → { lat, lon } */
function coordTexto(texto) {
  const m = /(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)/.exec(String(texto ?? ''));
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

const coordE7 = (o, lat = 'latitudeE7', lon = 'longitudeE7') =>
  (o && Number.isFinite(o[lat]) && Number.isFinite(o[lon]) ? { lat: o[lat] / 1e7, lon: o[lon] / 1e7 } : null);

/* ---------- Google Maps ---------- */

/**
 * @param {string} texto  contenido del archivo JSON
 * @returns {{ formato: string, puntos: { lat, lon, fecha, tipo: 'parada'|'recorrido' }[] }}
 */
export function extraerPuntosGoogle(texto) {
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  const puntos = [];
  const agregar = (coord, fecha, tipo) => {
    if (coord && fecha) puntos.push({ ...coord, fecha, tipo });
  };

  // Android (exportación desde el teléfono)
  if (Array.isArray(datos?.semanticSegments)) {
    for (const s of datos.semanticSegments) {
      const fecha = fechaDe(s.startTime);
      if (s.visit) agregar(coordTexto(s.visit.topCandidate?.placeLocation?.latLng), fecha, 'parada');
      if (s.activity) {
        agregar(coordTexto(s.activity.start?.latLng), fecha, 'recorrido');
        agregar(coordTexto(s.activity.end?.latLng), fechaDe(s.endTime) ?? fecha, 'recorrido');
      }
      for (const p of s.timelinePath ?? []) agregar(coordTexto(p.point), fechaDe(p.time) ?? fecha, 'recorrido');
    }
    for (const r of datos.rawSignals ?? []) {
      agregar(coordTexto(r.position?.LatLng), fechaDe(r.position?.timestamp), 'recorrido');
    }
    return { formato: 'Línea de tiempo (Android)', puntos };
  }

  // iOS (exportación desde el teléfono): arreglo de segmentos
  if (Array.isArray(datos) && datos.some((s) => s?.startTime && (s.visit || s.activity || s.timelinePath))) {
    for (const s of datos) {
      const fecha = fechaDe(s.startTime);
      if (s.visit) agregar(coordTexto(s.visit.topCandidate?.placeLocation), fecha, 'parada');
      if (s.activity) {
        agregar(coordTexto(s.activity.start), fecha, 'recorrido');
        agregar(coordTexto(s.activity.end), fechaDe(s.endTime) ?? fecha, 'recorrido');
      }
      for (const p of s.timelinePath ?? []) agregar(coordTexto(p.point), fecha, 'recorrido');
    }
    return { formato: 'Línea de tiempo (iPhone)', puntos };
  }

  // Takeout: Semantic Location History (un archivo por mes)
  if (Array.isArray(datos?.timelineObjects)) {
    for (const o of datos.timelineObjects) {
      if (o.placeVisit) {
        const d = o.placeVisit.duration ?? {};
        agregar(coordE7(o.placeVisit.location), fechaDe(d.startTimestamp ?? d.startTimestampMs), 'parada');
      }
      if (o.activitySegment) {
        const a = o.activitySegment;
        const d = a.duration ?? {};
        const fecha = fechaDe(d.startTimestamp ?? d.startTimestampMs);
        agregar(coordE7(a.startLocation), fecha, 'recorrido');
        agregar(coordE7(a.endLocation), fechaDe(d.endTimestamp ?? d.endTimestampMs) ?? fecha, 'recorrido');
        for (const w of a.waypointPath?.waypoints ?? []) agregar(coordE7(w, 'latE7', 'lngE7'), fecha, 'recorrido');
        for (const p of a.simplifiedRawPath?.points ?? []) {
          agregar(coordE7(p, 'latE7', 'lngE7'), fechaDe(p.timestamp ?? p.timestampMs) ?? fecha, 'recorrido');
        }
      }
    }
    return { formato: 'Historial de ubicaciones (Takeout)', puntos };
  }

  // Takeout: Records.json (puntos crudos, sin paradas)
  if (Array.isArray(datos?.locations)) {
    for (const l of datos.locations) agregar(coordE7(l), fechaDe(l.timestamp ?? l.timestampMs), 'recorrido');
    return { formato: 'Registros de ubicación (Records.json)', puntos };
  }

  throw new Error('No se reconoce el formato. Usa el archivo exportado de la línea de tiempo de Google Maps.');
}

/* ---------- Fotos ---------- */

/**
 * Lee GPS y fecha de cada foto.
 * @returns {Promise<{ archivo: File, lat, lon, fecha }[]>} solo las que tienen ubicación
 */
export async function extraerPuntosFotos(archivos, alProgreso = () => {}) {
  if (!window.exifr) throw new Error('No se pudo cargar el lector de metadatos.');
  const resultado = [];
  let hechos = 0;
  for (const archivo of archivos) {
    try {
      const gps = await window.exifr.gps(archivo);
      if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
        const meta = await window.exifr.parse(archivo, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']);
        const fecha = fechaDe(meta?.DateTimeOriginal ?? meta?.CreateDate ?? meta?.ModifyDate)
          ?? fechaDe(archivo.lastModified) ?? hoyISO();
        resultado.push({ archivo, lat: gps.latitude, lon: gps.longitude, fecha });
      }
    } catch (error) {
      console.warn('Sin metadatos legibles:', archivo.name, error);
    }
    alProgreso(++hechos, archivos.length);
  }
  return resultado;
}

/** Fecha en que se tomó una foto (EXIF) o, si no la tiene, la del archivo. */
export async function fechaDeFoto(archivo) {
  try {
    const meta = await window.exifr?.parse(archivo, ['DateTimeOriginal', 'CreateDate']);
    const fecha = fechaDe(meta?.DateTimeOriginal ?? meta?.CreateDate);
    if (fecha) return fecha;
  } catch { /* sin EXIF */ }
  return fechaDe(archivo.lastModified);
}

/* ---------- Agrupación ---------- */

const ceder = () => new Promise((r) => setTimeout(r, 0));

/**
 * Ubica los puntos en municipios y los agrupa en visitas.
 * @param {{ lat, lon, fecha, tipo?, archivo? }[]} puntos
 * @param {{ buscar: (lon, lat) => string|null }} indice  geo.crearIndice()
 * @returns {Promise<{ visitas: { divipola, fecha, dias: number }[], archivosPorMunicipio: Map, fuera: number }>}
 */
export async function agruparEnVisitas(puntos, indice, { incluirRecorridos = false, alProgreso = () => {} } = {}) {
  const diasPorMunicipio = new Map();     // DIVIPOLA → Set de fechas
  const archivosPorMunicipio = new Map(); // DIVIPOLA → [{ archivo, fecha }]
  const vistos = new Map();               // celda redondeada + fecha → DIVIPOLA (caché)
  let fuera = 0;

  for (let i = 0; i < puntos.length; i++) {
    const p = puntos[i];
    if (p.tipo === 'recorrido' && !incluirRecorridos) continue;
    const clave = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
    let divipola = vistos.get(clave);
    if (divipola === undefined) {
      divipola = indice.buscar(p.lon, p.lat);
      vistos.set(clave, divipola);
    }
    if (!divipola) { fuera++; continue; }
    if (!diasPorMunicipio.has(divipola)) diasPorMunicipio.set(divipola, new Set());
    diasPorMunicipio.get(divipola).add(p.fecha);
    if (p.archivo) {
      if (!archivosPorMunicipio.has(divipola)) archivosPorMunicipio.set(divipola, []);
      archivosPorMunicipio.get(divipola).push({ archivo: p.archivo, fecha: p.fecha });
    }
    if (i % 5000 === 4999) {
      alProgreso(i + 1, puntos.length);
      await ceder();
    }
  }

  const visitas = [];
  for (const [divipola, dias] of diasPorMunicipio) {
    const ordenados = [...dias].sort();
    let inicio = ordenados[0];
    let anterior = inicio;
    let n = 1;
    for (const dia of ordenados.slice(1)) {
      if (dia === sumarDia(anterior)) {
        n++;
      } else {
        visitas.push({ divipola, fecha: inicio, dias: n });
        inicio = dia;
        n = 1;
      }
      anterior = dia;
    }
    visitas.push({ divipola, fecha: inicio, dias: n });
  }
  visitas.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return { visitas, archivosPorMunicipio, fuera };
}
