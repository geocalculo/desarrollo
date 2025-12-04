// =======================================================
// GeoIPT - index.js (desarrollo)
// Motor de consulta PRC/SCC con BBOX + click
// Genera geoipt_reporte_actual en localStorage y abre info.html
// =======================================================

// Referencias globales
let map;
let regiones = [];
let instrumentosNacionales = [];

// Elementos del DOM (si existen)
const regionSelect = document.getElementById("regionSelect");
const instrumentoSelect = document.getElementById("instrumentoSelect");
const listaInstrumentosDiv = document.getElementById("listaInstrumentos");

// -------------------------------------------------------
// Utilidad: cargar JSON con manejo básico de errores
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
  // 1. Crear mapa base
  map = L.map("mapaGeoipt", {
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
  const regionesData = await cargarJSON("regiones.json", "regiones");
  if (regionesData) {
    regiones = regionesData.regiones_ipt || regionesData.regiones || [];
  } else {
    regiones = [];
  }

  // 3. Cargar listado nacional de instrumentos
  //    (ajusta la ruta si lo tienes en otra ubicación)
  const instrumentosData = await cargarJSON("capas/listado_nacional.json", "listado nacional de instrumentos");
  if (instrumentosData) {
    instrumentosNacionales = instrumentosData.instrumentos || instrumentosData;
  } else {
    instrumentosNacionales = [];
  }

  // 4. Poblar combos si están presentes
  poblarComboRegiones();
  poblarComboInstrumentosPorRegion(null); // inicialmente sin filtro, o puedes pasar una región

  // 5. Listeners del mapa
  configurarEventosMapa();
}

// -------------------------------------------------------
// Poblar combo de regiones (visual / zoom)
// -------------------------------------------------------
function poblarComboRegiones() {
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
// Poblar combo de instrumentos según región (opcional)
// -------------------------------------------------------
function poblarComboInstrumentosPorRegion(regionObj) {
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
    if (!regionObj) return true; // sin filtro de región
    // Se puede filtrar por regionNombre o por regionCarpeta / carpeta
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

  instrumentoSelect.addEventListener("change", () => {
    const valor = instrumentoSelect.value;
    if (!valor) return;
    const inst = instrumentosNacionales.find(
      (i) => i.archivo === valor
    );
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
// Eventos del mapa
// -------------------------------------------------------
function configurarEventosMapa() {
  // Click: dispara la consulta PRC/SCC
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
      const resultado = await ejecutarConsultaPRC({
        lat: clickLat,
        lng: clickLon
      }, bboxPantalla);

      if (!resultado) {
        alert("No se encontró ningún polígono PRC/SCC que contenga el punto.");
        return;
      }

      localStorage.setItem(
        "geoipt_reporte_actual",
        JSON.stringify(resultado)
      );

      window.open("info.html", "_blank");
    } catch (err) {
      console.error("Error en la consulta PRC/SCC:", err);
      alert("Ocurrió un error al generar el reporte. Revisa la consola.");
    }
  });

  // Opcional: cuando termina el movimiento, podríamos actualizar la lista
  map.on("moveend", () => {
    actualizarListaInstrumentosEnPantalla();
  });
}

// -------------------------------------------------------
// Actualizar listado simple de instrumentos que tocan el BBOX
// (solo visual, en un DIV opcional)
// -------------------------------------------------------
function actualizarListaInstrumentosEnPantalla() {
  if (!listaInstrumentosDiv) return;
  if (!instrumentosNacionales.length) return;

  const bounds = map.getBounds();
  const bbox = {
    minLat: bounds.getSouth(),
    minLon: bounds.getWest(),
    maxLat: bounds.getNorth(),
    maxLon: bounds.getEast()
  };

  const enPantalla = filtrarInstrumentosPorBbox(bbox);

  listaInstrumentosDiv.innerHTML = "";
  if (!enPantalla.length) {
    listaInstrumentosDiv.textContent = "No hay instrumentos en el área visible.";
    return;
  }

  const ul = document.createElement("ul");
  enPantalla.forEach((inst) => {
    const li = document.createElement("li");
    li.textContent = `${inst.regionNombre || ""} – ${inst.comuna || ""} – ${inst.nombre || inst.archivo}`;
    ul.appendChild(li);
  });

  listaInstrumentosDiv.appendChild(ul);
}

// -------------------------------------------------------
// Filtro de instrumentos por BBOX de pantalla
// -------------------------------------------------------
function filtrarInstrumentosPorBbox(bboxPantalla) {
  const { minLat, minLon, maxLat, maxLon } = bboxPantalla;

  return instrumentosNacionales.filter((inst) => {
    if (!inst.bbox || inst.bbox.length !== 4) return false;
    const [iMinLat, iMinLon, iMaxLat, iMaxLon] = inst.bbox;

    // Intersección de rectángulos (lat/long)
    const noIntersecta =
      iMaxLat < minLat ||
      iMinLat > maxLat ||
      iMaxLon < minLon ||
      iMinLon > maxLon;

    return !noIntersecta;
  });
}

// -------------------------------------------------------
// Ejecutar la consulta PRC/SCC dada la posición del click
// y el BBOX de la pantalla
// Devuelve estructura lista para info.html:
// {
//   click: {lat, lng},
//   instrumento: {...},
//   zona: { ...attrs, geometry: GeoJSON },
//   tabla: [ {nombre, tipo, comuna, contienePuntoBBOX} ]
// }
// -------------------------------------------------------
async function ejecutarConsultaPRC(click, bboxPantalla) {
  const candidatos = filtrarInstrumentosPorBbox(bboxPantalla);

  if (!candidatos.length) {
    console.warn("No hay instrumentos cuyos BBOX intersecten el área visible.");
    return null;
  }

  const tabla = candidatos.map((inst) => ({
    nombre: inst.nombre || inst.archivo,
    tipo: inst.tipo || "",
    comuna: inst.comuna || "",
    contienePuntoBBOX: true // por definición, todos intersectan el BBOX
  }));

  // Recorremos candidatos hasta encontrar un polígono que contenga el punto
  for (const inst of candidatos) {
    try {
      const resultadoInstrumento = await buscarPoligonoQueContienePunto(inst, click);
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

  // Si ninguno contiene el punto, devolvemos null
  return null;
}

// -------------------------------------------------------
// Cargar KML de un instrumento y buscar el polígono
// que contiene el punto. Devuelve {attrsZona, geometryZona}
// o null si no hay match.
// -------------------------------------------------------
async function buscarPoligonoQueContienePunto(inst, click) {
  const carpeta = inst.regionCarpeta || inst.carpeta || "";
  const archivo = inst.archivo;
  if (!archivo) {
    console.warn("Instrumento sin archivo KML:", inst);
    return null;
  }

  const rutaKml = carpeta
    ? `capas/${carpeta}/${archivo}`
    : archivo;

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
    // 1. Geometría (suponemos Polygon)
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

      // También podemos tomar <name> del Placemark
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
// Lanzar inicialización cuando el DOM esté listo
// -------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initGeoIPT().catch((err) => {
    console.error("Error inicializando GeoIPT:", err);
  });
});
