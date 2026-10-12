/**
 * Diálogo "Cuenta y sincronización" y el indicador del botón de la barra.
 */
import { esc } from '../utils.js';

function haceCuanto(ms) {
  if (!ms) return 'nunca';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(ms).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * @param {object} p
 * @param {typeof import('../nube.js')} p.nube
 * @param {(mensaje: string) => void} p.mostrarAviso
 */
export function iniciarCuenta({ nube, mostrarAviso }) {
  const dialogo = document.getElementById('dialogo-cuenta');
  const cuerpo = document.getElementById('cuenta-cuerpo');
  const boton = document.getElementById('btn-cuenta');
  let correoPendiente = '';
  let ocupado = false;

  function pintarBoton(e) {
    let estado = 'local';
    let texto = 'Solo en este navegador';
    if (e.configurada && e.usuario) {
      if (!e.enLinea) { estado = 'offline'; texto = 'Sin conexión: se sincronizará al volver'; }
      else if (e.sincronizando) { estado = 'sync'; texto = 'Sincronizando…'; }
      else if (e.error) { estado = 'error'; texto = `Error al sincronizar: ${e.error}`; }
      else { estado = 'ok'; texto = `Sincronizado ${haceCuanto(e.ultimaSync)}`; }
    }
    boton.dataset.estado = estado;
    boton.title = `Cuenta y sincronización · ${texto}`;
    boton.setAttribute('aria-label', boton.title);
  }

  function pintar() {
    const e = nube.estado();
    pintarBoton(e);
    if (!dialogo.open) return;
    // No borrar lo que se está escribiendo si llega un aviso de sincronización.
    if (!ocupado && document.activeElement?.matches('#cuenta-cuerpo input')) return;

    if (!e.configurada) {
      cuerpo.innerHTML = `
        <p>Tus visitas se guardan <strong>solo en este navegador</strong>. Para usarlas en varios
          dispositivos, conecta una cuenta gratuita de Supabase:</p>
        <ol class="pasos">
          <li>Crea un proyecto en <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
          <li>En <em>SQL Editor</em>, ejecuta el archivo <code>supabase/esquema.sql</code>.</li>
          <li>Copia la <em>Project URL</em> y la clave <em>anon</em> en <code>js/config.js</code>.</li>
        </ol>
        <p class="ayuda">Mientras tanto, usa <strong>Mis datos → Exportar copia</strong> de vez en cuando.</p>`;
      return;
    }

    if (!e.usuario) {
      cuerpo.innerHTML = correoPendiente ? `
        <p>Enviamos un correo a <strong>${esc(correoPendiente)}</strong>. Abre el enlace en este
          dispositivo o escribe aquí el código de 6 dígitos.</p>
        <form class="form-cuenta" data-form="codigo">
          <label class="campo"><span>Código</span>
            <input name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required></label>
          <div class="fila-botones">
            <button class="btn primario" type="submit">Entrar</button>
            <button class="btn" type="button" data-accion-cuenta="otro-correo">Usar otro correo</button>
          </div>
        </form>` : `
        <p>Inicia sesión con tu correo para sincronizar visitas, deseos y fotos entre tus
          dispositivos. No necesitas contraseña.</p>
        <form class="form-cuenta" data-form="correo">
          <label class="campo"><span>Correo electrónico</span>
            <input name="email" type="email" autocomplete="email" required></label>
          <button class="btn primario" type="submit">Enviar acceso</button>
        </form>
        <p class="ayuda">Al entrar, lo que ya tienes en este navegador se sube a tu cuenta y se combina.</p>`;
      return;
    }

    const estadoSync = !e.enLinea ? 'Sin conexión. Los cambios se sincronizarán al volver.'
      : e.sincronizando ? 'Sincronizando…'
        : e.error ? `Error: ${esc(e.error)}`
          : `Última sincronización: ${haceCuanto(e.ultimaSync)}.`;
    cuerpo.innerHTML = `
      <p>Sesión iniciada como <strong>${esc(e.usuario.email)}</strong>.</p>
      <p class="estado-sync ${e.error ? 'con-error' : ''}" role="status">${estadoSync}</p>
      <div class="fila-botones">
        <button class="btn" type="button" data-accion-cuenta="sincronizar" ${e.sincronizando ? 'disabled' : ''}>Sincronizar ahora</button>
        <button class="btn peligro" type="button" data-accion-cuenta="salir">Cerrar sesión</button>
      </div>
      <form class="bloque form-cuenta" data-form="perfil">
        <h3>Mapa público</h3>
        <p class="ayuda">Si lo activas, cualquiera con el enlace verá qué municipios visitaste y cuándo
          (nunca tus notas ni tus fotos), siempre actualizado.</p>
        <label class="campo"><span>Nombre que verán</span>
          <input name="nombre" maxlength="60" value="${esc(e.perfil.nombre)}" placeholder="Tu nombre o apodo"></label>
        <label class="interruptor"><input type="checkbox" name="publico" ${e.perfil.publico ? 'checked' : ''}> Mapa público</label>
        <button class="btn primario" type="submit">Guardar</button>
      </form>`;
  }

  async function ejecutar(fn) {
    if (ocupado) return;
    ocupado = true;
    cuerpo.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await fn();
    } catch (error) {
      mostrarAviso(error.message);
    } finally {
      ocupado = false;
      pintar();
    }
  }

  cuerpo.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const datos = new FormData(form);
    if (form.dataset.form === 'correo') {
      const email = String(datos.get('email')).trim();
      ejecutar(async () => {
        await nube.enviarAcceso(email);
        correoPendiente = email;
      });
    } else if (form.dataset.form === 'codigo') {
      ejecutar(async () => {
        await nube.verificarCodigo(correoPendiente, String(datos.get('codigo')));
        correoPendiente = '';
        mostrarAviso('Sesión iniciada. Sincronizando…');
      });
    } else if (form.dataset.form === 'perfil') {
      ejecutar(async () => {
        await nube.guardarPerfil({ nombre: String(datos.get('nombre')).trim(), publico: datos.get('publico') === 'on' });
        mostrarAviso('Perfil guardado.');
      });
    }
  });

  cuerpo.addEventListener('click', (ev) => {
    const accion = ev.target.closest('[data-accion-cuenta]')?.dataset.accionCuenta;
    if (accion === 'otro-correo') { correoPendiente = ''; pintar(); }
    if (accion === 'sincronizar') ejecutar(() => nube.sincronizar());
    if (accion === 'salir') {
      ejecutar(async () => {
        await nube.cerrarSesion();
        mostrarAviso('Sesión cerrada. Tus datos siguen en este navegador.');
      });
    }
  });

  boton.addEventListener('click', () => {
    dialogo.showModal();
    pintar();
  });
  nube.suscribir(pintar);
  pintar();
}
