/************************************************************
 * GeoIPT - bbox_test.js
 * Versión optimizada:
 * - Usa regiones.json para limitar las regiones a consultar.
 * - Solo carga listado.json de las regiones cuyo BBOX
 *   intersecta el BBOX de la pantalla.
 * - Luego filtra por BBOX de IPT y por geometría (KML/JSON).
 * - Si hay IPT que contienen el punto → abre info.html.
 * - Si no hay IPT que contengan el punto → vuelve a index.
 ************************************************************/

/* ---------------------------------------------------------
   1) LEER PARÁMETROS DE LA URL
---------------------------------------------------------*/
const urlParams = new URLSearchParams(window.location.search);
const lat = parseFloat(urlParams.get("lat"));
const lon = parseFloat(urlParams.get("lon"));
const bboxParam = urlParams.get("bbox"); // N,E,S,W
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

// Mostrar coordenadas en texto
const spanPunto = document.getElementById("txt-punto");
if (spanPunto && !isNaN(lat) && !isNaN(lon)) {
  spanPunto.textContent = `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`;
}

const spanBbox = document.getElementById("txt-bbox");
if (spanBbox && bboxPantalla) {
  spanBbox.textContent =
    `${bboxPantalla[0].toFixed(6)}, ${bboxPantalla[1].toFixed(6)}, ` +
    `${bboxPantalla[2].toFixed(6)}, ${bboxPantalla[3].toFixed(6)}`;
}

/* ---------------------------------------------------------
   2) MAPA LEAFLET
---------------------------------------------------------*/
const map = L.map("map").setView(
  (!isNaN(lat) && !isNaN(lon)) ? [lat, lon] : [-27, -70],
  zoom
);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

// Círculo del punto clic
if (!isNaN(lat) && !isNaN(lon)) {
  L.circleMarker([lat, lon], {
    radius: 6,
    color: "#ff6600",
    weight: 3
  }).addTo(map);
}

// Dibujar BBOX de pantalla
if (bboxPantalla) {
  const rect = L.rectangle(
    [
      [bboxPantalla[0], bboxPantalla[3]], // [N, W]
      [bboxPantalla[2], bboxPantalla[1]]  // [S, E]
    ],
    { color: "#00ff88", weight: 1, fillOpacity: 0.15 }
  );
  rect.addTo(map);
}

/* ---------------------------------------------------------
   3) UTILIDADES: BBOX
   Tus JSON usan bbox como [[S,W],[N,E]] → normalizamos
   a [N,E,S,W] para el motor.
---------------------------------------------------------*/
function normalizarBBoxSWNE(b) {
  if (!b || b.length !== 2) return null;
  const sw = b[0]; // [lat_s, lon_w]
  const ne = b[1]; // [lat_n, lon_e]
  const S = sw[0];
  const W = sw[1];
  const N = ne[0];
  const E = ne[1];
  return [N, E, S, W];
}

// Intersección de dos BBOX [N,E,S,W]
function intersectaBbox(b1, b2) {
  if (!b1 || !b2 || b1.length !== 4 || b2.length !== 4) return false;

  const [N1, E1, S1, W1] = b1;
  const [N2, E2, S2, W2] = b2;

  const noIntersecta =
    (S1 > N2) || // abajo > arriba
    (N1 < S2) || // arriba < abajo
    (W1 > E2) || // izq > der
    (E1 < W2);   // der < izq

  return !noIntersecta;
}

/* ---------------------------------------------------------
   4) CARGAR regiones + listado.json POR REGIÓN
---------------------------------------------------------*/

/**
 * Carga capas/regiones.json y devuelve la lista de IPT
 * solo de las regiones cuyo BBOX intersecta el BBOX
 * de la pantalla.
 */
async function cargarIptsDesdeRegiones(bboxPantalla) {
  const resp = await fetch("capas/regiones.json");
  if (!resp.ok) {
    throw new Error("No se pudo cargar capas/regiones.json");
  }

  const regiones = await resp.json(); // es un array
  const listaIpt = [];

  for (const reg of regiones) {
    const carpetaRegion = reg.carpeta || "";
    const bboxRegRaw = reg.bbox || null;
    const bboxRegionNorm = bboxRegRaw ? normalizarBBoxSWNE(bboxRegRaw) : null;

    // Si tenemos BBOX de región y BBOX de pantalla, filtramos
    if (bboxPantalla && bboxRegionNorm && !intersectaBbox(bboxRegionNorm, bboxPantalla)) {
      continue;
    }

    if (!carpetaRegion) {
      console.warn("Región sin carpeta definida:", reg);
      continue;
    }

    const urlListado = `capas/${carpetaRegion}/listado.json`;

    try {
      const respListado = await fetch(urlListado);
      if (!respListado.ok) {
        console.warn("No se pudo cargar listado:", urlListado);
        continue;
      }

      const datosListado = await respListado.json();

      const instrumentos =
        datosListado.instrumentos ||
        datosListado.listado ||
        (Array.isArray(datosListado) ? datosListado : []);

      instrumentos.forEach(ipt => {
        const bboxIptRaw = ipt.bbox || null;
        const bboxIptNorm = bboxIptRaw ? normalizarBBoxSWNE(bboxIptRaw) : null;

        listaIpt.push({
          ...ipt,
          carpeta: ipt.carpeta || datosListado.carpeta || carpetaRegion,
          region_nombre: datosListado.region || reg.nombre || "",
          codigo_region: datosListado.codigo_region || reg.codigo_ine || "",
          bboxNorm: bboxIptNorm
        });
      });
    } catch (e) {
      console.error("Error leyendo listado de región:", urlListado, e);
    }
  }

  return listaIpt;
}

/* ---------------------------------------------------------
   5) SEGUNDO FILTRO: GEOMETRÍA CONTIENE EL PUNTO
---------------------------------------------------------*/

/**
 * Revisa si un GeoJSON contiene el punto.
 */
function geojsonContienePunto(geojson, punto) {
  const pt = turf.point([punto.lon, punto.lat]);
  const features = geojson.features || [];

  for (const feat of features) {
    if (!feat.geometry) continue;
    const tipo = feat.geometry.type;

    if (tipo === "Polygon" || tipo === "MultiPolygon") {
      if (turf.booleanPointInPolygon(pt, feat)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Cargar KML/JSON de un IPT y comprobar si algún polígono contiene el punto.
 */
async function iptContienePunto(ipt, punto) {
  const carpeta = ipt.carpeta || "";
  const archivo = ipt.archivo || "";
  const url = `capas/${carpeta}/${archivo}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("No se pudo leer archivo:", url);
      return false;
    }

    const nombre = archivo.toLowerCase();

    if (nombre.endsWith(".json") || nombre.endsWith(".geojson")) {
      const gj = await resp.json();
      return geojsonContienePunto(gj, punto);
    }

    if (nombre.endsWith(".kml")) {
      const txt = await resp.text();
      const dom = new DOMParser().parseFromString(txt, "text/xml");
      const gj = toGeoJSON.kml(dom);
      return geojsonContienePunto(gj, punto);
    }

    console.warn("Formato no manejado para:", archivo);
    return false;
  } catch (err) {
    console.error("Error evaluando IPT", ipt, err);
    return false;
  }
}

/**
 * Recorre todos los IPT en pantalla y devuelve los que,
 * además, tienen geometrías que contienen al punto clic.
 */
async function filtrarIptsPorGeometria(iptsEnPantalla, punto) {
  const resultado = [];

  for (const ipt of iptsEnPantalla) {
    const contiene = await iptContienePunto(ipt, punto);
    if (contiene) resultado.push(ipt);
  }

  return resultado;
}

/* ---------------------------------------------------------
   6) FLUJO PRINCIPAL
---------------------------------------------------------*/
async function ejecutarFlujoBbox() {
  const preListado = document.getElementById("txt-instrumentos");
  const prePunto = document.getElementById("txt-instrumentos-punto");
  const btnReporte = document.getElementById("btn-reporte");

  if (preListado) {
    preListado.textContent =
      "(cargando instrumentos de las regiones que intersectan este BBOX...)";
  }
  if (prePunto) {
    prePunto.textContent = "(esperando resultado de la geometría...)";
  }
  if (btnReporte) {
    btnReporte.disabled = true;
    btnReporte.onclick = null;
  }

  try {
    // 1) Cargar IPT SOLO de regiones cuyo BBOX intersecta la pantalla
    const todosLosIpt = await cargarIptsDesdeRegiones(bboxPantalla);

    if (!todosLosIpt.length) {
      if (preListado) {
        preListado.textContent =
          "No se cargó ningún IPT para las regiones intersectadas.";
      }
      if (prePunto) prePunto.textContent = "No hay datos para analizar.";
      if (btnReporte) btnReporte.disabled = true;
      return;
    }

    // 2) Filtro 1: IPT cuyo BBOX intersecta el BBOX de pantalla
    let iptsEnBbox = todosLosIpt.filter(ipt => {
      const bb = ipt.bboxNorm;
      if (!bb || !bboxPantalla) return false;
      return intersectaBbox(bb, bboxPantalla);
    });

    if (iptsEnBbox.length === 0) {
      // Fallback: si no hay ninguno por BBOX, usamos todos los IPT
      if (preListado) {
        preListado.textContent =
          "⚠ Ningún IPT pasó el filtro BBOX. " +
          "Mostrando todos los IPT cargados de las regiones intersectadas (fallback).\n\n" +
          JSON.stringify(todosLosIpt, null, 2);
      }
      iptsEnBbox = todosLosIpt.slice();
    } else {
      if (preListado) {
        preListado.textContent = JSON.stringify(iptsEnBbox, null, 2);
      }
    }

    // 3) Filtro 2: GEOMETRÍA contiene el punto clic
    if (prePunto) {
      prePunto.textContent = "Analizando geometría de los IPT en pantalla...";
    }

    const iptsConPunto = await filtrarIptsPorGeometria(iptsEnBbox, puntoClick);

    if (!iptsConPunto.length) {
      // Caso fuera de IPT: mensaje + volver a index con último zoom
      if (prePunto) {
        prePunto.textContent =
          "⚠ Ningún IPT tiene polígonos que contengan exactamente el punto clic.\n" +
          "Volviendo al mapa principal para que pueda probar en un área urbana...";
      }
      if (btnReporte) {
        btnReporte.disabled = true;
        btnReporte.onclick = null;
      }

      // Pequeña pausa para que el usuario lea el mensaje
      setTimeout(() => {
        const urlIndex =
          `index.html?lat=${lat}&lon=${lon}&zoom=${zoom}`;
        window.location.href = urlIndex;
      }, 1800);

      return;
    }

    // Mostramos la lista final en pantalla
    if (prePunto) {
      prePunto.textContent = JSON.stringify(iptsConPunto, null, 2);
    }

    // 4) Preparar botón para llamar a info.html SOLO si hay IPT válidos
    if (btnReporte) {
      btnReporte.disabled = false;

      const bboxStr = bboxPantalla
        ? `${bboxPantalla[0]},${bboxPantalla[1]},${bboxPantalla[2]},${bboxPantalla[3]}`
        : "";

      const listaIpt = iptsConPunto
        .map(ipt => `capas/${ipt.carpeta}/${ipt.archivo}`)
        .join("|");

      const urlInfo =
        `info.html?lat=${lat}&lon=${lon}` +
        (bboxStr ? `&bbox=${bboxStr}` : "") +
        `&zoom=${zoom}` +
        `&ipts=${encodeURIComponent(listaIpt)}`;

      // Click manual (por si el usuario quiere reabrir)
      btnReporte.onclick = () => {
        window.open(urlInfo, "_blank");
      };

      // Auto-apertura de info.html
      window.open(urlInfo, "_blank");
    }
  } catch (err) {
    console.error(err);
    if (preListado) {
      preListado.textContent =
        "Error cargando capas/regiones.json o capas/capas_xx/listado.json.";
    }
    if (prePunto) {
      prePunto.textContent =
        "No se pudo completar el análisis de geometría.";
    }
    if (btnReporte) {
      btnReporte.disabled = true;
      btnReporte.onclick = null;
    }
  }
}

/* ---------------------------------------------------------
   7) EJECUTAR
---------------------------------------------------------*/
ejecutarFlujoBbox();
