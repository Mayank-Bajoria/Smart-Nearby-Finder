var lat = 28.6139,
  lng = 77.209;
var radius = 3000;
var map, userMarker, markers;
var currentLat = lat,
  currentLng = lng;
var activeType = null;
var results = [];
var loading = false;
var toastTimer;
var activeCard = null;

var categories = {
  hospital: {
    label: "Hospitals",
    icon: "fa-hospital",
    color: "#ef4444",
    tag: 'amenity="hospital"',
  },
  bank: {
    label: "Banks",
    icon: "fa-building-columns",
    color: "#3b82f6",
    tag: 'amenity="bank"',
  },
  hotel: {
    label: "Hotels",
    icon: "fa-hotel",
    color: "#a855f7",
    tag: 'tourism="hotel"',
  },
  pharmacy: {
    label: "Pharmacies",
    icon: "fa-pills",
    color: "#10b981",
    tag: 'amenity="pharmacy"',
  },
  school: {
    label: "Schools",
    icon: "fa-school",
    color: "#f59e0b",
    tag: 'amenity="school"',
  },
};

document.addEventListener("DOMContentLoaded", function () {
  map = L.map("map", { center: [currentLat, currentLng], zoom: 14 });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
  markers = L.layerGroup().addTo(map);

  var saved = localStorage.getItem("theme") || "light";
  setThemeJS(saved);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        setLocation(pos.coords.latitude, pos.coords.longitude, false);
      },
      function () {},
    );
  }

  setTimeout(function () {
    document.getElementById("page-loader").classList.add("hidden");
  }, 1000);

  setupEvents();
});

function setupEvents() {
  document
    .getElementById("theme-toggle")
    .addEventListener("click", function () {
      setThemeJS(
        document.documentElement.getAttribute("data-theme") === "dark"
          ? "light"
          : "dark",
      );
    });

  document.querySelectorAll(".cat-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var type = btn.getAttribute("data-type");
      if (activeType === type) {
        activeType = null;
        btn.classList.remove("active");
        resetSidebar();
        return;
      }
      document.querySelectorAll(".cat-btn").forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      activeType = type;
      fetchPlaces(type);
    });
  });

  document
    .getElementById("search-btn")
    .addEventListener("click", searchLocation);
  document
    .getElementById("location-search")
    .addEventListener("keydown", function (e) {
      if (e.key === "Enter") searchLocation();
    });



  document.getElementById("locate-btn").addEventListener("click", function () {
    if (!navigator.geolocation) {
      showToast("Geolocation not supported", "error");
      return;
    }
    var btn = document.getElementById("locate-btn");
    btn.style.opacity = "0.6";
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        btn.style.opacity = "1";
        setLocation(pos.coords.latitude, pos.coords.longitude, true);
        if (activeType) fetchPlaces(activeType);
      },
      function () {
        btn.style.opacity = "1";
        showToast("Could not get location", "error");
      },
    );
  });

  var filterTimer;
  document
    .getElementById("filter-input")
    .addEventListener("input", function () {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(applyFilter, 300);
    });
  document
    .getElementById("sort-select")
    .addEventListener("change", applyFilter);

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document
    .getElementById("modal-backdrop")
    .addEventListener("click", closeModal);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });
}

function setLocation(la, ln, pan) {
  currentLat = la;
  currentLng = ln;
  if (userMarker) map.removeLayer(userMarker);
  var icon = L.divIcon({
    className: "",
    html: '<div class="user-location-marker"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  userMarker = L.marker([la, ln], { icon: icon })
    .addTo(map)
    .bindPopup(
      '<div class="map-popup"><div class="map-popup-name">📍 You are here</div></div>',
    );
  if (pan) {
    map.flyTo([la, ln], 14, { duration: 1.2 });
    showToast("Location found!", "success");
  }
}

async function searchLocation() {
  var q = document.getElementById("location-search").value.trim();
  if (!q) return;
  showToast("Searching...", "info");
  try {
    var res = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&q=" +
        encodeURIComponent(q) +
        "&limit=1",
    );
    var data = await res.json();
    if (!data.length) {
      showToast("Location not found", "error");
      return;
    }
    currentLat = parseFloat(data[0].lat);
    currentLng = parseFloat(data[0].lon);
    map.flyTo([currentLat, currentLng], 14, { duration: 1.5 });
    showToast("Found: " + data[0].display_name.split(",")[0], "success");
    if (activeType)
      setTimeout(function () {
        fetchPlaces(activeType);
      }, 1600);
  } catch (e) {
    showToast("Search failed", "error");
  }
}



async function fetchPlaces(type) {
  if (loading) return;
  var cat = categories[type];
  loading = true;

  document.getElementById("sidebar-title").textContent =
    "Loading " + cat.label + "...";
  document.getElementById("results-count").textContent = "";
  document.getElementById("filter-row").style.display = "none";
  document.getElementById("map-loading").style.display = "flex";
  document.getElementById("results-list").innerHTML = "";

  var q =
    "[out:json][timeout:15];(node[" +
    cat.tag +
    "](around:" +
    radius +
    "," +
    currentLat +
    "," +
    currentLng +
    ");way[" +
    cat.tag +
    "](around:" +
    radius +
    "," +
    currentLat +
    "," +
    currentLng +
    "););out center 30;";

  try {
    var res = await fetch(
      "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q),
    );
    var data = await res.json();
    loading = false;
    document.getElementById("map-loading").style.display = "none";
    results = buildResults(data.elements || [], type);
    showResults(results, type);
  } catch (e) {
    loading = false;
    document.getElementById("map-loading").style.display = "none";
    showToast("Could not load places. Try again.", "error");
  }
}

function buildResults(elements, type) {
  var list = [];
  elements.forEach(function (el) {
    var la = el.lat || (el.center && el.center.lat);
    var lo = el.lon || (el.center && el.center.lon);
    if (!la || !lo) return;
    var tags = el.tags || {};
    var name = tags.name || tags["name:en"] || type;
    var addr = [
      tags["addr:housenumber"],
      tags["addr:street"],
      tags["addr:city"],
    ]
      .filter(Boolean)
      .join(", ");
    var dist = calcDist(currentLat, currentLng, la, lo);
    var seed = el.id % 20;
    var rating = Math.round((3 + seed * 0.1) * 10) / 10;
    list.push({
      id: el.id,
      name: name,
      type: type,
      lat: la,
      lng: lo,
      address: addr,
      distance: dist,
      rating: rating,
      phone: tags.phone || null,
      website: tags.website || null,
      hours: tags.opening_hours || null,
    });
  });
  list.sort(function (a, b) {
    return a.distance - b.distance;
  });
  return list;
}

function showResults(places, type) {
  var cat = categories[type];
  document.getElementById("sidebar-title").textContent = "Nearby " + cat.label;
  document.getElementById("filter-row").style.display = "flex";
  document.getElementById("filter-input").value = "";
  renderCards(places, type);
  renderMarkers(places, type);
  document.getElementById("results-count").textContent =
    places.length + " place" + (places.length !== 1 ? "s" : "");
}

function applyFilter() {
  var text = document.getElementById("filter-input").value.toLowerCase();
  var sort = document.getElementById("sort-select").value;
  var filtered = results.filter(function (p) {
    return !text || p.name.toLowerCase().includes(text);
  });
  filtered.sort(function (a, b) {
    if (sort === "rating") return b.rating - a.rating;
    if (sort === "name") return a.name.localeCompare(b.name);
    return a.distance - b.distance;
  });
  renderCards(filtered, activeType);
  renderMarkers(filtered, activeType);
  document.getElementById("results-count").textContent =
    filtered.length + " place" + (filtered.length !== 1 ? "s" : "");
}

function renderCards(places, type) {
  var list = document.getElementById("results-list");
  list.innerHTML = "";
  if (!places.length) {
    list.innerHTML =
      '<div class="empty-state"><i class="fa-solid fa-face-frown-open"></i><h3>Nothing Found</h3><p>No places found nearby.</p></div>';
    return;
  }
  var cat = categories[type];
  places.forEach(function (place) {
    var card = document.createElement("div");
    card.className = "place-card";
    card.setAttribute("data-id", place.id);
    card.innerHTML =
      '<div class="card-header">' +
      '<div class="card-cat-badge" style="background:' +
      cat.color +
      "22;color:" +
      cat.color +
      '"><i class="fa-solid ' +
      cat.icon +
      '"></i></div>' +
      '<div class="card-main">' +
      '<div class="card-name">' +
      place.name +
      "</div>" +
      '<div class="card-type">' +
      cat.label +
      "</div>" +
      "</div>" +
      '<div class="card-distance-badge">' +
      fmtDist(place.distance) +
      "</div>" +
      "</div>" +
      '<div class="card-stars">' +
      starsHtml(place.rating) +
      '<span class="rating-val">' +
      place.rating.toFixed(1) +
      "</span></div>" +
      '<div class="card-address"><i class="fa-solid fa-location-dot"></i> <span>' +
      (place.address || "Address not available") +
      "</span></div>" +
      '<div class="card-actions">' +
      '<button class="card-action-btn primary" onclick="openModal(' +
      place.id +
      ')"><i class="fa-solid fa-eye"></i> View</button>' +
      '<button class="card-action-btn secondary" onclick="getDirections(' +
      place.lat +
      "," +
      place.lng +
      ')"><i class="fa-solid fa-diamond-turn-right"></i> Directions</button>' +
      "</div>";
    card.addEventListener("click", function (e) {
      if (!e.target.closest(".card-action-btn")) {
        flyTo(place);
        highlightCard(card);
      }
    });
    list.appendChild(card);
  });
}

function highlightCard(card) {
  if (activeCard) activeCard.classList.remove("active");
  activeCard = card;
  card.classList.add("active");
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderMarkers(places, type) {
  markers.clearLayers();
  if (!places.length) return;
  var cat = categories[type];
  var bounds = L.latLngBounds();
  places.forEach(function (place) {
    var icon = L.divIcon({
      className: "",
      html:
        '<div class="custom-marker" style="background:' +
        cat.color +
        '"><i class="fa-solid ' +
        cat.icon +
        '"></i></div>',
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -38],
    });
    var m = L.marker([place.lat, place.lng], { icon: icon });
    m.bindPopup(
      '<div class="map-popup"><div class="map-popup-name">' +
        place.name +
        '</div><div class="map-popup-type">' +
        cat.label +
        '</div><div class="map-popup-dist">' +
        fmtDist(place.distance) +
        '</div><button class="map-popup-btn" onclick="openModal(' +
        place.id +
        ')"><i class="fa-solid fa-circle-info"></i> Details</button></div>',
    );
    m._pid = place.id;
    m.on("click", function () {
      var card = document.querySelector('[data-id="' + place.id + '"]');
      if (card) highlightCard(card);
    });
    markers.addLayer(m);
    bounds.extend([place.lat, place.lng]);
  });
  if (userMarker) bounds.extend(userMarker.getLatLng());
  if (bounds.isValid())
    setTimeout(function () {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }, 300);
}

function flyTo(place) {
  map.flyTo([place.lat, place.lng], 17, { duration: 1 });
  markers.eachLayer(function (m) {
    if (m._pid === place.id)
      setTimeout(function () {
        m.openPopup();
      }, 1100);
  });
}

function openModal(id) {
  var place = results.find(function (p) {
    return p.id === id;
  });
  if (!place) return;
  var cat = categories[place.type];
  document.getElementById("modal-content").innerHTML =
    '<div class="modal-place-icon" style="background:' +
    cat.color +
    "22;color:" +
    cat.color +
    '"><i class="fa-solid ' +
    cat.icon +
    '"></i></div>' +
    '<div class="modal-place-name">' +
    place.name +
    "</div>" +
    '<div class="modal-place-type">' +
    cat.label +
    "</div>" +
    '<div class="modal-stars-row">' +
    starsHtml(place.rating) +
    '<span class="modal-rating-text">' +
    place.rating.toFixed(1) +
    " / 5.0</span></div>" +
    '<div class="modal-info">' +
    '<div class="modal-info-row"><i class="fa-solid fa-route"></i><span>' +
    fmtDist(place.distance) +
    " away</span></div>" +
    (place.address
      ? '<div class="modal-info-row"><i class="fa-solid fa-location-dot"></i><span>' +
        place.address +
        "</span></div>"
      : "") +
    (place.phone
      ? '<div class="modal-info-row"><i class="fa-solid fa-phone"></i><a href="tel:' +
        place.phone +
        '" style="color:#6366f1">' +
        place.phone +
        "</a></div>"
      : "") +
    (place.website
      ? '<div class="modal-info-row"><i class="fa-solid fa-globe"></i><a href="' +
        place.website +
        '" target="_blank" style="color:#6366f1">Visit Website</a></div>'
      : "") +
    (place.hours
      ? '<div class="modal-info-row"><i class="fa-solid fa-clock"></i><span>' +
        place.hours +
        "</span></div>"
      : "") +
    "</div>" +
    '<div class="modal-action-row">' +
    '<button class="modal-action-btn primary" onclick="closeModal();flyTo({lat:' +
    place.lat +
    ",lng:" +
    place.lng +
    ",id:" +
    place.id +
    '})"><i class="fa-solid fa-location-dot"></i> Show on Map</button>' +
    '<button class="modal-action-btn secondary" onclick="getDirections(' +
    place.lat +
    "," +
    place.lng +
    ')"><i class="fa-solid fa-diamond-turn-right"></i> Directions</button>' +
    "</div>";
  document.getElementById("place-modal").style.display = "flex";
}

function closeModal() {
  document.getElementById("place-modal").style.display = "none";
}

window.openModal = openModal;
window.closeModal = closeModal;
window.flyTo = flyTo;
window.getDirections = getDirections;

function resetSidebar() {
  results = [];
  markers.clearLayers();
  document.getElementById("results-count").textContent = "";
  document.getElementById("sidebar-title").textContent = "Nearby Places";
  document.getElementById("filter-row").style.display = "none";
  document.getElementById("results-list").innerHTML =
    '<div class="empty-state"><i class="fa-solid fa-map-location-dot"></i><h3>Start Exploring</h3><p>Select a category or search for a location.</p></div>';
}

function showToast(msg, type) {
  clearTimeout(toastTimer);
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + (type || "") + " visible";
  toastTimer = setTimeout(function () {
    t.classList.remove("visible");
  }, 3000);
}

function getDirections(la, lo) {
  window.open(
    "https://www.openstreetmap.org/directions?engine=fossil_osrm_car&route=" +
      currentLat +
      "," +
      currentLng +
      ";" +
      la +
      "," +
      lo,
    "_blank",
  );
}

function calcDist(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var dLat = ((lat2 - lat1) * Math.PI) / 180;
  var dLon = ((lon2 - lon1) * Math.PI) / 180;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m) {
  return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1) + " km";
}

function starsHtml(rating) {
  var full = Math.floor(rating),
    half = rating % 1 >= 0.5 ? 1 : 0,
    empty = 5 - full - half;
  var h = '<div class="stars">';
  for (var i = 0; i < full; i++) h += '<i class="fa-solid fa-star filled"></i>';
  if (half) h += '<i class="fa-solid fa-star-half-stroke filled"></i>';
  for (var j = 0; j < empty; j++) h += '<i class="fa-regular fa-star"></i>';
  return h + "</div>";
}

function setThemeJS(t) {
  document.documentElement.setAttribute("data-theme", t);
  document.getElementById("theme-icon").className =
    "fa-solid fa-" + (t === "dark" ? "moon" : "sun");
  localStorage.setItem("theme", t);
  var el = document.getElementById("dynamic-theme");
  if (!el) {
    el = document.createElement("style");
    el.id = "dynamic-theme";
    document.head.appendChild(el);
  }
  el.innerHTML =
    t === "dark"
      ? "body{background:#111827;color:#f9fafb} .header,.category-bar,.sidebar,.place-card,.footer,.place-modal,.autocomplete-dropdown{background:#1f2937;border-color:#374151;color:#f9fafb} .search-bar,.filter-input,.sort-select{background:#111827;border-color:#374151;color:white} .icon-btn,.cat-btn{background:#374151;border-color:#4b5563;color:white} .icon-btn:hover,.cat-btn:hover,.place-card:hover{background:#4b5563;border-color:#4b5563} .search-input{color:white} .search-input::placeholder{color:#9ca3af}"
      : "";
}
