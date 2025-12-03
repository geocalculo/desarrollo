// ===============================
//   GeoIPT - index.js (Versión BBOX)
//   Lucky 2025
// ===============================

// DOM
const regionSelect = document.getElementById("region-select");
const instrumentoSelect = document.getElementById("instrumento-select");

let regionesData = [];
let map;

// --------------------------------------------------
//   1) Cargar regiones desde capas/regiones.json
// --------------------------------------------------
async function cargarRegiones() {
  try {
    const resp = await fetch("capas/regiones.json");
    if (!resp.ok) throw new Error("No se pudo leer capas/regiones.json");

    const data = await resp.json();

    // Soporta: arreglo plano / {regiones_ipt:[...]} / {regiones:[...]}
    regionesData = Array.isArray(data)
      ? data
      : data.regiones_ipt || data.regiones || [];

    regionSelect.innerHTML = "";

    regionesData
      .filter((r) => r.activo !== false)
      .forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.codigo_ine; // "01", "02", etc.
        const nombreCorto = r.nombre.replace(/^Región( de)? /i, "");
        opt.textContent = `${r.codigo_ine} - ${nombreCorto}`;
        regionSelect.appendChild(opt);
      });

    // Región por defecto (Atacama)
    let defaultCode = "03";
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

// --------------------------------------------------
//   2) Obtener región por código
// --------------------------------------------------
function obtenerRegionPorCodigo(cod) {
  return regionesData.find((r) => r.codigo_ine === cod) || null;
}

// --------------------------------------------------
//   3) Centrar mapa según región seleccionada
// --------------------------------------------------
function centrarEnRegion(cod) {
  const reg = obtenerRegionPorCodigo(cod);
  if (!reg || !Array.isArray(reg.centro)) return;
  const [lat, lon] = reg.centro;
  const zoom = reg.zoom || 7;
  map.setView([lat, lon], zoom);
}

// --------------------------------------------------
//   4) Cargar instrumentos de la región seleccionada
// --------------------------------------------------
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

// --------------------------------------------------
//   5) Zoom óptico a un instrumento KML
// --------------------------------------------------
async function zoomAlInstrumento(regionCode, archivo) {
  if (!archivo) return;

  const reg = obtenerRegionPorCodigo(regionCode);
  if (!reg) return;

  const carpetaRegion = reg.carpeta; // ej: "capas_03"
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

// --------------------------------------------------
//   6) Inicializar mapa base
// --------------------------------------------------
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

  // ---------------------------------------
  // CLICK → abrir info.html con lat/lon/bbox
  // ---------------------------------------
  map.on("click", (e) => {
    const url = new URL("info.html", window.location.href);

    // 1) Punto consultado
    url.searchParams.set("lat", e.latlng.lat.toFixed(6));
    url.searchParams.set("lon", e.latlng.lng.toFixed(6));

    // 2) BBOX visible (minLon,minLat,maxLon,maxLat)
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    url.searchParams.set(
      "bbox",
      [
        sw.lng.toFixed(6),
        sw.lat.toFixed(6),
        ne.lng.toFixed(6),
        ne.lat.toFixed(6),
      ].join(",")
    );

    // NOTA IMPORTANTE:
    // Ya NO enviamos la región.
    // El info.html detectará todo por BBOX automáticamente.

    window.open(url, "_blank");
  });

  // ---------------------------------------
  // Mira de rifle (geolocalización)
  // ---------------------------------------
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

// --------------------------------------------------
//   7) INICIO
// --------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initMapa();

  regionSelect.addEventListener("change", () => {
    const code = regionSelect.value;
    centrarEnRegion(code);
    cargarInstrumentos(code);
  });

  instrumentoSelect.addEventListener("change", () => {
    zoomAlInstrumento(regionSelect.value, instrumentoSelect.value);
  });

  cargarRegiones();
});
