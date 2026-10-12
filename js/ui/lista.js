/**
 * Lista de visitas ordenada por fecha (más reciente primero), agrupada por año,
 * precedida por la lista de deseos ("Quiero ir") pendientes.
 */
import { esc, formatearFecha, estrellasHTML, anioDe } from '../utils.js';

/** Lugares de la lista de deseos que aún no se visitan. */
function seccionDeseos({ deseos, ultimas, datos, filtroDepto, soloLectura }) {
  const pendientes = [...deseos]
    .filter((id) => !ultimas.has(id) && datos.porId.has(id))
    .map((id) => datos.porId.get(id))
    .filter((m) => !filtroDepto || m.dpto === filtroDepto)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (!pendientes.length) return '';
  return `
    <details class="bloque-deseos" open>
      <summary>Quiero ir <span class="contador">${pendientes.length}</span></summary>
      <ul class="lista-deseos">
        ${pendientes.map((m) => `
          <li>
            <button type="button" class="enlace-lugar" data-accion="ver" data-divipola="${esc(m.id)}">${esc(m.nombre)}</button>
            <span class="visita-meta">${esc(m.dptoNombre)}</span>
            ${soloLectura ? '' : `<button type="button" class="btn-texto" data-accion="alternar-deseo" data-divipola="${esc(m.id)}"
              aria-label="Quitar ${esc(m.nombre)} de la lista de deseos">Quitar</button>`}
          </li>`).join('')}
      </ul>
    </details>`;
}

export function renderLista(el, {
  visitas, datos, filtroDepto, deseos = new Set(), ultimas = new Map(), soloLectura = false,
}) {
  const filtradas = filtroDepto
    ? visitas.filter((v) => datos.porId.get(v.divipola)?.dpto === filtroDepto)
    : visitas;

  const nota = (filtroDepto
    ? `<p class="ayuda">Mostrando solo ${esc(datos.deptos.get(filtroDepto)?.nombre ?? '')}.</p>`
    : '') + seccionDeseos({ deseos, ultimas, datos, filtroDepto, soloLectura });

  if (!filtradas.length) {
    el.innerHTML = `${nota}
      <div class="vacio">
        <p><strong>${visitas.length ? 'No hay visitas en este departamento.' : 'Todavía no hay visitas.'}</strong></p>
        ${soloLectura ? '' : '<p>Selecciona un municipio en el mapa y registra tu primera visita.</p>'}
      </div>`;
    return;
  }

  // Agrupar por año manteniendo el orden descendente.
  const grupos = [];
  for (const v of filtradas) {
    const a = anioDe(v.fecha);
    if (grupos.at(-1)?.anio !== a) grupos.push({ anio: a, visitas: [] });
    grupos.at(-1).visitas.push(v);
  }

  el.innerHTML = `${nota}
    <p class="ayuda">${filtradas.length} ${filtradas.length === 1 ? 'visita' : 'visitas'}</p>
    ${grupos.map((g) => `
      <section class="grupo-anio" aria-labelledby="anio-${g.anio}">
        <h3 id="anio-${g.anio}" class="grupo-anio-titulo">${g.anio}</h3>
        <ul class="lista-visitas">
          ${g.visitas.map((v) => {
            const m = datos.porId.get(v.divipola);
            return `
              <li class="visita">
                <div class="visita-cabecera">
                  <button type="button" class="enlace-lugar" data-accion="ver" data-divipola="${esc(v.divipola)}">
                    ${esc(m?.nombre ?? v.divipola)}
                  </button>
                  ${estrellasHTML(v.calificacion)}
                </div>
                <p class="visita-meta">
                  ${esc(m?.dptoNombre ?? '')} · <time datetime="${esc(v.fecha)}">${formatearFecha(v.fecha)}</time>
                </p>
                ${v.notas ? `<p class="visita-notas">${esc(v.notas)}</p>` : ''}
                ${soloLectura ? '' : `<div class="visita-acciones">
                  <button type="button" class="btn-texto" data-accion="editar" data-id="${esc(v.id)}"
                    aria-label="Editar visita a ${esc(m?.nombre ?? '')} del ${formatearFecha(v.fecha)}">Editar</button>
                  <button type="button" class="btn-texto peligro" data-accion="eliminar" data-id="${esc(v.id)}"
                    aria-label="Eliminar visita a ${esc(m?.nombre ?? '')} del ${formatearFecha(v.fecha)}">Eliminar</button>
                </div>`}
              </li>`;
          }).join('')}
        </ul>
      </section>`).join('')}`;
}
