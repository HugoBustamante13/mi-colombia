/**
 * Panel de estadísticas: cifras clave, visitas por año y avance por departamento.
 */
import { esc, numero, porcentaje, anioDe } from '../utils.js';

export function renderEstadisticas(el, { datos, ultimas, visitas, filtroDepto, deseos = new Set() }) {
  const visitados = ultimas.size;
  const visitadosPorDepto = new Map();
  for (const id of ultimas.keys()) {
    const dpto = datos.porId.get(id)?.dpto;
    if (dpto) visitadosPorDepto.set(dpto, (visitadosPorDepto.get(dpto) ?? 0) + 1);
  }

  const filas = datos.listaDeptos
    .map((d) => ({ ...d, total: d.ids.length, visitados: visitadosPorDepto.get(d.id) ?? 0 }))
    .sort((a, b) => b.visitados / b.total - a.visitados / a.total || a.nombre.localeCompare(b.nombre, 'es'));

  const deptoActivo = filtroDepto ? filas.find((f) => f.id === filtroDepto) : null;

  el.innerHTML = `
    ${deptoActivo ? `
      <div class="resumen-depto">
        <p class="resumen-depto-titulo">${esc(deptoActivo.nombre)}</p>
        <p><strong>${numero(deptoActivo.visitados)}</strong> de ${numero(deptoActivo.total)} municipios
          · ${porcentaje(deptoActivo.visitados, deptoActivo.total)}</p>
      </div>` : ''}

    <dl class="cifras">
      <div class="cifra">
        <dt>Municipios visitados</dt>
        <dd><strong>${numero(visitados)}</strong> <span>de ${numero(datos.total)}</span></dd>
      </div>
      <div class="cifra">
        <dt>Del país</dt>
        <dd><strong>${porcentaje(visitados, datos.total)}</strong></dd>
      </div>
      <div class="cifra">
        <dt>Departamentos</dt>
        <dd><strong>${visitadosPorDepto.size}</strong> <span>de ${datos.listaDeptos.length}</span></dd>
      </div>
      <div class="cifra">
        <dt>Visitas registradas</dt>
        <dd><strong>${numero(visitas.length)}</strong></dd>
      </div>
      <div class="cifra">
        <dt>Quiero ir</dt>
        <dd><strong>${numero([...deseos].filter((id) => !ultimas.has(id)).length)}</strong> <span>pendientes</span></dd>
      </div>
      <div class="cifra">
        <dt>Deseos cumplidos</dt>
        <dd><strong>${numero([...deseos].filter((id) => ultimas.has(id)).length)}</strong></dd>
      </div>
    </dl>

    <section class="bloque" aria-labelledby="titulo-anios">
      <h3 id="titulo-anios">Visitas por año</h3>
      ${graficoAnios(visitas)}
    </section>

    <section class="bloque" aria-labelledby="titulo-deptos">
      <h3 id="titulo-deptos">Avance por departamento</h3>
      <p class="ayuda">Toca un departamento para filtrar el mapa.</p>
      <ol class="lista-deptos">
        ${filas.map((f) => {
          const pct = (f.visitados / f.total) * 100;
          const ancho = f.visitados ? Math.max(pct, 2) : 0;
          return `
            <li>
              <button type="button" class="fila-depto ${f.id === filtroDepto ? 'activa' : ''}"
                data-accion="filtrar-depto" data-dpto="${esc(f.id)}"
                aria-pressed="${f.id === filtroDepto}"
                aria-label="${esc(f.nombre)}: ${f.visitados} de ${f.total} municipios (${porcentaje(f.visitados, f.total)}). Filtrar mapa.">
                <span class="fila-depto-nombre">${esc(f.nombre)}</span>
                <span class="fila-depto-cifra">${f.visitados}/${f.total}</span>
                <span class="pista" aria-hidden="true"><span class="relleno" style="width:${ancho}%"></span></span>
              </button>
            </li>`;
        }).join('')}
      </ol>
    </section>`;
}

/** Barras verticales por año, del primero al último con visitas (incluye años sin visitas). */
function graficoAnios(visitas) {
  if (!visitas.length) {
    return '<p class="ayuda">Cuando registres visitas verás aquí tu línea de tiempo.</p>';
  }
  const conteo = new Map();
  for (const v of visitas) {
    const a = anioDe(v.fecha);
    conteo.set(a, (conteo.get(a) ?? 0) + 1);
  }
  const min = Math.min(...conteo.keys());
  const max = Math.max(...conteo.keys());
  const anios = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const tope = Math.max(...conteo.values());
  // Con muchos años se muestran etiquetas alternas para que no se encimen.
  const salto = Math.ceil(anios.length / 10);
  const etiquetarValores = anios.length <= 12;

  return `
    <div class="grafico-anios" role="list" aria-label="Número de visitas por año">
      ${anios.map((a, i) => {
        const n = conteo.get(a) ?? 0;
        const texto = `${a}: ${n} ${n === 1 ? 'visita' : 'visitas'}`;
        const mostrarAnio = i % salto === 0 || i === anios.length - 1;
        return `
          <div class="barra-anio" role="listitem" tabindex="0" aria-label="${texto}" data-tooltip="${texto}">
            <span class="barra-valor">${etiquetarValores && n ? n : ''}</span>
            <span class="barra-columna" style="height:${(n / tope) * 100}%"></span>
            <span class="barra-etiqueta">${mostrarAnio ? a : ''}</span>
          </div>`;
      }).join('')}
    </div>`;
}
