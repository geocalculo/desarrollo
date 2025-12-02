const loadingOverlay = document.getElementById("loading-overlay");

function showLoading() {
  if (loadingOverlay) loadingOverlay.style.display = "flex";
}

function hideLoading() {
  if (loadingOverlay) loadingOverlay.style.display = "none";
}

function getParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Extrae TODOS los atributos desde un Placemark KML
function getAttributesFromPlacemark(placemarkEl) {
  const attrs = {};

  // ExtendedData/Data
  placemarkEl.querySelectorAll("ExtendedData Data").forEach((data) => {
    const name =
      data.getAttribute("name") ||
      (data.querySelector("displayName") &&
        data.querySelector("displayName").textContent.trim());
    const value =
      (data.querySelector("value") &&
        data.querySelector("value").textContent.trim()) ||
      "";
    if (name) attrs[name] = value;
  });

  // ExtendedData/SimpleData
  placemarkEl.querySelectorAll("ExtendedData SimpleData").forEach((sd) => {
    const name = sd.getAttribute("name");
    const value = sd.textContent.trim();
    if (name) attrs[name] = value;
  });

  // name del Placemark
  const nameEl = placemarkEl.querySelector("name");
  if (nameEl) {
    const val = nameEl.textContent.trim();
    if (val && !attrs["NAME"]) {
      attrs["NAME"] = val;
    }
  }

  // description del Placemark (sin HTML)
  const descEl = placemarkEl.querySelector("description");
  if (descEl && descEl.textContent.trim()) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = descEl.textContent;
    const plainText = tempDiv.textContent || tempDiv.innerText || "";
    if (plainText.trim()) {
      attrs["DESCRIPTION"] = plainText.trim();
    }
  }

  return attrs;
}

function renderAttributesTable(placemarkEl, index) {
  const attrs = getAttributesFromPlacemark(placemarkEl);
  const keys = Object.keys(attrs);

  const zonaLabel = attrs["ZONA"]
    ? `Zona : ${escapeHtml(attrs["ZONA"])}`
    : `Polígono ${index + 1}`;

  if (!keys.length) {
    return `
      <div class="atributos-item">
        <h4>${zonaLabel}</h4>
        <p>No se encontraron atributos en el KML para este polígono.</p>
      </div>
    `;
  }

  const rows = keys
    .map(
      (key) => `
      <tr>
        <th>${escapeHtml(key)}</th>
        <td>${escapeHtml(attrs[key])}</td>
      </tr>
    `
    )
    .join("");

  return `
    <div class="atributos-item" style="margin-top: 1rem;">
      <h4>${zonaLabel}</h4>
      <table class="tabla-atributos">
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function actualizarAtributosPRC(matchingPlacemarks) {
  const container = document.getElementById("detalle-atributos-prc");
  if (!container) return;

  if (!matchingPlacemarks || !matchingPlacemarks.length) {
    container.innerHTML =
      "<p>No hay atributos que mostrar porque el punto no se encontró dentro de ningún polígono.</p>";
    return;
  }

  container.innerHTML = matchingPlacemarks
    .map((plc, idx) => renderAttributesTable(plc, idx))
    .join("");
}

// Punto en polígono (Ray casting)
function pointInPolygon(lat, lon, polygonLatLngs) {
  let inside = false;
  const x = lon;
  const y = lat;

  for (let i = 0, j = polygonLatLngs.length - 1; i < polygonLatLngs.length; j = i++) {
    const xi = polygonLatLngs[i].lng,
      yi = polygonLatLngs[i].lat;
    const xj = polygonLatLngs[j].lng,
      yj = polygonLatLngs[j].lat;

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function parseKmlPolygons(kmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, "application/xml");
  const placemarks = Array.from(xml.getElementsByTagName("Placemark"));
  const results = [];

  placemarks.forEach((pm) => {
    const polygons = [];

    pm.querySelectorAll("Polygon").forEach((poly) => {
      const coordsEl =
        poly.querySelector(
          "outerBoundaryIs coordinates, outerBoundaryIs>LinearRing>coordinates, coordinates"
        );
      if (!coordsEl) return;
      const coordsText = coordsEl.textContent.trim();
      if (!coordsText) return;

      const coords = coordsText
        .split(/\s+/)
        .map((pair) => {
          const parts = pair.split(",");
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (isNaN(lat) || isNaN(lon)) return null;
          return L.latLng(lat, lon);
        })
        .filter(Boolean);

      if (coords.length >= 3) {
        polygons.push(coords);
      }
    });

    pm.querySelectorAll("MultiGeometry Polygon").forEach((poly) => {
      const coordsEl =
        poly.querySelector(
          "outerBoundaryIs coordinates, outerBoundaryIs>LinearRing>coordinates, coordinates"
        );
      if (!coordsEl) return;
      const coordsText = coordsEl.textContent.trim();
      if (!coordsText) return;

      const coords = coordsText
        .split(/\s+/)
        .map((pair) => {
          const parts = pair.split(",");
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (isNaN(lat) || isNaN(lon)) return null;
          return L.latLng(lat, lon);
        })
        .filter(Boolean);

      if (coords.length >= 3) {
        polygons.push(coords);
      }
    });

    if (polygons.length) {
      results.push({
        placemarkEl: pm,
        polygons,
      });
    }
  });

  return results;
}

// BBOX del mapa (viewport actual)
function getViewBBox() {
  const map = window._geoiptMap;
  if (!map) return null;
  const b = map.getBounds();
  return {
    minLat: b.getSouth(),
    maxLat: b.getNorth(),
    minLon: b.getWest(),
    maxLon: b.getEast(),
  };
}

// Leer bbox de una entrada de listado.json
// Soporta:
// - bbox: [minLat, minLon, maxLat, maxLon]
// - extent: [minLat, minLon, maxLat, maxLon]
// - minLat, maxLat, minLon, maxLon como campos separados
function getEntryBBox(entry) {
  if (!entry || typeof entry !== "object") return null;

  let minLat, maxLat, minLon, maxLon;

  if (Array.isArray(entry.bbox) && entry.bbox.length === 4) {
    [minLat, minLon, maxLat, maxLon] = entry.bbox.map(Number);
  } else if (Array.isArray(entry.extent) && entry.extent.length === 4) {
    [minLat, minLon, maxLat, maxLon] = entry.extent.map(Number);
  } else if (
    typeof entry.minLat !== "undefined" &&
    typeof entry.maxLat !== "undefined" &&
    typeof entry.minLon !== "undefined" &&
    typeof entry.maxLon !== "undefined"
  ) {
    minLat = Number(entry.minLat);
    maxLat = Number(entry.maxLat);
    minLon = Number(entry.minLon);
    maxLon = Number(entry.maxLon);
  }

  if (
    [minLat, maxLat, minLon, maxLon].some(
      (v) => typeof v !== "number" || isNaN(v)
    )
  ) {
    return null;
  }

  return { minLat, maxLat, minLon, maxLon };
}

function bboxesIntersect(a, b) {
  if (!a || !b) return true;
  const noOverlap =
    b.minLat > a.maxLat ||
    b.maxLat < a.minLat ||
    b.minLon > a.maxLon ||
    b.maxLon < a.minLon;
  return !noOverlap;
}

// === BBOX a partir del propio KML (LatLonBox o coordinates) ===
function getKmlBBoxFromText(kmlText) {
  if (!kmlText) return null;

  // Intentar primero con LatLonBox / north-south-east-west
  const northMatch = kmlText.match(/<north>\s*([-\d.]+)\s*<\/north>/i);
  const southMatch = kmlText.match(/<south>\s*([-\d.]+)\s*<\/south>/i);
  const eastMatch  = kmlText.match(/<east>\s*([-\d.]+)\s*<\/east>/i);
  const westMatch  = kmlText.match(/<west>\s*([-\d.]+)\s*<\/west>/i);

  if (northMatch && southMatch && eastMatch && westMatch) {
    const north = parseFloat(northMatch[1]);
    const south = parseFloat(southMatch[1]);
    const east  = parseFloat(eastMatch[1]);
    const west  = parseFloat(westMatch[1]);

    if (
      ![north, south, east, west].some(
        (v) => typeof v !== "number" || isNaN(v)
      )
    ) {
      return {
        minLat: Math.min(north, south),
        maxLat: Math.max(north, south),
        minLon: Math.min(east, west),
        maxLon: Math.max(east, west),
      };
    }
  }

  // Si no hay LatLonBox, barrer las coordinates
  const coordMatches = [...kmlText.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
  let minLat = 90,
    maxLat = -90,
    minLon = 180,
    maxLon = -180;
  let found = false;

  coordMatches.forEach((m) => {
    const block = m[1].trim();
    if (!block) return;
    const pairs = block.split(/\s+/);
    pairs.forEach((pair) => {
      const parts = pair.split(",");
      if (parts.length < 2) return;
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (isNaN(lat) || isNaN(lon)) return;
      found = true;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    });
  });

  if (!found) return null;

  return { minLat, maxLat, minLon, maxLon };
}

// ============================
//   EVALUAR PRC / SCC
// ============================
async function evaluarPRC(lat, lon, regionCode) {
  const resultadoDiv = document.getElementById("resultado-prc");
  const listaUl = document.getElementById("lista-coincidencias");

  resultadoDiv.textContent = "Evaluando polígonos PRC/SCC de la región...";
  listaUl.innerHTML = "";

  const matchingPlacemarks = [];
  const coincidenciasArchivos = new Map();

  const basePath = `capas/capas_${regionCode}/`;
  const listadoUrl = `${basePath}listado.json`;

  // limpiar capa de resultado si existe
  if (window._geoiptResultado) {
    window._geoiptResultado.clearLayers();
  }

  const viewBBox = getViewBBox(); // BBOX del mapa visible en el reporte

  try {
    const listadoResp = await fetch(listadoUrl);
    if (!listadoResp.ok) {
      throw new Error(
        "No se pudo leer listado.json de la región " + regionCode
      );
    }
    const listado = await listadoResp.json();

    let archivos = [];

    // Soportar 3 formatos:
    // 1) Array simple
    if (Array.isArray(listado)) {
      archivos = listado;
      // 2) { kml: [ ... ] }
    } else if (Array.isArray(listado.kml)) {
      archivos = listado.kml;
      // 3) { instrumentos: [ ... ] }
    } else if (Array.isArray(listado.instrumentos)) {
      archivos = listado.instrumentos;
    }

    for (const entry of archivos) {
      let archivo = "";
      let nombreInstrumento = "";
      let entryMeta = null;

      if (typeof entry === "string") {
        archivo = entry;
        nombreInstrumento = entry;
      } else if (entry && typeof entry === "object") {
        archivo = entry.archivo || entry.kml || entry.nombre || "";
        nombreInstrumento = entry.nombre || archivo;
        entryMeta = entry;
      }

      if (!archivo) continue;

      // Filtro rápido con BBOX del listado.json si existe
      const entryBBox = getEntryBBox(entryMeta);
      if (viewBBox && entryBBox && !bboxesIntersect(viewBBox, entryBBox)) {
        continue;
      }

      const kmlUrl = basePath + archivo;

      try {
        const kmlResp = await fetch(kmlUrl);
        if (!kmlResp.ok) {
          console.warn("No se pudo leer KML:", kmlUrl);
          continue;
        }
        const kmlText = await kmlResp.text();

        // Filtro adicional con BBOX del propio KML
        const kmlBBox = getKmlBBoxFromText(kmlText);
        if (viewBBox && kmlBBox && !bboxesIntersect(viewBBox, kmlBBox)) {
          // Si el KML no intersecta el área visible → se omite
          continue;
        }

        const features = parseKmlPolygons(kmlText);

        features.forEach((feat) => {
          let contiene = false;

          // atributos del Placemark original
          const attrs = getAttributesFromPlacemark(feat.placemarkEl) || {};

          // nombre amigable opcional
          if (!attrs.name) {
            if (attrs.ZONA) {
              attrs.name = attrs.ZONA;
            } else if (attrs.NOMBRE) {
              attrs.name = attrs.NOMBRE;
            }
          }

          feat.polygons.forEach((polyCoords) => {
            if (pointInPolygon(lat, lon, polyCoords)) {
              contiene = true;

              const polyLayer = L.polygon(polyCoords, {
                color: "#2563eb",
                weight: 2,
                fillColor: "#3b82f6",
                fillOpacity: 0.15,
              });

              // adjuntamos atributos para que viajen al KML
              polyLayer.feature = {
                type: "Feature",
                properties: attrs,
              };

              if (window._geoiptResultado) {
                polyLayer.addTo(window._geoiptResultado);
              } else {
                polyLayer.addTo(window._geoiptMap);
              }
            }
          });

          if (contiene) {
            matchingPlacemarks.push(feat.placemarkEl);

            if (!coincidenciasArchivos.has(archivo)) {
              coincidenciasArchivos.set(archivo, {
                archivo,
                nombreInstrumento,
              });
            }
          }
        });
      } catch (errKml) {
        console.warn("Error procesando KML", kmlUrl, errKml);
      }
    }

    if (matchingPlacemarks.length > 0) {
      resultadoDiv.innerHTML =
        '<span class="resultado-ok">Resultado:</span> El punto consultado se encuentra dentro de uno o más polígonos de los instrumentos PRC/SCC de la región.';
      listaUl.innerHTML = "";

      coincidenciasArchivos.forEach((obj) => {
        const li = document.createElement("li");
        li.textContent = `Coincidencia en archivo: ${obj.archivo}`;
        listaUl.appendChild(li);
      });

      actualizarAtributosPRC(matchingPlacemarks);

      // Instrumentos consultados detectados por el motor
      const instrumentos = Array.from(coincidenciasArchivos.values())
        .map((obj) =>
          (obj.nombreInstrumento || obj.archivo).replace(/\.kml$/i, "")
        )
        .join(", ");

      if (instrumentos) {
        const instrumentoDisplay =
          document.getElementById("instrumento-display");
        if (instrumentoDisplay) {
          instrumentoDisplay.textContent = instrumentos;
        }

        const tituloAttr = document.getElementById("titulo-atributos");
        if (tituloAttr) {
          tituloAttr.textContent =
            "Detalle de atributos del/los polígono(s) – " +
            instrumentos;
        }

        const pInstrumentoAttr =
          document.getElementById("instrumento-atributos");
        if (pInstrumentoAttr) {
          pInstrumentoAttr.textContent =
            "Instrumento(s) consultado(s): " + instrumentos;
        }
      }
    } else {
      resultadoDiv.innerHTML =
        '<span class="resultado-nok">Resultado:</span> El punto consultado no se encuentra dentro de ningún polígono de los archivos PRC/SCC cargados.';
      listaUl.innerHTML = "";
      actualizarAtributosPRC([]);

      // Reset encabezados cuando no hay match
      const instrumentoDisplay =
        document.getElementById("instrumento-display");
      if (instrumentoDisplay) {
        instrumentoDisplay.textContent = "-";
      }
      const tituloAttr = document.getElementById("titulo-atributos");
      if (tituloAttr) {
        tituloAttr.textContent =
          "Detalle de atributos del/los polígono(s)";
      }
      const pInstrumentoAttr =
        document.getElementById("instrumento-atributos");
      if (pInstrumentoAttr) {
        pInstrumentoAttr.textContent =
          "No se encontró ningún instrumento que contenga el punto consultado.";
      }
    }
  } catch (err) {
    console.error(err);
    resultadoDiv.innerHTML =
      '<span class="resultado-nok">Resultado:</span> No fue posible evaluar los polígonos PRC/SCC de la región (revisa listado.json y la ruta de los KML).';
    listaUl.innerHTML = "";
    actualizarAtributosPRC([]);

    const instrumentoDisplay =
      document.getElementById("instrumento-display");
    if (instrumentoDisplay) {
      instrumentoDisplay.textContent = "-";
    }
  }
}

// ============================
//   MAPA DEL REPORTE
// ============================
function initMap(lat, lon, initialBBox) {
  const map = L.map("map");

  // Si viene bbox desde index, usamos ese extent
  if (initialBBox) {
    const sw = L.latLng(initialBBox.minLat, initialBBox.minLon);
    const ne = L.latLng(initialBBox.maxLat, initialBBox.maxLon);
    map.fitBounds(L.latLngBounds(sw, ne));
  } else {
    // Fallback: centramos en el punto con zoom fijo
    map.setView([lat, lon], 15);
  }

  window._geoiptMap = map;

  const osm = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }
  ).addTo(map);

  const esriSat = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, and the GIS User Community",
    }
  );

  L.control
    .layers(
      { "Mapa calle": osm, Satélite: esriSat },
      {},
      { position: "topright" }
    )
    .addTo(map);

  // capa vacía donde se almacenan los polígonos que hicieron match
  window._geoiptResultado = L.featureGroup().addTo(map);

  const marker = L.marker([lat, lon]).addTo(map);
  marker
    .bindPopup(
      `Punto consultado<br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}`
    )
    .openPopup();

  // Al hacer clic en el mapa, abrir nueva pestaña con nuevo punto
  map.on("click", (e) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lat", e.latlng.lat.toString());
    url.searchParams.set("lon", e.latlng.lng.toString());
    // Nota: aquí no reenviamos bbox para el nuevo clic, se recalculará en la nueva vista
    window.open(url.toString(), "_blank");
  });
}

// ============================
//   DESCARGA KML
// ============================
function initKmlButton() {
  const btn = document.getElementById("btn-descargar-kml");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const group = window._geoiptResultado;
    if (!group || group.getLayers().length === 0) {
      alert("No hay ningún polígono para descargar.");
      return;
    }

    // GeoJSON desde la capa de resultado
    const gj = group.toGeoJSON();

    // Nombre del instrumento (solo para metadata interna del KML)
    let instrumentoRaw =
      (
        document.getElementById("instrumento-display")?.textContent ||
        "PRC"
      )
        .split(",")[0]
        .trim();

    let instrumento = instrumentoRaw
      .replace(/^IPT_\d+_/i, "")
      .replace(/_/g, " ");

    // Zonas involucradas (para el nombre del Document)
    let zonas = [];
    gj.features.forEach((f) => {
      if (f.properties && f.properties.ZONA) {
        const z = String(f.properties.ZONA).trim().split(/\s+/)[0];
        zonas.push(z);
      }
    });
    zonas = [...new Set(zonas)];
    const nombreZona = zonas.length ? zonas.join("_") : "Zona";

    // Timestamp AAAAMMDD_HHMMSS
    function timestamp() {
      const now = new Date();
      const YYYY = now.getFullYear();
      const MM = String(now.getMonth() + 1).padStart(2, "0");
      const DD = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      return `${YYYY}${MM}${DD}_${hh}${mm}${ss}`;
    }

    const nombreArchivo = `descargaKML_${timestamp()}.kml`;

    // Convertir GeoJSON a KML
    let kmlString = tokml(gj, {
      documentName: instrumento,
      name: nombreZona,
    });

    // Agregar estilo azul semitransparente
    const styleBlock = `
  <Style id="geoipt_poly">
    <LineStyle>
      <color>ffeb6325</color>
      <width>2</width>
    </LineStyle>
    <PolyStyle>
      <color>66f6823b</color>
    </PolyStyle>
  </Style>`;

    kmlString = kmlString.replace("<Document>", "<Document>" + styleBlock);
    kmlString = kmlString.replace(
      /<Placemark>/g,
      "<Placemark><styleUrl>#geoipt_poly</styleUrl>"
    );

    const blob = new Blob([kmlString], {
      type: "application/vnd.google-earth.kml+xml;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// ============================
//   UI: nota, home, print, geoloc
// ============================
function initNotaToggle() {
  const toggle = document.getElementById("nota-toggle");
  const contenido = document.getElementById("nota-contenido");
  const icono = document.getElementById("nota-icono");
  if (!toggle || !contenido || !icono) return;

  toggle.addEventListener("click", () => {
    const visible = contenido.style.display === "block";
    contenido.style.display = visible ? "none" : "block";
    icono.textContent = visible ? "+" : "–";
  });
}

function initHomeButton() {
  const btnHome = document.getElementById("btn-home");
  if (!btnHome) return;
  btnHome.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

function initPrintButton() {
  const btnPrint = document.getElementById("btn-print");
  if (!btnPrint) return;
  btnPrint.addEventListener("click", () => {
    window.print();
  });
}

// Mira de rifle (geolocalización sin marcador)
function initGeolocateButton() {
  const btnGeo = document.getElementById("btn-geolocate");
  if (!btnGeo) return;

  btnGeo.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("La geolocalización no está disponible en este navegador.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!window._geoiptMap) return;
        window._geoiptMap.flyTo(
          [pos.coords.latitude, pos.coords.longitude],
          16
        );
      },
      () => {
        alert("No se pudo obtener la ubicación del dispositivo.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ============================
//   CARGA DEL REPORTE
// ============================
async function cargarReporte() {
  try {
    const latParam = parseFloat(getParam("lat") || "-27.0");
    const lonParam = parseFloat(getParam("lon") || "-70.0");
    const regionCode = getParam("region") || "--";

    // Leer bbox enviado desde index (minLon,minLat,maxLon,maxLat)
    const bboxParam = getParam("bbox");
    let initialBBox = null;
    if (bboxParam) {
      const parts = bboxParam.split(",").map(Number);
      if (parts.length === 4 && parts.every((v) => !isNaN(v))) {
        const [minLon, minLat, maxLon, maxLat] = parts;
        initialBBox = { minLat, maxLat, minLon, maxLon };
      }
    }

    document.getElementById("lat-display").textContent =
      latParam.toFixed(6);
    document.getElementById("lon-display").textContent =
      lonParam.toFixed(6);
    document.getElementById("region-display").textContent = regionCode;

    // Conversión a UTM usando utm.js
    actualizarUTM(latParam, lonParam);

    // Mapa de referencia con el mismo extent que el index
    initMap(latParam, lonParam, initialBBox);

    // UI
    initKmlButton();
    initNotaToggle();
    initHomeButton();
    initPrintButton();
    initGeolocateButton();

    // Evaluación PRC/SCC
    if (regionCode && regionCode !== "--") {
      await evaluarPRC(latParam, lonParam, regionCode);
    } else {
      document.getElementById("resultado-prc").innerHTML =
        '<span class="resultado-nok">Resultado:</span> No se indicó código de región en la URL.';
    }
  } catch (error) {
    console.error("Error al cargar el reporte:", error);
    alert("Ocurrió un problema al generar el reporte. Intenta nuevamente.");
  } finally {
    hideLoading();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  showLoading();
  cargarReporte();
});
