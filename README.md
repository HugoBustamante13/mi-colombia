# Mi Colombia

Mapa personal de los municipios de Colombia que has visitado. Marca visitas con fecha, notas y
calificación, mira tu avance por departamento y exporta tu mapa como imagen.

Funciona 100 % en el navegador, sin servidor propio. Los datos se guardan en tu navegador
(`localStorage` para visitas y deseos; IndexedDB para fotos). La cuenta en la nube es opcional.

## Funciones

| | |
|---|---|
| **Visitas** | Fecha, notas y calificación; varias visitas por municipio; colores por estado o por año. |
| **Quiero ir** | Lista de deseos con su propio color en el mapa (botón en la ficha de cada lugar). |
| **Fotos por lugar** | Se reducen a 1600 px y se guardan en IndexedDB; se suben a la nube si sincronizas. |
| **Modo viaje** | *Capas → Mapa de calor* (dónde se concentran tus visitas) y *Ruta por fechas* (paradas numeradas en orden). |
| **Capas** | Relieve (Esri), Parques Nacionales Naturales y cabeceras/centros poblados (DANE). |
| **Retos** | Todas las capitales, todo el Eje Cafetero, las seis regiones, regiones completas, etc. |
| **Compartir** | Enlace de solo lectura con tu mapa dentro de la URL (sin servidor), o enlace en vivo con la nube. |
| **Importar** | Línea de tiempo de Google Maps o fotos con GPS: propone visitas y tú eliges cuáles guardar. |
| **Sin conexión** | Se instala como app (PWA) y funciona sin internet; *Mis datos → Instalar como app*. |
| **Nube** | Cuenta con Supabase para sincronizar visitas, deseos y fotos entre dispositivos. |

## Sincronización en la nube (opcional)

Sin configurarla, todo funciona igual pero solo en el navegador que uses. Para activarla:

1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pega y ejecuta [`supabase/esquema.sql`](supabase/esquema.sql). Crea las tablas,
   las reglas de seguridad (cada usuario solo ve lo suyo), el bucket privado de fotos y la función
   del mapa público.
3. En **Project Settings → API**, copia la *Project URL* y la clave *anon public* en
   [`js/config.js`](js/config.js). La clave *anon* es pública por diseño; la seguridad la dan las reglas RLS.
4. En **Authentication → URL Configuration**, pon la dirección donde publicaste la app como
   *Site URL* y agrégala (más `http://localhost:3000`) a *Redirect URLs*.
5. Recomendado: en **Authentication → Email Templates → Magic Link**, agrega `{{ .Token }}` al mensaje.
   Así el correo trae también un código de 6 dígitos, que es la forma cómoda de entrar desde la
   app instalada (el enlace abre el navegador, no la app).

Cómo sincroniza: al entrar, al abrir la app, 3 segundos después de cada cambio y al recuperar la
conexión. Cada registro guarda cuándo cambió por última vez y gana el cambio más reciente; lo
borrado se guarda como "lápida" para que también se borre en los demás dispositivos.

El plan gratuito de Supabase incluye 1 GB para archivos: unas 3.000 fotos con el tamaño que usa la app.

**Mapa público**: en *Cuenta y sincronización → Mapa público* elige un nombre y actívalo. El enlace
(`?mapa=<id>`) muestra solo municipios y fechas, nunca notas ni fotos.

## Importar visitas

**Google Maps** (*Mis datos → Importar de Google Maps*). Desde 2024 la línea de tiempo vive en el
teléfono, no en Takeout:

- Android: *Ajustes → Ubicación → Servicios de ubicación → Cronología → Exportar datos de Cronología* (`Timeline.json`).
- iPhone: *Google Maps → tu foto → Cronología → ⋯ → Configuración → Exportar datos de Cronología*.
- También sirven copias antiguas de Takeout: `Semantic Location History/*.json` o `Records.json`.

Por defecto solo cuentan los lugares donde te detuviste. Los municipios por los que pasaste en
carretera se pueden incluir con una casilla. Los días seguidos en un mismo municipio forman una
sola visita, y nunca se duplica una visita que ya tengas en la misma fecha.

**Fotos** (*Mis datos → Importar desde fotos*): lee la ubicación GPS y la fecha EXIF (JPEG, HEIC…)
y opcionalmente guarda cada foto en su lugar. WhatsApp borra la ubicación de las fotos que envía;
usa las originales de la cámara.

Todo se procesa en el navegador; los archivos no se suben a ningún servidor.

## Ejecutar en tu computador

Necesitas [Node.js](https://nodejs.org) 18 o superior (solo para levantar un servidor local).

```bash
cd mi-colombia
npx serve .
```

Abre la dirección que aparece (normalmente http://localhost:3000).

> No abras `index.html` con doble clic: el navegador bloquea la carga del archivo de datos
> (`fetch`) y los módulos JavaScript cuando la página se abre como `file://`.
> Alternativa sin Node: `python -m http.server 8000` y abre http://localhost:8000.

## Publicar gratis

El proyecto es estático (HTML, CSS, JS y JSON), así que no hay paso de compilación. Las librerías
están copiadas en `vendor/` para que la app funcione sin conexión.

Tras publicar cambios, sube `VERSION` en `sw.js` para que las apps instaladas descarten la copia vieja.

**GitHub Pages**
1. Crea un repositorio en GitHub y sube el contenido de esta carpeta:
   ```bash
   git init
   git add .
   git commit -m "Mi Colombia"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/mi-colombia.git
   git push -u origin main
   ```
2. En el repositorio: *Settings → Pages → Build and deployment → Source: Deploy from a branch*,
   rama `main`, carpeta `/ (root)`.
3. En uno o dos minutos estará en `https://TU_USUARIO.github.io/mi-colombia/`.

**Netlify**: entra a https://app.netlify.com/drop y arrastra la carpeta `mi-colombia`.

**Vercel**: `npx vercel` dentro de la carpeta. Framework: *Other*; sin comando de build;
directorio de salida: `.`.

Cada dominio tiene su propio almacenamiento: las visitas guardadas en `localhost` no aparecen en
la versión publicada. Para moverlas, inicia sesión en la nube en ambos lados, o usa **Mis datos →
Exportar copia** e **Importar copia** (la copia JSON incluye visitas y deseos, no fotos).

## Datos geográficos

| | |
|---|---|
| Fuente | DANE – Marco Geoestadístico Nacional (MGN) **2025**, capa *Municipio* |
| Servicio | https://geoportal.dane.gov.co/mparcgis/rest/services/MGN2025/Serv_CapasMGN_2025/FeatureServer/317 |
| Entidades | 1.122 (1.103 municipios, 1 isla, 18 áreas no municipalizadas) en 33 departamentos |
| Identificador | código DIVIPOLA de 5 dígitos (`MPIO_CDPMP`) |
| Archivo | `data/municipios.topo.json` (TopoJSON, 1,8 MB; ~500 KB con gzip) |

**Cómo se generó** (`scripts/construir-datos.sh`, reproducible):

1. Descarga de las geometrías completas (~130 MB) en WGS84 desde el servicio del DANE, en lotes de 50.
2. Simplificación **topológica** con [mapshaper](https://github.com/mbloch/mapshaper) 0.6:
   `-simplify interval=100 keep-shapes -clean`
   - Visvalingam ponderado, tolerancia de **100 metros**.
   - Los límites compartidos se simplifican una sola vez, así que los vecinos siguen encajando sin
     huecos ni solapes (3.352 arcos compartidos).
   - `keep-shapes` impide que desaparezcan los municipios pequeños; `-clean` reparó 4 autointersecciones.
3. Exportación a TopoJSON cuantizado (1e5) con el DIVIPOLA como `id`.

Los límites departamentales no son otro archivo: se calculan en el navegador con `topojson.mesh` a
partir de los mismos arcos, y por eso coinciden exactamente con los municipales.

Para actualizar al MGN de otro año, cambia `MGN2025` en el script y ejecútalo con `bash scripts/construir-datos.sh`.

**Capas opcionales** (`scripts/construir-capas.sh`, se descargan solo al activarlas):

| Archivo | Fuente | Contenido |
|---|---|---|
| `data/centros-poblados.json` (400 KB) | DANE – MGN 2025, capa *Zona Urbana* (305) | 8.420 puntos: 1.104 cabeceras y los centros poblados, con altitud |
| `data/parques.topo.json` (170 KB) | Parques Nacionales Naturales – *Límites oficiales* | 66 áreas protegidas, simplificadas a 200 m |

El relieve son teselas de *Esri World Hillshade*: se cargan por internet y la app guarda en caché
las últimas 1.500 que viste.

## Estructura

```
index.html              Estructura de la página
manifest.webmanifest    Datos para instalar la app (PWA)
sw.js                   Service worker: funcionamiento sin conexión
css/estilos.css         Estilos, paleta clara/oscura y diseño responsivo
data/                   Municipios, centros poblados y parques
icons/                  Íconos de la app (scripts/generar-iconos.mjs)
vendor/                 Leaflet, leaflet.heat, topojson-client, exifr, supabase-js
supabase/esquema.sql    Tablas y reglas de seguridad para la nube
js/
  main.js               Conecta todo; modo edición y modo solo lectura
  config.js             URL y clave de Supabase (vacías = sin nube)
  data.js               Carga del TopoJSON, índices y búsqueda
  storage.js            Visitas y deseos en localStorage, importar/exportar, fusión para sincronizar
  fotos.js              Fotos en IndexedDB
  nube.js               Sesión y sincronización con Supabase
  map.js                Mapa Leaflet en Canvas, colores, capas, calor y rutas
  geo.js                ¿En qué municipio cae un punto GPS? (índice en rejilla)
  capas.js              Carga de centros poblados y parques
  logros.js             Retos y logros
  compartir.js          Codifica el mapa en la URL para compartir
  importar-externo.js   Lectura de Google Maps y EXIF de fotos; agrupación en visitas
  colors.js             Paleta, escala por año y leyenda
  export-png.js         Dibujo del mapa en PNG
  utils.js              Fechas, texto y descargas
  ui/                   Buscador, pestañas, ficha, resumen, retos, lista, galería,
                        cuenta, compartir, importación y avisos
scripts/
  construir-datos.sh    Regenera los municipios desde el DANE
  construir-capas.sh    Regenera centros poblados y parques
  generar-iconos.mjs    Dibuja los íconos PNG
```

## Formato de los datos

Copia de seguridad JSON (versión 2; también se importan copias de la versión 1):

```json
{
  "app": "mi-colombia", "version": 2,
  "visitas": [
    { "id": "…", "divipola": "05001", "fecha": "2024-03-15", "notas": "Feria de las flores", "calificacion": 5, "creada": 1710500000000 }
  ],
  "deseos": ["05364", "91001"]
}
```

`id` y `creada` son internos (para editar, eliminar y ordenar visitas del mismo día).
`calificacion` puede ser `null` si no calificaste. En el navegador cada registro guarda además
`actualizada` y `borrada`, que usa la sincronización.

## Licencia de los datos

La información geográfica es del DANE, entidad pública de Colombia. Cita la fuente al publicar:
"Límites municipales: DANE, Marco Geoestadístico Nacional 2025". Las áreas protegidas son de
Parques Nacionales Naturales de Colombia, y el relieve es de Esri (atribución visible en el mapa).
