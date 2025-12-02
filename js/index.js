const regionSelect = document.getElementById("region-select");
const instrumentoSelect = document.getElementById("instrumento-select");

// Guardamos las regiones leídas del JSON (incluyendo bbox)
let regionesData = [];

// Bandera para distinguir cambio automático vs cambio del usuario
let ajusteAutomaticoRegion = false;

// -------------------------
// MAPA BASE + CAPAS
// -------------------------
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

// -------------------------
// HELPERS BBOX REGIONES
// -------------------------
function pointInRegionBBox(lat, lon, reg) {
  if (!reg.bbox || reg.bbox.length !== 4) return false;
  const [minLon, minLat, maxLon, maxLat] = reg.bbox.map(Number);
  return (
    lat >= minLat &&
    lat <= maxLat &&
    lon >= minLon &&
    lon <= maxLon
  );
}

// Detectar región según el centro de pantalla
// Solo ajusta el combo si hay UNA sola región candidata
function detectarRegionPorPantalla() {
  if (!regionesData.length) return;

  const center = map.getCenter();
  const lat = center.lat;
  const lon = center.lng;

  const candidatas = regionesData.filter((reg) =>
    pointInRegionBBox(lat, lon, reg)
  );

  // Si no hay o hay más de una (RM / V Región), no tocamos el combo
  if (candidatas.length !== 1) return;

  const regionDetectada = candidatas[0];
  const nuevoCodigo = regionDetectada.codigo_ine;

  if (regionSelect.value === nuevoCodigo) return;

  // Marcamos que el cambio es automático para no hacer setView doble
  ajusteAutomaticoRegion = true;
  regionSelect.value = nuevoCodigo;
  cargarInstrumentos(nuevoCodigo);
  ajusteAutomaticoRegion = false;
}

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
    // Soportar {regiones:[...]} o array directo
    regionesData = Array.isArray(data) ? data : (data.regiones || []);

    regionSelect.innerHTML = "";

    regionesData
      .filter((r) => r.activo)
      .forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.codigo_ine;
        opt.textContent = `${r.codigo_ine} - ${r.nombre.replace("Región de ", "")}`;
        regionSelect.appendChild(opt);
      });

    // Atacama por defecto
    regionSelect.value = "03";
  } catch (err) {
    console.error("Error cargando regiones:", err);
  }
}

// -------------------------
// CARGAR INSTRUMENTOS
// -------------------------
async function cargarInstrumentos(regionCode) {
  instrumentoSelect.innerHTML = "";
  instrumentoSelect.disabled = true;

  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Selecciona un instrumento para hacer zoom";
  instrumentoSelect.appendChild(def);

  const url = `capas/capas_${regionCode}/listado.json`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return;

    const data = await resp.json();
    const lista = data.instrumentos || [];

    lista.forEach((entry) => {
      const opt = document.createElement("option");
      opt.value = entry.archivo;
      opt.textContent = entry.nombre.replace(/\.kml$/i, "");
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
  if (!archivo) return;
  const url = `capas/capas_${regionCode}/${archivo}`;
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
// EVENTOS
// -------------------------
regionSelect.addEventListener("change", () => {
  const code = regionSelect.value;

  // Si el cambio viene del ajuste automático, no movemos la vista (ya está donde debe)
  if (!ajusteAutomaticoRegion) {
    const r = regionesData.find((x) => x.codigo_ine === code);
    if (r && Array.isArray(r.centro)) {
      map.setView(r.centro, r.zoom || 7);
    }
  }

  cargarInstrumentos(code);
});

instrumentoSelect.addEventListener("change", () => {
  zoomAlInstrumento(regionSelect.value, instrumentoSelect.value);
});

// Al mover el mapa (pan/zoom), intentamos detectar región solo si hay una candidata
map.on("moveend", () => {
  detectarRegionPorPantalla();
});

// Al hacer clic, abrimos el reporte con punto y bbox de la pantalla
map.on("click", (e) => {
  const url = new URL("info.html", window.location.href);
  url.searchParams.set("lat", e.latlng.lat);
  url.searchParams.set("lon", e.latlng.lng);
  url.searchParams.set("region", regionSelect.value);

  const b = map.getBounds();
  const bboxParam = [
    b.getWest(),  // minLon
    b.getSouth(), // minLat
    b.getEast(),  // maxLon
    b.getNorth()  // maxLat
  ].join(",");
  url.searchParams.set("bbox", bboxParam);

  window.open(url, "_blank");
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
  await cargarInstrumentos("03");
  map.setView([-27.5, -70.25], 7);
})();
