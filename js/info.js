// ================================
// 1. Recuperar datos desde localStorage
// ================================
function cargarDatosGeoipt() {
  try {
    const raw = localStorage.getItem("geoipt_reporte_actual");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error leyendo geoipt_reporte_actual", e);
    return null;
  }
}

const data = cargarDatosGeoipt();
const mensaje = document.getElementById("mensaje");
const contenido = document.getElementById("contenido");

if (!data) {
  mensaje.innerHTML = `
    <div class="msg-error">
      No se encontraron datos de reporte activos.<br/>
      Por favor, vuelva al mapa principal y seleccione un punto sobre una zona urbana.
    </div>
  `;
} else {
  contenido.style.display = "block";

  const { click, instrumento, zona, tabla } = data;
  const lat = click.lat;
  const lon = click.lng;

  // ================================
  // 2. Subtítulo, región, instrumento
  // ================================
  document.getElementById("subtitulo-instrumento").textContent =
    instrumento.nombre || "";

  document.getElementById("region-texto").textContent =
    instrumento.regionNombre || (zona && zona.REG) || "Región no especificada";

  document.getElementById("instrumentos-texto").textContent =
    instrumento.nombre || instrumento.archivo || "(sin nombre)";

  // ================================
  // 3. WGS84
  // ================================
  document.getElementById("wgs-lat").textContent = lat.toFixed(6);
  document.getElementById("wgs-lon").textContent = lon.toFixed(6);

  // ================================
  // 4. Cálculo de UTM (zona automática)
  // ================================
  let utmZone = Math.floor((lon + 180) / 6) + 1;
  if (utmZone < 1) utmZone = 1;
  if (utmZone > 60) utmZone = 60;

  const epsg = 32700 + utmZone; // hemisferio sur
  const utmDef = `+proj=utm +zone=${utmZone} +south +datum=WGS84 +units=m +no_defs`;

  let este = "";
  let norte = "";
  try {
    const res = proj4("EPSG:4326", utmDef, [lon, lat]);
    este = res[0].toFixed(3);
    norte = res[1].toFixed(3);
  } catch (e) {
    console.error("Error en transformación UTM", e);
  }

  document.getElementById("utm-e").textContent = este;
  document.getElementById("utm-n").textContent = norte;
  document.getElementById("utm-epsg").textContent = `EPSG:${epsg}`;

  // ================================
  // 5. Mapa de referencia
  // ================================
  const map = L.map("map").setView([lat, lon], 17);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20
  }).addTo(map);

  // Punto consultado
  L.circleMarker([lat, lon], {
    radius: 7,
    weight: 3,
    color: "#0f172a",
    fillColor: "#ffffff",
    fillOpacity: 0.9
  }).addTo(map);

  // ================================
  // 5b. Dibujar polígono de la zona (azul semitransparente)
  //     y mostrar vértices al hacer click sobre él
  // ================================
  (function dibujarPoligonoZona() {
    if (!zona) return;

    let geom = null;

    // Caso 1: zona.geometry = objeto GeoJSON geometry
    if (zona.geometry && zona.geometry.type) {
      geom = zona.geometry;
    }
    // Caso 2: zona.geojson = Feature o FeatureCollection
    else if (zona.geojson) {
      if (zona.geojson.type === "Feature") {
        geom = zona.geojson.geometry;
      } else if (
        zona.geojson.type === "FeatureCollection" &&
        zona.geojson.features &&
        zona.geojson.features.length > 0
      ) {
        geom = zona.geojson.features[0].geometry;
      }
    }
    // Caso 3: zona.coords = array de [lon, lat]
    else if (Array.isArray(zona.coords) && zona.coords.length > 2) {
      const ring = zona.coords.map(function (par) {
        return [par[0], par[1]]; // [lon, lat]
      });
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
      }
      geom = { type: "Polygon", coordinates: [ring] };
    }

    if (!geom) return;

    try {
      const capaZona = L.geoJSON(geom, {
        style: {
          color: "#2563eb",     // borde azul
          weight: 2,
          fillColor: "#3b82f6", // relleno azul
          fillOpacity: 0.30     // semitransparente
        }
      }).addTo(map);

      const bounds = capaZona.getBounds().extend([lat, lon]);
      map.fitBounds(bounds.pad(0.15));

      // Mostrar vértices al hacer click sobre el polígono
      const contenedorVertices = document.getElementById("vertices-poligono");

      capaZona.on("click", function (e) {
        // Evitar que el click llegue al mapa (para que NO abra nuevo index.html)
        L.DomEvent.stop(e);

        let coords = [];

        if (geom.type === "Polygon") {
          coords = geom.coordinates[0]; // primer anillo
        } else if (geom.type === "MultiPolygon") {
          if (
            Array.isArray(geom.coordinates) &&
            geom.coordinates.length > 0 &&
            Array.isArray(geom.coordinates[0]) &&
            geom.coordinates[0].length > 0
          ) {
            coords = geom.coordinates[0][0];
          }
        }

        if (!coords || !coords.length) return;

        const items = coords.map(function (par, idx) {
          const lonV = Number(par[0]) || 0;
          const latV = Number(par[1]) || 0;
          return `<li>${idx + 1}. Lon: ${lonV.toFixed(6)} – Lat: ${latV.toFixed(6)}</li>`;
        }).join("");

        contenedorVertices.innerHTML = `
          <h3 style="margin:10px 0 4px; font-size:0.95rem;">Vértices del polígono seleccionado</h3>
          <ol style="margin-left:18px;">
            ${items}
          </ol>
        `;
      });
    } catch (e) {
      console.error("Error dibujando polígono de zona:", e);
    }
  })();

  // ================================
  // 5c. Nueva consulta desde overview
  //     Cada click en el mapa (fuera del polígono) abre index.html?lat=..&lon=..
  // ================================
  map.on("click", function (e) {
    const newLat = e.latlng.lat.toFixed(6);
    const newLon = e.latlng.lng.toFixed(6);
    const url = `index.html?lat=${newLat}&lon=${newLon}`;
    window.open(url, "_blank");
  });

  // ================================
  // 6. Resultado de la consulta
  // ================================
  const textoResultado = document.getElementById("texto-resultado");
  textoResultado.textContent =
    "Resultado: el punto consultado se encuentra dentro de al menos un polígono PRC/SCC.";

  const listaCoincidencias = document.getElementById("lista-coincidencias");
  listaCoincidencias.innerHTML = `
    <li>Coincidencia en archivo: <strong>${instrumento.archivo}</strong></li>
  `;

  // ================================
  // 7. Detalle de atributos de la zona
  // ================================
  document.getElementById("titulo-detalle-poligono").textContent =
    `Detalle de atributos del/los polígono(s) – ${instrumento.archivo}`;

  const tablaZona = document.getElementById("tabla-zona");
  const filasZona = Object.entries(zona)
    .filter(([k, _]) => k !== "geometry" && k !== "geojson" && k !== "coords")
    .map(([k, v]) => `
      <tr>
        <th style="width: 180px;">${k}</th>
        <td>${v}</td>
      </tr>
    `).join("");

  tablaZona.innerHTML = `<tbody>${filasZona}</tbody>`;

  // ================================
  // 8. Tabla de instrumentos en pantalla
  // ================================
  const cuerpoLista = document.querySelector("#tabla-lista tbody");
  cuerpoLista.innerHTML = (tabla || []).map(i => `
    <tr>
      <td>${i.nombre || ""}</td>
      <td>${i.tipo || ""}</td>
      <td>${i.comuna || ""}</td>
      <td>${i.contienePuntoBBOX ? "✔" : ""}</td>
    </tr>
  `).join("");

  // ================================
  // 9. Documentos adjuntos
  //      - JSON ya existía
  //      - KML AHORA solo del polígono azul
  // ================================

  function escapeXml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function construirKmlZona(inst, zonaObj) {
    if (!zonaObj || !zonaObj.geometry) return null;
    const geom = zonaObj.geometry;

    let ring = [];
    if (geom.type === "Polygon" && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
      ring = geom.coordinates[0];
    } else if (
      geom.type === "MultiPolygon" &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates.length > 0 &&
      geom.coordinates[0].length > 0
    ) {
      ring = geom.coordinates[0][0];
    }

    if (!ring || ring.length < 3) return null;

    const coordsStr = ring
      .map(par => `${par[0]},${par[1]},0`)
      .join(" ");

    const nombreInstrumento = inst.nombre || inst.archivo || "Zona GeoIPT";
    const nombreZona =
      zonaObj.NOM || zonaObj.ZONA || zonaObj.NOMBRE_PM || "Zona consultada";

    const attrsXml = Object.entries(zonaObj)
      .filter(([k]) => k !== "geometry" && k !== "geojson" && k !== "coords")
      .map(([k, v]) =>
        `        <Data name="${escapeXml(k)}"><value>${escapeXml(v)}</value></Data>`
      )
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(nombreInstrumento)}</name>
    <Style id="geoipt_poly">
      <LineStyle>
        <color>ffeb6325</color>
        <width>2</width>
      </LineStyle>
      <PolyStyle>
        <color>66f6823b</color>
      </PolyStyle>
    </Style>
    <Placemark>
      <name>${escapeXml(nombreZona)}</name>
      <styleUrl>#geoipt_poly</styleUrl>
      <ExtendedData>
${attrsXml}
      </ExtendedData>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              ${coordsStr}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
  }

  const linkKml = document.getElementById("link-kml");
  linkKml.addEventListener("click", function (ev) {
    ev.preventDefault();
    const kmlStr = construirKmlZona(instrumento, zona);
    if (!kmlStr) {
      alert("No se pudo construir el KML de la zona consultada.");
      return;
    }
    const blob = new Blob(
      [kmlStr],
      { type: "application/vnd.google-earth.kml+xml" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const baseName = (instrumento.archivo || "zona").replace(/\.kml$/i, "");
    a.download = `geoipt_zona_${baseName}.kml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  const linkJsonZona = document.getElementById("link-json-zona");
  linkJsonZona.addEventListener("click", function (ev) {
    ev.preventDefault();
    const blob = new Blob(
      [JSON.stringify(zona, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geoipt_zona_${instrumento.archivo.replace(/\.kml$/i, "")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}
