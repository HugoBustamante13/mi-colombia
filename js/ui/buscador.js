/**
 * Buscador con autocompletado (patrón ARIA "combobox" + "listbox").
 * Teclado: ↑/↓ para moverse, Enter para elegir, Esc para cerrar o limpiar.
 */
import { esc } from '../utils.js';

export function iniciarBuscador({ entrada, lista, buscar, alElegir }) {
  let resultados = [];
  let activo = -1;

  function cerrar() {
    lista.hidden = true;
    entrada.setAttribute('aria-expanded', 'false');
    entrada.removeAttribute('aria-activedescendant');
    activo = -1;
  }

  function pintar() {
    const hayConsulta = entrada.value.trim().length >= 2;
    if (!resultados.length) {
      if (!hayConsulta) return cerrar();
      lista.innerHTML = '<li class="sugerencia vacia" role="option" aria-disabled="true">Sin resultados</li>';
    } else {
      lista.innerHTML = resultados.map((m, i) => `
        <li id="sugerencia-${i}" class="sugerencia" role="option" data-i="${i}" aria-selected="${i === activo}">
          <span class="sugerencia-nombre">${esc(m.nombre)}</span>
          <span class="sugerencia-depto">${esc(m.dptoNombre)}</span>
        </li>`).join('');
    }
    lista.hidden = false;
    entrada.setAttribute('aria-expanded', 'true');
    if (activo >= 0) {
      entrada.setAttribute('aria-activedescendant', `sugerencia-${activo}`);
      lista.querySelector(`#sugerencia-${activo}`)?.scrollIntoView({ block: 'nearest' });
    } else {
      entrada.removeAttribute('aria-activedescendant');
    }
  }

  function elegir(i) {
    const m = resultados[i];
    if (!m) return;
    entrada.value = m.nombre;
    cerrar();
    alElegir(m.id);
  }

  entrada.addEventListener('input', () => {
    resultados = buscar(entrada.value);
    activo = resultados.length ? 0 : -1;
    pintar();
  });

  entrada.addEventListener('keydown', (e) => {
    const abierta = !lista.hidden && resultados.length > 0;
    switch (e.key) {
      case 'ArrowDown':
        if (!abierta) return;
        e.preventDefault();
        activo = (activo + 1) % resultados.length;
        pintar();
        break;
      case 'ArrowUp':
        if (!abierta) return;
        e.preventDefault();
        activo = (activo - 1 + resultados.length) % resultados.length;
        pintar();
        break;
      case 'Enter':
        if (!abierta) return;
        e.preventDefault();
        elegir(activo);
        break;
      case 'Escape':
        if (!lista.hidden) cerrar();
        else entrada.value = '';
        break;
      default:
    }
  });

  // mousedown evita que el campo pierda el foco antes del clic.
  lista.addEventListener('mousedown', (e) => e.preventDefault());
  lista.addEventListener('click', (e) => {
    const item = e.target.closest('[data-i]');
    if (item) elegir(Number(item.dataset.i));
  });
  entrada.addEventListener('blur', cerrar);
  entrada.addEventListener('focus', () => {
    if (entrada.value.trim().length >= 2) {
      resultados = buscar(entrada.value);
      pintar();
    }
  });
}
