/**
 * Avisos breves ("toasts") con acción opcional, p. ej. "Deshacer".
 * El contenedor tiene role="status" para que los lectores de pantalla lo anuncien.
 */
let temporizador = null;

export function mostrarAviso(mensaje, { accion, alAccion, duracion = 5000 } = {}) {
  const caja = document.getElementById('aviso');
  clearTimeout(temporizador);
  caja.replaceChildren();

  const texto = document.createElement('span');
  texto.textContent = mensaje;
  caja.append(texto);

  if (accion) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn-texto';
    boton.textContent = accion;
    boton.addEventListener('click', () => {
      ocultar();
      alAccion?.();
    });
    caja.append(boton);
  }

  caja.classList.add('visible');
  temporizador = setTimeout(ocultar, duracion);
}

function ocultar() {
  document.getElementById('aviso').classList.remove('visible');
}
