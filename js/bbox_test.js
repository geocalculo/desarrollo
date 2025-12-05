/************************************************************
 * GeoIPT - bbox_test.js  (Versión optimizada)
 * 
 * PASO 1: Determinar qué REGIONES tocan la pantalla
 * PASO 2: De esas regiones, determinar qué IPT tocan la pantalla
 * PASO 3: De esos IPT, detectar cuáles contienen el clic (geometría)
 * PASO 4: Mandar la lista de IPT a info.html en PESTAÑA NUEVA
 * 
 * Si ningún IPT contiene el clic → volver a index.html con zoom.
 ************************************************************/

/* ---------------------------------------------------------
   1) LEER PARÁMETROS DE LA URL
---------------------------------------------------------*/
const urlParams = new URLSearchParams(window.location.search);
const lat = parseFloat(urlParams.get("lat"));
const lon = parseFloat(urlParams.get("lon"));
const bboxParam = urlParams.get("bbox");
const zoomParam = parseInt(urlParams.get("zoom"), 10);
const zoom = Number.isFinite(zoomParam) ? zoomParam : 14;

let bboxPantalla = null;
if (bboxParam) {
  const s = bboxParam.split(",");
  bboxPantalla = [
    parseFloat(s[0]), // N
    parseFloat(s[1]), // E
    parseFloat(s[2]), // S
    parseFloat(s[3])  // W
  ];
}

const puntoClick = { lat, lon };

// Mostrar en pantalla
document.getElementById("txt-punto").textContent =
  `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`;

document.getElementById("txt-bbox").textContent =
  `${bboxPantalla[0].toFixed(6)}, ${bboxPantalla[1].toFixed(6)}, ` +
  `${bboxPantalla[2].toFixed(6)}, ${bboxPantalla[3].toFixed(6)}`;

/* ---------------------------------------------------------
   2) MAPA (visualización)
---------------------------------------------------------*/
const map = L.map("map").setView([lat, lon], zoom);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

L.circleMarker([lat, lon], { radius: 6, color: "#ff6600", weight: 3 }).addTo(map);

L.rectangle(
  [
    [bboxPantalla[0], bboxPantalla[3]],
    [bboxPantalla[2], bboxPantalla[1]]
  ],
  { color: "#00ff88", weight: 1, fillOpacity: 0.15 }
).addTo(map);

/* ---------------------------------------------------------
   UTILIDADES DE BBOX
---------------------------------------------------------*/
function normalizarBBoxSWNE(b) {
  if (!b || b.length !== 2) return null;
  const sw = b[0];
  const ne = b[1];
  return [ne[0], ne[1], sw[0], sw[1]]; // [N, E, S, W]
}

function intersectaBbox(a, b) {
  if (!a || !b) return false;
  const [N1, E1, S1, W1] = a;
  const [N2, E2, S2, W2] = b;

  return !(S1 > N2 || N1 < S2 || W1 > E2 || E1 < W2);
}

/* ---------------------------------------------------------
   PASO 1: Cargar regiones que tocan la pantalla
---------------------------------------------------------*/
async function obtenerRegionesIntersectadas() {
  const resp = await fetch("capas/regiones.json");
  const regiones = await resp.json();

  return regiones.filter(reg => {
    const bboxReg = normalizarBBoxSWNE(reg.bbox);
    return intersectaBbox(bboxReg, bboxPantalla);
  });
}

/* ---------------------------------------------------------
   PASO 2: Cargar IPT cuyo BBOX toca la pantalla
---------------------------------------------------------*/
async function obtenerIptEnPantalla(regiones) {
  const lista = [];

  for (const reg of regiones) {
    const carpeta = reg.carpeta;
    const urlListado = `capas/${carpeta}/listado.json`;

    try {
      const resp = await fetch(urlListado);
      const datos = await resp.json();
      const instrumentos = datos.instrumentos || [];

      for (const ipt of instrumentos) {
        const bboxNorm = normalizarBBoxSWNE(ipt.bbox);
        if (intersectaBbox(bboxNorm, bboxPantalla)) {
          lista.push({
            carpeta: carpeta,
            archivo: ipt.archivo,
            bboxNorm: bboxNorm
          });
        }
      }
    } catch (e) {
      console.warn("No se pudo leer:", urlListado);
    }
  }

  return lista;
}

/* ---------------------------------------------------------
   PASO 3: Verificar qué IPT contienen el clic (geometría)
---------------------------------------------------------*/
async function iptContienePunto(ipt) {
  const url = `capas/${ipt.carpeta}/${ipt.archivo}`;
  try {
    const resp = await fetch(url);
    const txt = await resp.text();
    const dom = new DOMParser().parseFromString(txt, "text/xml");
    const gj = toGeoJSON.kml(dom);

    const pt = turf.point([lon, lat]);

    for (const f of gj.features) {
      if (f.geometry &&
          (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")) {
        if (turf.booleanPointInPolygon(pt, f)) {
          return true;
        }
      }
    }
  } catch (e) {
    console.error("Error leyendo IPT:", ipt.archivo, e);
  }
  return false;
}

async function obtenerIptQueContienenElPunto(listaIpt) {
  const resultado = [];
  for (const ipt of listaIpt) {
    if (await iptContienePunto(ipt)) resultado.push(ipt);
  }
  return resultado;
}

/* ---------------------------------------------------------
   PASO 4: Si hay IPT válidos → ir a info.html
          Si no hay → volver a index.html
---------------------------------------------------------*/
function abrirInfoHtml(listaIpt) {
  const rutas = listaIpt
    .map(ipt => `capas/${ipt.carpeta}/${ipt.archivo}`)
    .join("|");

  const url =
    `info.html?lat=${lat}&lon=${lon}&zoom=${zoom}` +
    `&bbox=${bboxPantalla.join(",")}` +
    `&ipts=${encodeURIComponent(rutas)}`;

  // Abrir en pestaña nueva:
  window.open(url, "_blank");
}

function volverAIndex() {
  const url = `index.html?lat=${lat}&lon=${lon}&zoom=${zoom}`;
  window.location.href = url;
}

/* ---------------------------------------------------------
   MÓDULO PRINCIPAL
---------------------------------------------------------*/
async function ejecutarFlujo() {

  const pre1 = document.getElementById("txt-instrumentos");
  const pre2 = document.getElementById("txt-instrumentos-punto");

  pre1.textContent = "(Cargando regiones que intersectan BBOX...)";

  // PASO 1
  const regiones = await obtenerRegionesIntersectadas();

  // PASO 2
  pre1.textContent = "(Cargando IPT de regiones intersectadas...)";
  const iptEnPantalla = await obtenerIptEnPantalla(regiones);

  pre1.textContent = JSON.stringify(iptEnPantalla, null, 2);

  if (!iptEnPantalla.length) {
    pre2.textContent = "⚠ No hay IPT en pantalla. Volviendo...";
    return setTimeout(volverAIndex, 1500);
  }

  // PASO 3
  pre2.textContent = "(Analizando geometría de IPT...)";
  const iptConPunto = await obtenerIptQueContienenElPunto(iptEnPantalla);

  if (!iptConPunto.length) {
    pre2.textContent =
      "⚠ Ningún IPT contiene el clic.\nVolviendo al mapa...";
    return setTimeout(volverAIndex, 1500);
  }

  pre2.textContent = JSON.stringify(iptConPunto, null, 2);

  // PASO 4 → info.html (pestaña nueva)
  abrirInfoHtml(iptConPunto);
}

ejecutarFlujo();
