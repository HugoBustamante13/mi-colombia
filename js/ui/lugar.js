/**
 * Panel "Lugar": ficha del municipio seleccionado, sus visitas y el formulario.
 * Solo genera HTML; los eventos se manejan por delegación en main.js
 * mediante atributos data-accion.
 */
import { esc, formatearFecha, estrellasHTML, hoyISO } from '../utils.js';

export function renderLugar(el, { municipio, visitas, editando, deseo = false, soloLectura = false, conFotos = true }) {
  if (!municipio) {
    el.innerHTML = `
      <div class="vacio">
        <p><strong>Ningún lugar seleccionado.</strong></p>
        <p>Haz clic en un municipio del mapa o búscalo por nombre para registrar una visita.</p>
      </div>`;
    return;
  }

  const visitado = visitas.length > 0;
  const ultima = visitas[0];
  const enEdicion = editando ? visitas.find((v) => v.id === editando) : null;
  const valores = enEdicion ?? { fecha: hoyISO(), notas: '', calificacion: null };

  el.innerHTML = `
    <header class="ficha">
      <h2 id="titulo-lugar" tabindex="-1">${esc(municipio.nombre)}</h2>
      <p class="ficha-meta">${esc(municipio.dptoNombre)} · ${esc(municipio.tipo)} · DIVIPOLA ${esc(municipio.id)}</p>
      <p class="ficha-estado">
        <span class="insignia ${visitado ? 'insignia-visitado' : 'insignia-pendiente'}">
          ${visitado ? 'Visitado' : 'Pendiente'}
        </span>
        ${!visitado && deseo ? '<span class="insignia insignia-deseo">Quiero ir</span>' : ''}
        ${visitado ? `<span>Última visita: ${formatearFecha(ultima.fecha)}</span>` : ''}
      </p>
      ${soloLectura ? '' : `
        <div class="fila-botones ficha-botones">
          ${visitado ? '' : `
            <button type="button" class="btn primario" data-accion="marcar-hoy">
              Marcar como visitado hoy
            </button>`}
          <button type="button" class="btn btn-deseo" data-accion="alternar-deseo" aria-pressed="${deseo}">
            <span aria-hidden="true">${deseo ? '★' : '☆'}</span> ${deseo ? 'En mi lista de deseos' : 'Quiero ir'}
          </button>
        </div>`}
    </header>

    ${visitado ? `
      <section class="bloque" aria-labelledby="titulo-visitas-lugar">
        <h3 id="titulo-visitas-lugar">Visitas (${visitas.length})</h3>
        <ul class="visitas-lugar">
          ${visitas.map((v) => `
            <li class="visita ${v.id === editando ? 'editando' : ''}">
              <div class="visita-cabecera">
                <time datetime="${esc(v.fecha)}">${formatearFecha(v.fecha)}</time>
                ${estrellasHTML(v.calificacion)}
              </div>
              ${v.notas ? `<p class="visita-notas">${esc(v.notas)}</p>` : ''}
              ${soloLectura ? '' : `<div class="visita-acciones">
                <button type="button" class="btn-texto" data-accion="editar" data-id="${esc(v.id)}"
                  aria-label="Editar visita del ${formatearFecha(v.fecha)}">Editar</button>
                <button type="button" class="btn-texto peligro" data-accion="eliminar" data-id="${esc(v.id)}"
                  aria-label="Eliminar visita del ${formatearFecha(v.fecha)}">Eliminar</button>
              </div>`}
            </li>`).join('')}
        </ul>
      </section>` : ''}

    ${conFotos && !soloLectura ? `
      <section class="bloque" aria-labelledby="titulo-fotos">
        <div class="bloque-cabecera">
          <h3 id="titulo-fotos">Fotos</h3>
          <button type="button" class="btn-texto" data-accion="agregar-fotos">Agregar fotos</button>
        </div>
        <div id="galeria-lugar" class="galeria" aria-live="polite"></div>
      </section>` : ''}

    ${soloLectura ? '' : `<form class="bloque form-visita" id="form-visita" data-id="${esc(enEdicion?.id ?? '')}" novalidate>
      <h3>${enEdicion ? 'Editar visita' : visitado ? 'Agregar otra visita' : 'Registrar visita'}</h3>
      <label class="campo">
        <span>Fecha de la visita</span>
        <input type="date" name="fecha" required value="${esc(valores.fecha)}">
      </label>
      <fieldset class="campo estrellas" data-valor="${valores.calificacion ?? 0}">
        <legend>Calificación</legend>
        <div class="estrellas-fila">
          ${[1, 2, 3, 4, 5].map((n) => `
            <input type="radio" id="estrella-${n}" name="calificacion" value="${n}"
              ${valores.calificacion === n ? 'checked' : ''}>
            <label for="estrella-${n}" title="${n} de 5">
              <span aria-hidden="true">★</span><span class="sr-only">${n} ${n === 1 ? 'estrella' : 'estrellas'}</span>
            </label>`).join('')}
          <button type="button" class="btn-texto" data-accion="quitar-calificacion">Quitar</button>
        </div>
      </fieldset>
      <label class="campo">
        <span>Notas</span>
        <textarea name="notas" rows="3" maxlength="2000"
          placeholder="¿Qué hiciste, con quién fuiste, qué recomiendas?">${esc(valores.notas)}</textarea>
      </label>
      <p class="error-form" role="alert" hidden></p>
      <div class="fila-botones">
        <button type="submit" class="btn primario">${enEdicion ? 'Guardar cambios' : 'Guardar visita'}</button>
        ${enEdicion ? '<button type="button" class="btn" data-accion="cancelar-edicion">Cancelar</button>' : ''}
      </div>
    </form>`}`;
}

/** Lee el formulario y devuelve { fecha, notas, calificacion }. */
export function leerFormulario(form) {
  const datos = new FormData(form);
  const cal = Number(datos.get('calificacion'));
  return {
    fecha: String(datos.get('fecha') ?? ''),
    notas: String(datos.get('notas') ?? '').trim(),
    calificacion: cal >= 1 && cal <= 5 ? cal : null,
  };
}
