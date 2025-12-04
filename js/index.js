// =======================================================
// GeoIPT - index.js (Desarrollo)
// Consulta PRC / SCC usando BBOX + click
// Genera geoipt_reporte_actual en localStorage
// y abre info.html?lat=..&lon=..&bbox=..
// =======================================================

// -------------------------------------------------------
// Variables globales
// -------------------------------------------------------
let map;
let regiones = [];
let instrumentosNacionales = [];

// IDs esperados en el HTML
const MAP_ID = "mapaGeoipt";          // <div id="mapaGeoipt"></div>
const REGION_SELECT_ID = "regionSelect";
const INSTRUMENTO_SELECT_ID = "instrumentoSelect";
const LISTA_INSTRUMENTOS_ID = "listaInstrumentos";

// -------------------------------------------------------
// Utilidad: cargar JSON
// -------------------------------------------------------
async function cargarJSON(url, descripcion) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`Error al cargar ${descripcion} desde ${url}:`, resp.status);
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.error(`Excepción al cargar ${descripcion} desde ${url}:`, err);
    return null;
  }
}

// -------------------------------------------------------
// Inicialización principal
// -------------------------------------------------------
async function initGeoIPT() {
  // 1. Crear mapa
  const mapDiv = document.getElementById(MAP_ID);
  if (!mapDiv) {
    console.error(`No se encontró el DIV del mapa con id="${MAP_ID}"`);
    return;
  }

  map = L.map(MAP_ID, {
    center: [-30.5, -71.0], // centro aproximado de Chile
    zoom: 5,
    minZoom: 4,
    maxZoom: 19
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
  }).addTo(map);

  // 2. Cargar regiones
  //    Estructura esperada:
  //    { "regiones_ipt": [ { id, nombre, carpeta, centro, zoom, bbox }, ... ] }
  const regionesData = await cargarJSON("regiones.json", "regiones");
  if (regionesData) {
    regiones = regionesData.regiones_ipt || regionesData.regiones || [];
  } else {
    regiones = [];
  }

  // 3. Cargar listado nacional de instrumentos
  //    Ajusta el nombre si tu archivo se llama distinto.
  //
  //    Estructura esperada (ejemplo):
  //    {
  //      "instrumentos": [
  //        {
  //          "nombre": "PRC Copiapó",
  //          "archivo": "IPT_03_PRC_Copiapo.kml",
  //          "tipo": "PRC",
  //          "comuna": "Copiapó",
  //          "regionNombre": "Región de Atacama",
  //          "regionCarpeta": "capas_03",
  //          "bbox": [minLat, minLon, maxLat, maxLon]
  //        },
  //        ...
  //      ]
  //    }
  const instrumentosData = await cargarJSON(
    "capas/prc_bbox_nacional.json",
    "listado nacional de instrumentos"
  );
  if (instrumentosData) {
    instrumentosNacionales = instrumentosData.instrumentos || instrumentosData;
  } else {
    instrumentosNacionales = [];
  }

  // 4. Poblar combos (si existen)
  poblarComboRegiones();
  poblarComboInstrumentosPorRegion(null);

  // 5. Eventos del mapa
  configurarEventosMapa();

  // 6. Refrescar lista visual de instrumentos en pantalla (opcional)
  actualizarListaInstrumentosEnPantalla();
}

// -------------------------------------------------------
// Poblar combo de regiones
// -------------------------------------------------------
function poblarComboRegiones() {
  const regionSelect = document.getElementById(REGION_SELECT_ID);
  if (!regionSelect || !Array.isArray(regiones)) return;

  regionSelect.innerHTML = "";

  const optDefault = document.createElement("option");
  optDefault.value = "";
  optDefault.textContent = "Todas las regiones";
  regionSelect.appendChild(optDefault);

  regiones.forEach((reg) => {
    const opt = document.createElement("option");
    opt.value = reg.id || reg.nombre;
    opt.textContent = reg.nombre || reg.id;
    regionSelect.appendChild(opt);
  });

  regionSelect.addEventListener("change", () => {
    const valor = regionSelect.value;
    if (!valor) return;

    const reg = regiones.find(
      (r) => String(r.id) === valor || r.nombre === valor
    );
    if (!reg) return;

    if (reg.centro && reg.zoom) {
      map.setView([reg.centro[0], reg.centro[1]], reg.zoom);
    } else if (reg.bbox && reg.bbox.length === 4) {
      const [minLat, minLon, maxLat, maxLon] = reg.bbox;
      const bounds = L.latLngBounds(
        [minLat, minLon],
        [maxLat, maxLon]
      );
      map.fitBounds(bounds);
    }

    poblarComboInstrumentosPorRegion(reg);
  });
}

// -------------------------------------------------------
// Poblar combo de instrumentos según región seleccionada
// -------------------------------------------------------
function poblarComboInstrumentosPorRegion(regionObj) {
  const instrumentoSelect = document.getElementById(INSTRUMENTO_SELECT_ID);
  if (!instrumentoSelect) return;

  instrumentoSelect.innerHTML = "";

  const optDefault = document.createElement("option");
  optDefault.value = "";
  optDefault.textContent = "Todos los instrumentos";
  instrumentoSelect.appendChild(optDefault);

  let filtroRegionNombre = null;
  let filtroCarpeta = null;

  if (regionObj) {
    filtroRegionNombre = regionObj.nombre || null;
    filtroCarpeta = regionObj.carpeta || regionObj.id || null;
  }

  const instrumentosFiltrados = instrumentosNacionales.filter((inst) => {
    if (!regionObj) return true;
    if (inst.regionNombre && filtroRegionNombre) {
      return inst.regionNombre === filtroRegionNombre;
    }
    if (inst.regionCarpeta && filtroCarpeta) {
      return inst.regionCarpeta === filtroCarpeta;
    }
    if (inst.carpeta && filtroCarpeta) {
      return inst.carpeta === filtroCarpeta;
    }
    return true;
  });

  instrumentosFiltrados.forEach((inst, idx) => {
    const opt = document.createElement("option");
    opt.value = inst.archivo || String(idx);
    opt.textContent = inst.nombre || inst.archivo || `Instrumento ${idx + 1}`;
    instrumentoSelect.appendChild(opt);
  });

  // Si eliges un instrumento en particular, hacemos zoom a su BBOX
  instrumentoSelect.addEventListener("change", () => {
    const valor = instrumentoSelect.value;
    if (!valor) return;
    const inst = instrumentosNacionales.find((i) => i.archivo === valor);
    if (inst && Array.isArray(inst.bbox) && inst.bbox.length === 4) {
      const [minLat, minLon, maxLat, maxLon] = inst.bbox;
      const bounds = L.latLngBounds(
        [minLat, minLon],
        [maxLat, maxLon]
      );
      map.fitBounds(bounds);
    }
  });
}

// -------------------------------------------------------
// Eventos del mapa (click y moveend)
// -------------------------------------------------------
function configurarEventosMapa() {
  // Click en el mapa → ejecuta consulta PRC/SCC
  map.on("click", async (e) => {
    const clickLat = e.latlng.lat;
    const clickLon = e.latlng.lng;
    const bounds = map.getBounds();

    const bboxPantalla = {
      minLat: bounds.getSouth(),
      minLon: bounds.getWest(),
      maxLat: bounds.getNorth(),
      maxLon: bounds.getEast()
    };

    try {
      const resultado = await ejecutarConsultaPRC(
        { lat: clickLat, lng: clickLon },
        bboxPantalla
      );

      if (!resultado) {
        alert("No se encontró ningún polígono PRC/SCC que contenga el punto.");
        return;
      }

      // Guardar en localStorage para que info.html lo use
      localStorage.setItem(
        "geoipt_reporte_actual",
        JSON.stringify(resultado)
      );

      // También pasamos lat, lon y bbox por URL (compatibilidad)
      const bboxStr = [
        bboxPantalla.maxLat,
        bboxPantalla.maxLon,
        bboxPantalla.minLat,
        bboxPantalla.minLon
      ].join(",");

      const url =
        "info.html?lat=" +
        encodeURIComponent(clickLat) +
        "&lon=" +
        encodeURIComponent(clickLon) +
        "&bbox=" +
        encodeURIComponent(bboxStr);

      window.open(url, "_blank");
    } catch (err) {
      console.error("Error en la consulta PRC/SCC:", err);
      alert("Ocurrió un error al generar el reporte. Revisa la consola.");
    }
  });

  // Cuando el mapa se mueve, actualizamos lista de instrumentos visibles
  map.on("moveend", () => {
    actualizarListaInstrumentosEnPantalla();
  });
}

// -------------------------------------------------------
// Lista simple de instrumentos que intersectan el BBOX de pantalla
// (solo visual, en un DIV opcional)
// -------------------------------------------------------
function actualizarListaInstrumentosEnPantalla() {
  const contenedor = document.getElementById(LISTA_INSTRUMENTOS_ID);
  if (!contenedor) return;
  if (!instrumentosNacionales.length) return;

  const bounds = map.getBounds();
  const bbox = {
    minLat: bounds.getSouth(),
    minLon: bounds.getWest(),
    maxLat: bounds.getNorth(),
    maxLon: bounds.getEast()
  };

  const enPantalla = filtrarInstrumentosPorBbox(bbox);

  contenedor.innerHTML = "";
  if (!enPantalla.length) {
    contenedor.textContent = "No hay instrumentos en el área visible.";
    return;
  }

  const ul = document.createElement("ul");
  enPantalla.forEach((inst) => {
    const li = document.createElement("li");
    li.textContent =
      (inst.regionNombre || "") +
      " – " +
      (inst.comuna || "") +
      " – " +
      (inst.nombre || inst.archivo);
    ul.appendChild(li);
  });

  contenedor.appendChild(ul);
}

// -------------------------------------------------------
// Filtro de instrumentos por BBOX
// -------------------------------------------------------
function filtrarInstrumentosPorBbox(bboxPantalla) {
  const { minLat, minLon, maxLat, maxLon } = bboxPantalla;

  return instrumentosNacionales.filter((inst) => {
    if (!inst.bbox || inst.bbox.length !== 4) return false;
    const [iMinLat, iMinLon, iMaxLat, iMaxLon] = inst.bbox;

    // Intersección simple de rectángulos
    const noIntersecta =
      iMaxLat < minLat ||
      iMinLat > maxLat ||
      iMaxLon < minLon ||
      iMinLon > maxLon;

    return !noIntersecta;
  });
}

// -------------------------------------------------------
// Ejecutar la consulta PRC/SCC
// -------------------------------------------------------
async function ejecutarConsultaPRC(click, bboxPantalla) {
  const candidatos = filtrarInstrumentosPorBbox(bboxPantalla);

  if (!candidatos.length) {
    console.warn("No hay instrumentos cuyos BBOX intersecten el área visible.");
    return null;
  }

  // Tabla resumen (para info.html)
  const tabla = candidatos.map((inst) => ({
    nombre: inst.nombre || inst.archivo,
    tipo: inst.tipo || "",
    comuna: inst.comuna || "",
    contienePuntoBBOX: true // por definición todos intersectan el BBOX
  }));

  // Recorremos candidatos hasta encontrar un polígono que contenga el punto
  for (const inst of candidatos) {
    try {
      const resultadoInstrumento = await buscarPoligonoQueContienePunto(
        inst,
        click
      );
      if (resultadoInstrumento) {
        const { attrsZona, geometryZona } = resultadoInstrumento;

        const instrumentoReporte = {
          nombre: inst.nombre || inst.archivo,
          archivo: inst.archivo,
          tipo: inst.tipo || "",
          comuna: inst.comuna || "",
          regionNombre: inst.regionNombre || "",
          regionCarpeta: inst.regionCarpeta || inst.carpeta || ""
        };

        const zona = Object.assign({}, attrsZona || {});
        // 👇 CLAVE: aquí va la geometría para que info.html dibuje el polígono
        zona.geometry = geometryZona;

        return {
          click: { lat: click.lat, lng: click.lng },
          instrumento: instrumentoReporte,
          zona,
          tabla
        };
      }
    } catch (err) {
      console.error("Error evaluando instrumento", inst, err);
    }
  }

  // Si ningún polígono de los candidatos contiene el punto
  return null;
}

// -------------------------------------------------------
// Buscar polígono que contiene el punto dentro del KML
// -------------------------------------------------------
async function buscarPoligonoQueContienePunto(inst, click) {
  const carpeta = inst.regionCarpeta || inst.carpeta || "";
  const archivo = inst.archivo;
  if (!archivo) {
    console.warn("Instrumento sin archivo KML:", inst);
    return null;
  }

  const rutaKml = carpeta ? `capas/${carpeta}/${archivo}` : archivo;

  let textoKml = "";
  try {
    const resp = await fetch(rutaKml);
    if (!resp.ok) {
      console.error("No se pudo cargar KML:", rutaKml, resp.status);
      return null;
    }
    textoKml = await resp.text();
  } catch (err) {
    console.error("Error de red cargando KML:", rutaKml, err);
    return null;
  }

  const parser = new DOMParser();
  const xml = parser.parseFromString(textoKml, "text/xml");
  const placemarks = Array.from(xml.getElementsByTagName("Placemark"));

  if (!placemarks.length) {
    console.warn("KML sin placemarks:", rutaKml);
    return null;
  }

  const pt = [click.lng, click.lat]; // [lon, lat]

  for (const pm of placemarks) {
    // 1. Geometría (suponemos Polygon; se puede extender a MultiGeometry)
    const coordsNode = pm.getElementsByTagName("coordinates")[0];
    if (!coordsNode) continue;

    const coordsText = coordsNode.textContent.trim();
    if (!coordsText) continue;

    const puntos = coordsText
      .split(/\s+/)
      .map((token) => {
        const parts = token.split(",");
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        return [lon, lat];
      })
      .filter((p) => !Number.isNaN(p[0]) && !Number.isNaN(p[1]));

    if (puntos.length < 3) continue;

    const ring = puntos;

    if (puntoEnPoligono(pt, ring)) {
      // 2. Atributos (ExtendedData)
      const dataNodes = Array.from(pm.getElementsByTagName("Data"));
      const attrsZona = {};

      dataNodes.forEach((d) => {
        const nombreAttr = d.getAttribute("name");
        const valNode = d.getElementsByTagName("value")[0];
        const valorAttr = valNode ? valNode.textContent.trim() : "";
        if (nombreAttr) {
          attrsZona[nombreAttr] = valorAttr;
        }
      });

      // Opcional: nombre del Placemark
      const nameNode = pm.getElementsByTagName("name")[0];
      if (nameNode && nameNode.textContent) {
        attrsZona["NOMBRE_PM"] = nameNode.textContent.trim();
      }

      const geometryZona = {
        type: "Polygon",
        coordinates: [ring]
      };

      return { attrsZona, geometryZona };
    }
  }

  return null;
}

// -------------------------------------------------------
// Algoritmo punto en polígono (ray casting)
// pt = [lon, lat]
// polygon = array de [lon, lat]
// -------------------------------------------------------
function puntoEnPoligono(pt, polygon) {
  const x = pt[0];
  const y = pt[1];
  let dentro = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersecta =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;

    if (intersecta) dentro = !dentro;
  }

  return dentro;
}

// -------------------------------------------------------
// Lanzar inicialización
// -------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initGeoIPT().catch((err) => {
    console.error("Error inicializando GeoIPT:", err);
  });
});
