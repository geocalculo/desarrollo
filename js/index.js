const regionSelect = document.getElementById("region-select");
const instrumentoSelect = document.getElementById("instrumento-select");
let regionesData = [];
let map;
let marcadorPunto = null;

// -------------------------
// Utilidad: leer lat/lon si vienen por URL
// -------------------------
function getUrlParamsLatLon() {
  const p = new URLSearchParams(window.location.search);
  const lat = parseFloat(p.get("lat"));
  const lon = parseFloat(p.get("lon"));
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return null;
  }
  return { lat, lon };
}

// -------------------------
// MAPA BASE
// -------------------------
function initMapa() {
  const mapaCalle = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }
  );

  const mapaSatelite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        "Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP",
    }
  );

  map = L.map("map", {
    center: [-27.5, -70.25],
    zoom: 5,
    minZoom: 4,
    maxZoom: 19,
    layers: [mapaCalle],     // OSM simple por defecto
  });

  L.control
    .layers(
      {
        "Mapa calle": mapaCalle,
        "Satélite": mapaSatelite,
      },
      {},
      { position: "topright" }
    )
    .addTo(map);

  // Si viene llamado desde info.html con lat/lon: centrar ahí
  const p = getUrlParamsLatLon();
  if (p) {
    const { lat, lon } = p;
    map.setView([lat, lon], 16);
    marcadorPunto = L.circleMarker([lat, lon], {
      radius: 6,
      color: "#f97316",
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 0.9
    }).addTo(map);
  }

  // CLICK → motor BBOX (bbox_test.html) con lat, lon y BBOX (north,east,south,west)
  map.on("click", (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    // actualizar / crear marcador
    if (marcadorPunto) {
      marcadorPunto.setLatLng(e.latlng);
    } else {
      marcadorPunto = L.circleMarker(e.latlng, {
        radius: 6,
        color: "#f97316",
        weight: 2,
        fillColor: "#ffffff",
        fillOpacity: 0.9
      }).addTo(map);
    }

    const bounds = map.getBounds();
    const north = bounds.getNorth();
    const east  = bounds.getEast();
    const south = bounds.getSouth();
    const west  = bounds.getWest();

    const bboxStr = [
      north.toFixed(8),
      east.toFixed(8),
      south.toFixed(8),
      west.toFixed(8)
    ].join(",");

    const url = new URL("bbox_test.html", window.location.href);
    url.searchParams.set("lat", lat.toFixed(6));
    url.searchParams.set("lon", lon.toFixed(6));
    url.searchParams.set("bbox", bboxStr);

    // IMPORTANTE: solo enviamos lat, lon, bbox (sin región)
    window.open(url, "_blank");
  });

  // Mira de rifle (geolocalización)
  const mira = document.getElementById("mira-rifle");
  if (mira) {
    mira.addEventListener("click", () => {
      if (!navigator.geolocation) {
        alert("Tu navegador no soporta geolocalización.");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.setView([pos.coords.latitude, pos.coords.longitude], 16);
        },
        (err) => {
          console.error(err);
          alert("No se pudo obtener tu ubicación.");
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }
}

// -------------------------
// REGIONES
// -------------------------
async function cargarRegiones() {
  try {
    const resp = await fetch("capas/regiones.json");
    if (!resp.ok) throw new Error("No se pudo leer capas/regiones.json");

    const data = await resp.json();
    regionesData = Array.isArray(data)
      ? data
      : data.regiones_ipt || data.regiones || [];

    regionSelect.innerHTML = "";

    regionesData
      .filter((r) => r.activo !== false)
      .forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.codigo_ine;
        const nombreCorto = (r.nombre || "").replace(/^Región( de)? /i, "");
        opt.textContent = `${r.codigo_ine} - ${nombreCorto}`;
        regionSelect.appendChild(opt);
      });

    let defaultCode = "03"; // Atacama como default
    if (!regionesData.some((r) => r.codigo_ine === defaultCode)) {
      defaultCode = regionesData[0]?.codigo_ine;
    }

    if (defaultCode) {
      regionSelect.value = defaultCode;
      centrarEnRegion(defaultCode);
      cargarInstrumentos(defaultCode);
    }
  } catch (err) {
    console.error("Error cargando regiones:", err);
  }
}

function obtenerRegionPorCodigo(cod) {
  return regionesData.find((r) => r.codigo_ine === cod) || null;
}

function centrarEnRegion(cod) {
  const reg = obtenerRegionPorCodigo(cod);
  if (!reg || !Array.isArray(reg.centro)) return;
  const [lat, lon] = reg.centro;
  const zoom = reg.zoom || 7;
  map.setView([lat, lon], zoom);
}

// -------------------------
// INSTRUMENTOS (zoom óptico)
// -------------------------
async function cargarInstrumentos(regionCode) {
  instrumentoSelect.innerHTML = "";
  instrumentoSelect.disabled = true;

  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Selecciona un instrumento para hacer zoom";
  instrumentoSelect.appendChild(def);

  const reg = obtenerRegionPorCodigo(regionCode);
  if (!reg) {
    console.warn("No se encontró la región", regionCode);
    return;
  }

  const carpetaRegion = reg.carpeta; // ej: "capas_03"
  const url = `capas/${carpetaRegion}/listado.json`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("No se pudo leer", url, resp.status);
      return;
    }

    const data = await resp.json();
    const lista = data.instrumentos || data.kml || [];

    lista.forEach((entry) => {
      let archivo = "";
      let nombre = "";

      if (typeof entry === "string") {
        archivo = entry;
        nombre = entry.replace(/\.kml$/i, "");
      } else if (entry && typeof entry === "object") {
        archivo = entry.archivo || entry.kml || "";
        nombre = (entry.nombre || archivo || "").replace(/\.kml$/i, "");
      }

      if (!archivo) return;

      const opt = document.createElement("option");
      opt.value = archivo;
      opt.textContent = nombre;
      instrumentoSelect.appendChild(opt);
    });

    instrumentoSelect.disabled = instrumentoSelect.options.length <= 1;
  } catch (e) {
    console.error("Error leyendo instrumentos:", e);
  }
}

async function zoomAlInstrumento(regionCode, archivo) {
  if (!archivo) return;

  const reg = obtenerRegionPorCodigo(regionCode);
  if (!reg) return;

  const carpetaRegion = reg.carpeta;
  const url = `capas/${carpetaRegion}/${archivo}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("No se pudo abrir el KML:", url);
      return;
    }
    const txt = await resp.text();

    const xml = new DOMParser().parseFromString(txt, "application/xml");
    const coords = xml.querySelectorAll("coordinates");

    const puntos = [];
    coords.forEach((c) => {
      c.textContent
        .trim()
        .split(/\s+/)
        .forEach((par) => {
          const [lon, lat] = par.split(",").map(Number);
          if (!isNaN(lat) && !isNaN(lon)) puntos.push([lat, lon]);
        });
    });

    if (puntos.length) {
      map.fitBounds(L.latLngBounds(puntos), { padding: [30, 30] });
    }
  } catch (e) {
    console.warn("No se pudo procesar el KML:", e);
  }
}

// -------------------------
// INICIO
// -------------------------
document.addEventListener("DOMContentLoaded", () => {
  initMapa();
  cargarRegiones();

  regionSelect.addEventListener("change", () => {
    const code = regionSelect.value;
    centrarEnRegion(code);
    cargarInstrumentos(code);
  });

  instrumentoSelect.addEventListener("change", () => {
    zoomAlInstrumento(regionSelect.value, instrumentoSelect.value);
  });
});
