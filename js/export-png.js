/**
 * Exportación del mapa a PNG.
 *
 * En lugar de "fotografiar" el canvas de Leaflet (que depende del zoom actual y
 * del tamaño de la pantalla), se redibuja el mapa en un canvas fuera de pantalla
 * con proyección Web Mercator, título, leyenda y fuente. Así la imagen siempre
 * sale completa y con buena resolución. San Andrés y Providencia va en un recuadro.
 */
const ANCHO = 1600;
const MARGEN = 64;
const ALTO_CABECERA = 150;
const ALTO_PIE = 170;
const ALTO_MAX_MAPA = 1900;
const DPTO_ISLAS = '88';

const mercator = ([lon, lat]) => [
  (lon * Math.PI) / 180,
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

/** Recorre todos los anillos de un Polygon/MultiPolygon. */
function anillos(geometria) {
  const poligonos = geometria.type === 'Polygon' ? [geometria.coordinates] : geometria.coordinates;
  return poligonos.flat();
}

function cajaProyectada(features) {
  const caja = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const f of features) {
    for (const anillo of anillos(f.geometry)) {
      for (const punto of anillo) {
        const [x, y] = mercator(punto);
        if (x < caja.minX) caja.minX = x;
        if (x > caja.maxX) caja.maxX = x;
        if (y < caja.minY) caja.minY = y;
        if (y > caja.maxY) caja.maxY = y;
      }
    }
  }
  return caja;
}

/** Crea una función de proyección que encaja la caja en el rectángulo dado. */
function crearProyeccion(caja, x, y, ancho, alto) {
  const escala = Math.min(ancho / (caja.maxX - caja.minX), alto / (caja.maxY - caja.minY));
  const dx = x + (ancho - (caja.maxX - caja.minX) * escala) / 2;
  const dy = y + (alto - (caja.maxY - caja.minY) * escala) / 2;
  return (punto) => {
    const [px, py] = mercator(punto);
    return [dx + (px - caja.minX) * escala, dy + (caja.maxY - py) * escala];
  };
}

function rutaDe(lineas, proyectar, cerrar) {
  const ruta = new Path2D();
  for (const linea of lineas) {
    linea.forEach((punto, i) => {
      const [x, y] = proyectar(punto);
      if (i === 0) ruta.moveTo(x, y);
      else ruta.lineTo(x, y);
    });
    if (cerrar) ruta.closePath();
  }
  return ruta;
}

function dibujarMunicipios(ctx, features, proyectar, colorDe, paleta, grosor) {
  const union = new Path2D();
  for (const f of features) {
    const ruta = rutaDe(anillos(f.geometry), proyectar, true);
    ctx.fillStyle = colorDe(f.properties.id);
    ctx.fill(ruta, 'evenodd');
    ctx.strokeStyle = paleta.borde;
    ctx.lineWidth = grosor;
    ctx.stroke(ruta);
    union.addPath(ruta);
  }
  return union;
}

function dibujarLeyenda(ctx, leyenda, paleta, fuente, x, y) {
  ctx.fillStyle = paleta.textoSuave;
  ctx.font = `600 22px ${fuente}`;
  ctx.fillText(leyenda.titulo, x, y);
  const top = y + 22;
  const cuadro = 26;
  ctx.font = `22px ${fuente}`;

  const muestra = (color, etiqueta, cx) => {
    ctx.fillStyle = color;
    ctx.fillRect(cx, top, cuadro, cuadro);
    ctx.strokeStyle = paleta.textoSuave;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, top + 0.5, cuadro - 1, cuadro - 1);
    ctx.fillStyle = paleta.texto;
    ctx.fillText(etiqueta, cx + cuadro + 10, top + 20);
    return cx + cuadro + 10 + ctx.measureText(etiqueta).width + 34;
  };

  if (leyenda.tipo === 'discreta') {
    let cx = x;
    for (const item of leyenda.items) cx = muestra(item.color, item.etiqueta, cx);
    return;
  }
  let cx = x;
  for (const item of [leyenda.sin, ...(leyenda.extra ?? [])]) cx = muestra(item.color, item.etiqueta, cx);
  const ancho = 360;
  const gradiente = ctx.createLinearGradient(cx, 0, cx + ancho, 0);
  leyenda.colores.forEach((c, i) => gradiente.addColorStop(i / (leyenda.colores.length - 1), c));
  ctx.fillStyle = gradiente;
  ctx.fillRect(cx, top, ancho, cuadro);
  ctx.fillStyle = paleta.texto;
  ctx.fillText(String(leyenda.desde), cx, top + cuadro + 28);
  const fin = String(leyenda.hasta);
  ctx.fillText(fin, cx + ancho - ctx.measureText(fin).width, top + cuadro + 28);
}

/**
 * @param {object} p
 * @param {object} p.datos        resultado de cargarDatos()
 * @param {(id: string) => string} p.colorDe  color de relleno por DIVIPOLA
 * @param {object} p.paleta       leerPaleta()
 * @param {string} p.filtroDepto  '' o código de departamento
 * @param {string} p.titulo
 * @param {string} p.subtitulo
 * @param {object} p.leyenda      construirLeyenda()
 * @returns {Promise<Blob>}
 */
export function generarPNG({ datos, colorDe, paleta, filtroDepto, titulo, subtitulo, leyenda }) {
  const fuente = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const todos = datos.municipios.features;
  const principales = todos.filter((f) =>
    (filtroDepto ? f.properties.dpto === filtroDepto : f.properties.dpto !== DPTO_ISLAS));
  const islas = filtroDepto ? [] : todos.filter((f) => f.properties.dpto === DPTO_ISLAS);

  // Tamaño del área del mapa según la proporción del territorio.
  const caja = cajaProyectada(principales);
  const anchoMapa = ANCHO - 2 * MARGEN;
  const altoMapa = Math.min(ALTO_MAX_MAPA, anchoMapa * ((caja.maxY - caja.minY) / (caja.maxX - caja.minX)));
  const alto = Math.round(ALTO_CABECERA + altoMapa + ALTO_PIE);

  const canvas = document.createElement('canvas');
  canvas.width = ANCHO;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';

  ctx.fillStyle = paleta.fondo;
  ctx.fillRect(0, 0, ANCHO, alto);

  // Cabecera
  ctx.fillStyle = paleta.texto;
  ctx.font = `700 52px ${fuente}`;
  ctx.fillText(titulo, MARGEN, 82);
  ctx.fillStyle = paleta.textoSuave;
  ctx.font = `26px ${fuente}`;
  ctx.fillText(subtitulo, MARGEN, 124);

  // Mapa principal
  const proyectar = crearProyeccion(caja, MARGEN, ALTO_CABECERA, anchoMapa, altoMapa);
  const union = dibujarMunicipios(ctx, principales, proyectar, colorDe, paleta, 0.6);

  // Límites departamentales recortados al área dibujada.
  ctx.save();
  if (filtroDepto) ctx.clip(union, 'nonzero');
  else {
    ctx.beginPath();
    ctx.rect(MARGEN - 4, ALTO_CABECERA - 4, anchoMapa + 8, altoMapa + 8);
    ctx.clip();
  }
  ctx.strokeStyle = paleta.bordeDepto;
  ctx.lineWidth = filtroDepto ? 3 : 1.6;
  ctx.stroke(rutaDe(datos.limitesDeptos.coordinates, proyectar, false));
  ctx.restore();

  // Recuadro de San Andrés y Providencia (esquina noroccidental, que es mar).
  if (islas.length) {
    const rx = MARGEN;
    const ry = ALTO_CABECERA;
    const rw = 190;
    const rh = 230;
    ctx.strokeStyle = paleta.textoSuave;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    const proyectarIslas = crearProyeccion(cajaProyectada(islas), rx + 20, ry + 20, rw - 40, rh - 70);
    dibujarMunicipios(ctx, islas, proyectarIslas, colorDe, paleta, 0.8);
    ctx.fillStyle = paleta.textoSuave;
    ctx.font = `18px ${fuente}`;
    ctx.fillText('San Andrés y', rx + 14, ry + rh - 34);
    ctx.fillText('Providencia', rx + 14, ry + rh - 12);
  }

  // Pie: leyenda y fuente
  const yPie = ALTO_CABECERA + altoMapa + 50;
  dibujarLeyenda(ctx, leyenda, paleta, fuente, MARGEN, yPie);
  ctx.fillStyle = paleta.textoSuave;
  ctx.font = `18px ${fuente}`;
  ctx.fillText('Mi Colombia · Límites municipales: DANE, Marco Geoestadístico Nacional 2025', MARGEN, alto - 28);

  return new Promise((resolver, rechazar) => {
    canvas.toBlob((blob) => (blob ? resolver(blob) : rechazar(new Error('No se pudo generar la imagen'))), 'image/png');
  });
}
