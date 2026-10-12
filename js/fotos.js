/**
 * Fotos por lugar, guardadas en IndexedDB (localStorage no admite archivos).
 *
 * Cada foto: { id, divipola, fecha, creada, actualizada, borrada, ancho, alto,
 *              imagen: Blob|null, miniatura: Blob|null, nube: { ruta, rutaMini } | null }
 *  - imagen: JPEG de máximo 1600 px de lado; miniatura: 360 px.
 *  - Una foto que llegó de la nube puede tener imagen = null: se descarga al abrirla.
 *  - borrada funciona igual que en las visitas (lápida para sincronizar).
 */
const BD = 'mi-colombia';
const ALMACEN = 'fotos';
const LADO_IMAGEN = 1600;
const LADO_MINIATURA = 360;

let promesaBD = null;
const oyentes = new Set();

function abrir() {
  promesaBD ??= new Promise((resolver, rechazar) => {
    const solicitud = indexedDB.open(BD, 1);
    solicitud.onupgradeneeded = () => {
      const almacen = solicitud.result.createObjectStore(ALMACEN, { keyPath: 'id' });
      almacen.createIndex('divipola', 'divipola');
    };
    solicitud.onsuccess = () => resolver(solicitud.result);
    solicitud.onerror = () => { promesaBD = null; rechazar(solicitud.error); };
  });
  return promesaBD;
}

/** Ejecuta fn(almacen) dentro de una transacción y resuelve con el resultado de su última solicitud. */
async function transaccion(modo, fn) {
  const bd = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = bd.transaction(ALMACEN, modo);
    const solicitud = fn(tx.objectStore(ALMACEN));
    tx.oncomplete = () => resolver(solicitud?.result);
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error ?? new Error('Transacción cancelada'));
  });
}

const avisar = (origen = 'local') => oyentes.forEach((fn) => fn({ origen }));

/** Avisa a los suscriptores tras cambios hechos en bloque (p. ej. al sincronizar). */
export const notificar = (origen) => avisar(origen);

export function suscribir(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

export const disponible = () => typeof indexedDB !== 'undefined';

async function redimensionar(fuente, lado, calidad) {
  const imagen = await createImageBitmap(fuente, { imageOrientation: 'from-image' });
  const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height));
  const ancho = Math.round(imagen.width * escala);
  const alto = Math.round(imagen.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  canvas.getContext('2d').drawImage(imagen, 0, 0, ancho, alto);
  imagen.close?.();
  const blob = await new Promise((resolver) => canvas.toBlob(resolver, 'image/jpeg', calidad));
  if (!blob) throw new Error('No se pudo procesar la imagen.');
  return { blob, ancho, alto };
}

/**
 * Procesa y guarda archivos de imagen para un municipio.
 * @param {string} divipola
 * @param {{ archivo: File, fecha?: string|null }[]} entradas
 * @returns {Promise<{ guardadas: number, fallidas: string[] }>}
 */
export async function agregarFotos(divipola, entradas) {
  const nuevas = [];
  const fallidas = [];
  for (const { archivo, fecha = null } of entradas) {
    try {
      const imagen = await redimensionar(archivo, LADO_IMAGEN, 0.82);
      const miniatura = await redimensionar(imagen.blob, LADO_MINIATURA, 0.75);
      const ahora = Date.now();
      nuevas.push({
        id: crypto.randomUUID?.() ?? `${ahora.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        divipola,
        fecha,
        creada: ahora + nuevas.length,
        actualizada: ahora,
        borrada: false,
        ancho: imagen.ancho,
        alto: imagen.alto,
        imagen: imagen.blob,
        miniatura: miniatura.blob,
        nube: null,
      });
    } catch (error) {
      console.warn('Foto no procesada:', archivo.name, error);
      fallidas.push(archivo.name);
    }
  }
  if (nuevas.length) {
    await transaccion('readwrite', (almacen) => {
      let ultima;
      for (const f of nuevas) ultima = almacen.put(f);
      return ultima;
    });
    avisar();
  }
  return { guardadas: nuevas.length, fallidas };
}

const porFecha = (a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '') || b.creada - a.creada;

export async function fotosDe(divipola) {
  if (!disponible()) return [];
  const todas = await transaccion('readonly', (almacen) => almacen.index('divipola').getAll(divipola));
  return todas.filter((f) => !f.borrada).sort(porFecha);
}

export const obtenerFoto = (id) => transaccion('readonly', (almacen) => almacen.get(id));

/** Todas las fotos, incluidas las lápidas (para sincronizar). */
export async function todasLasFotos() {
  if (!disponible()) return [];
  return transaccion('readonly', (almacen) => almacen.getAll());
}

/** Map DIVIPOLA → número de fotos. */
export async function conteoPorMunicipio() {
  const conteo = new Map();
  for (const f of await todasLasFotos()) {
    if (!f.borrada) conteo.set(f.divipola, (conteo.get(f.divipola) ?? 0) + 1);
  }
  return conteo;
}

/** Guarda un registro completo (lo usa la sincronización). */
export async function guardarFoto(foto, { origen = 'nube', silencioso = false } = {}) {
  await transaccion('readwrite', (almacen) => almacen.put(foto));
  if (!silencioso) avisar(origen);
}

export async function eliminarFoto(id) {
  const foto = await obtenerFoto(id);
  if (!foto || foto.borrada) return null;
  await guardarFoto({ ...foto, borrada: true, actualizada: Date.now() }, { origen: 'local' });
  return foto;
}

export async function restaurarFoto(foto) {
  await guardarFoto({ ...foto, borrada: false, actualizada: Date.now() }, { origen: 'local' });
}

/** Libera el espacio de las fotos borradas hace más de 30 días que ya no hacen falta para sincronizar. */
export async function limpiarLapidas() {
  if (!disponible()) return;
  const limite = Date.now() - 30 * 24 * 3600 * 1000;
  const viejas = (await todasLasFotos()).filter((f) => f.borrada && f.actualizada < limite && (f.imagen || f.miniatura));
  for (const f of viejas) await guardarFoto({ ...f, imagen: null, miniatura: null }, { silencioso: true });
}
