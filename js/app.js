const statusEl = document.getElementById("status");
const listEl = document.getElementById("schoolList");
const searchEl = document.getElementById("search");
const nextBtn = document.getElementById("nextBtn");
const resetRouteBtn = document.getElementById("resetRouteBtn");

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function escapeHtml(str = "") {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function popupHtml(s) {
  const name = escapeHtml(s.name || "");
  const city = escapeHtml(s.city || "");
  const desc = escapeHtml(s.description || "");
  const photo = s.photo
    ? `<img src="${escapeHtml(s.photo)}" alt="${name}" style="width:100%;max-width:280px;border-radius:12px;margin:8px 0;" />`
    : "";
  const link = s.link
    ? `<div style="margin-top:8px;"><a href="${escapeHtml(s.link)}" target="_blank" rel="noopener">Отвори публикация/материали</a></div>`
    : "";

  const order = Number.isFinite(s.order)
    ? `<div style="opacity:.8;font-size:12px;margin-top:6px;">Маршрут №${s.order}</div>`
    : "";

  return `
    <div style="min-width:240px;max-width:320px;">
      <div style="font-weight:800;margin-bottom:2px;">${name}</div>
      <div style="opacity:.8;margin-bottom:6px;">${city}</div>
      ${photo}
      <div style="font-size:13px;line-height:1.35;">${desc}</div>
      ${link}
      ${order}
    </div>
  `;
}

async function loadSchools() {
  setStatus("Зареждане на училищата…");
  const res = await fetch("data/schools.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Не успях да заредя data/schools.json");
  return await res.json();
}

function initMap() {
  const map = L.map("map", { scrollWheelZoom: true }).setView([42.7, 25.3], 7);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  return map;
}

function renderList(items, onSelect) {
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.innerHTML = `<li style="cursor:default;opacity:.8;">Няма резултати.</li>`;
    return;
  }

  for (const s of items) {
    const li = document.createElement("li");
    const ord = Number.isFinite(s.order) ? ` · №${s.order}` : "";
    li.innerHTML = `
      <div class="name">${escapeHtml(s.name)}</div>
      <div class="meta">${escapeHtml(s.city)}${ord}</div>
    `;
    li.addEventListener("click", () => onSelect(s));
    listEl.appendChild(li);
  }
}

/**
 * Подрежда по order; ако няма order -> накрая (по име).
 */
function sortByOrder(schools) {
  return [...schools].sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY;
    const bo = Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return (a.name || "").localeCompare(b.name || "", "bg");
  });
}

/**
 * Управлява рисуването на „път“ (polyline) до даден индекс.
 */
function createRouteController(map, orderedSchools) {
  let routeLine = null;
  let animTimer = null;

  function clearAnim() {
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = null;
    }
  }

  function drawToIndex(idx, { animate = true } = {}) {
    clearAnim();

    const maxIdx = orderedSchools.length - 1;
    const target = (idx == null) ? maxIdx : Math.max(0, Math.min(idx, maxIdx));

    const latlngsFull = orderedSchools.map(s => [s.lat, s.lng]);
    const latlngsTarget = latlngsFull.slice(0, target + 1);

    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }

    if (latlngsTarget.length < 2) return;

    const initial = animate ? [latlngsTarget[0]] : latlngsTarget;
    routeLine = L.polyline(initial, { weight: 4, opacity: 0.9 }).addTo(map);

    if (!animate) return;

    let i = 1;
    animTimer = setInterval(() => {
      if (!routeLine) return clearAnim();
      if (i >= latlngsTarget.length) return clearAnim();
      routeLine.addLatLng(latlngsTarget[i]);
      i += 1;
    }, 120);
  }

  return {
    drawFull: (opts) => drawToIndex(null, opts),
    drawToOrder: (orderNumber, opts) => {
      const idx = orderedSchools.findIndex(s => s.order === orderNumber);
      drawToIndex(idx === -1 ? null : idx, opts);
    },
    drawToSchoolId: (id, opts) => {
      const idx = orderedSchools.findIndex(s => s.id === id);
      drawToIndex(idx === -1 ? null : idx, opts);
    }
  };
}

(async function main() {
  const map = initMap();

  let schools = [];
  const markersById = new Map();

  // Маршрутни данни (само тези с order)
  let ordered = [];
  let route = null;
  let tourIndex = 0;

  try {
    schools = await loadSchools();
    setStatus(`Заредени училища: ${schools.length}`);

    // Клъстер (важно при 300+ точки)
    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true
    });

    // Подреждане за маршрута (само тези с order)
    ordered = sortByOrder(schools).filter(s => Number.isFinite(s.order));
    route = createRouteController(map, ordered);

    // Маркери -> в cluster
    for (const s of schools) {
      const m = L.marker([s.lat, s.lng]).bindPopup(popupHtml(s));
      markersById.set(s.id, m);

      m.on("click", () => {
        if (route && Number.isFinite(s.order)) route.drawToOrder(s.order, { animate: true });
        if (Number.isFinite(s.order)) tourIndex = Math.max(0, ordered.findIndex(x => x.id === s.id));
      });

      cluster.addLayer(m);
    }
    map.addLayer(cluster);

    // рамкиране
    if (schools.length >= 2) {
      const bounds = L.latLngBounds(schools.map(s => [s.lat, s.lng]));
      map.fitBounds(bounds.pad(0.2));
    }

    // Показваме целия маршрут (ако има)
    if (ordered.length >= 2) {
      route.drawFull({ animate: true });
      tourIndex = 0;
    }

    const selectSchool = (s) => {
      const m = markersById.get(s.id);
      if (!m) return;

      map.setView([s.lat, s.lng], 12, { animate: true });

      // ако маркерът е в клъстер, гарантираме, че ще се отвори
      cluster.zoomToShowLayer(m, () => {
        m.openPopup();
      });

      if (route && Number.isFinite(s.order)) {
        route.drawToOrder(s.order, { animate: true });
        tourIndex = Math.max(0, ordered.findIndex(x => x.id === s.id));
      }
    };

    const applyFilter = () => {
      const q = (searchEl.value || "").trim().toLowerCase();
      const filtered = !q
        ? schools
        : schools.filter(s =>
            (s.name || "").toLowerCase().includes(q) ||
            (s.city || "").toLowerCase().includes(q)
          );

      renderList(filtered, selectSchool);
      setStatus(`Показани: ${filtered.length} / ${schools.length}`);
    };

    searchEl.addEventListener("input", applyFilter);
    renderList(schools, selectSchool);

    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (!ordered.length) return;

        const s = ordered[tourIndex % ordered.length];
        selectSchool(s);
        tourIndex = (tourIndex + 1) % ordered.length;
      });
    }

    if (resetRouteBtn) {
      resetRouteBtn.addEventListener("click", () => {
        if (route) route.drawFull({ animate: true });
      });
    }
  } catch (err) {
    console.error(err);
    setStatus("Грешка при зареждане. Провери дали data/schools.json е качен правилно.");
  }
})();
