/**
 * Punto de entrada: conecta datos, almacenamiento, mapa e interfaz.
 *
 * Flujo: cualquier cambio en las visitas → storage notifica → renderTodo()
 * recalcula colores, leyenda, estadísticas, retos, lista y ficha del lugar.
 *
 * La app tiene dos modos:
 *  - Edición (normal): los datos salen de storage.js (y se sincronizan con la nube si hay sesión).
 *  - Solo lectura: al abrir un enlace compartido (?ver=… o ?mapa=…) se muestra el mapa
 *    de otra persona sin tocar los datos propios.
 */
import { cargarDatos, buscarMunicipios } from './data.js';
import * as almacen from './storage.js';
import * as fotos from './fotos.js';
import * as nube from './nube.js';
import { crearMapa } from './map.js';
import { crearIndice } from './geo.js';
import { cargarCentrosPoblados, cargarParques, puntosDeMunicipios } from './capas.js';
import { leerPaleta, escalaPorAnio, construirLeyenda } from './colors.js';
import { calcularLogros } from './logros.js';
import { codificarMapa, decodificarMapa, urlCompartida } from './compartir.js';
import { fechaDeFoto } from './importar-externo.js';
import { generarPNG } from './export-png.js';
import {
  esc, formatearFecha, hoyISO, esFechaISO, anioDe, descargarBlob, numero, porcentaje,
} from './utils.js';
import { iniciarBuscador } from './ui/buscador.js';
import { iniciarPestanas } from './ui/pestanas.js';
import { renderLugar, leerFormulario } from './ui/lugar.js';
import { renderEstadisticas } from './ui/estadisticas.js';
import { renderLista } from './ui/lista.js';
import { renderRetos } from './ui/retos.js';
import { renderGaleria, abrirVisor } from './ui/galeria.js';
import { iniciarCuenta } from './ui/cuenta.js';
import { iniciarCompartir } from './ui/compartir.js';
import { iniciarImportacion } from './ui/importacion.js';
import { mostrarAviso } from './ui/aviso.js';

const $ = (selector) => document.querySelector(selector);

const CAPAS_GUARDABLES = ['relieve', 'parques', 'centros', 'calor'];

const estado = {
  seleccion: null,     // DIVIPOLA seleccionado
  editando: null,      // id de la visita en edición
  filtroDepto: '',     // '' = todo el país
  modo: almacen.leerPreferencia('modo', 'estado'), // 'estado' | 'anio'
  capas: new Set(),    // capas opcionales activas
  ruta: { desde: '', hasta: '' },
};

let datos;
let indice;
let mapa;
let pestanas;
let fuente;
let importacion;
let compartir;
let leyendaActual;
let coloresActuales = new Map();
let puntosMunicipios = null; // Map DIVIPOLA → [lat, lon], se calcula al primer uso

const esMovil = () => window.matchMedia('(max-width: 900px)').matches;

/* ======================= Fuentes de datos ======================= */

/** Datos propios (editables). */
const fuenteLocal = {
  soloLectura: false,
  titulo: 'Mi Colombia',
  visitas: () => almacen.obtenerVisitas(),
  visitasDe: (id) => almacen.visitasDe(id),
  ultimas: () => almacen.ultimaFechaPorMunicipio(),
  deseos: () => almacen.obtenerDeseos(),
  esDeseo: (id) => almacen.esDeseo(id),
};

/** Mapa de otra persona: { nombre, visitas: [{ divipola, fecha }], deseos: Set|array }. */
function crearFuenteCompartida({ nombre, visitas, deseos }) {
  const lista = visitas
    .filter((v) => datos.porId.has(v.divipola))
    .map((v, i) => ({ id: `c${i}`, notas: '', calificacion: null, creada: 0, ...v }))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const ultimas = new Map();
  for (const v of lista) if (!ultimas.has(v.divipola)) ultimas.set(v.divipola, v.fecha);
  const setDeseos = new Set(deseos);
  return {
    soloLectura: true,
    titulo: nombre ? `Mapa de ${nombre}` : 'Mapa compartido',
    visitas: () => lista,
    visitasDe: (id) => lista.filter((v) => v.divipola === id),
    ultimas: () => ultimas,
    deseos: () => setDeseos,
    esDeseo: (id) => setDeseos.has(id),
  };
}

/** Si la URL trae un mapa compartido, lo carga. Devuelve null en modo normal. */
async function leerMapaCompartido() {
  const parametros = new URLSearchParams(location.search);
  const codigo = parametros.get('ver');
  const idUsuario = parametros.get('mapa');
  if (codigo) {
    const { visitas, deseos } = decodificarMapa(datos, codigo);
    return crearFuenteCompartida({ nombre: parametros.get('n') ?? '', visitas, deseos });
  }
  if (idUsuario) {
    if (!nube.configurada()) throw new Error('Esta copia de la app no tiene la nube configurada.');
    const publico = await nube.cargarMapaPublico(idUsuario);
    return crearFuenteCompartida({ nombre: publico.nombre, visitas: publico.visitas, deseos: publico.deseos });
  }
  return null;
}

/* ======================= Arranque ======================= */

async function iniciar() {
  iniciarTema();
  almacen.iniciar();
  pestanas = iniciarPestanas($('.pestanas'));

  try {
    datos = await cargarDatos();
  } catch (error) {
    console.error(error);
    $('#cargando').innerHTML = `
      <strong>No se pudo cargar el mapa.</strong><br>
      Abre la app desde un servidor local (por ejemplo <code>npx serve .</code>),
      no con doble clic sobre index.html.`;
    return;
  }
  indice = crearIndice(datos.municipios);

  try {
    fuente = (await leerMapaCompartido()) ?? fuenteLocal;
  } catch (error) {
    console.error(error);
    mostrarAviso(`No se pudo abrir el mapa compartido: ${error.message}`, { duracion: 8000 });
    fuente = fuenteLocal;
  }
  if (fuente.soloLectura) activarSoloLectura();

  mapa = crearMapa($('#mapa'), datos, {
    alSeleccionar: (id) => seleccionar(id, { origen: 'mapa' }),
    contenidoTooltip,
    municipioEn: (lon, lat) => indice.buscar(lon, lat),
  });
  $('#cargando').hidden = true;

  poblarDepartamentos();
  conectarEventos();
  iniciarBuscador({
    entrada: $('#buscar'),
    lista: $('#sugerencias'),
    buscar: (q) => buscarMunicipios(datos, q),
    alElegir: (id) => seleccionar(id, { origen: 'buscador', zoom: true }),
  });

  compartir = iniciarCompartir({
    enlaceInstantanea: () => ({
      url: urlCompartida(codificarMapa(datos, fuente.ultimas(), fuente.deseos()), almacen.leerPreferencia('nombre-compartir', '')),
      visitados: fuente.ultimas().size,
    }),
    enlaceEnVivo: () => (nube.estado().perfil.publico ? nube.urlMapaEnVivo() : null),
    nubeConfigurada: nube.configurada,
    generarImagen: generarImagenMapa,
    descargarImagen: descargarPNG,
    mostrarAviso,
    leerNombre: () => almacen.leerPreferencia('nombre-compartir', ''),
    guardarNombre: (n) => almacen.guardarPreferencia('nombre-compartir', n),
  });

  if (!fuente.soloLectura) {
    importacion = iniciarImportacion({ datos, indice, almacen, fotos, mostrarAviso });
    iniciarCuenta({ nube, mostrarAviso });
    almacen.suscribir(({ guardado }) => {
      if (!guardado) mostrarAviso('No se pudo guardar en este navegador. Exporta una copia de seguridad.');
      renderTodo();
    });
    fotos.suscribir(() => pintarGaleria());
    nube.iniciarNube();
    fotos.limpiarLapidas().catch(() => {});
    // Pide al navegador que no borre los datos por falta de espacio.
    navigator.storage?.persist?.().catch(() => {});
  }

  $(`input[name="modo"][value="${estado.modo}"]`).checked = true;
  restaurarCapas();
  renderTodo(false);
  registrarServiceWorker();
}

function activarSoloLectura() {
  document.body.classList.add('solo-lectura');
  const banda = $('#banda-lectura');
  banda.querySelector('.banda-titulo').textContent = fuente.titulo;
  banda.querySelector('.banda-detalle').textContent =
    `${numero(fuente.ultimas().size)} municipios visitados · Solo lectura.`;
  banda.hidden = false;
  document.title = `${fuente.titulo} · Mi Colombia`;
}

/* ======================= Render ======================= */

/** Calcula el color de cada municipio según el modo activo (y la lista de deseos). */
function calcularColores() {
  const paleta = leerPaleta();
  const ultimas = fuente.ultimas();
  const deseos = fuente.deseos();
  const anios = [...ultimas.values()].map(anioDe);
  const colores = new Map();
  for (const id of deseos) if (!ultimas.has(id)) colores.set(id, paleta.deseo);
  if (estado.modo === 'anio') {
    const escala = escalaPorAnio(anios, paleta.rampa);
    for (const [id, fecha] of ultimas) colores.set(id, escala(anioDe(fecha)));
  } else {
    for (const id of ultimas.keys()) colores.set(id, paleta.visitado);
  }
  const hayDeseos = [...deseos].some((id) => !ultimas.has(id));
  return { colores, ultimas, deseos, leyenda: construirLeyenda(estado.modo, anios, paleta, { hayDeseos }) };
}

function renderTodo(animar = true) {
  const { colores, ultimas, deseos, leyenda } = calcularColores();
  coloresActuales = colores;
  leyendaActual = leyenda;
  mapa.actualizarColores(colores, animar);
  renderLeyenda(leyenda);

  const visitas = fuente.visitas();
  const comunes = { datos, ultimas, visitas, deseos, filtroDepto: estado.filtroDepto, soloLectura: fuente.soloLectura };
  renderEstadisticas($('#vista-stats'), comunes);
  renderRetos($('#vista-retos'), { datos, logros: calcularLogros(comunes) });
  renderLista($('#vista-visitas'), comunes);
  renderLugarActual();
  $('#contador-visitas').textContent = visitas.length ? `(${visitas.length})` : '';
  actualizarModoViaje();
}

function renderLugarActual() {
  const municipio = estado.seleccion ? datos.porId.get(estado.seleccion) : null;
  renderLugar($('#vista-lugar'), {
    municipio,
    visitas: municipio ? fuente.visitasDe(municipio.id) : [],
    editando: estado.editando,
    deseo: municipio ? fuente.esDeseo(municipio.id) : false,
    soloLectura: fuente.soloLectura,
    conFotos: fotos.disponible(),
  });
  renderChipMovil(municipio);
  pintarGaleria();
}

let turnoGaleria = 0;
async function pintarGaleria() {
  const contenedor = $('#galeria-lugar');
  if (!contenedor || !estado.seleccion) return;
  const turno = ++turnoGaleria;
  const id = estado.seleccion;
  try {
    const lista = await fotos.fotosDe(id);
    if (turno === turnoGaleria && estado.seleccion === id) renderGaleria($('#galeria-lugar'), lista);
  } catch (error) {
    console.warn('No se pudieron leer las fotos', error);
    contenedor.innerHTML = '<p class="ayuda">Este navegador no permite guardar fotos.</p>';
  }
}

function renderLeyenda(leyenda) {
  const muestra = (color, etiqueta) =>
    `<li><span class="muestra" style="background:${color}"></span>${esc(etiqueta)}</li>`;
  let cuerpo;
  if (leyenda.tipo === 'discreta') {
    cuerpo = `<ul>${leyenda.items.map((i) => muestra(i.color, i.etiqueta)).join('')}</ul>`;
  } else {
    cuerpo = `
      <ul>${[leyenda.sin, ...leyenda.extra].map((i) => muestra(i.color, i.etiqueta)).join('')}</ul>
      <div class="gradiente" style="background:linear-gradient(90deg, ${leyenda.colores.join(',')})"></div>
      <div class="gradiente-etiquetas"><span>${leyenda.desde}</span><span>${leyenda.hasta}</span></div>`;
  }
  $('#leyenda').innerHTML = `<p class="leyenda-titulo">${esc(leyenda.titulo)}</p>${cuerpo}`;
}

function contenidoTooltip(id) {
  const m = datos.porId.get(id);
  const visitas = fuente.visitasDe(id);
  let estadoTexto = 'Sin visitar';
  if (visitas.length) {
    estadoTexto = `Visitado · ${formatearFecha(visitas[0].fecha)}${visitas.length > 1 ? ` · ${visitas.length} visitas` : ''}`;
  } else if (fuente.esDeseo(id)) {
    estadoTexto = 'Quiero ir';
  }
  return `<strong>${esc(m.nombre)}</strong><br><span>${esc(m.dptoNombre)}</span><br><span>${esc(estadoTexto)}</span>`;
}

/** En móvil, una tarjeta sobre el mapa muestra lo seleccionado y lleva al panel. */
function renderChipMovil(municipio) {
  const chip = $('#chip-seleccion');
  if (!municipio) {
    chip.hidden = true;
    return;
  }
  const visitado = fuente.visitasDe(municipio.id).length > 0;
  const texto = visitado ? 'Visitado' : fuente.esDeseo(municipio.id) ? 'Quiero ir' : 'Pendiente';
  chip.querySelector('.chip-nombre').textContent = municipio.nombre;
  chip.querySelector('.chip-meta').textContent = `${municipio.dptoNombre} · ${texto}`;
  chip.hidden = false;
}

/* ======================= Capas y modo viaje ======================= */

function restaurarCapas() {
  let guardadas = [];
  try {
    guardadas = JSON.parse(almacen.leerPreferencia('capas', '[]'));
  } catch { /* preferencia dañada */ }
  for (const capa of guardadas) {
    if (!CAPAS_GUARDABLES.includes(capa)) continue;
    const casilla = $(`input[name="capa"][value="${capa}"]`);
    if (casilla) casilla.checked = true;
    alternarCapa(capa, true, { guardar: false });
  }
}

async function alternarCapa(capa, activa, { guardar = true } = {}) {
  if (activa) estado.capas.add(capa);
  else estado.capas.delete(capa);
  if (guardar) {
    almacen.guardarPreferencia('capas', JSON.stringify([...estado.capas].filter((c) => CAPAS_GUARDABLES.includes(c))));
  }
  try {
    switch (capa) {
      case 'relieve':
        mapa.mostrarRelieve(activa);
        break;
      case 'parques':
        mapa.mostrarParques(activa ? await cargarParques() : null);
        break;
      case 'centros':
        mapa.mostrarCentros(activa ? await cargarCentrosPoblados() : null);
        break;
      case 'calor':
      case 'ruta':
        $('#rango-ruta').hidden = !estado.capas.has('ruta');
        if (capa === 'ruta' && activa) prepararRango();
        await actualizarModoViaje();
        break;
      default:
    }
  } catch (error) {
    console.error(error);
    mostrarAviso('No se pudo cargar la capa. Revisa tu conexión.');
    const casilla = $(`input[name="capa"][value="${capa}"]`);
    if (casilla) casilla.checked = false;
    estado.capas.delete(capa);
  }
}

/** Rango inicial de la ruta: las dos semanas que terminan en la visita más reciente. */
function prepararRango() {
  if (estado.ruta.desde && estado.ruta.hasta) return;
  const visitas = fuente.visitas().filter((v) => esFechaISO(v.fecha));
  const hasta = visitas[0]?.fecha ?? hoyISO();
  const [a, m, d] = hasta.split('-').map(Number);
  const inicio = new Date(a, m - 1, d - 14);
  const desde = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-${String(inicio.getDate()).padStart(2, '0')}`;
  estado.ruta = { desde, hasta };
  $('#ruta-desde').value = desde;
  $('#ruta-hasta').value = hasta;
}

async function obtenerPuntosMunicipios() {
  puntosMunicipios ??= await puntosDeMunicipios(datos);
  return puntosMunicipios;
}

let turnoViaje = 0;
async function actualizarModoViaje() {
  if (!mapa) return;
  const turno = ++turnoViaje;
  const quiereCalor = estado.capas.has('calor');
  const quiereRuta = estado.capas.has('ruta');
  if (!quiereCalor) mapa.mostrarCalor(null);
  if (!quiereRuta) mapa.mostrarRuta(null);
  if (!quiereCalor && !quiereRuta) return;

  const puntos = await obtenerPuntosMunicipios();
  if (turno !== turnoViaje) return;
  const visitas = fuente.visitas();

  if (quiereCalor) {
    const conteo = new Map();
    for (const v of visitas) conteo.set(v.divipola, (conteo.get(v.divipola) ?? 0) + 1);
    mapa.mostrarCalor([...conteo].filter(([id]) => puntos.has(id)).map(([id, n]) => [...puntos.get(id), n]));
  }

  if (quiereRuta) {
    const { desde, hasta } = estado.ruta;
    const enRango = visitas
      .filter((v) => esFechaISO(v.fecha) && (!desde || v.fecha >= desde) && (!hasta || v.fecha <= hasta))
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creada - b.creada);
    const paradas = [];
    for (const v of enRango) {
      if (paradas.at(-1)?.divipola === v.divipola || !puntos.has(v.divipola)) continue;
      const [lat, lon] = puntos.get(v.divipola);
      paradas.push({ lat, lon, divipola: v.divipola, nombre: datos.porId.get(v.divipola).nombre, fecha: formatearFecha(v.fecha) });
    }
    mapa.mostrarRuta(paradas);
    $('#ruta-resumen').textContent = paradas.length
      ? `${paradas.length} ${paradas.length === 1 ? 'parada' : 'paradas'}: ${paradas[0].nombre} → ${paradas.at(-1).nombre}`
      : fuente.soloLectura && visitas.some((v) => !esFechaISO(v.fecha))
        ? 'Este mapa compartido solo trae el año de cada visita.'
        : 'No hay visitas en esas fechas.';
  }
}

/* ======================= Acciones ======================= */

function seleccionar(id, { origen, zoom = false } = {}) {
  if (!datos.porId.has(id)) return;
  estado.seleccion = id;
  estado.editando = null;
  mapa.seleccionar(id);
  if (zoom) mapa.enfocarMunicipio(id);
  renderLugarActual();
  pestanas.activar('lugar');
  // Desde el mapa en móvil no se desplaza la página: el chip permite ir al panel.
  if (origen !== 'mapa' && esMovil()) irAlPanel();
}

function deseleccionar() {
  estado.seleccion = null;
  estado.editando = null;
  mapa.seleccionar(null);
  renderLugarActual();
}

function irAlPanel() {
  $('#panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#titulo-lugar')?.focus({ preventScroll: true });
}

function editarVisita(idVisita) {
  const visita = almacen.obtenerVisita(idVisita);
  if (!visita) return;
  if (estado.seleccion !== visita.divipola) seleccionar(visita.divipola, { origen: 'lista', zoom: true });
  estado.editando = idVisita;
  renderLugarActual();
  pestanas.activar('lugar');
  $('#form-visita input[name="fecha"]')?.focus();
}

function eliminarVisita(idVisita) {
  const eliminada = almacen.eliminarVisita(idVisita);
  if (!eliminada) return;
  if (estado.editando === idVisita) estado.editando = null;
  const nombre = datos.porId.get(eliminada.divipola)?.nombre ?? '';
  mostrarAviso(`Visita a ${nombre} eliminada.`, {
    accion: 'Deshacer',
    alAccion: () => almacen.restaurarVisita(eliminada),
  });
}

function guardarFormulario(form) {
  const valores = leerFormulario(form);
  const error = form.querySelector('.error-form');
  if (!esFechaISO(valores.fecha)) {
    error.textContent = 'Indica una fecha válida.';
    error.hidden = false;
    form.querySelector('input[name="fecha"]').focus();
    return;
  }
  const idVisita = form.dataset.id;
  if (idVisita) {
    almacen.actualizarVisita(idVisita, valores);
    estado.editando = null;
    renderLugarActual();
    mostrarAviso('Cambios guardados.');
  } else {
    almacen.agregarVisita({ divipola: estado.seleccion, ...valores });
    mostrarAviso(`Visita a ${datos.porId.get(estado.seleccion).nombre} guardada.`);
  }
}

function alternarDeseo(divipola) {
  const activo = almacen.alternarDeseo(divipola);
  const nombre = datos.porId.get(divipola)?.nombre ?? '';
  mostrarAviso(activo ? `${nombre} está en tu lista "Quiero ir".` : `${nombre} salió de tu lista de deseos.`, {
    accion: 'Deshacer',
    alAccion: () => almacen.alternarDeseo(divipola, !activo),
  });
}

async function agregarFotosAlLugar(archivos) {
  const divipola = estado.seleccion;
  if (!divipola || !archivos.length) return;
  mostrarAviso(`Procesando ${archivos.length} ${archivos.length === 1 ? 'foto' : 'fotos'}…`, { duracion: 60000 });
  const entradas = [];
  for (const archivo of archivos) entradas.push({ archivo, fecha: await fechaDeFoto(archivo) });
  try {
    const { guardadas, fallidas } = await fotos.agregarFotos(divipola, entradas);
    mostrarAviso(fallidas.length
      ? `${guardadas} guardadas. ${fallidas.length} no se pudieron leer (¿formato HEIC? conviértelas a JPG).`
      : `${guardadas} ${guardadas === 1 ? 'foto guardada' : 'fotos guardadas'}.`);
  } catch (error) {
    console.error(error);
    mostrarAviso('No se pudieron guardar las fotos. ¿Queda espacio en el dispositivo?');
  }
}

async function verFoto(id) {
  const foto = await fotos.obtenerFoto(id);
  if (!foto) return;
  abrirVisor(foto, datos.porId.get(foto.divipola)?.nombre ?? '', (f) => nube.descargarImagen(f));
}

async function eliminarFoto(id) {
  const foto = await fotos.eliminarFoto(id);
  if (!foto) return;
  mostrarAviso('Foto eliminada.', { accion: 'Deshacer', alAccion: () => fotos.restaurarFoto(foto) });
}

function cambiarFiltro(dpto) {
  estado.filtroDepto = dpto;
  $('#filtro-depto').value = dpto;
  mapa.filtrarDepto(dpto);
  renderTodo(false);
}

/* ---------- Datos: exportar / importar / PNG ---------- */

function exportarJSON() {
  const blob = new Blob([almacen.exportarJSON()], { type: 'application/json' });
  descargarBlob(blob, `mi-colombia-${hoyISO()}.json`);
  mostrarAviso('Copia de seguridad descargada (sin fotos).');
}

async function importarArchivo(archivo) {
  let analisis;
  try {
    analisis = almacen.analizarImportacion(await archivo.text(), (id) => datos.porId.has(id));
  } catch (error) {
    mostrarAviso(error.message);
    return;
  }
  if (!analisis.validas.length && !analisis.deseos.length) {
    mostrarAviso('El archivo no contiene visitas válidas.');
    return;
  }
  const dialogo = $('#dialogo-importar');
  dialogo.querySelector('.dialogo-texto').textContent =
    `El archivo trae ${analisis.validas.length} visitas válidas`
    + `${analisis.omitidas ? ` (${analisis.omitidas} omitidas por datos incorrectos)` : ''}`
    + `${analisis.deseos.length ? ` y ${analisis.deseos.length} lugares en la lista de deseos` : ''}. `
    + `Ahora tienes ${almacen.obtenerVisitas().length}. ¿Qué quieres hacer?`;
  dialogo.returnValue = '';
  dialogo.showModal();
  dialogo.addEventListener('close', () => {
    const modo = dialogo.returnValue;
    if (modo !== 'combinar' && modo !== 'reemplazar') return;
    const n = almacen.aplicarImportacion(analisis, modo);
    mostrarAviso(modo === 'reemplazar' ? `Se cargaron ${n} visitas.` : `Se añadieron ${n} visitas nuevas.`);
  }, { once: true });
}

function generarImagenMapa() {
  const ultimas = fuente.ultimas();
  const depto = estado.filtroDepto ? datos.deptos.get(estado.filtroDepto) : null;
  const visitadosDepto = depto ? depto.ids.filter((id) => ultimas.has(id)).length : 0;
  const subtitulo = depto
    ? `${depto.nombre}: ${visitadosDepto} de ${depto.ids.length} municipios visitados (${porcentaje(visitadosDepto, depto.ids.length)})`
    : `${numero(ultimas.size)} de ${numero(datos.total)} municipios visitados (${porcentaje(ultimas.size, datos.total)})`;
  const paleta = leerPaleta();
  return generarPNG({
    datos,
    colorDe: (id) => coloresActuales.get(id) ?? paleta.sinVisitar,
    paleta,
    filtroDepto: estado.filtroDepto,
    titulo: fuente.titulo,
    subtitulo,
    leyenda: leyendaActual,
  });
}

async function descargarPNG() {
  try {
    const blob = await generarImagenMapa();
    descargarBlob(blob, `mi-colombia-${estado.filtroDepto ? `${estado.filtroDepto}-` : ''}${hoyISO()}.png`);
  } catch (error) {
    console.error(error);
    mostrarAviso('No se pudo generar la imagen.');
  }
}

/* ======================= Tema ======================= */

function temaEfectivo() {
  return document.documentElement.dataset.theme
    ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function actualizarBotonTema() {
  const oscuro = temaEfectivo() === 'dark';
  const boton = $('#btn-tema');
  boton.setAttribute('aria-label', oscuro ? 'Activar modo claro' : 'Activar modo oscuro');
  boton.title = boton.getAttribute('aria-label');
  boton.dataset.tema = oscuro ? 'oscuro' : 'claro';
}

function alCambiarTema() {
  actualizarBotonTema();
  if (!mapa) return;
  mapa.refrescarTema();
  renderTodo(false);
}

function iniciarTema() {
  actualizarBotonTema();
  $('#btn-tema').addEventListener('click', () => {
    const nuevo = temaEfectivo() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nuevo;
    almacen.guardarPreferencia('tema', nuevo);
    alCambiarTema();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) alCambiarTema();
  });
}

/* ======================= App instalable (PWA) ======================= */

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker no registrado:', error));

  let aviso = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    aviso = e;
    $('#btn-instalar').hidden = false;
  });
  $('#btn-instalar').addEventListener('click', async () => {
    $('#menu-datos').open = false;
    if (!aviso) return;
    aviso.prompt();
    await aviso.userChoice;
    aviso = null;
    $('#btn-instalar').hidden = true;
  });
  window.addEventListener('appinstalled', () => mostrarAviso('Mi Colombia quedó instalada.'));
}

/* ======================= Eventos ======================= */

function poblarDepartamentos() {
  $('#filtro-depto').insertAdjacentHTML('beforeend', datos.listaDeptos
    .map((d) => `<option value="${esc(d.id)}">${esc(d.nombre)}</option>`).join(''));
}

function conectarEventos() {
  $('#filtro-depto').addEventListener('change', (e) => cambiarFiltro(e.target.value));

  document.querySelectorAll('input[name="modo"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      estado.modo = radio.value;
      almacen.guardarPreferencia('modo', estado.modo);
      renderTodo(true);
    });
  });

  // Capas y modo viaje
  document.querySelectorAll('input[name="capa"]').forEach((casilla) => {
    casilla.addEventListener('change', () => alternarCapa(casilla.value, casilla.checked));
  });
  for (const [campo, clave] of [['#ruta-desde', 'desde'], ['#ruta-hasta', 'hasta']]) {
    $(campo).addEventListener('change', (e) => {
      estado.ruta[clave] = e.target.value;
      actualizarModoViaje();
    });
  }

  // Delegación: todas las acciones del panel lateral.
  $('#panel').addEventListener('click', (e) => {
    const objetivo = e.target.closest('[data-accion]');
    if (!objetivo) return;
    const { accion, id, dpto, divipola } = objetivo.dataset;
    const editable = !fuente.soloLectura;
    switch (accion) {
      case 'marcar-hoy':
        if (!editable) break;
        almacen.agregarVisita({ divipola: estado.seleccion, fecha: hoyISO() });
        mostrarAviso(`${datos.porId.get(estado.seleccion).nombre} marcado como visitado.`);
        break;
      case 'alternar-deseo': if (editable) alternarDeseo(divipola ?? estado.seleccion); break;
      case 'editar': if (editable) editarVisita(id); break;
      case 'eliminar': if (editable) eliminarVisita(id); break;
      case 'cancelar-edicion':
        estado.editando = null;
        renderLugarActual();
        break;
      case 'quitar-calificacion': {
        const fieldset = objetivo.closest('.estrellas');
        fieldset.querySelectorAll('input').forEach((i) => { i.checked = false; });
        fieldset.dataset.valor = '0';
        break;
      }
      case 'agregar-fotos': $('#archivo-fotos-lugar').click(); break;
      case 'ver-foto': verFoto(id); break;
      case 'eliminar-foto': eliminarFoto(id); break;
      case 'filtrar-depto': cambiarFiltro(estado.filtroDepto === dpto ? '' : dpto); break;
      case 'ver': seleccionar(divipola, { origen: 'lista', zoom: true }); break;
      default:
    }
  });

  $('#panel').addEventListener('change', (e) => {
    if (e.target.name === 'calificacion') e.target.closest('.estrellas').dataset.valor = e.target.value;
  });

  $('#panel').addEventListener('submit', (e) => {
    if (e.target.id !== 'form-visita') return;
    e.preventDefault();
    guardarFormulario(e.target);
  });

  // Chip móvil
  $('#chip-seleccion .chip-ir').addEventListener('click', irAlPanel);
  $('#chip-seleccion .chip-cerrar').addEventListener('click', deseleccionar);

  // Menú de datos
  const menus = [...document.querySelectorAll('details.menu')];
  const cerrarMenus = () => menus.forEach((m) => { m.open = false; });
  const enMenu = (fn) => () => { cerrarMenus(); fn(); };
  $('#btn-compartir').addEventListener('click', enMenu(() => compartir.abrir()));
  $('#btn-png').addEventListener('click', enMenu(descargarPNG));
  $('#btn-exportar').addEventListener('click', enMenu(exportarJSON));
  $('#btn-importar').addEventListener('click', enMenu(() => $('#archivo-importar').click()));
  $('#btn-importar-google').addEventListener('click', enMenu(() => importacion?.inicioGoogle()));
  $('#btn-importar-fotos').addEventListener('click', enMenu(() => importacion?.inicioFotos()));

  const alElegirArchivos = (selector, fn) => {
    $(selector).addEventListener('change', (e) => {
      const archivos = [...(e.target.files ?? [])];
      e.target.value = '';
      if (archivos.length) fn(archivos);
    });
  };
  alElegirArchivos('#archivo-importar', ([archivo]) => importarArchivo(archivo));
  alElegirArchivos('#archivo-google', (archivos) => importacion?.importarGoogle(archivos));
  alElegirArchivos('#archivo-fotos-importar', (archivos) => importacion?.importarFotos(archivos));
  alElegirArchivos('#archivo-fotos-lugar', agregarFotosAlLugar);

  document.addEventListener('click', (e) => {
    for (const m of menus) if (m.open && !m.contains(e.target)) m.open = false;
    // Botones "cerrar" de los diálogos
    const cerrar = e.target.closest('[data-cerrar]');
    if (cerrar) cerrar.closest('dialog')?.close();
    // Clic en el fondo oscuro de un diálogo (fuera de su caja): cerrarlo
    if (e.target instanceof HTMLDialogElement && e.target.open && e.target.id !== 'dialogo-importar') {
      const r = e.target.getBoundingClientRect();
      const fuera = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (fuera && e.clientX + e.clientY > 0) e.target.close();
    }
  });
  // Al abrir un menú, cerrar el otro.
  menus.forEach((m) => m.addEventListener('toggle', () => {
    if (m.open) menus.filter((o) => o !== m).forEach((o) => { o.open = false; });
  }));

  // Esc: cierra el menú o quita la selección (si no se está escribiendo).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const abierto = menus.find((m) => m.open);
    if (abierto) { abierto.open = false; abierto.querySelector('summary').focus(); return; }
    const escribiendo = e.target.closest('input, textarea, select, dialog');
    if (!escribiendo && estado.seleccion) deseleccionar();
  });
}

iniciar();
