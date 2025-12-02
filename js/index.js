const regionSelect = document.getElementById("region-select");
const instrumentoSelect = document.getElementById("instrumento-select");

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
// CARGAR REGIONES
// -------------------------
async function cargarRegiones() {
  try {
    const resp = await fetch("capas/regiones.json");
    if (!resp.ok) {
      console.error("No se pudo leer regiones.json", resp.status);
      return;
    }

    const regiones = await resp.json();
    regionSelect.innerHTML = "";

    regiones
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
regionSelect.addEventListener("change", async () => {
  const code = regionSelect.value;

  try {
    const resp = await fetch("capas/regiones.json");
    const regiones = await resp.json();
    const r = regiones.find((x) => x.codigo_ine === code);

    if (r) map.setView(r.centro, r.zoom);
  } catch (e) {
    console.warn("No se pudo leer regiones.json en cambio de región:", e);
  }

  cargarInstrumentos(code);
});

instrumentoSelect.addEventListener("change", () => {
  zoomAlInstrumento(regionSelect.value, instrumentoSelect.value);
});

map.on("click", (e) => {
  const url = new URL("info.html", window.location.href);
  url.searchParams.set("lat", e.latlng.lat);
  url.searchParams.set("lon", e.latlng.lng);
  url.searchParams.set("region", regionSelect.value);
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
