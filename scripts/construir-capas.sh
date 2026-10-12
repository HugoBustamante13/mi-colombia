#!/usr/bin/env bash
# Regenera las capas opcionales del mapa:
#
#   data/centros-poblados.json   Cabeceras municipales y centros poblados (puntos)
#     Fuente: DANE – MGN 2025, capa "Zona Urbana" (id 305), 8.420 entidades.
#     Se guarda solo el centroide de cada zona urbana, no el polígono.
#     Formato compacto: { campos: [...], filas: [[lon, lat, nombre, divipola, clase, altitud], …] }
#       clase 1 = cabecera municipal, 2 = centro poblado.
#
#   data/parques.topo.json       Áreas protegidas del Sistema de Parques Nacionales Naturales
#     Fuente: Parques Nacionales Naturales de Colombia, "Límites oficiales" (polígonos).
#     Simplificado con mapshaper (interval=200 m, keep-shapes).
#
# Requisitos: bash, curl y Node.js 18+ (Git Bash sirve en Windows).
# Uso: bash scripts/construir-capas.sh
set -euo pipefail

cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p data

# ---------- Centros poblados (DANE) ----------
ZU="https://geoportal.dane.gov.co/mparcgis/rest/services/MGN2025/Serv_CapasMGN_2025/FeatureServer/305/query"
CAMPOS="MPIO_CDPMP,CLAS_CCDGO,ZU_CNMBRE,ZU_NALTD"

echo "→ Centros poblados: consultando rango de OBJECTID…"
curl -sL "$ZU?where=1%3D1&returnIdsOnly=true&f=json" -o "$TMP/zu-ids.json"
read -r MIN MAX < <(node -e '
  const ids = require(process.argv[1]).objectIds;
  console.log(Math.min(...ids), Math.max(...ids));' "$TMP/zu-ids.json")

mkdir -p "$TMP/zu"
for ((i = MIN; i <= MAX; i += 1000)); do
  curl -sL --retry 3 --max-time 300 -o "$TMP/zu/$i.json" \
    "$ZU?where=OBJECTID%3E%3D$i%20AND%20OBJECTID%3C$((i + 1000))&outFields=$CAMPOS&returnGeometry=false&returnCentroid=true&outSR=4326&f=json"
  printf '.'
done
echo

node -e '
  const fs = require("fs"), dir = process.argv[1];
  const filas = [];
  for (const archivo of fs.readdirSync(dir)) {
    const j = JSON.parse(fs.readFileSync(dir + "/" + archivo, "utf8"));
    if (j.error) throw new Error(archivo + ": " + JSON.stringify(j.error));
    for (const f of j.features) {
      const a = f.attributes, c = f.centroid;
      if (!c) continue;
      filas.push([
        +c.x.toFixed(5), +c.y.toFixed(5),
        a.ZU_CNMBRE, a.MPIO_CDPMP, Number(a.CLAS_CCDGO),
        a.ZU_NALTD == null ? null : Math.round(a.ZU_NALTD),
      ]);
    }
  }
  filas.sort((x, y) => x[3].localeCompare(y[3]) || x[4] - y[4] || x[2].localeCompare(y[2]));
  console.log("  centros poblados:", filas.length);
  fs.writeFileSync(process.argv[2], JSON.stringify({
    fuente: "DANE – MGN 2025, Zona Urbana",
    campos: ["lon", "lat", "nombre", "divipola", "clase", "altitud"],
    filas,
  }));
' "$TMP/zu" data/centros-poblados.json

# ---------- Parques Nacionales Naturales ----------
PNN="https://mapas.parquesnacionales.gov.co/arcgis/rest/services/pnn/Limites_oficiales_Poligono/FeatureServer/0/query"
echo "→ Parques nacionales: descargando polígonos…"
curl -sL --retry 3 --max-time 600 -o "$TMP/parques.geojson" \
  "$PNN?where=1%3D1&outFields=ap_nombre,ap_categoria,ap_id&outSR=4326&geometryPrecision=5&f=geojson"
node -e '
  const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!j.features?.length) throw new Error("Respuesta sin polígonos: " + JSON.stringify(j).slice(0, 300));
  console.log("  áreas protegidas:", j.features.length);' "$TMP/parques.geojson"

npx --yes mapshaper@0.6 "$TMP/parques.geojson" \
  -rename-fields nombre=ap_nombre,categoria=ap_categoria,id=ap_id \
  -rename-layers parques \
  -simplify interval=200 keep-shapes \
  -clean \
  -o format=topojson quantization=1e5 data/parques.topo.json

echo "✓ Listo: data/centros-poblados.json y data/parques.topo.json"
