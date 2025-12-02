// Referencias a los controles
const regionSelect = document.getElementById("region-select");
const instrumentoSelect = document.getElementById("instrumento-select");

// Mapa base + capas
const mapaCalle = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
});

const mapaSatelite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      "Tiles © Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP",
  }
);

const map = L.map("map", {
  center: [-27.5, -70.25],
  zoom: 7,
  minZoom: 4,
  maxZoom: 19,
  layers: [mapaCalle],
});

L.control
  .layers(
    {
      "Mapa calle": mapaCalle,
      Satélite: mapaSatelite,
    },
    {},
    { position: "topright" }
  )
  .addTo(map);

// Variables globales de regiones
let regionesData = [];
window._regionesData = regionesData;

// -------------------------
// CARGAR REGIONES
// -------------------------
async function cargarRegiones() {
  try {
    const resp = await fetch("capas/regiones.json");
    if (!resp.ok) {
      console.error("No se pudo leer regiones.json", resp.status);
      return;
    }

    const data = await resp.json();
    regionesData = data.regiones || [];
    window._regionesData = regionesData;

    regionSelect.innerHTML = "";

    regionesData
      .filter((r) => r.activo)
      .forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.codigo_ine; // ej: capas_03, capas_13, capas_RM
        opt.textContent = r.nombre;
        regionSelect.appendChild(opt);
      });

    // Región por defecto: Atacama (capas_03) si existe, si no la primera
    let defaultCode = "capas_03";
    if (!regionesData.some((r) => r.codigo_ine === defaultCode)) {
      if (regionesData.length > 0) {
        defaultCode = regionesData[0].codigo_ine;
      }
    }

    regionSelect.value = defaultCode;

    const regDef = regionesData.find((r) => r.codigo_ine === defaultCode);
    if (regDef) {
      map.setView(regDef.centro, regDef.zoom || 7);
    }

    await cargarInstrumentos(defaultCode);
  } catch (err) {
    console.error("Error cargando regiones:", err);
  }
}

// -------------------------
// CARGAR INSTRUMENTOS (zoom óptico)
// -------------------------
async function cargarInstrumentos(regionCode) {
  instrumentoSelect.innerHTML = "";
  instrumentoSelect.disabled = true;

  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Selecciona un instrumento para hacer zoom";
  instrumentoSelect.appendChild(def);

  if (!regionCode) return;

  // regionCode viene como nombre de carpeta: capas_03, capas_RM, etc.
  const url = `capas/${regionCode}/listado.json`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return;

    const data = await resp.json();
    const lista = data.instrumentos || data.kml || data || [];

    lista.forEach((entry) => {
      let archivo = "";
      let nombre = "";

      if (typeof entry === "string") {
        archivo = entry;
        nombre = entry;
      } else if (entry && typeof entry === "object") {
        archivo = entry.archivo || entry.kml || entry.nombre || "";
        nombre = entry.nombre || archivo;
      }

      if (!archivo) return;

      const opt = document.createElement("option");
      opt.value = archivo;
      opt.textContent = nombre.replace(/\.kml$/i, "");
      instrumentoSelect.appendChild(opt);
    });

    instrumentoSelect.disabled = false;
  } catch (e) {
    console.warn("Error leyendo instrumentos:", e);
  }
}

// -------------------------
// ZOOM AL EXTENT DEL KML
// -------------------------
async function zoomAlInstrumento(regionCode, archivo) {
  if (!archivo || !regionCode) return;

  const url = `capas/${regionCode}/${archivo}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
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
    console.warn("No se pudo abrir el KML:", e);
  }
}

// -------------------------
// DETECCIÓN AUTOMÁTICA DE REGIÓN SEGÚN VIEWPORT
// -------------------------
function detectarRegionVisible() {
  if (!regionesData || !regionesData.length) return;

  const b = map.getBounds();
  const view = {
    minLat: b.getSouth(),
    maxLat: b.getNorth(),
    minLon: b.getWest(),
    maxLon: b.getEast(),
  };

  let mejorRegion = null;
  let mayorSolape = 0;

  regionesData.forEach((reg) => {
    if (!reg.bbox || reg.bbox.length !== 4) return;

    const [minLon, minLat, maxLon, maxLat] = reg.bbox;

    const solapeLon = Math.max(0, Math.min(view.maxLon, maxLon) - Math.max(view.minLon, minLon));
    const solapeLat = Math.max(0, Math.min(view.maxLat, maxLat) - Math.max(view.minLat, minLat));
    const areaSolape = solapeLon * solapeLat;

    if (areaSolape > mayorSolape) {
      mayorSolape = areaSolape;
      mejorRegion = reg;
    }
  });

  if (mejorRegion && regionSelect.value !== mejorRegion.codigo_ine) {
    // Actualiza combo y lista de instrumentos, pero NO recentra el mapa
    regionSelect.value = mejorRegion.codigo_ine;
    cargarInstrumentos(mejorRegion.codigo_ine);
    console.log("Región detectada automáticamente:", mejorRegion.nombre);
  }
}

// Vincular evento al mapa
map.on("moveend", detectarRegionVisible);

// -------------------------
// EVENTOS DE CONTROLES
// -------------------------
regionSelect.addEventListener("change", async () => {
  const code = regionSelect.value;
  const reg = regionesData.find((r) => r.codigo_ine === code);

  if (reg) {
    map.setView(reg.centro, reg.zoom || 7);
  }

  cargarInstrumentos(code);
});

instrumentoSelect.addEventListener("change", () => {
  zoomAlInstrumento(regionSelect.value, instrumentoSelect.value);
});

// Click en el mapa → abrir info.html
map.on("click", (e) => {
  const url = new URL("info.html", window.location.href);
  url.searchParams.set("lat", e.latlng.lat);
  url.searchParams.set("lon", e.latlng.lng);
  // Pasamos el identificador de carpeta como "region"
  url.searchParams.set("region", regionSelect.value);
  window.open(url.toString(), "_blank");
});

// -------------------------
// MIRA DE RIFLE (CENTRAR SIN MARCADOR)
// -------------------------
document.getElementById("mira-rifle").addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("La geolocalización no es compatible con este navegador.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      map.setView([lat, lon], 16); // escala aprox 1:10.000
    },
    (err) => {
      alert("No se pudo obtener tu ubicación.");
      console.error(err);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
    }
  );
});

// -------------------------
// INICIO
// -------------------------
(async function init() {
  await cargarRegiones();
})();
