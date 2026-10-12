/**
 * Diálogo "Compartir mi mapa": enlace de solo lectura (en la URL o en vivo desde
 * la nube) y la imagen PNG con el menú nativo de compartir del teléfono.
 */
import { esc, numero } from '../utils.js';

/**
 * @param {object} p
 * @param {() => { url: string, visitados: number }} p.enlaceInstantanea  enlace con los datos en la URL
 * @param {() => string|null} p.enlaceEnVivo  null si no hay sesión o el perfil no es público
 * @param {() => boolean} p.nubeConfigurada
 * @param {() => Promise<Blob>} p.generarImagen
 * @param {() => void} p.descargarImagen
 * @param {(m: string) => void} p.mostrarAviso
 * @param {(nombre: string) => void} p.guardarNombre
 * @param {() => string} p.leerNombre
 */
export function iniciarCompartir(p) {
  const dialogo = document.getElementById('dialogo-compartir');
  const cuerpo = document.getElementById('compartir-cuerpo');

  function campoEnlace(id, url) {
    return `
      <div class="campo-enlace">
        <input id="${id}" readonly value="${esc(url)}" aria-label="Enlace">
        <button type="button" class="btn" data-copiar="${id}">Copiar</button>
        ${navigator.share ? `<button type="button" class="btn" data-compartir-url="${id}">Compartir…</button>` : ''}
      </div>`;
  }

  function pintar() {
    const { url, visitados } = p.enlaceInstantanea();
    const enVivo = p.enlaceEnVivo();
    cuerpo.innerHTML = `
      <label class="campo"><span>Tu nombre (opcional)</span>
        <input id="compartir-nombre" maxlength="60" value="${esc(p.leerNombre())}" placeholder="Así se verá: «Mapa de …»"></label>

      <section class="bloque">
        <h3>Enlace con tu mapa de hoy</h3>
        <p class="ayuda">Lleva tus ${numero(visitados)} municipios visitados (con el año) y tu lista de deseos dentro del
          enlace. No incluye notas ni fotos. Si agregas visitas, crea un enlace nuevo.</p>
        ${campoEnlace('enlace-instantanea', url)}
      </section>

      <section class="bloque">
        <h3>Enlace siempre actualizado</h3>
        ${enVivo ? `
          <p class="ayuda">Muestra tus visitas actuales desde la nube. Puedes desactivarlo en
            <em>Cuenta → Mapa público</em>.</p>
          ${campoEnlace('enlace-vivo', enVivo)}`
        : `<p class="ayuda">${p.nubeConfigurada()
          ? 'Inicia sesión y activa <em>Mapa público</em> en Cuenta y sincronización.'
          : 'Disponible al conectar la sincronización en la nube (ver Cuenta).'}</p>`}
      </section>

      <section class="bloque">
        <h3>Imagen</h3>
        <div class="fila-botones">
          ${navigator.canShare ? '<button type="button" class="btn" data-compartir-imagen>Compartir imagen…</button>' : ''}
          <button type="button" class="btn" data-descargar-imagen>Descargar PNG</button>
        </div>
      </section>`;
  }

  cuerpo.addEventListener('input', (e) => {
    if (e.target.id !== 'compartir-nombre') return;
    p.guardarNombre(e.target.value.trim());
    const { url } = p.enlaceInstantanea();
    cuerpo.querySelector('#enlace-instantanea').value = url;
  });

  cuerpo.addEventListener('click', async (e) => {
    const copiar = e.target.closest('[data-copiar]')?.dataset.copiar;
    const compartirUrl = e.target.closest('[data-compartir-url]')?.dataset.compartirUrl;
    try {
      if (copiar) {
        const campo = cuerpo.querySelector(`#${copiar}`);
        await navigator.clipboard.writeText(campo.value);
        p.mostrarAviso('Enlace copiado.');
      } else if (compartirUrl) {
        await navigator.share({ title: 'Mi Colombia', text: 'Mira los municipios que he visitado', url: cuerpo.querySelector(`#${compartirUrl}`).value });
      } else if (e.target.closest('[data-compartir-imagen]')) {
        const archivo = new File([await p.generarImagen()], 'mi-colombia.png', { type: 'image/png' });
        if (!navigator.canShare({ files: [archivo] })) throw new Error('Este navegador no puede compartir imágenes.');
        await navigator.share({ files: [archivo], title: 'Mi Colombia' });
      } else if (e.target.closest('[data-descargar-imagen]')) {
        p.descargarImagen();
      }
    } catch (error) {
      if (error.name !== 'AbortError') p.mostrarAviso(error.message || 'No se pudo compartir.');
    }
  });

  return {
    abrir() {
      pintar();
      dialogo.showModal();
    },
  };
}
