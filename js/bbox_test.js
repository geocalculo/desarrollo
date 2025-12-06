/************************************************************
 * GeoIPT - bbox_test.js  (Versión ajustada con polígonos AZULES)
 *
 * PASO 1: Regiones cuyo BBOX toca la pantalla
 * PASO 2: IPT cuyo BBOX toca la pantalla
 * PASO 3: IPT cuya GEOMETRÍA contiene el clic
 * PASO 4: Si hay IPT → habilitar botón y abrir info.html
 *         Si no hay  → mensaje + volver a index.html
 *
 * Cambios:
 *  - Se elimina el rectángulo verde del BBOX
 *  - Se dibujan en AZUL los polígonos que contienen el punto
 *  - Se muestra metadata de TODOS los polígonos match
 ************************************************************/

/* ---------------------------------------------
   1) PARÁMETROS DE LA URL
---------------------------------------------*/
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

// Mostrar en texto
if (!isNaN(lat) && !isNaN(lon)) {
  document.getElementById("txt-punto").textContent =
    `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`;
}
if (bboxPantalla) {
  document.getElementById("txt-bbox").textContent =
    `${bboxPantalla[0].toFixed(6)}, ${bboxPantalla[1].toFixed(6)}, ` +
    `${bboxPantalla[2].toFixed(6)}, ${bboxPantalla[3].toFixed(6)}`;
}

/* ---------------------------------------------
   2) MAPA LEAFLET
---------------------------------------------*/
const map = L.map("map").setView(
  (!isNaN(lat) && !isNaN(lon)) ? [lat, lon] : [-27, -70],
  zoom
);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

if (!isNaN(lat) && !isNaN(lon)) {
  L.circleMarker([lat, lon], {
    radius: 6,
    color: "#ff6600",
    weight: 3
  }).addTo(map);
}

/* ***********************************************
   ❌ NO DIBUJAMOS EL RECTÁNGULO VERDE DEL BBOX
   (solo usamos bboxPantalla para la lógica)
*********************************************** */
// if (bboxPantalla) {
//   L.rectangle(...).addTo(map);
// }

/* ---------------------------------------------
   UTILIDADES DE BBOX
---------------------------------------------*/
function normalizarBBoxSWNE(b) {
  if (!b || b.length !== 2) return null;
  const sw = b[0]; // [lat_s, lon_w]
  const ne = b[1]; // [lat_n, lon_e]
  return [ne[0], ne[1], sw[0], sw[1]]; // [N, E, S, W]
}

function intersectaBbox(a, b) {
  if (!a || !b) return false;
  const [N1, E1, S1, W1] = a;
  const [N2, E2, S2, W2] = b;
  return !(S1 > N2 || N1 < S2 || W1 > E2 || E1 < W2);
}

/* ---------------------------------------------
   PASO 1: Regiones que intersectan el BBOX
---------------------------------------------*/
async function obtenerRegionesIntersectadas() {
  const resp = await fetch("capas/regiones.json");
  const regiones = await resp.json();

  return regiones.filter(reg => {
    const bboxReg = normalizarBBoxSWNE(reg.bbox);
    return intersectaBbox(bboxReg, bboxPantalla);
  });
}

/* ---------------------------------------------
   PASO 2: IPT cuyo BBOX intersecta el BBOX
---------------------------------------------*/
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
            carpeta,
            archivo: ipt.archivo,
            bboxNorm
          });
        }
      }
    } catch (e) {
      console.warn("No se pudo leer listado:", urlListado, e);
    }
  }

  return lista;
}

/* ---------------------------------------------
   PASO 3: IPT cuya GEOMETRÍA contiene el clic
---------------------------------------------*/

// Capa global para los polígonos match AZULES
let matchLayer = null;

async function iptContienePunto(ipt, acumuladorFeatures) {
  const url = `capas/${ipt.carpeta}/${ipt.archivo}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("No se pudo leer IPT:", url);
      return false;
    }

    const txt = await resp.text();
    const dom = new DOMParser().parseFromString(txt, "text/xml");
    const gj = toGeoJSON.kml(dom);

    const pt = turf.point([lon, lat]);

    for (const f of gj.features) {
      if (
        !f.geometry ||
        !["Polygon", "MultiPolygon"].includes(f.geometry.type)
      ) {
        continue;
      }

      if (turf.booleanPointInPolygon(pt, f)) {
        // Guardamos feature + metadata + archivo/carpeta
        acumuladorFeatures.push({
          feature: f,
          metadata: f.properties || {},
          archivo: ipt.archivo,
          carpeta: ipt.carpeta
        });

        return true;
      }
    }
  } catch (e) {
    console.error("Error leyendo IPT:", ipt.archivo, e);
  }

  return false;
}

async function obtenerIptQueContienenElPunto(listaIpt) {
  const resultado = [];
  const featuresParaDibujar = [];

  for (const ipt of listaIpt) {
    if (await iptContienePunto(ipt, featuresParaDibujar)) {
      resultado.push(ipt);
    }
  }

  // Si hay matches, dibujamos y mostramos metadata
  if (featuresParaDibujar.length > 0) {
    dibujarPoligonosMatch(featuresParaDibujar.map(f => f.feature));

    const metaBox = document.getElementById("txt-metadata-poligono");
    if (metaBox) {
      let texto = "";

      featuresParaDibujar.forEach((item, idx) => {
        const meta = item.metadata || {};
        const archivo = item.archivo || "(desconocido)";
        const carpeta = item.carpeta || "";

        texto += `#${idx + 1} ${carpeta}/${archivo}\n`;
        texto += Object.entries(meta)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        texto += "\n\n";
      });

      metaBox.textContent = texto.trim() || "(sin metadata disponible)";
    }
  } else {
    const metaBox = document.getElementById("txt-metadata-poligono");
    if (metaBox) {
      metaBox.textContent =
        "(ningún polígono contiene el punto clic en los IPT analizados)";
    }
  }

  return resultado;
}

/* ---------------------------------------------
   Dibujar polígonos match en AZUL
---------------------------------------------*/
function dibujarPoligonosMatch(features) {
  // Borrar resaltado anterior
  if (matchLayer) {
    map.removeLayer(matchLayer);
    matchLayer = null;
  }

  if (!features || !features.length) return;

  const fc = {
    type: "FeatureCollection",
    features
  };

  matchLayer = L.geoJSON(fc, {
    style: {
      color: "#2563eb",      // borde azul
      weight: 2,
      fillColor: "#3b82f6",  // relleno azul
      fillOpacity: 0.35
    }
  }).addTo(map);

  try {
    const bounds = matchLayer.getBounds();
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  } catch (e) {
    // por si acaso
  }
}

/* ---------------------------------------------
   PASO 4: Navegación (info.html / index.html)
---------------------------------------------*/
function volverAIndex() {
  const url = `index.html?lat=${lat}&lon=${lon}&zoom=${zoom}`;
  window.location.href = url;
}

function prepararBotonReporte(iptsConPunto) {
  const btn = document.getElementById("btn-reporte");
  if (!btn) return;

  if (!iptsConPunto || !iptsConPunto.length) {
    btn.disabled = true;
    btn.style.opacity = 0.5;
    btn.onclick = null;
    return;
  }

  btn.disabled = false;
  btn.style.opacity = 1;
  btn.style.cursor = "pointer";

  const rutas = iptsConPunto
    .map(ipt => `capas/${ipt.carpeta}/${ipt.archivo}`)
    .join("|");

  const bboxStr = bboxPantalla ? bboxPantalla.join(",") : "";

  const urlInfo =
    `info.html?lat=${lat}&lon=${lon}` +
    `&zoom=${zoom}` +
    (bboxStr ? `&bbox=${bboxStr}` : "") +
    `&ipts=${encodeURIComponent(rutas)}`;

  btn.onclick = () => {
    window.location.href = urlInfo;
  };
}

/* ---------------------------------------------
   FLUJO PRINCIPAL
---------------------------------------------*/
async function ejecutarFlujo() {
  const pre1 = document.getElementById("txt-instrumentos");
  const pre2 = document.getElementById("txt-instrumentos-punto");
  const preMeta = document.getElementById("txt-metadata-poligono");
  const btn = document.getElementById("btn-reporte");

  if (btn) {
    btn.disabled = true;
    btn.style.opacity = 0.5;
    btn.onclick = null;
  }

  if (pre1) pre1.textContent = "(Cargando regiones que intersectan el BBOX...)";
  if (pre2) pre2.textContent = "";
  if (preMeta) preMeta.textContent = "(sin datos aún)";

  // PASO 1
  const regiones = await obtenerRegionesIntersectadas();

  // PASO 2
  if (pre1) pre1.textContent = "(Cargando IPT de las regiones intersectadas...)";
  const iptEnPantalla = await obtenerIptEnPantalla(regiones);

  if (pre1) pre1.textContent = JSON.stringify(iptEnPantalla, null, 2);

  if (!iptEnPantalla.length) {
    if (pre2) {
      pre2.textContent =
        "⚠ No hay IPT cuyo BBOX intersecte la pantalla en este clic.\n" +
        "Sugerencia: regrese al mapa principal y haga clic sobre un área urbana.";
    }
    if (preMeta) {
      preMeta.textContent =
        "(no se encontraron IPT intersectando el BBOX para este clic)";
    }
    prepararBotonReporte([]);
    setTimeout(volverAIndex, 2000);
    return;
  }

  // PASO 3
  if (pre2) pre2.textContent = "(Analizando geometría de los IPT en pantalla...)";
  const iptConPunto = await obtenerIptQueContienenElPunto(iptEnPantalla);

  if (!iptConPunto.length) {
    if (pre2) {
      pre2.textContent =
        "⚠ Ningún IPT tiene polígonos que contengan exactamente el punto clic.\n" +
        "Sugerencia: regrese al mapa principal y haga clic sobre un área urbana.";
    }
    if (preMeta) {
      preMeta.textContent =
        "(ningún polígono de los IPT intersectados contiene el punto clic)";
    }
    prepararBotonReporte([]);
    setTimeout(volverAIndex, 2000);
    return;
  }

  if (pre2) {
    pre2.textContent = JSON.stringify(iptConPunto, null, 2);
  }

  // PASO 4: habilitar botón reporte
  prepararBotonReporte(iptConPunto);
}

// Ejecutar flujo
ejecutarFlujo();
