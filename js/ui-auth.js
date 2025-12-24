// js/ui-auth.js
import { getIdToken } from "./auth.js";

// 🔁 Reemplaza esto por tu Cloud Run API real (servicio que entregará el KML protegido)
const KML_API_BASE = "https://TU-SERVICIO-API-xxxxx.a.run.app";

/**
 * Descarga KML desde Cloud Run API, enviando el Firebase ID Token.
 * @param {string} queryString ejemplo: "?cut=03101&capa=IPT_03_ZONIF&zona=Z1"
 */
export async function downloadKML(queryString = "") {
  const token = await getIdToken();

  // Si no hay sesión, invitación
  if (!token) {
    alert("Inicia sesión para descargar");
    window.location.href = "login.html";
    return;
  }

  // Normaliza query string
  let qs = queryString || "";
  if (qs && !qs.startsWith("?")) qs = "?" + qs;

  const url = `${KML_API_BASE}/kml${qs}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    alert(`No autorizado o error al descargar KML.\n${resp.status} ${resp.statusText}\n${txt}`.trim());
    return;
  }

  const blob = await resp.blob();

  // Nombre de archivo (si el backend lo manda, lo respetamos)
  let filename = "geoipt_export.kml";
  const cd = resp.headers.get("content-disposition") || "";
  const m = cd.match(/filename="([^"]+)"/i);
  if (m && m[1]) filename = m[1];

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Limpieza
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
