/************************************************************
 * GeoIPT - bbox_test.js
 * Flujo:
 * 1. Recibe lat, lon, bbox desde la URL.
 * 2. Muestra punto y BBOX en el mapa.
 * 3. Carga capas/regiones.json.
 * 4. Por cada región cuyo BBOX intersecta la pantalla, carga
 *    capas_xx/listado.json y junta todos los IPT.
 * 5. Filtro 1: IPT cuyo BBOX intersecta el BBOX de pantalla.
 * 6. Filtro 2: de esos, IPT donde la geometría (KML/JSON)
 *    contiene el punto clic.
 * 7. Solo si hay IPT del filtro 2, habilita el botón para
 *    llamar a info.html.
 ************************************************************/

/* ---------------------------------------------------------
   1) LEER PARÁMETROS DE LA URL
---------------------------------------------------------*/
const params = new URLSearchParams(window.location.search);
const lat = parseFloat(params.get("lat"));
const lon = parseFloat(params.get("lon"));
const bboxParam = params.get("bbox");   // N,E,S,W

let bbox = null;
if (bboxParam) {
  const s = bboxParam.split(",");
  bbox = {
    N: parseFloat(s[0]),
    E: parseFloat(s[1]),
    S: parseFloat(s[2]),
    W: parseFloat(s[3])
  };
}

const puntoClick = { lat, lon };

// Mostrar coordenadas en texto
const spanPunto = document.getElementById("txt-punto");
if (spanPunto && !isNaN(lat) && !isNaN(lon)) {
  spanPunto.textContent = `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`;
}

const spanBbox = document.getElementById("txt-bbox");
if (spanBbox && bbox) {
  spanBbox.textContent =
    `${bbox.N.toFixed(6)}, ${bbox.E.toFixed(6)}, ` +
    `${bbox.S.toFixed(6)}, ${bbox.W.toFixed(6)}`;
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
if (bbox) {
  const rect = L.rectangle(
    [
      [bbox.N, bbox.W],
      [bbox.S, bbox.E]
    ],
    { color: "#00ff88", weight: 1 }
  );
  rect.addTo(map);
}

/* ---------------------------------------------------------
   3) UTILIDADES DE BBOX
---------------------------------------------------------*/
function intersectaBbox(b1, b2) {
  if (!b1 || !b2 || b1.length !== 4) return false;

  const [N, E, S, W] = b1;
  const noIntersecta =
    (S > b2.N) || // abajo > arriba
    (N < b2.S) || // arriba < abajo
    (W > b2.E) || // izq > der
    (E < b2.W);   // der < izq

  return !noIntersecta;
}

/* ---------------------------------------------------------
   4) CARGAR regiones + listado.json POR REGIÓN
---------------------------------------------------------*/

/**
 * Carga capas/regiones.json y devuelve una lista de IPT
 * de todas las regiones cuyo BBOX intersecta el BBOX de pantalla.
 *
 * Estructura asumida:
 *   capas/regiones.json -> { regiones_ipt: [ { carpeta, bbox, ... } ] }
 *   cada carpeta -> capas_xx/listado.json
 *     { instrumentos: [ { archivo, carpeta?, bbox, ... } ] }
 */
async function cargarIptsDesdeRegiones(bboxPantalla) {
  const resp = await fetch("capas/regiones.json");
  if (!resp.ok) {
    throw new Error("No se pudo cargar capas/regiones.json");
  }

  const data = await resp.json();
  const regiones = data.regiones_ipt || data.regiones || data || [];

  const listaIpt = [];

  for (const reg of regiones) {
    const bboxReg = reg.bbox || reg.bbox_region || null;
    const carpetaRegion = reg.carpeta || "";

    // Si hay bbox de región y NO intersecta la pantalla, se omite
    if (bboxReg && !intersectaBbox(bboxReg, bboxPantalla)) {
      continue;
    }

    if (!carpetaRegion) {
      console.warn("Región sin carpeta definida:", reg);
      continue;
    }

    const urlListado = `${carpetaRegion}/listado.json`;

    try {
      const respListado = await fetch(urlListado);
      if (!respListado.ok) {
        console.warn("No se pudo cargar listado:", urlListado);
        continue;
      }

      const datosListado = await respListado.json();
      const instrumentos =
        datosListado.instrumentos || datosListado.listado || datosListado;

      instrumentos.forEach(ipt => {
        listaIpt.push({
          ...ipt,
          carpeta: ipt.carpeta || carpetaRegion,
          region_nombre: ipt.region || reg.nombre || reg.id || "",
          id_region: reg.id || reg.codigo_region || "",
          bbox_region: bboxReg
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
  const url = `${carpeta}/${archivo}`;

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
      "(cargando instrumentos desde capas/regiones.json y capas_xx/listado.json...)";
  }
  if (prePunto) {
    prePunto.textContent = "(esperando resultado de la geometría...)";
  }
  if (btnReporte) {
    btnReporte.disabled = true;
  }

  try {
    // 1) Cargar todos los IPT desde regiones + listados
    const todosLosIpt = await cargarIptsDesdeRegiones(bbox);

    // 2) Filtro 1: IPT cuyo BBOX intersecta el BBOX de pantalla
    const iptsEnBbox = todosLosIpt.filter(ipt => {
      const bboxIpt = ipt.bbox || ipt.bbox_ipt || null;
      return intersectaBbox(bboxIpt, bbox);
    });

    if (preListado) {
      preListado.textContent = JSON.stringify(iptsEnBbox, null, 2);
    }

    if (!iptsEnBbox.length) {
      if (prePunto) {
        prePunto.textContent =
          "No hay IPT cuyo BBOX intersecte la pantalla en este clic.";
      }
      // No habilitamos el botón
      return;
    }

    // 3) Filtro 2: GEOMETRÍA contiene el punto clic
    if (prePunto) {
      prePunto.textContent = "Analizando geometría de los IPT en pantalla...";
    }

    const iptsConPunto = await filtrarIptsPorGeometria(iptsEnBbox, puntoClick);

    if (iptsConPunto.length === 0) {
      if (prePunto) {
        prePunto.textContent =
          "⚠ Ningún IPT tiene polígonos que contengan exactamente el punto clic.\n" +
          "Sugerencia: regrese al mapa principal y haga clic sobre un área urbana.";
      }
      // 👇 Importante: NO habilitamos el botón, no hace nada.
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
        const bboxStr = `${bbox.N},${bbox.E},${bbox.S},${bbox.W}`;

        const listaIpt = iptsConPunto
          .map(ipt => `${ipt.carpeta}/${ipt.archivo}`)
          .join("|");

        const url =
          `info.html?lat=${lat}&lon=${lon}` +
          `&bbox=${bboxStr}` +
          `&ipts=${encodeURIComponent(listaIpt)}`;

        window.open(url, "_blank");
      };
    }
  } catch (err) {
    console.error(err);
    if (preListado) {
      preListado.textContent =
        "Error cargando capas/regiones.json o capas_xx/listado.json.";
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
