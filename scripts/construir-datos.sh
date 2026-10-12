#!/usr/bin/env bash
# Regenera data/municipios.topo.json a partir del servicio oficial del DANE.
#
# Fuente: DANE – Marco Geoestadístico Nacional (MGN) 2025, capa "Municipio" (id 317)
#   https://geoportal.dane.gov.co/mparcgis/rest/services/MGN2025/Serv_CapasMGN_2025/FeatureServer/317
#
# Pasos:
#   1. Descarga las 1.122 entidades en lotes de 50 (el servicio limita a 2.000 por consulta
#      y las geometrías completas pesan ~130 MB) en WGS84 (outSR=4326), 6 decimales.
#   2. Une los lotes en un solo GeoJSON.
#   3. Simplifica con mapshaper de forma TOPOLÓGICA: los límites compartidos se
#      simplifican una sola vez, así los vecinos siguen encajando sin huecos ni solapes.
#      - Método: Visvalingam ponderado (el predeterminado de mapshaper)
#      - Tolerancia: interval=100 (metros)
#      - keep-shapes: ningún municipio pequeño desaparece
#      - clean: repara las pocas autointersecciones que deja la simplificación
#   4. Exporta TopoJSON cuantizado (1e5) con el código DIVIPOLA como id.
#
# Requisitos: bash, curl y Node.js 18+ (Git Bash sirve en Windows).
# Uso: bash scripts/construir-datos.sh
set -euo pipefail

cd "$(dirname "$0")/.."
SERVICIO="https://geoportal.dane.gov.co/mparcgis/rest/services/MGN2025/Serv_CapasMGN_2025/FeatureServer/317/query"
CAMPOS="DPTO_CCDGO,MPIO_CDPMP,DPTO_CNMBRE,MPIO_CNMBRE,MPIO_TIPO"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Consultando rango de OBJECTID…"
curl -sL "$SERVICIO?where=1%3D1&returnIdsOnly=true&f=json" -o "$TMP/ids.json"
read -r MIN MAX < <(node -e '
  const ids = require(process.argv[1]).objectIds;
  console.log(Math.min(...ids), Math.max(...ids));' "$TMP/ids.json")

echo "→ Descargando municipios ($MIN–$MAX) en lotes de 50…"
mkdir -p "$TMP/lotes"
for ((i = MIN; i <= MAX; i += 50)); do
  curl -sL --retry 3 --max-time 300 \
    -o "$TMP/lotes/$i.json" \
    "$SERVICIO?where=OBJECTID%3E%3D$i%20AND%20OBJECTID%3C$((i + 50))&outFields=$CAMPOS&outSR=4326&geometryPrecision=6&f=geojson"
  printf '.'
done
echo

echo "→ Uniendo lotes…"
node -e '
  const fs = require("fs"), dir = process.argv[1];
  const features = fs.readdirSync(dir).flatMap(f => JSON.parse(fs.readFileSync(dir + "/" + f, "utf8")).features);
  const ids = new Set(features.map(f => f.properties.MPIO_CDPMP));
  if (features.length !== ids.size) throw new Error("Códigos DIVIPOLA duplicados");
  console.log("  entidades:", features.length);
  fs.writeFileSync(process.argv[2], JSON.stringify({ type: "FeatureCollection", features }));
' "$TMP/lotes" "$TMP/municipios.geojson"

echo "→ Simplificando con mapshaper (interval=100 m)…"
mkdir -p data
npx --yes mapshaper@0.6 "$TMP/municipios.geojson" \
  -rename-fields id=MPIO_CDPMP,nombre=MPIO_CNMBRE,dpto=DPTO_CCDGO,dpto_nombre=DPTO_CNMBRE,tipo=MPIO_TIPO \
  -rename-layers municipios \
  -simplify interval=100 keep-shapes \
  -clean \
  -o format=topojson quantization=1e5 id-field=id data/municipios.topo.json

echo "✓ Listo: data/municipios.topo.json"
