/************************************************************
 * GeoIPT - bbox_test.js
 *
 * Flujo:
 * 1. Recibe lat, lon y bbox (N,E,S,W) desde la URL.
 * 2. Muestra punto y BBOX en el mapa.
 * 3. Carga capas/regiones.json.
 * 4. Por cada región cuyo BBOX intersecta la pantalla, carga
 *    capas/capas_xx/listado.json y junta todos los IPT.
 * 5. Filtro 1: IPT cuyo BBOX intersecta el BBOX de pantalla.
 *    - Si el IPT tiene bbox propio, se usa ese.
 *    - Si no, se usa el bbox de la región.  (OPCIÓN A)
 * 6. Filtro 2: de esos, IPT donde la geometría (KML/JSON)
 *    contiene el punto clic.
 * 7. Solo si hay IPT del filtro 2, se habilita el botón para
 *    llamar a info.html con la lista de IPT.
 ************************************************************/

/* ---------------------------------------------------------
   1) LEER PARÁMETROS DE LA URL
---------------------------------------------------------*/
const urlParams = new URLSearchParams(window.location.search);
const lat = parseFloat(urlParams.get("lat"));
const lon = parseFloat(urlParams.get("lon"));
const bboxParam = urlParams.get("bbox"); // N,E,S,W

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
  14
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
 * Carga capas/regiones.json y devuelve una lista de IPT
 * de todas las regiones cuyo BBOX intersecta el BBOX de pantalla.
 *
 * estructuras:
 *   capas/regiones.json -> [ { carpeta, bbox:[[S,W],[N,E]], ... } ]
 *   capas/capas_xx/listado.json -> {
 *       region, codigo_region, carpeta, instrumentos:[...]
 *   }
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

    // Si hay bbox de región y NO intersecta la pantalla, se omite
    if (bboxRegionNorm && bboxPantalla && !intersectaBbox(bboxRegionNorm, bboxPantalla)) {
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

      // Ejemplo: { region, codigo_region, carpeta, instrumentos:[...] }
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
          bboxNorm: bboxIptNorm,
          bboxRegionNorm: bboxRegionNorm
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
 * además, tienen geometrías que contienen el punto clic.
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
      "(cargando instrumentos desde capas/regiones.json y capas/capas_xx/listado.json...)";
  }
  if (prePunto) {
    prePunto.textContent = "(esperando resultado de la geometría...)";
  }
  if (btnReporte) {
    btnReporte.disabled = true;
  }

  try {
    // 1) Cargar todos los IPT desde regiones + listados
    const todosLosIpt = await cargarIptsDesdeRegiones(bboxPantalla);

    // 2) Filtro 1: IPT cuyo BBOX intersecta el BBOX de pantalla
    //    (usa bbox del IPT si existe, si no, bbox de región)
    const iptsEnBbox = todosLosIpt.filter(ipt => {
      const bb = ipt.bboxNorm || ipt.bboxRegionNorm || null;
      if (!bb || !bboxPantalla) return false;
      return intersectaBbox(bb, bboxPantalla);
    });

    if (preListado) {
      preListado.textContent = JSON.stringify(iptsEnBbox, null, 2);
    }

    if (!iptsEnBbox.length) {
      if (prePunto) {
        prePunto.textContent =
          "No hay IPT cuyo BBOX intersecte la pantalla en este clic.";
      }
      if (btnReporte) btnReporte.disabled = true;
      return;
    }

    // 3) Filtro 2: GEOMETRÍA contiene el punto clic
    if (prePunto) {
      prePunto.textContent = "Analizando geometría de los IPT en pantalla...";
    }

    const iptsConPunto = await filtrarIptsPorGeometria(iptsEnBbox, puntoClick);

    if (!iptsConPunto.length) {
      if (prePunto) {
        prePunto.textContent =
          "⚠ Ningún IPT tiene polígonos que contengan exactamente el punto clic.\n" +
          "Sugerencia: regrese al mapa principal y haga clic sobre un área urbana.";
      }
      if (btnReporte) btnReporte.disabled = true;
      return;
    }

    // Mostramos la lista final en pantalla
    if (prePunto) {
      prePunto.textContent = JSON.stringify(iptsConPunto, null, 2);
    }

    // 4) Preparar botón para llamar a info.html SOLO si hay IPT válidos
    if (btnReporte) {
      btnReporte.disabled = false;

      btnReporte.onclick = () => {
        const bboxStr = bboxPantalla
          ? `${bboxPantalla[0]},${bboxPantalla[1]},${bboxPantalla[2]},${bboxPantalla[3]}`
          : "";

        // Para info.html le pasamos rutas relativas listas para hacer fetch:
        //   capas/capas_03/IPT_03_PRC_Copiapo.kml|...
        const listaIpt = iptsConPunto
          .map(ipt => `capas/${ipt.carpeta}/${ipt.archivo}`)
          .join("|");

        const url =
          `info.html?lat=${lat}&lon=${lon}` +
          (bboxStr ? `&bbox=${bboxStr}` : "") +
          `&ipts=${encodeURIComponent(listaIpt)}`;

        window.open(url, "_blank");
      };
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
    }
  }
}

/* ---------------------------------------------------------
   7) EJECUTAR
---------------------------------------------------------*/
ejecutarFlujoBbox();
