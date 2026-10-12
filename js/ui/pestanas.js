/**
 * Pestañas accesibles (patrón ARIA "tabs"): clic, ←/→, Inicio y Fin.
 * Cada botón [role=tab] lleva data-vista y aria-controls.
 */
export function iniciarPestanas(contenedor, alCambiar = () => {}) {
  const pestanas = [...contenedor.querySelectorAll('[role="tab"]')];
  let actual = pestanas.find((p) => p.getAttribute('aria-selected') === 'true')?.dataset.vista;

  function activar(vista, enfocar = false) {
    actual = vista;
    for (const p of pestanas) {
      const activa = p.dataset.vista === vista;
      p.setAttribute('aria-selected', String(activa));
      p.tabIndex = activa ? 0 : -1;
      document.getElementById(p.getAttribute('aria-controls')).hidden = !activa;
      if (activa && enfocar) p.focus();
    }
    alCambiar(vista);
  }

  contenedor.addEventListener('click', (e) => {
    const p = e.target.closest('[role="tab"]');
    if (p) activar(p.dataset.vista);
  });

  contenedor.addEventListener('keydown', (e) => {
    const i = pestanas.findIndex((p) => p.dataset.vista === actual);
    const destino = {
      ArrowRight: (i + 1) % pestanas.length,
      ArrowLeft: (i - 1 + pestanas.length) % pestanas.length,
      Home: 0,
      End: pestanas.length - 1,
    }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    activar(pestanas[destino].dataset.vista, true);
  });

  activar(actual);
  return { activar, actual: () => actual };
}
