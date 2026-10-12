/**
 * Colores del mapa y leyenda.
 * Los valores viven en CSS (variables --mapa-* y --rampa-*) para que el modo
 * oscuro tenga su propia paleta; aquí solo se leen y se combinan.
 */

/** Lee la paleta activa (cambia con el tema). Todos los valores son #rrggbb. */
export function leerPaleta() {
  const estilos = getComputedStyle(document.documentElement);
  const v = (nombre) => estilos.getPropertyValue(nombre).trim();
  return {
    sinVisitar: v('--mapa-sin-visitar'),
    visitado: v('--mapa-visitado'),
    borde: v('--mapa-borde'),
    bordeDepto: v('--mapa-borde-depto'),
    hover: v('--mapa-hover'),
    seleccion: v('--mapa-seleccion'),
    deseo: v('--mapa-deseo'),
    parque: v('--mapa-parque'),
    punto: v('--mapa-punto'),
    puntoSecundario: v('--mapa-punto-2'),
    puntoBorde: v('--mapa-punto-borde'),
    ruta: v('--mapa-ruta'),
    mar: v('--mapa-mar'),
    fondo: v('--superficie'),
    texto: v('--texto'),
    textoSuave: v('--texto-suave'),
    rampa: [1, 2, 3, 4, 5].map((i) => v(`--rampa-${i}`)),
  };
}

function hexARgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Interpola dos colores hex (t entre 0 y 1). */
export function mezclar(a, b, t) {
  const x = hexARgb(a);
  const y = hexARgb(b);
  return `#${x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

function colorEnRampa(rampa, t) {
  const pos = Math.min(Math.max(t, 0), 1) * (rampa.length - 1);
  const i = Math.min(Math.floor(pos), rampa.length - 2);
  return mezclar(rampa[i], rampa[i + 1], pos - i);
}

/**
 * Escala secuencial de un solo tono (verde): año más antiguo = claro, más reciente = intenso.
 * Si solo hay un año, se usa el tono más intenso.
 */
export function escalaPorAnio(anios, rampa) {
  if (!anios.length) return () => rampa[rampa.length - 1];
  const min = Math.min(...anios);
  const max = Math.max(...anios);
  if (min === max) return () => rampa[rampa.length - 1];
  return (anio) => colorEnRampa(rampa, (anio - min) / (max - min));
}

/**
 * Describe la leyenda del modo activo. La usan la interfaz y la exportación PNG.
 * - discreta: { items: [{ color, etiqueta }] }
 * - gradiente: { sin, extra, desde, hasta, colores } (más de 6 años distintos)
 */
export function construirLeyenda(modo, anios, paleta, { hayDeseos = false } = {}) {
  const sin = { color: paleta.sinVisitar, etiqueta: 'Sin visitar' };
  const deseo = { color: paleta.deseo, etiqueta: 'Quiero ir' };
  const extra = hayDeseos ? [deseo] : [];
  if (modo === 'estado') {
    return {
      tipo: 'discreta',
      titulo: 'Estado',
      items: [sin, ...extra, { color: paleta.visitado, etiqueta: 'Visitado' }],
    };
  }
  const tituloAnio = 'Año de la última visita';
  const unicos = [...new Set(anios)].sort((a, b) => a - b);
  if (!unicos.length) {
    return { tipo: 'discreta', titulo: tituloAnio, items: [sin, ...extra] };
  }
  const escala = escalaPorAnio(unicos, paleta.rampa);
  if (unicos.length <= 6) {
    return {
      tipo: 'discreta',
      titulo: tituloAnio,
      items: [sin, ...extra, ...unicos.map((a) => ({ color: escala(a), etiqueta: String(a) }))],
    };
  }
  return {
    tipo: 'gradiente',
    titulo: tituloAnio,
    sin,
    extra,
    desde: unicos[0],
    hasta: unicos[unicos.length - 1],
    colores: paleta.rampa,
  };
}
