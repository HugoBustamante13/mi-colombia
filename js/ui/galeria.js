/**
 * Galería de fotos de un lugar y visor a pantalla completa.
 * Las imágenes vienen de IndexedDB como Blob; se muestran con URLs de objeto
 * que se liberan en cada nuevo pintado para no acumular memoria.
 */
import { esc, formatearFecha } from '../utils.js';

let urlsVivas = [];

function liberar() {
  urlsVivas.forEach((u) => URL.revokeObjectURL(u));
  urlsVivas = [];
}

function urlDe(blob) {
  const url = URL.createObjectURL(blob);
  urlsVivas.push(url);
  return url;
}

/** @param {object[]} fotos  registros de fotos.js (sin borrar) */
export function renderGaleria(el, fotos) {
  liberar();
  if (!el) return;
  if (!fotos.length) {
    el.innerHTML = '<p class="ayuda">Guarda aquí tus fotos de este lugar. Se quedan en este dispositivo (y en tu cuenta, si sincronizas).</p>';
    return;
  }
  el.innerHTML = `
    <ul class="galeria-lista">
      ${fotos.map((f) => `
        <li>
          <button type="button" class="miniatura" data-accion="ver-foto" data-id="${esc(f.id)}"
            aria-label="Ver foto${f.fecha ? ` del ${formatearFecha(f.fecha)}` : ''}">
            ${f.miniatura
              ? `<img src="${urlDe(f.miniatura)}" alt="" loading="lazy" width="120" height="120">`
              : '<span class="miniatura-vacia" aria-hidden="true">⌛</span>'}
          </button>
          <button type="button" class="miniatura-borrar" data-accion="eliminar-foto" data-id="${esc(f.id)}"
            aria-label="Eliminar foto${f.fecha ? ` del ${formatearFecha(f.fecha)}` : ''}">✕</button>
        </li>`).join('')}
    </ul>`;
}

let urlVisor = null;

/** Abre el visor. `obtenerImagen` devuelve el Blob grande (puede descargarlo de la nube). */
export async function abrirVisor(foto, titulo, obtenerImagen) {
  const dialogo = document.getElementById('dialogo-foto');
  const img = dialogo.querySelector('img');
  const pie = dialogo.querySelector('figcaption');
  if (urlVisor) URL.revokeObjectURL(urlVisor);
  urlVisor = null;
  pie.textContent = [titulo, foto.fecha ? formatearFecha(foto.fecha) : ''].filter(Boolean).join(' · ');
  img.alt = `Foto de ${titulo}`;
  if (foto.miniatura) {
    urlVisor = URL.createObjectURL(foto.miniatura);
    img.src = urlVisor;
  }
  dialogo.showModal();
  try {
    const grande = foto.imagen ?? await obtenerImagen(foto);
    if (grande && dialogo.open) {
      if (urlVisor) URL.revokeObjectURL(urlVisor);
      urlVisor = URL.createObjectURL(grande);
      img.src = urlVisor;
    }
  } catch (error) {
    pie.textContent += ' · No se pudo descargar la imagen completa.';
  }
}
