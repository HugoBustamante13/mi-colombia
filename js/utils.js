/**
 * Utilidades compartidas: texto, fechas y descargas.
 * No dependen del DOM del mapa ni del almacenamiento.
 */

/** Escapa texto para insertarlo de forma segura en HTML. */
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Quita tildes, pasa a minúsculas y colapsa espacios (para búsquedas). */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const PALABRAS_MENORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en']);

/**
 * Convierte nombres del DANE (en MAYÚSCULAS) a formato título en español:
 * "SAN JOSÉ DE CÚCUTA" → "San José de Cúcuta", "BOGOTÁ, D.C." → "Bogotá, D.C."
 */
export function titulo(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((palabra, i) => {
      if (!palabra.trim() || palabra === '-') return palabra;
      if (palabra.includes('.')) return palabra.toUpperCase();
      if (i > 0 && PALABRAS_MENORES.has(palabra)) return palabra;
      return palabra.replace(/^(\(?)(\p{L})/u, (_, p, letra) => p + letra.toUpperCase());
    })
    .join('');
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Formatea una fecha ISO (AAAA-MM-DD) sin pasar por Date,
 * para evitar desfases de zona horaria (new Date('2024-03-01') es UTC).
 */
export function formatearFecha(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  if (!a || !m || !d) return iso;
  return `${d} ${MESES[m - 1]} ${a}`;
}

/** Fecha local de hoy en formato ISO AAAA-MM-DD. */
export function hoyISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Valida que una cadena sea una fecha de calendario real en formato AAAA-MM-DD. */
export function esFechaISO(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

export const anioDe = (iso) => Number(String(iso).slice(0, 4));

/** Estrellas visuales + texto accesible. */
export function estrellasHTML(calificacion) {
  if (!calificacion) return '<span class="estrellas-lectura sin-calificar">Sin calificar</span>';
  const llenas = '★'.repeat(calificacion);
  const vacias = '★'.repeat(5 - calificacion);
  return `<span class="estrellas-lectura" role="img" aria-label="${calificacion} de 5 estrellas">`
    + `<span class="llenas">${llenas}</span><span class="vacias">${vacias}</span></span>`;
}

export const numero = (n) => n.toLocaleString('es-CO');

/** Porcentaje legible: "<0,1 %" para valores mínimos distintos de cero. */
export function porcentaje(parte, total) {
  if (!total) return '0 %';
  const p = (parte / total) * 100;
  if (p > 0 && p < 0.1) return '<0,1 %';
  return `${p.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
}

/** Descarga un Blob con el nombre indicado. */
export function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const prefiereMenosMovimiento = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
