/**
 * Asistente para importar visitas desde la línea de tiempo de Google Maps o desde fotos.
 * Pasos: leer archivos → ubicar puntos en municipios → vista previa con casillas → importar.
 */
import { esc, formatearFecha, numero } from '../utils.js';
import { extraerPuntosGoogle, extraerPuntosFotos, agruparEnVisitas } from '../importar-externo.js';

/**
 * @param {object} p
 * @param {object} p.datos
 * @param {{ buscar: Function }} p.indice     geo.crearIndice()
 * @param {object} p.almacen                  storage.js
 * @param {object} p.fotos                    fotos.js
 * @param {(m: string) => void} p.mostrarAviso
 */
export function iniciarImportacion({ datos, indice, almacen, fotos, mostrarAviso }) {
  const dialogo = document.getElementById('dialogo-externo');
  const cuerpo = document.getElementById('externo-cuerpo');
  const titulo = document.getElementById('externo-titulo');

  let sesion = null; // { origen, puntos, formato, incluirRecorridos, guardarFotos, resultado, seleccion }

  const progreso = (texto) => {
    cuerpo.innerHTML = `<p class="progreso" role="status"><span class="girando" aria-hidden="true"></span>${esc(texto)}</p>`;
  };

  function abrir(texto) {
    titulo.textContent = texto;
    if (!dialogo.open) dialogo.showModal();
  }

  async function agrupar() {
    progreso('Ubicando lugares en el mapa…');
    sesion.resultado = await agruparEnVisitas(sesion.puntos, indice, {
      incluirRecorridos: sesion.incluirRecorridos,
      alProgreso: (n, total) => progreso(`Ubicando lugares en el mapa… ${Math.round((n / total) * 100)} %`),
    });
    sesion.seleccion = new Set(sesion.resultado.visitas.map((v) => v.divipola));
    pintarVistaPrevia();
  }

  function pintarVistaPrevia() {
    const { visitas, fuera } = sesion.resultado;
    const ultimas = almacen.ultimaFechaPorMunicipio();
    const porMunicipio = new Map();
    for (const v of visitas) {
      if (!porMunicipio.has(v.divipola)) porMunicipio.set(v.divipola, []);
      porMunicipio.get(v.divipola).push(v);
    }
    const filas = [...porMunicipio].map(([id, vs]) => ({ m: datos.porId.get(id), vs }))
      .sort((a, b) => a.m.dptoNombre.localeCompare(b.m.dptoNombre, 'es') || a.m.nombre.localeCompare(b.m.nombre, 'es'));
    const hayParadas = sesion.puntos.some((p) => p.tipo === 'parada');
    const hayRecorridos = sesion.puntos.some((p) => p.tipo === 'recorrido');
    const nuevos = filas.filter((f) => !ultimas.has(f.m.id)).length;

    cuerpo.innerHTML = `
      <p>${sesion.formato ? `${esc(sesion.formato)}: ` : ''}<strong>${numero(visitas.length)}</strong>
        ${visitas.length === 1 ? 'visita' : 'visitas'} en <strong>${numero(filas.length)}</strong> municipios
        (${numero(nuevos)} nuevos para tu mapa).
        ${fuera ? `<span class="ayuda">${numero(fuera)} puntos quedaron fuera de Colombia.</span>` : ''}</p>
      ${hayParadas && hayRecorridos ? `
        <label class="interruptor"><input type="checkbox" data-opcion="recorridos" ${sesion.incluirRecorridos ? 'checked' : ''}>
          Incluir municipios por los que solo pasaste en carretera</label>` : ''}
      ${sesion.origen === 'fotos' ? `
        <label class="interruptor"><input type="checkbox" data-opcion="fotos" ${sesion.guardarFotos ? 'checked' : ''}>
          Guardar también las fotos en cada lugar</label>` : ''}
      <p class="ayuda">Los días seguidos en un mismo municipio cuentan como una sola visita. No se duplican
        visitas que ya tengas en la misma fecha.</p>
      ${filas.length ? `
        <div class="fila-botones">
          <button type="button" class="btn-texto" data-accion-imp="todos">Marcar todos</button>
          <button type="button" class="btn-texto" data-accion-imp="ninguno">Ninguno</button>
          <button type="button" class="btn-texto" data-accion-imp="nuevos">Solo nuevos</button>
        </div>
        <ul class="lista-importacion">
          ${filas.map(({ m, vs }) => `
            <li>
              <label>
                <input type="checkbox" data-divipola="${esc(m.id)}" ${sesion.seleccion.has(m.id) ? 'checked' : ''}>
                <span class="imp-nombre">${esc(m.nombre)} <span class="visita-meta">${esc(m.dptoNombre)}</span></span>
                <span class="imp-fechas">${vs.length === 1 ? formatearFecha(vs[0].fecha)
                  : `${vs.length} visitas · ${formatearFecha(vs.at(-1).fecha)} – ${formatearFecha(vs[0].fecha)}`}</span>
                ${ultimas.has(m.id) ? '<span class="insignia insignia-visitado">Ya en tu mapa</span>' : ''}
              </label>
            </li>`).join('')}
        </ul>` : '<p class="vacio">No encontramos lugares en Colombia en estos archivos.</p>'}
      <div class="fila-botones dialogo-pie">
        <button type="button" class="btn primario" data-accion-imp="importar" ${filas.length ? '' : 'disabled'}>
          Importar ${numero(visitas.filter((v) => sesion.seleccion.has(v.divipola)).length)} visitas</button>
        <button type="button" class="btn" data-cerrar>Cancelar</button>
      </div>`;
  }

  async function importar() {
    const { visitas, archivosPorMunicipio } = sesion.resultado;
    const nota = sesion.origen === 'fotos' ? 'Importada desde fotos' : 'Importada de Google Maps';
    const elegidas = visitas.filter((v) => sesion.seleccion.has(v.divipola))
      .map((v) => ({ divipola: v.divipola, fecha: v.fecha, notas: nota }));
    progreso('Guardando visitas…');
    const n = almacen.agregarVisitasNuevas(elegidas);

    let guardadas = 0;
    if (sesion.origen === 'fotos' && sesion.guardarFotos) {
      const grupos = [...archivosPorMunicipio].filter(([id]) => sesion.seleccion.has(id));
      let hechos = 0;
      for (const [divipola, entradas] of grupos) {
        progreso(`Guardando fotos… ${++hechos} de ${grupos.length} lugares`);
        guardadas += (await fotos.agregarFotos(divipola, entradas)).guardadas;
      }
    }
    dialogo.close();
    mostrarAviso(`Se añadieron ${n} visitas${guardadas ? ` y ${guardadas} fotos` : ''}.`);
    sesion = null;
  }

  cuerpo.addEventListener('change', (e) => {
    if (!sesion) return;
    const t = e.target;
    if (t.dataset.opcion === 'recorridos') {
      sesion.incluirRecorridos = t.checked;
      agrupar();
    } else if (t.dataset.opcion === 'fotos') {
      sesion.guardarFotos = t.checked;
    } else if (t.dataset.divipola) {
      if (t.checked) sesion.seleccion.add(t.dataset.divipola);
      else sesion.seleccion.delete(t.dataset.divipola);
      const n = sesion.resultado.visitas.filter((v) => sesion.seleccion.has(v.divipola)).length;
      cuerpo.querySelector('[data-accion-imp="importar"]').textContent = `Importar ${numero(n)} visitas`;
    }
  });

  cuerpo.addEventListener('click', (e) => {
    const selector = e.target.closest('[data-elegir]')?.dataset.elegir;
    if (selector) { document.getElementById(selector).click(); return; }
    const accion = e.target.closest('[data-accion-imp]')?.dataset.accionImp;
    if (!accion || !sesion) return;
    const ultimas = almacen.ultimaFechaPorMunicipio();
    const ids = sesion.resultado.visitas.map((v) => v.divipola);
    if (accion === 'todos') sesion.seleccion = new Set(ids);
    if (accion === 'ninguno') sesion.seleccion = new Set();
    if (accion === 'nuevos') sesion.seleccion = new Set(ids.filter((id) => !ultimas.has(id)));
    if (accion === 'importar') { importar(); return; }
    pintarVistaPrevia();
  });

  dialogo.addEventListener('close', () => { sesion = null; });

  async function importarGoogle(archivos) {
    abrir('Importar de Google Maps');
    const puntos = [];
    const formatos = new Set();
    try {
      for (const [i, archivo] of [...archivos].entries()) {
        progreso(`Leyendo ${archivo.name} (${i + 1} de ${archivos.length})…`);
        const { formato, puntos: p } = extraerPuntosGoogle(await archivo.text());
        formatos.add(formato);
        for (const x of p) puntos.push(x);
      }
    } catch (error) {
      cuerpo.innerHTML = `<p class="error-form">${esc(error.message)}</p>${ayudaGoogle()}`;
      return;
    }
    sesion = {
      origen: 'google',
      puntos,
      formato: [...formatos].join(', '),
      incluirRecorridos: !puntos.some((p) => p.tipo === 'parada'),
      guardarFotos: false,
    };
    await agrupar();
  }

  async function importarFotos(archivos) {
    abrir('Importar desde fotos');
    progreso('Leyendo ubicación de las fotos…');
    let puntos;
    try {
      puntos = await extraerPuntosFotos([...archivos],
        (n, total) => progreso(`Leyendo ubicación de las fotos… ${n} de ${total}`));
    } catch (error) {
      cuerpo.innerHTML = `<p class="error-form">${esc(error.message)}</p>`;
      return;
    }
    const sinGps = archivos.length - puntos.length;
    sesion = {
      origen: 'fotos',
      puntos: puntos.map((p) => ({ ...p, tipo: 'parada' })),
      formato: `${numero(puntos.length)} fotos con ubicación${sinGps ? ` (${numero(sinGps)} sin GPS)` : ''}`,
      incluirRecorridos: false,
      guardarFotos: true,
    };
    await agrupar();
  }

  function inicio(textoTitulo, explicacion, idEntrada) {
    sesion = null;
    abrir(textoTitulo);
    cuerpo.innerHTML = `${explicacion}
      <div class="fila-botones dialogo-pie">
        <button type="button" class="btn primario" data-elegir="${idEntrada}">Elegir archivos…</button>
        <button type="button" class="btn" data-cerrar>Cancelar</button>
      </div>`;
  }

  const inicioGoogle = () => inicio('Importar de Google Maps', `
    <p>Convierte tu línea de tiempo de Google Maps en visitas. El archivo se lee en tu navegador:
      no se sube a ningún servidor.</p>${ayudaGoogle()}`, 'archivo-google');

  const inicioFotos = () => inicio('Importar desde fotos', `
    <p>Elige fotos de tus viajes: con la ubicación GPS y la fecha guardadas en cada foto
      sabremos qué municipios visitaste y cuándo. Puedes elegir cientos a la vez.</p>
    <p class="ayuda">Las fotos se leen en tu navegador. Si el teléfono quitó la ubicación al
      compartirlas (WhatsApp lo hace), cópialas directamente desde la cámara o la galería.</p>`,
  'archivo-fotos-importar');

  return { inicioGoogle, inicioFotos, importarGoogle, importarFotos };
}

function ayudaGoogle() {
  return `
    <div class="ayuda-bloque">
      <p><strong>¿Cómo obtengo el archivo?</strong></p>
      <ul>
        <li><strong>Android:</strong> Ajustes → Ubicación → Servicios de ubicación → Cronología →
          <em>Exportar datos de Cronología</em>. Se genera <code>Timeline.json</code>.</li>
        <li><strong>iPhone:</strong> Google Maps → tu foto → Cronología → ⋯ → Configuración →
          <em>Exportar datos de Cronología</em>.</li>
        <li><strong>Copia antigua de Google Takeout:</strong> usa los archivos de
          <code>Semantic Location History</code> o <code>Records.json</code>.</li>
      </ul>
    </div>`;
}
