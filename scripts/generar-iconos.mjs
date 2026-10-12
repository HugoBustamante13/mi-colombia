// Genera los íconos PNG de la app (bandera con un marcador de lugar) sin dependencias.
// Uso: node scripts/generar-iconos.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const AMARILLO = [233, 196, 106];
const AZUL = [43, 76, 126];
const ROJO = [200, 85, 61];
const BLANCO = [255, 255, 255];

const tablaCrc = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = tablaCrc[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** Color del punto (x, y) en coordenadas 0..1. null = transparente. */
function colorEn(x, y, { redondeado, margenPin }) {
  if (redondeado) {
    const r = 0.18;
    const dx = Math.max(r - x, 0, x - (1 - r));
    const dy = Math.max(r - y, 0, y - (1 - r));
    if (dx * dx + dy * dy > r * r) return null;
  }
  // Marcador: círculo con punta hacia abajo, más pequeño en la versión "maskable".
  const s = margenPin;
  const cx = 0.5;
  const cy = 0.42;
  const R = 0.2 * s;
  const d = Math.hypot(x - cx, y - cy);
  const punta = cy + R * 2.1;
  const enTriangulo = y > cy && y < punta && Math.abs(x - cx) < R * 0.96 * (1 - (y - cy) / (punta - cy));
  if (d < R * 0.42) return AZUL;
  if (d < R || enTriangulo) return BLANCO;
  if (y < 0.5) return AMARILLO;
  if (y < 0.75) return AZUL;
  return ROJO;
}

function png(lado, opciones) {
  const muestras = 4; // suavizado
  const filas = [];
  for (let py = 0; py < lado; py++) {
    const fila = Buffer.alloc(1 + lado * 4);
    for (let px = 0; px < lado; px++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < muestras; sy++) {
        for (let sx = 0; sx < muestras; sx++) {
          const c = colorEn((px + (sx + 0.5) / muestras) / lado, (py + (sy + 0.5) / muestras) / lado, opciones);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = 1 + px * 4;
      if (a) {
        fila[i] = Math.round(r / a);
        fila[i + 1] = Math.round(g / a);
        fila[i + 2] = Math.round(b / a);
      }
      fila[i + 3] = Math.round((a / (muestras * muestras)) * 255);
    }
    filas.push(fila);
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(lado, 0);
  cabecera.writeUInt32BE(lado, 4);
  cabecera[8] = 8;  // bits por canal
  cabecera[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloque('IHDR', cabecera),
    bloque('IDAT', deflateSync(Buffer.concat(filas), { level: 9 })),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icono-192.png', png(192, { redondeado: true, margenPin: 1 }));
writeFileSync('icons/icono-512.png', png(512, { redondeado: true, margenPin: 1 }));
writeFileSync('icons/icono-maskable-512.png', png(512, { redondeado: false, margenPin: 0.75 }));
writeFileSync('icons/icono-180.png', png(180, { redondeado: false, margenPin: 0.9 }));
console.log('✓ Íconos en icons/');
