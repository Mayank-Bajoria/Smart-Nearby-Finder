/* ====================================================
   Smart Nearby Finder – Main JavaScript
   Uses Leaflet.js for the map and Nominatim API
   (OpenStreetMap) to search for nearby places.
   ==================================================== */

// Default map center: New Delhi, India (lat/lng)
var lat = 28.6139,
    lng = 77.209;

// Search radius in meters around the user's location
var radius = 1500;

// Leaflet map instance, user location marker, and marker group
var map, userMarker, markers;

// Current coordinates the app is searching around
var currentLat = lat,
    currentLng = lng;

// Tracks which category button is currently active (hospital, bank etc.)
var activeType = null;

// Stores the full list of fetched place results for filtering/sorting
var results = [];

// Prevents multiple simultaneous API fetches
var loading = false;

// Timer reference for the toast notification auto-hide
var toastTimer;

// Reference to the currently highlighted sidebar card
var activeCard = null;

/*
 * Category configuration object.
 * Each key maps to a category button's data-type attribute.
 * - label : Human-readable name shown in the UI
 * - icon  : Font Awesome icon class for cards and map markers
 * - color : Hex color used for badges and marker pins
 * - tag   : OSM tag used for filtering (kept for reference)
 */
var categories = {
    hospital: {
        label: "Hospitals",
        icon: "fa-hospital",
        color: "#ef4444",
    },
    bank: {
        label: "Banks",
        icon: "fa-building-columns",
        color: "#3b82f6",
    },
    hotel: {
        label: "Hotels",
        icon: "fa-hotel",
        color: "#a855f7",
    },
    pharmacy: {
        label: "Pharmacies",
        icon: "fa-pills",
        color: "#10b981",
    },
    school: {
        label: "Schools",
        icon: "fa-school",
        color: "#f59e0b",
    },
};

/* ── App Initialization ───────────────────────────────── */

/*
 * initMapApp()
 * Entry point for the entire application.
 * Creates the Leaflet map, loads the saved theme,
 * requests the user's GPS location, hides the loader,
 * and wires up all UI event listeners.
 */
function initMapApp() {
    console.log("Initializing Smart Nearby Finder...");

    // Create the Leaflet map centered on New Delhi and attach the OSM tile layer
    try {
        map = L.map("map", { center: [currentLat, currentLng], zoom: 14 });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 19,
        }).addTo(map);
        // Layer group to hold all place markers so we can clear them at once
        markers = L.layerGroup().addTo(map);
    } catch(e) {
        console.error("Map init failed:", e);
    }

    // Read persisted theme preference from localStorage (wrapped in try/catch
    // because some browsers block localStorage when loaded via file://)
    var saved = "light";
    try {
        saved = localStorage.getItem("theme") || "light";
    } catch(e) { console.warn("Local storage blocked", e); }
    
    try {
        setThemeJS(saved); // Apply the theme to the document
    } catch(e) { console.error("Theme init failed:", e); }

    // Ask the browser for the user's GPS coordinates (silently ignore if denied)
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                // Center the map and drop a "You are here" marker
                setLocation(pos.coords.latitude, pos.coords.longitude, false);
            },
            function () { /* User denied – stay on default location */ },
        );
    }

    // Hide the full-screen loading overlay after 1 second
    setTimeout(function () {
        var loader = document.getElementById("page-loader");
        if(loader) loader.classList.add("hidden");
    }, 1000);

    // Attach click/input listeners to all interactive elements
    setupEvents();
}

/*
 * Run initMapApp as soon as the HTML DOM is ready.
 * If the DOM is already parsed (e.g. script is deferred), call directly.
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMapApp);
} else {
    initMapApp();
}

/* ── Event Setup ──────────────────────────────────────── */

/*
 * setupEvents()
 * Wires all UI elements to their handler functions.
 * Called once during initMapApp().
 */
function setupEvents() {

    // Toggle between dark and light mode when the theme button is clicked
    document
        .getElementById("theme-toggle")
        .addEventListener("click", function () {
            setThemeJS(
                document.documentElement.getAttribute("data-theme") === "dark"
                    ? "light"
                    : "dark",
            );
        });

    // Category buttons (Hospitals, Banks, etc.)
    document.querySelectorAll(".cat-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            var type = btn.getAttribute("data-type");

            // If the same category is clicked again, deselect it and reset sidebar
            if (activeType === type) {
                activeType = null;
                btn.classList.remove("active");
                resetSidebar();
                return;
            }

            // Remove 'active' highlight from all other category buttons
            document.querySelectorAll(".cat-btn").forEach(function (b) {
                b.classList.remove("active");
            });

            // Mark this button as active and trigger the place search
            btn.classList.add("active");
            activeType = type;
            fetchPlaces(type);
        });
    });

    // Search bar – trigger on button click or pressing Enter key
    document
        .getElementById("search-btn")
        .addEventListener("click", searchLocation);
    document
        .getElementById("location-search")
        .addEventListener("keydown", function (e) {
            if (e.key === "Enter") searchLocation();
        });

    // "My Location" button – get GPS coordinates and re-center the map
    document.getElementById("locate-btn").addEventListener("click", function () {
        if (!navigator.geolocation) {
            showToast("Geolocation not supported", "error");
            return;
        }
        var btn = document.getElementById("locate-btn");
        btn.style.opacity = "0.6"; // Dim the button to indicate loading
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                btn.style.opacity = "1";
                setLocation(pos.coords.latitude, pos.coords.longitude, true);
                // If a category is already selected, refresh results for new location
                if (activeType) fetchPlaces(activeType);
            },
            function () {
                btn.style.opacity = "1";
                showToast("Could not get location", "error");
            },
        );
    });

    // Filter by name input – debounced 300ms to avoid querying on every keypress
    var filterTimer;
    document
        .getElementById("filter-input")
        .addEventListener("input", function () {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(applyFilter, 300);
        });

    // Sort dropdown – re-apply filter immediately when selection changes
    document
        .getElementById("sort-select")
        .addEventListener("change", applyFilter);

    // Close the details modal via the X button, backdrop click, or Escape key
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document
        .getElementById("modal-backdrop")
        .addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeModal();
    });
}

/* ── Location Helpers ─────────────────────────────────── */

/*
 * setLocation(la, ln, pan)
 * Updates the global currentLat/currentLng and places
 * a "You are here" marker on the map.
 * If pan=true, smoothly flies the map view to that location.
 */
function setLocation(la, ln, pan) {
    currentLat = la;
    currentLng = ln;

    // Remove any previous user marker before placing a new one
    if (userMarker) map.removeLayer(userMarker);

    // Create a custom circular pulsing marker div for the user's position
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

    // Smoothly animate the map to the new location if requested
    if (pan) {
        map.flyTo([la, ln], 14, { duration: 1.2 });
        showToast("Location found!", "success");
    }
}

/*
 * searchLocation()
 * Reads the text from the search input and calls the
 * Nominatim geocoding API to find the city/area.
 * On success, moves the map and re-fetches places if
 * a category is already selected.
 */
async function searchLocation() {
    var q = document.getElementById("location-search").value.trim();
    if (!q) return; // Do nothing if the search box is empty

    showToast("Searching...", "info");
    try {
        // Nominatim geocoding: convert a place name → lat/lng
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

        // Fly the map view smoothly to the found location
        map.flyTo([currentLat, currentLng], 14, { duration: 1.5 });
        showToast("Found: " + data[0].display_name.split(",")[0], "success");

        // Wait for the fly animation to finish before re-fetching nearby places
        if (activeType)
            setTimeout(function () {
                fetchPlaces(activeType);
            }, 1600);
    } catch (e) {
        showToast("Search failed", "error");
    }
}

/* ── API Fetching ─────────────────────────────────────── */

/*
 * fetchPlaces(type)
 * The main data-fetching function. Called whenever the user
 * clicks a category button. Queries the Nominatim search API
 * using the current visible map bounds as a bounding box so
 * results are always relevant to what's on screen.
 */
async function fetchPlaces(type) {
    if (loading) return; // Prevent overlapping requests
    var cat = categories[type];
    loading = true;

    // Show loading state: update sidebar title and show overlay spinner
    document.getElementById("sidebar-title").textContent =
        "Loading " + cat.label + "...";
    document.getElementById("results-count").textContent = "";
    document.getElementById("filter-row").style.display = "none";
    document.getElementById("map-loading").style.display = "flex";
    document.getElementById("results-list").innerHTML = "";

    try {
        // Get the visible map boundary (west, north, east, south) from Leaflet
        // and send it as a viewbox to restrict results to the current map view.
        var bounds = map.getBounds();
        var viewbox = bounds.getWest() + "," + bounds.getNorth() + "," + bounds.getEast() + "," + bounds.getSouth();
        var query = encodeURIComponent(cat.label); // e.g. "Hospitals", "Banks"
        
        // bounded=1 ensures results are STRICTLY within the viewbox
        var apiUrl = "https://nominatim.openstreetmap.org/search?format=json&q=" + query + "&viewbox=" + viewbox + "&bounded=1&limit=25";
        
        var res = await fetch(apiUrl);
        if (!res.ok) throw new Error("API responded with error");
        var data = await res.json();
        
        loading = false;
        document.getElementById("map-loading").style.display = "none";
        
        // Parse the raw API response into our internal place objects
        results = buildResults(data || [], type);
        showResults(results, type);
    } catch (e) {
        console.error("API Error:", e);
        loading = false;
        document.getElementById("map-loading").style.display = "none";
        showToast("Server busy. Please try again.", "error");
    }
}

/*
 * buildResults(elements, type)
 * Converts the raw Nominatim JSON array into our internal
 * place object format that the rest of the app uses.
 * Also calculates the straight-line distance from the user
 * and generates a deterministic rating from the place ID.
 */
function buildResults(elements, type) {
    var list = [];
    elements.forEach(function (el) {
        var la = parseFloat(el.lat);
        var lo = parseFloat(el.lon);
        if (!la || !lo) return; // Skip entries without valid coordinates
        
        // Nominatim returns the full address as a comma-separated display_name.
        // We take the first part as the name, and parts 2–3 as a short address.
        var nameParts = el.display_name.split(",");
        var name = nameParts[0].trim();
        var addr = nameParts.slice(1, 3).join(", ").trim();
        
        // Calculate distance from user's current location in metres
        var dist = calcDist(currentLat, currentLng, la, lo);

        // Generate a pseudo-rating (3.0–5.0) using the OSM place_id as a seed
        // Since Nominatim doesn't provide ratings, this keeps it consistent
        var seed = parseInt(el.place_id || "123", 10) % 20;
        var rating = Math.round((3 + seed * 0.1) * 10) / 10;
        
        list.push({
            id: el.place_id || Math.floor(Math.random() * 1000000),
            name: name,
            type: type,
            lat: la,
            lng: lo,
            address: addr || "Address not available",
            distance: dist,
            rating: rating,
            phone: null,    // Nominatim doesn't provide phone numbers
            website: null,  // Nominatim doesn't provide websites
            hours: null,    // Nominatim doesn't provide opening hours
        });
    });

    // Default sort: nearest first
    list.sort(function (a, b) {
        return a.distance - b.distance;
    });
    return list;
}

/* ── Results Display ──────────────────────────────────── */

/*
 * showResults(places, type)
 * After a successful API fetch, updates the sidebar header,
 * reveals the filter/sort controls, and calls the card and
 * marker renderers to populate the UI.
 */
function showResults(places, type) {
    var cat = categories[type];
    document.getElementById("sidebar-title").textContent = "Nearby " + cat.label;
    document.getElementById("filter-row").style.display = "flex";
    document.getElementById("filter-input").value = ""; // Clear any previous filter text
    renderCards(places, type);     // Draw result cards in sidebar
    renderMarkers(places, type);   // Drop pins on the map
    document.getElementById("results-count").textContent =
        places.length + " place" + (places.length !== 1 ? "s" : "");
}

/*
 * applyFilter()
 * Runs whenever the user types in the filter box or changes
 * the sort dropdown. Filters the global results array by name
 * and re-sorts, then re-renders both cards and map markers.
 */
function applyFilter() {
    var text = document.getElementById("filter-input").value.toLowerCase();
    var sort = document.getElementById("sort-select").value;

    // Keep only places whose name contains the filter text
    var filtered = results.filter(function (p) {
        return !text || p.name.toLowerCase().includes(text);
    });

    // Sort by the selected criterion (rating, name, or distance)
    filtered.sort(function (a, b) {
        if (sort === "rating") return b.rating - a.rating; // Highest rating first
        if (sort === "name")   return a.name.localeCompare(b.name); // A → Z
        return a.distance - b.distance; // Nearest first (default)
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

/*
 * highlightCard(card)
 * Removes the active highlight from the previous sidebar card
 * and applies it to the newly selected one, then scrolls it
 * into view smoothly.
 */
function highlightCard(card) {
    if (activeCard) activeCard.classList.remove("active");
    activeCard = card;
    card.classList.add("active");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ── Map Markers ──────────────────────────────────────── */

/*
 * renderMarkers(places, type)
 * Clears existing place pins and adds a new colored custom
 * marker for every place in the list. Also auto-fits the map
 * view so all markers (and the user's position) are visible.
 */
function renderMarkers(places, type) {
    markers.clearLayers(); // Remove all previous marker pins
    if (!places.length) return;
    var cat = categories[type];
    var bounds = L.latLngBounds(); // Collect all positions to auto-zoom

    places.forEach(function (place) {
        // Build a colored circular div icon using the category's color & icon
        var icon = L.divIcon({
            className: "",
            html:
                '<div class="custom-marker" style="background:' +
                cat.color +
                '"><i class="fa-solid ' +
                cat.icon +
                '"></i></div>',
            iconSize: [36, 36],
            iconAnchor: [18, 36],   // Anchor at bottom-center of the pin
            popupAnchor: [0, -38],  // Popup appears above the pin
        });

        var m = L.marker([place.lat, place.lng], { icon: icon });

        // Attach a popup with the place name, type, distance and a Details button
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

        // Store the place ID on the marker so we can link it to a sidebar card
        m._pid = place.id;

        // Clicking the marker also highlights the matching sidebar card
        m.on("click", function () {
            var card = document.querySelector('[data-id="' + place.id + '"]');
            if (card) highlightCard(card);
        });
        markers.addLayer(m);
        bounds.extend([place.lat, place.lng]); // Expand bounds to include this pin
    });

    // Include the user marker in the bounding box so it's not cut off
    if (userMarker) bounds.extend(userMarker.getLatLng());

    // Auto-zoom the map to show all results; slight delay for a smooth transition
    if (bounds.isValid())
        setTimeout(function () {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        }, 300);
}

/*
 * flyTo(place)
 * Smoothly animates the map to zoom into a specific place
 * and then opens its popup after the animation finishes.
 */
function flyTo(place) {
    map.flyTo([place.lat, place.lng], 17, { duration: 1 });
    markers.eachLayer(function (m) {
        if (m._pid === place.id)
            // Delay popup to match flyTo animation duration (~1s)
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

/* Dismiss the details modal */
function closeModal() {
    document.getElementById("place-modal").style.display = "none";
}

/*
 * Expose these functions on the global window object so they
 * can be called via inline onclick attributes inside dynamically
 * generated HTML strings (cards and map popups).
 */
window.openModal = openModal;
window.closeModal = closeModal;
window.flyTo = flyTo;
window.getDirections = getDirections;

/* ── Sidebar Reset ────────────────────────────────────── */

/*
 * resetSidebar()
 * Clears all results, removes map markers, and restores
 * the sidebar to its initial "Start Exploring" empty state.
 * Called when the user deselects a category.
 */
function resetSidebar() {
    results = [];
    markers.clearLayers();
    document.getElementById("results-count").textContent = "";
    document.getElementById("sidebar-title").textContent = "Nearby Places";
    document.getElementById("filter-row").style.display = "none";
    document.getElementById("results-list").innerHTML =
        '<div class="empty-state"><i class="fa-solid fa-map-location-dot"></i><h3>Start Exploring</h3><p>Select a category or search for a location.</p></div>';
}

/* ── Utility Functions ────────────────────────────────── */

/*
 * showToast(msg, type)
 * Displays a brief notification bar at the bottom of the screen.
 * The type string ('success', 'error', 'info') sets its color via CSS.
 * Auto-hides after 3 seconds.
 */
function showToast(msg, type) {
    clearTimeout(toastTimer);
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast " + (type || "") + " visible";
    toastTimer = setTimeout(function () {
        t.classList.remove("visible");
    }, 3000);
}

/*
 * getDirections(la, lo)
 * Opens OpenStreetMap routing in a new browser tab,
 * requesting directions from the user's current location
 * to the target latitude/longitude.
 */
function getDirections(la, lo) {
    window.open(
        "https://www.openstreetmap.org/directions?engine=fossil_osrm_car&route=" +
        currentLat + "," + currentLng + ";" + la + "," + lo,
        "_blank",
    );
}

/*
 * calcDist(lat1, lon1, lat2, lon2)
 * Computes the straight-line distance (in metres) between
 * two GPS coordinates using the Haversine formula.
 * This accounts for the curvature of the Earth.
 */
function calcDist(lat1, lon1, lat2, lon2) {
    var R = 6371000; // Earth radius in metres
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

/*
 * fmtDist(m)
 * Formats a distance in metres to a human-readable string.
 * Shows metres below 1 km and kilometres (1 decimal) above.
 */
function fmtDist(m) {
    return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1) + " km";
}

/*
 * starsHtml(rating)
 * Generates a row of filled / half / empty star icons for
 * a given numeric rating (0–5). Returns an HTML string.
 */
function starsHtml(rating) {
    var full  = Math.floor(rating);
    var half  = rating % 1 >= 0.5 ? 1 : 0;
    var empty = 5 - full - half;
    var h = '<div class="stars">';
    for (var i = 0; i < full; i++)  h += '<i class="fa-solid fa-star filled"></i>';
    if (half)                        h += '<i class="fa-solid fa-star-half-stroke filled"></i>';
    for (var j = 0; j < empty; j++) h += '<i class="fa-regular fa-star"></i>';
    return h + "</div>";
}

/*
 * setThemeJS(t)
 * Switches the app between 'dark' and 'light' themes.
 * Updates the data-theme attribute on <html>, flips the
 * toggle button icon, persists the choice to localStorage,
 * and injects a <style> block of dark-mode CSS overrides.
 */
function setThemeJS(t) {
    document.documentElement.setAttribute("data-theme", t);
    // Flip the icon between moon (dark) and sun (light)
    document.getElementById("theme-icon").className =
        "fa-solid fa-" + (t === "dark" ? "moon" : "sun");
    localStorage.setItem("theme", t); // Persist for next visit

    // Find or create the dynamic <style> tag for dark mode overrides
    var el = document.getElementById("dynamic-theme");
    if (!el) {
        el = document.createElement("style");
        el.id = "dynamic-theme";
        document.head.appendChild(el);
    }
    // Inject dark-mode CSS when 'dark', clear it when 'light'
    el.innerHTML =
        t === "dark"
            ? "body{background:#111827;color:#f9fafb} .header,.category-bar,.sidebar,.place-card,.footer,.place-modal,.autocomplete-dropdown{background:#1f2937;border-color:#374151;color:#f9fafb} .search-bar,.filter-input,.sort-select{background:#111827;border-color:#374151;color:white} .icon-btn,.cat-btn{background:#374151;border-color:#4b5563;color:white} .icon-btn:hover,.cat-btn:hover,.place-card:hover{background:#4b5563;border-color:#4b5563} .search-input{color:white} .search-input::placeholder{color:#9ca3af}"
            : "";
}
