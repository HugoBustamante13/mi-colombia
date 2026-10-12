/**
 * Panel "Retos": logros con barra de avance y, cuando son pocos, los lugares que faltan.
 */
import { esc, numero } from '../utils.js';

function tarjeta(l, datos) {
  const pct = l.meta ? Math.min(100, (l.actual / l.meta) * 100) : 0;
  const niveles = l.niveles
    ? `<span class="reto-nivel">Nivel ${l.nivel} de ${l.niveles}</span>`
    : '';
  const faltan = l.pendientes?.length && !l.completado
    ? `
      <details class="reto-pendientes">
        <summary>Faltan ${l.pendientes.length}</summary>
        <ul>
          ${l.pendientes.map((id) => {
            const m = datos.porId.get(id);
            return `<li><button type="button" class="enlace-lugar" data-accion="ver" data-divipola="${esc(id)}">${esc(m?.nombre ?? id)}</button>
              <span class="visita-meta">${esc(m?.dptoNombre ?? '')}</span></li>`;
          }).join('')}
        </ul>
      </details>`
    : '';
  const faltanDeptos = l.pendientesDeptos?.length && !l.completado
    ? `
      <details class="reto-pendientes">
        <summary>Faltan ${l.pendientesDeptos.length}</summary>
        <ul>
          ${l.pendientesDeptos.map((d) => `<li><button type="button" class="enlace-lugar" data-accion="filtrar-depto"
            data-dpto="${esc(d)}">${esc(datos.deptos.get(d)?.nombre ?? d)}</button></li>`).join('')}
        </ul>
      </details>`
    : '';

  return `
    <li class="reto ${l.completado ? 'reto-completo' : ''}">
      <div class="reto-cabecera">
        <span class="reto-medalla" aria-hidden="true">${l.completado ? '★' : l.nivel ? '✦' : '○'}</span>
        <div>
          <p class="reto-titulo">${esc(l.titulo)}${l.completado ? ' <span class="sr-only">(completado)</span>' : ''}</p>
          <p class="reto-desc">${esc(l.descripcion)}</p>
        </div>
      </div>
      <div class="reto-avance">
        <span class="pista" aria-hidden="true"><span class="relleno" style="width:${pct}%"></span></span>
        <span class="reto-cifra">${numero(l.actual)} / ${numero(l.meta)}</span>
      </div>
      ${niveles}
      ${faltan}${faltanDeptos}
    </li>`;
}

export function renderRetos(el, { logros, datos }) {
  const principales = logros.filter((l) => !l.grupo);
  const regiones = logros.filter((l) => l.grupo === 'regiones');
  const completos = logros.filter((l) => l.completado).length;

  el.innerHTML = `
    <p class="ayuda">${completos} de ${logros.length} retos completados. Se recalculan con cada visita.</p>
    <ul class="retos">${principales.map((l) => tarjeta(l, datos)).join('')}</ul>
    <section class="bloque" aria-labelledby="titulo-regiones">
      <h3 id="titulo-regiones">Regiones completas</h3>
      <ul class="retos">${regiones.map((l) => tarjeta(l, datos)).join('')}</ul>
    </section>`;
}
