/**
 * Cuenta y sincronización en la nube con Supabase (opcional; ver js/config.js).
 *
 * - Inicio de sesión sin contraseña: enlace mágico o código de 6 dígitos por correo
 *   (el código sirve en la app instalada, donde el enlace abre el navegador).
 * - Sincronización: se descargan todos los registros remotos, se fusionan con los
 *   locales (gana el de `actualizada` más reciente) y se suben los que cambiaron.
 *   Se ejecuta al iniciar sesión, al abrir la app, unos segundos después de cada
 *   cambio local y al recuperar la conexión.
 * - Fotos: el archivo va al bucket privado "fotos"; de las que llegan de otros
 *   dispositivos se descarga solo la miniatura y la imagen grande al abrirla.
 */
import { NUBE } from './config.js';
import * as almacen from './storage.js';
import * as fotos from './fotos.js';

const PAGINA = 1000;
const LOTE = 500;
const ESPERA_SYNC = 3000; // ms tras el último cambio local

let cliente = null;
let promesaCliente = null;
let usuario = null;
let perfil = { nombre: '', publico: false };
let sincronizando = false;
let pendiente = false;
let ultimaSync = Number(almacen.leerPreferencia('ultima-sync', 0)) || null;
let error = null;
let temporizador = null;
const oyentes = new Set();

export const configurada = () => Boolean(NUBE.url && NUBE.claveAnonima);

export function estado() {
  return {
    configurada: configurada(),
    usuario: usuario ? { id: usuario.id, email: usuario.email } : null,
    perfil: { ...perfil },
    sincronizando,
    ultimaSync,
    error,
    enLinea: navigator.onLine,
  };
}

export function suscribir(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

const avisar = () => oyentes.forEach((fn) => fn(estado()));

function cargarLibreria() {
  if (window.supabase) return Promise.resolve();
  return new Promise((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = 'vendor/supabase.js';
    script.onload = resolver;
    script.onerror = () => rechazar(new Error('No se pudo cargar la librería de Supabase.'));
    document.head.append(script);
  });
}

function obtenerCliente() {
  if (!configurada()) return Promise.reject(new Error('La nube no está configurada.'));
  promesaCliente ??= cargarLibreria().then(() => {
    cliente = window.supabase.createClient(NUBE.url, NUBE.claveAnonima, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return cliente;
  }).catch((e) => { promesaCliente = null; throw e; });
  return promesaCliente;
}

/** Arranca la sesión guardada (si la hay) y la sincronización automática. */
export async function iniciarNube() {
  if (!configurada()) return;
  try {
    const sb = await obtenerCliente();
    sb.auth.onAuthStateChange((evento, sesion) => {
      const anterior = usuario?.id;
      usuario = sesion?.user ?? null;
      if (usuario && usuario.id !== anterior) {
        cargarPerfil().then(() => sincronizar());
      }
      if (!usuario) perfil = { nombre: '', publico: false };
      avisar();
    });
    const { data } = await sb.auth.getSession();
    usuario = data.session?.user ?? null;
    // Limpia los parámetros del enlace mágico de la barra de direcciones.
    if (/access_token=|refresh_token=|type=magiclink/.test(location.hash)) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    avisar();
  } catch (e) {
    error = e.message;
    avisar();
    return;
  }

  almacen.suscribir(({ origen }) => { if (origen === 'local') programarSync(); });
  fotos.suscribir(({ origen }) => { if (origen === 'local') programarSync(); });
  window.addEventListener('online', () => { avisar(); programarSync(0); });
  window.addEventListener('offline', avisar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') programarSync(0);
  });
}

function programarSync(espera = ESPERA_SYNC) {
  if (!usuario) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => sincronizar(), espera);
}

/* ---------- Sesión ---------- */

export async function enviarAcceso(email) {
  const sb = await obtenerCliente();
  const { error: e } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (e) throw new Error(traducirError(e));
}

export async function verificarCodigo(email, codigo) {
  const sb = await obtenerCliente();
  const { error: e } = await sb.auth.verifyOtp({ email, token: codigo.trim(), type: 'email' });
  if (e) throw new Error(traducirError(e));
}

export async function cerrarSesion() {
  const sb = await obtenerCliente();
  await sb.auth.signOut();
  usuario = null;
  avisar();
}

function traducirError(e) {
  const m = e?.message ?? String(e);
  if (/rate limit|security purposes/i.test(m)) return 'Demasiados intentos. Espera un minuto e intenta de nuevo.';
  if (/expired|invalid/i.test(m)) return 'El código no es válido o ya venció. Pide uno nuevo.';
  if (/fetch|network/i.test(m)) return 'Sin conexión con el servidor.';
  return m;
}

/* ---------- Perfil público ---------- */

async function cargarPerfil() {
  const sb = await obtenerCliente();
  const { data, error: e } = await sb.from('perfiles').select('nombre, publico').maybeSingle();
  if (e) { console.warn(e); return; }
  if (data) perfil = data;
  else await sb.from('perfiles').insert({ nombre: '', publico: false });
  avisar();
}

export async function guardarPerfil(cambios) {
  const sb = await obtenerCliente();
  const nuevo = { ...perfil, ...cambios };
  const { error: e } = await sb.from('perfiles')
    .upsert({ user_id: usuario.id, ...nuevo, actualizada: new Date().toISOString() });
  if (e) throw new Error(traducirError(e));
  perfil = nuevo;
  avisar();
}

export function urlMapaEnVivo() {
  if (!usuario) return null;
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('mapa', usuario.id);
  return url.toString();
}

/** Lee el mapa público de otra persona (no requiere sesión). */
export async function cargarMapaPublico(idUsuario) {
  const sb = await obtenerCliente();
  const { data, error: e } = await sb.rpc('mapa_publico', { p_usuario: idUsuario });
  if (e) throw new Error(traducirError(e));
  if (!data) throw new Error('Este mapa no existe o ya no es público.');
  return data;
}

/* ---------- Sincronización ---------- */

async function leerTodo(tabla) {
  const sb = await obtenerCliente();
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error: e } = await sb.from(tabla).select('*').range(desde, desde + PAGINA - 1);
    if (e) throw e;
    filas.push(...data);
    if (data.length < PAGINA) return filas;
  }
}

async function subir(tabla, filas, conflicto) {
  const sb = await obtenerCliente();
  for (let i = 0; i < filas.length; i += LOTE) {
    const { error: e } = await sb.from(tabla).upsert(filas.slice(i, i + LOTE), { onConflict: conflicto });
    if (e) throw e;
  }
}

/** Filas locales que la nube no tiene o tiene con una versión más vieja. */
function cambiadas(locales, remotas, clave) {
  const fechas = new Map(remotas.map((r) => [clave(r), Number(r.actualizada)]));
  return locales.filter((l) => !(fechas.get(clave(l)) >= l.actualizada));
}

export async function sincronizar() {
  if (!usuario || !navigator.onLine) return;
  if (sincronizando) { pendiente = true; return; }
  sincronizando = true;
  error = null;
  avisar();
  try {
    const uid = usuario.id;

    // 1. Visitas y deseos: bajar, fusionar, subir lo que cambió.
    const [remotasV, remotosD] = await Promise.all([leerTodo('visitas'), leerTodo('deseos')]);
    almacen.fusionarRemotos({ visitas: remotasV, deseos: remotosD });
    const locales = almacen.registrosParaSincronizar();
    await subir('visitas', cambiadas(locales.visitas, remotasV, (v) => v.id).map((v) => ({
      user_id: uid,
      id: v.id,
      divipola: v.divipola,
      fecha: v.fecha,
      notas: v.notas,
      calificacion: v.calificacion,
      creada: v.creada,
      actualizada: v.actualizada,
      borrada: v.borrada,
    })), 'user_id,id');
    await subir('deseos', cambiadas(locales.deseos, remotosD, (d) => d.divipola).map((d) => ({
      user_id: uid, ...d,
    })), 'user_id,divipola');

    // 2. Fotos.
    await sincronizarFotos(uid);

    ultimaSync = Date.now();
    almacen.guardarPreferencia('ultima-sync', String(ultimaSync));
  } catch (e) {
    console.error('Error de sincronización:', e);
    error = traducirError(e);
  } finally {
    sincronizando = false;
    avisar();
    if (pendiente) {
      pendiente = false;
      programarSync(0);
    }
  }
}

async function sincronizarFotos(uid) {
  if (!fotos.disponible()) return;
  const sb = await obtenerCliente();
  const bucket = sb.storage.from('fotos');
  const remotas = await leerTodo('fotos');
  const locales = new Map((await fotos.todasLasFotos()).map((f) => [f.id, f]));
  let hubo = false;

  // Bajar: fotos nuevas o más recientes en la nube.
  for (const r of remotas) {
    const local = locales.get(r.id);
    const actualizada = Number(r.actualizada);
    if (local && local.actualizada >= actualizada) continue;
    const base = {
      ...(local ?? { imagen: null, miniatura: null }),
      id: r.id,
      divipola: r.divipola,
      fecha: r.fecha,
      ancho: r.ancho,
      alto: r.alto,
      creada: Number(r.creada),
      actualizada,
      borrada: r.borrada,
      nube: r.ruta ? { ruta: r.ruta, rutaMini: r.ruta_mini } : null,
    };
    if (!base.borrada && !base.miniatura && r.ruta_mini) {
      const { data } = await bucket.download(r.ruta_mini);
      if (data) base.miniatura = data;
    }
    await fotos.guardarFoto(base, { silencioso: true });
    locales.set(r.id, base);
    hubo = true;
  }

  // Subir: fotos locales nuevas o modificadas.
  const fechasRemotas = new Map(remotas.map((r) => [r.id, Number(r.actualizada)]));
  for (const f of locales.values()) {
    if (fechasRemotas.get(f.id) >= f.actualizada) continue;
    let nube = f.nube;
    if (!f.borrada && !nube && f.imagen) {
      const ruta = `${uid}/${f.id}.jpg`;
      const rutaMini = `${uid}/${f.id}-mini.jpg`;
      const opciones = { contentType: 'image/jpeg', upsert: true };
      const r1 = await bucket.upload(ruta, f.imagen, opciones);
      if (r1.error) throw r1.error;
      const r2 = await bucket.upload(rutaMini, f.miniatura ?? f.imagen, opciones);
      if (r2.error) throw r2.error;
      nube = { ruta, rutaMini };
      await fotos.guardarFoto({ ...f, nube }, { silencioso: true });
    }
    if (f.borrada && nube) {
      await bucket.remove([nube.ruta, nube.rutaMini].filter(Boolean));
    }
    const { error: e } = await sb.from('fotos').upsert({
      user_id: uid,
      id: f.id,
      divipola: f.divipola,
      fecha: f.fecha,
      ancho: f.ancho,
      alto: f.alto,
      ruta: f.borrada ? null : nube?.ruta ?? null,
      ruta_mini: f.borrada ? null : nube?.rutaMini ?? null,
      creada: f.creada,
      actualizada: f.actualizada,
      borrada: f.borrada,
    }, { onConflict: 'user_id,id' });
    if (e) throw e;
  }

  if (hubo) fotos.notificar('nube');
}

/** Imagen grande de una foto que solo está en la nube. */
export async function descargarImagen(foto) {
  if (!foto.nube?.ruta) return null;
  const sb = await obtenerCliente();
  const { data, error: e } = await sb.storage.from('fotos').download(foto.nube.ruta);
  if (e) throw new Error(traducirError(e));
  await fotos.guardarFoto({ ...foto, imagen: data }, { silencioso: true });
  return data;
}
