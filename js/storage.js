/**
 * Módulo de ALMACENAMIENTO: visitas y lista de deseos en localStorage.
 *
 * Cada visita: { id, divipola, fecha, notas, calificacion, creada, actualizada, borrada }
 *  - divipola: código DIVIPOLA de 5 dígitos (texto)
 *  - fecha: AAAA-MM-DD (ISO 8601, fecha local)
 *  - notas: texto libre
 *  - calificacion: entero 1–5, o null si no se calificó
 *  - id / creada: internos, para editar/eliminar y desempatar visitas del mismo día
 *  - actualizada: marca de tiempo (ms) del último cambio; la sincronización gana el más reciente
 *  - borrada: las eliminaciones se guardan como "lápidas" para que se propaguen a otros dispositivos
 *
 * Cada deseo ("quiero ir"): { divipola, creada, actualizada, borrada }
 *
 * Un municipio puede tener varias visitas; su estado y color salen de la más reciente.
 * Las funciones públicas de lectura nunca devuelven registros borrados.
 */
import { esFechaISO } from './utils.js';

const CLAVE = 'mi-colombia:datos';
const VERSION = 2;

let visitas = [];          // incluye lápidas
let deseos = new Map();    // DIVIPOLA → deseo (incluye lápidas)
const oyentes = new Set();

const nuevoId = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Ordena de la más reciente a la más antigua. */
const porFechaDesc = (a, b) => b.fecha.localeCompare(a.fecha) || (b.creada ?? 0) - (a.creada ?? 0);

const vivas = () => visitas.filter((v) => !v.borrada);

function limpiarDivipola(valor, esMunicipioValido) {
  const divipola = String(valor ?? '').trim().padStart(5, '0');
  if (!/^\d{5}$/.test(divipola) || (esMunicipioValido && !esMunicipioValido(divipola))) return null;
  return divipola;
}

/** Normaliza y valida una visita externa (importada, guardada o remota). Devuelve null si no es válida. */
export function limpiarVisita(v, esMunicipioValido) {
  if (!v || typeof v !== 'object') return null;
  const divipola = limpiarDivipola(v.divipola, esMunicipioValido);
  if (!divipola || !esFechaISO(v.fecha)) return null;
  const cal = Number(v.calificacion);
  const creada = Number.isFinite(Number(v.creada)) && v.creada !== null ? Number(v.creada) : Date.now();
  return {
    id: typeof v.id === 'string' && v.id ? v.id : nuevoId(),
    divipola,
    fecha: v.fecha,
    notas: typeof v.notas === 'string' ? v.notas.slice(0, 2000) : '',
    calificacion: Number.isInteger(cal) && cal >= 1 && cal <= 5 ? cal : null,
    creada,
    actualizada: Number.isFinite(Number(v.actualizada)) && v.actualizada !== null ? Number(v.actualizada) : creada,
    borrada: v.borrada === true,
  };
}

function limpiarDeseo(d, esMunicipioValido) {
  if (!d || typeof d !== 'object') return null;
  const divipola = limpiarDivipola(d.divipola, esMunicipioValido);
  if (!divipola) return null;
  const creada = Number.isFinite(Number(d.creada)) && d.creada !== null ? Number(d.creada) : Date.now();
  return {
    divipola,
    creada,
    actualizada: Number.isFinite(Number(d.actualizada)) && d.actualizada !== null ? Number(d.actualizada) : creada,
    borrada: d.borrada === true,
  };
}

function persistir() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ version: VERSION, visitas, deseos: [...deseos.values()] }));
    return true;
  } catch (error) {
    console.error('No se pudo guardar en localStorage:', error);
    return false;
  }
}

/** origen: 'local' (cambio del usuario) o 'nube' (llegó de la sincronización). */
function confirmarCambio(origen = 'local') {
  visitas.sort(porFechaDesc);
  const guardado = persistir();
  oyentes.forEach((fn) => fn({ guardado, origen }));
}

/** Lee lo guardado (y migra la versión 1). Debe llamarse una vez al inicio. */
export function iniciar() {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return;
    const datos = JSON.parse(crudo);
    visitas = (Array.isArray(datos?.visitas) ? datos.visitas : [])
      .map((v) => limpiarVisita(v))
      .filter(Boolean)
      .sort(porFechaDesc);
    deseos = new Map((Array.isArray(datos?.deseos) ? datos.deseos : [])
      .map((d) => limpiarDeseo(d))
      .filter(Boolean)
      .map((d) => [d.divipola, d]));
    if (datos?.version !== VERSION) persistir();
  } catch (error) {
    console.warn('Datos guardados ilegibles; se empieza vacío.', error);
    visitas = [];
    deseos = new Map();
  }
}

/** Registra una función que se llama tras cada cambio: fn({ guardado, origen }). */
export function suscribir(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/* ---------- Visitas ---------- */

/** Todas las visitas, de la más reciente a la más antigua (copia). */
export const obtenerVisitas = () => vivas();

export const visitasDe = (divipola) => visitas.filter((v) => !v.borrada && v.divipola === divipola);

export const obtenerVisita = (id) => visitas.find((v) => v.id === id && !v.borrada) ?? null;

/** Map DIVIPOLA → fecha ISO de la visita más reciente. */
export function ultimaFechaPorMunicipio() {
  const ultimas = new Map();
  for (const v of visitas) {
    if (v.borrada) continue;
    const actual = ultimas.get(v.divipola);
    if (!actual || v.fecha > actual) ultimas.set(v.divipola, v.fecha);
  }
  return ultimas;
}

export function agregarVisita({ divipola, fecha, notas = '', calificacion = null }) {
  const ahora = Date.now();
  const visita = limpiarVisita({ divipola, fecha, notas, calificacion, creada: ahora, actualizada: ahora });
  if (!visita) throw new Error('Visita inválida');
  visitas.push(visita);
  confirmarCambio();
  return visita;
}

export function actualizarVisita(id, cambios) {
  const i = visitas.findIndex((v) => v.id === id && !v.borrada);
  if (i === -1) return null;
  const visita = limpiarVisita({ ...visitas[i], ...cambios, id, actualizada: Date.now() });
  if (!visita) throw new Error('Visita inválida');
  visitas[i] = visita;
  confirmarCambio();
  return visita;
}

/** Elimina (deja una lápida) y devuelve la visita tal como estaba (para poder deshacer). */
export function eliminarVisita(id) {
  const i = visitas.findIndex((v) => v.id === id && !v.borrada);
  if (i === -1) return null;
  const eliminada = { ...visitas[i] };
  visitas[i] = { ...visitas[i], borrada: true, actualizada: Date.now() };
  confirmarCambio();
  return eliminada;
}

export function restaurarVisita(visita) {
  const i = visitas.findIndex((v) => v.id === visita.id);
  const restaurada = { ...visita, borrada: false, actualizada: Date.now() };
  if (i === -1) visitas.push(restaurada);
  else if (visitas[i].borrada) visitas[i] = restaurada;
  else return;
  confirmarCambio();
}

/**
 * Añade visitas nuevas (p. ej. de Google Maps o de fotos), omitiendo las que ya
 * existen para el mismo municipio y fecha.
 * @returns {number} visitas añadidas
 */
export function agregarVisitasNuevas(lista) {
  const existentes = new Set(vivas().map((v) => `${v.divipola}|${v.fecha}`));
  let añadidas = 0;
  const ahora = Date.now();
  for (const datos of lista) {
    const visita = limpiarVisita({ ...datos, id: undefined, creada: ahora + añadidas, actualizada: ahora });
    if (!visita || existentes.has(`${visita.divipola}|${visita.fecha}`)) continue;
    visitas.push(visita);
    existentes.add(`${visita.divipola}|${visita.fecha}`);
    añadidas++;
  }
  if (añadidas) confirmarCambio();
  return añadidas;
}

/* ---------- Lista de deseos ---------- */

export const esDeseo = (divipola) => deseos.get(divipola)?.borrada === false;

/** Set de DIVIPOLA marcados como "quiero ir". */
export const obtenerDeseos = () =>
  new Set([...deseos.values()].filter((d) => !d.borrada).map((d) => d.divipola));

/** Marca o desmarca un municipio como deseo. Devuelve el nuevo estado. */
export function alternarDeseo(divipola, activo = !esDeseo(divipola)) {
  const ahora = Date.now();
  const actual = deseos.get(divipola);
  deseos.set(divipola, {
    divipola,
    creada: actual && !actual.borrada ? actual.creada : ahora,
    actualizada: ahora,
    borrada: !activo,
  });
  confirmarCambio();
  return activo;
}

/* ---------- Sincronización ---------- */

/** Copia de todos los registros, incluidas las lápidas, para subir a la nube. */
export function registrosParaSincronizar() {
  return {
    visitas: visitas.map((v) => ({ ...v })),
    deseos: [...deseos.values()].map((d) => ({ ...d })),
  };
}

/**
 * Fusiona registros remotos: para cada id gana el de `actualizada` más reciente.
 * @returns {number} registros locales que cambiaron
 */
export function fusionarRemotos({ visitas: remotasV = [], deseos: remotosD = [] }) {
  let cambios = 0;
  const indice = new Map(visitas.map((v, i) => [v.id, i]));
  for (const crudo of remotasV) {
    const remota = limpiarVisita(crudo);
    if (!remota) continue;
    const i = indice.get(remota.id);
    if (i === undefined) {
      indice.set(remota.id, visitas.push(remota) - 1);
      cambios++;
    } else if (remota.actualizada > visitas[i].actualizada) {
      visitas[i] = remota;
      cambios++;
    }
  }
  for (const crudo of remotosD) {
    const remoto = limpiarDeseo(crudo);
    if (!remoto) continue;
    const local = deseos.get(remoto.divipola);
    if (!local || remoto.actualizada > local.actualizada) {
      deseos.set(remoto.divipola, remoto);
      cambios++;
    }
  }
  if (cambios) confirmarCambio('nube');
  return cambios;
}

/* ---------- Copia de seguridad (JSON) ---------- */

export function exportarJSON() {
  const visitasPublicas = vivas().map(({ id, divipola, fecha, notas, calificacion, creada }) =>
    ({ id, divipola, fecha, notas, calificacion, creada }));
  return JSON.stringify({
    app: 'mi-colombia',
    version: VERSION,
    exportado: new Date().toISOString(),
    visitas: visitasPublicas,
    deseos: [...obtenerDeseos()].sort(),
  }, null, 2);
}

/**
 * Analiza un archivo de respaldo sin modificar nada.
 * Acepta { visitas: [...], deseos?: [...] } o directamente un arreglo de visitas.
 * @returns {{ validas: object[], omitidas: number, deseos: string[] }}
 */
export function analizarImportacion(texto, esMunicipioValido) {
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  const lista = Array.isArray(datos) ? datos : datos?.visitas;
  if (!Array.isArray(lista)) throw new Error('El archivo no contiene una lista de visitas.');
  const validas = lista
    .map((v) => limpiarVisita(v, esMunicipioValido))
    .filter((v) => v && !v.borrada);
  const listaDeseos = Array.isArray(datos?.deseos) ? datos.deseos : [];
  const deseosValidos = [...new Set(listaDeseos
    .map((d) => limpiarDivipola(typeof d === 'object' ? d?.divipola : d, esMunicipioValido))
    .filter(Boolean))];
  return { validas, omitidas: lista.length - validas.length, deseos: deseosValidos };
}

/**
 * Aplica una importación ya analizada.
 * modo 'reemplazar' borra lo actual; 'combinar' añade evitando duplicados.
 * @returns {number} visitas añadidas
 */
export function aplicarImportacion({ validas, deseos: deseosNuevos = [] }, modo) {
  const ahora = Date.now();
  let añadidas = 0;
  if (modo === 'reemplazar') {
    // Lo actual queda como lápida para que también se borre en la nube.
    const nuevosIds = new Set(validas.map((v) => v.id));
    visitas = visitas
      .filter((v) => !nuevosIds.has(v.id))
      .map((v) => (v.borrada ? v : { ...v, borrada: true, actualizada: ahora }));
    for (const d of deseos.values()) {
      if (!d.borrada) deseos.set(d.divipola, { ...d, borrada: true, actualizada: ahora });
    }
    visitas.push(...validas.map((v) => ({ ...v, borrada: false, actualizada: ahora })));
    añadidas = validas.length;
  } else {
    const firma = (v) => `${v.divipola}|${v.fecha}|${v.notas}|${v.calificacion}`;
    const ids = new Set(vivas().map((v) => v.id));
    const firmas = new Set(vivas().map(firma));
    for (const v of validas) {
      if (ids.has(v.id) || firmas.has(firma(v))) continue;
      const i = visitas.findIndex((x) => x.id === v.id); // lápida con el mismo id
      const nueva = { ...v, borrada: false, actualizada: ahora };
      if (i === -1) visitas.push(nueva);
      else visitas[i] = nueva;
      ids.add(v.id);
      firmas.add(firma(v));
      añadidas++;
    }
  }
  for (const divipola of deseosNuevos) {
    if (!esDeseo(divipola)) deseos.set(divipola, { divipola, creada: ahora, actualizada: ahora, borrada: false });
  }
  confirmarCambio();
  return añadidas;
}

/* ---------- Preferencias de interfaz ---------- */

export function leerPreferencia(nombre, porDefecto) {
  try {
    return localStorage.getItem(`mi-colombia:${nombre}`) ?? porDefecto;
  } catch {
    return porDefecto;
  }
}

export function guardarPreferencia(nombre, valor) {
  try {
    localStorage.setItem(`mi-colombia:${nombre}`, valor);
  } catch { /* modo privado o almacenamiento lleno: se ignora */ }
}
