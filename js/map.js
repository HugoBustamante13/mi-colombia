/**
 * Módulo del MAPA (Leaflet con renderizado en Canvas).
 *
 * ¿Por qué Leaflet y no D3? Leaflet trae zoom, arrastre, navegación por teclado,
 * tooltips y "fitBounds" listos, y su renderizador Canvas dibuja los 1.122
 * polígonos en un solo <canvas> (en vez de 1.122 nodos SVG), lo que mantiene
 * el zoom y el arrastre fluidos también en móviles. D3 daría más control del
 * dibujo, pero habría que reimplementar toda la interacción del mapa.
 */
import { leerPaleta, mezclar } from './colors.js';
import { prefiereMenosMovimiento, esc } from './utils.js';

const DURACION_TRANSICION = 450; // ms
const MAX_ANIMADOS = 150;        // con más cambios simultáneos se pinta sin animación
const DPTO_ISLAS = '88';         // San Andrés: fuera de la vista inicial continental
const ZOOM_CABECERAS = 7;        // desde este zoom se ven las cabeceras municipales
const ZOOM_CENTROS = 9;          // y desde este, los demás centros poblados

const RELIEVE = {
  claro: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
  oscuro: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
};

/**
 * @param {HTMLElement} elemento
 * @param {object} datos  resultado de cargarDatos()
 * @param {object} opciones
 * @param {(id: string) => void} opciones.alSeleccionar
 * @param {(id: string) => string} opciones.contenidoTooltip
 * @param {(lon: number, lat: number) => string|null} opciones.municipioEn
 */
export function crearMapa(elemento, datos, { alSeleccionar, contenidoTooltip, municipioEn }) {
  const tactil = window.matchMedia('(pointer: coarse)').matches;
  // Un solo lienzo para todo lo vectorial: con varios, el de arriba taparía los clics del de abajo.
  // tolerance agranda la zona de clic: útil en pantallas táctiles.
  const lienzo = L.canvas({ padding: 0.5, tolerance: tactil ? 6 : 1 });

  const mapa = L.map(elemento, {
    renderer: lienzo,
    zoomControl: false,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
    minZoom: 3.5,
    maxZoom: 13,
    keyboard: true,
  });
  L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(mapa);
  mapa.attributionControl.setPrefix(false);
  mapa.attributionControl.addAttribution(
    'Límites: <a href="https://geoportal.dane.gov.co/" target="_blank" rel="noopener">DANE · MGN 2025</a>',
  );

  let paleta = leerPaleta();
  let seleccion = null;
  let hover = null;
  let filtroDepto = '';
  let animacion = null;
  let opacidadRelleno = 0.95; // baja con el relieve activo para que se vea el terreno
  const capas = new Map(); // DIVIPOLA → capa Leaflet

  /** Estilo de borde/opacidad según selección, hover y filtro (el relleno va aparte). */
  function estiloDe(id) {
    const atenuado = filtroDepto && datos.porId.get(id).dpto !== filtroDepto;
    const sel = id === seleccion;
    const hov = id === hover;
    return {
      stroke: true,
      color: sel ? paleta.seleccion : hov ? paleta.hover : paleta.borde,
      weight: sel ? 2.5 : hov ? 1.6 : 0.5,
      opacity: atenuado && !sel ? 0.5 : 1,
      fill: true,
      fillOpacity: atenuado ? 0.3 : opacidadRelleno,
    };
  }

  const refrescar = (id) => id && capas.get(id)?.setStyle(estiloDe(id));

  const capaMunicipios = L.geoJSON(datos.municipios, {
    style: (f) => ({ ...estiloDe(f.properties.id), fillColor: paleta.sinVisitar }),
    onEachFeature: (feature, capa) => {
      const id = feature.properties.id;
      capas.set(id, capa);
      capa._colorDestino = paleta.sinVisitar;
      capa._colorVisible = paleta.sinVisitar;
      // En táctil no hay "hover": el tooltip estorbaría al tocar.
      if (!tactil) {
        capa.bindTooltip(() => contenidoTooltip(id), {
          sticky: true, direction: 'top', offset: [0, -10], className: 'mc-tooltip', opacity: 1,
        });
      }
      capa.on({
        mouseover: () => { hover = id; refrescar(id); },
        mouseout: () => { if (hover === id) hover = null; refrescar(id); },
        click: () => alSeleccionar(id),
      });
    },
  }).addTo(mapa);

  // Límites departamentales encima de los municipios (sin interacción).
  const estiloDeptos = () => ({ color: paleta.bordeDepto, weight: 1.3, opacity: 0.9, fill: false, interactive: false });
  const capaDeptos = L.geoJSON(datos.limitesDeptos, { interactive: false, style: estiloDeptos }).addTo(mapa);

  // Extensión de cada departamento (para el zoom automático del filtro).
  const extensionDepto = new Map();
  for (const d of datos.listaDeptos) {
    const ext = new L.LatLngBounds();
    d.ids.forEach((id) => ext.extend(capas.get(id).getBounds()));
    extensionDepto.set(d.id, ext);
  }
  const extensionPais = new L.LatLngBounds();
  for (const [id, ext] of extensionDepto) if (id !== DPTO_ISLAS) extensionPais.extend(ext);

  const opcionesMovimiento = () => (prefiereMenosMovimiento() ? { animate: false } : { duration: 0.6 });

  mapa.fitBounds(extensionPais, { padding: [12, 12], animate: false });
  mapa.setMaxBounds(capaMunicipios.getBounds().pad(0.5));

  /* ---------- API pública ---------- */

  /**
   * Aplica colores de relleno: Map DIVIPOLA → color (los ausentes quedan "sin visitar").
   * Interpola en el tiempo para lograr una transición suave.
   */
  function actualizarColores(colores, animar = true) {
    if (animacion) cancelAnimationFrame(animacion);
    const cambios = [];
    for (const [id, capa] of capas) {
      const destino = colores.get(id) ?? paleta.sinVisitar;
      capa._colorDestino = destino;
      if (capa._colorVisible !== destino) cambios.push({ capa, desde: capa._colorVisible, hasta: destino });
    }
    if (!cambios.length) return;

    const pintar = (capa, color) => { capa._colorVisible = color; capa.setStyle({ fillColor: color }); };

    if (!animar || prefiereMenosMovimiento() || cambios.length > MAX_ANIMADOS) {
      cambios.forEach(({ capa, hasta }) => pintar(capa, hasta));
      return;
    }
    const inicio = performance.now();
    const paso = (ahora) => {
      const t = Math.min((ahora - inicio) / DURACION_TRANSICION, 1);
      const suave = 1 - (1 - t) ** 3; // ease-out cúbico
      cambios.forEach(({ capa, desde, hasta }) => pintar(capa, t === 1 ? hasta : mezclar(desde, hasta, suave)));
      animacion = t < 1 ? requestAnimationFrame(paso) : null;
    };
    animacion = requestAnimationFrame(paso);
  }

  function seleccionar(id) {
    const anterior = seleccion;
    seleccion = id;
    refrescar(anterior);
    refrescar(id);
  }

  function enfocarMunicipio(id) {
    const capa = capas.get(id);
    if (!capa) return;
    const ext = capa.getBounds();
    if (prefiereMenosMovimiento()) mapa.fitBounds(ext, { padding: [48, 48], maxZoom: 10, animate: false });
    else mapa.flyToBounds(ext, { padding: [48, 48], maxZoom: 10, duration: 0.8 });
  }

  /** Filtra (atenúa los demás) y hace zoom al departamento; '' = todo el país. */
  function filtrarDepto(dpto) {
    filtroDepto = dpto || '';
    capas.forEach((_, id) => refrescar(id));
    const ext = filtroDepto ? extensionDepto.get(filtroDepto) : extensionPais;
    mapa.flyToBounds(ext, { padding: [24, 24], ...opcionesMovimiento() });
  }

  /* ---------- Capas opcionales ---------- */

  let capaRelieve = null;
  let capaParques = null;
  let capaCabeceras = null;
  let capaCentros = null;
  let capaCalor = null;
  let capaRuta = null;

  const temaOscuro = () => getComputedStyle(document.documentElement).colorScheme === 'dark';

  /** Sombreado del relieve (Esri World Hillshade) bajo los municipios, que se vuelven translúcidos. */
  function mostrarRelieve(activo) {
    capaRelieve?.remove();
    capaRelieve = null;
    opacidadRelleno = activo ? 0.6 : 0.95;
    if (activo) {
      capaRelieve = L.tileLayer(temaOscuro() ? RELIEVE.oscuro : RELIEVE.claro, {
        maxZoom: 13,
        attribution: 'Relieve: Esri, USGS, NGA, NASA',
      }).addTo(mapa);
    }
    capas.forEach((_, id) => refrescar(id));
  }

  const estiloParque = () => ({
    color: paleta.parque, weight: 1.4, opacity: 0.95, dashArray: '5 4',
    fill: true, fillColor: paleta.parque, fillOpacity: 0.16,
  });

  /** Áreas protegidas. Al tocarlas se selecciona el municipio que hay debajo. */
  function mostrarParques(coleccion) {
    capaParques?.remove();
    capaParques = null;
    if (!coleccion) return;
    capaParques = L.geoJSON(coleccion, {
      renderer: lienzo,
      style: estiloParque,
      onEachFeature: (feature, capa) => {
        const { nombre, categoria } = feature.properties;
        const base = `<strong>${esc(nombre)}</strong><br><span>${esc(categoria)}</span>`;
        if (!tactil) {
          capa.bindTooltip(base, { sticky: true, direction: 'top', offset: [0, -10], className: 'mc-tooltip', opacity: 1 });
          capa.on('mousemove', (e) => {
            const id = municipioEn(e.latlng.lng, e.latlng.lat);
            const m = id && datos.porId.get(id);
            capa.setTooltipContent(m ? `${base}<br><span>En ${esc(m.nombre)} (${esc(m.dptoNombre)})</span>` : base);
          });
        }
        capa.on('click', (e) => {
          const id = municipioEn(e.latlng.lng, e.latlng.lat);
          if (id) alSeleccionar(id);
        });
      },
    }).addTo(mapa);
  }

  /** Cabeceras municipales y centros poblados como puntos; aparecen según el zoom. */
  function mostrarCentros(lista) {
    capaCabeceras?.remove();
    capaCentros?.remove();
    capaCabeceras = null;
    capaCentros = null;
    if (!lista) return;
    const punto = (c) => {
      const marcador = L.circleMarker([c.lat, c.lon], {
        renderer: lienzo,
        radius: c.cabecera ? 4 : 2.5,
        weight: 1,
        color: paleta.puntoBorde,
        fillColor: c.cabecera ? paleta.punto : paleta.puntoSecundario,
        fillOpacity: 1,
      });
      const tipo = c.cabecera ? 'Cabecera municipal' : `Centro poblado de ${datos.porId.get(c.divipola)?.nombre ?? ''}`;
      const altitud = c.altitud != null ? ` · ${c.altitud.toLocaleString('es-CO')} m s. n. m.` : '';
      if (!tactil) {
        marcador.bindTooltip(`<strong>${esc(c.nombre)}</strong><br><span>${esc(tipo)}${altitud}</span>`,
          { direction: 'top', offset: [0, -6], className: 'mc-tooltip', opacity: 1 });
      }
      marcador.on('click', () => alSeleccionar(c.divipola));
      return marcador;
    };
    capaCabeceras = L.layerGroup(lista.filter((c) => c.cabecera).map(punto));
    capaCentros = L.layerGroup(lista.filter((c) => !c.cabecera).map(punto));
    ajustarCentrosAlZoom();
  }

  function ajustarCentrosAlZoom() {
    const z = mapa.getZoom();
    for (const [capa, minimo] of [[capaCabeceras, ZOOM_CABECERAS], [capaCentros, ZOOM_CENTROS]]) {
      if (!capa) continue;
      if (z >= minimo && !mapa.hasLayer(capa)) capa.addTo(mapa);
      if (z < minimo && mapa.hasLayer(capa)) capa.remove();
    }
  }
  mapa.on('zoomend', ajustarCentrosAlZoom);

  /** Mapa de calor: puntos [lat, lon, peso]. */
  function mostrarCalor(puntos) {
    capaCalor?.remove();
    capaCalor = null;
    if (!puntos?.length || !L.heatLayer) return;
    const maximo = Math.max(...puntos.map((p) => p[2]));
    capaCalor = L.heatLayer(puntos, {
      radius: 24,
      blur: 20,
      maxZoom: 9,
      max: Math.max(1, maximo * 0.6),
      minOpacity: 0.35,
      gradient: { 0.2: '#3d7fd6', 0.45: '#4cc27a', 0.7: '#f2c94c', 1: '#d9472b' },
    }).addTo(mapa);
  }

  /**
   * Ruta de viaje: línea entre las paradas en orden cronológico y un número por parada.
   * @param {{ lat, lon, divipola, nombre, fecha }[] | null} paradas
   */
  function mostrarRuta(paradas) {
    capaRuta?.remove();
    capaRuta = null;
    if (!paradas?.length) return;
    const latlngs = paradas.map((p) => [p.lat, p.lon]);
    const linea = L.polyline(latlngs, {
      renderer: lienzo, color: paleta.ruta, weight: 3, opacity: 0.9, interactive: false,
    });
    const marcas = paradas.map((p, i) => L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: 'marca-ruta', html: `<span>${i + 1}</span>`, iconSize: [24, 24] }),
      keyboard: false,
      title: `${i + 1}. ${p.nombre} · ${p.fecha}`,
    }).on('click', () => alSeleccionar(p.divipola)));
    capaRuta = L.layerGroup([linea, ...marcas]).addTo(mapa);
    mapa.flyToBounds(L.latLngBounds(latlngs), { padding: [48, 48], maxZoom: 10, ...opcionesMovimiento() });
  }

  /** Relee la paleta tras cambiar de tema y repinta bordes (los rellenos los fija main). */
  function refrescarTema() {
    paleta = leerPaleta();
    capas.forEach((_, id) => refrescar(id));
    capaDeptos.setStyle(estiloDeptos());
    capaParques?.setStyle(estiloParque);
    if (capaRelieve) mostrarRelieve(true);
    capaRuta?.eachLayer((l) => l.setStyle?.({ color: paleta.ruta }));
  }

  // El contenedor puede cambiar de tamaño sin que cambie la ventana (rotación, teclado, panel).
  new ResizeObserver(() => mapa.invalidateSize({ pan: false })).observe(elemento);

  return {
    actualizarColores,
    seleccionar,
    enfocarMunicipio,
    filtrarDepto,
    refrescarTema,
    mostrarRelieve,
    mostrarParques,
    mostrarCentros,
    mostrarCalor,
    mostrarRuta,
    invalidarTamano: () => mapa.invalidateSize(),
  };
}
