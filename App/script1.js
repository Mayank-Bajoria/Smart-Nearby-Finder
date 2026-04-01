/**
 * ======================================================
 *   SMART PLACE FINDER — MAIN SCRIPT
 *   Features: Overpass API, Nominatim Geocoding,
 *   Marker Clustering, Dark/Light Mode, Caching,
 *   Filtering & Sorting, Star Ratings, Geolocation
 * ======================================================
 */

'use strict';

// ───────────────────────────────────────────────────────
//  CONFIGURATION
// ───────────────────────────────────────────────────────
const CONFIG = {
    DEFAULT_LAT: 28.6139,      // New Delhi as default
    DEFAULT_LNG: 77.2090,
    DEFAULT_ZOOM: 14,
    SEARCH_RADIUS_M: 3000,     // 3 km radius
    MAX_RESULTS: 30,
    CACHE_TTL_MS: 5 * 60 * 1000,  // 5 minutes cache
    DEBOUNCE_MS: 400,
    NOMINATIM_DELAY_MS: 1000,  // respect rate limits

    // ── Overpass resilience ───────────────────────────────
    // Multiple public Overpass mirrors — tried in order on failure
    OVERPASS_MIRRORS: [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
        'https://overpass.openstreetmap.ru/api/interpreter',
    ],
    OVERPASS_TIMEOUT_MS: 18000,   // per-mirror request timeout (18 s)
    OVERPASS_MAX_RETRIES: 2,      // retries per mirror before moving on
    OVERPASS_BACKOFF_BASE_MS: 800, // base delay for exponential backoff
};

// Category configuration with colors, icons, Overpass tags
const CATEGORIES = {
    hospital:   { label: 'Hospitals',       icon: 'fa-hospital',           color: '#ef4444', tag: 'amenity="hospital"'          },
    restaurant: { label: 'Restaurants',     icon: 'fa-utensils',           color: '#f97316', tag: 'amenity="restaurant"'        },
    atm:        { label: 'ATMs',            icon: 'fa-money-bill-wave',    color: '#22c55e', tag: 'amenity="atm"'               },
    bank:       { label: 'Banks',           icon: 'fa-building-columns',   color: '#3b82f6', tag: 'amenity="bank"'              },
    hotel:      { label: 'Hotels',          icon: 'fa-hotel',              color: '#a855f7', tag: 'tourism="hotel"'             },
    toilets:    { label: 'Public Toilets',  icon: 'fa-restroom',           color: '#06b6d4', tag: 'amenity="toilets"'           },
    pharmacy:   { label: 'Pharmacies',      icon: 'fa-pills',              color: '#10b981', tag: 'amenity="pharmacy"'          },
    school:     { label: 'Schools',         icon: 'fa-school',             color: '#f59e0b', tag: 'amenity="school"'            },
};

// ───────────────────────────────────────────────────────
//  STATE
// ───────────────────────────────────────────────────────
const STATE = {
    map: null,
    clusterGroup: null,
    userMarker: null,
    currentPos: { lat: CONFIG.DEFAULT_LAT, lng: CONFIG.DEFAULT_LNG },
    activeCategory: null,
    activeCardEl: null,
    activeMarker: null,
    allResults: [],         // current full result set (unfiltered)
    filteredResults: [],    // after client-side filter
    isLoading: false,
    lastNominatimCall: 0,
    cache: new Map(),       // simple in-memory cache
    sortBy: 'distance',
    filterText: '',
    autocompleteAbort: null,
};

// ───────────────────────────────────────────────────────
//  DOM REFS
// ───────────────────────────────────────────────────────
const DOM = {};

document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM refs
    DOM.pageLoader       = document.getElementById('page-loader');
    DOM.locationSearch   = document.getElementById('location-search');
    DOM.searchBtn        = document.getElementById('search-btn');
    DOM.autocomplete     = document.getElementById('autocomplete-dropdown');
    DOM.locateBtn        = document.getElementById('locate-btn');
    DOM.themeToggle      = document.getElementById('theme-toggle');
    DOM.themeIcon        = document.getElementById('theme-icon');
    DOM.catBtns          = document.querySelectorAll('.cat-btn');
    DOM.sidebarTitle     = document.getElementById('sidebar-title');
    DOM.resultsCount     = document.getElementById('results-count');
    DOM.resultsList      = document.getElementById('results-list');
    DOM.filterRow        = document.getElementById('filter-row');
    DOM.filterInput      = document.getElementById('filter-input');
    DOM.clearFilterBtn   = document.getElementById('clear-filter');
    DOM.sortSelect       = document.getElementById('sort-select');
    DOM.emptyState       = document.getElementById('empty-state');
    DOM.mapStats         = document.getElementById('map-stats');
    DOM.statCatLabel     = document.getElementById('stat-cat-label');
    DOM.statCountVal     = document.getElementById('stat-count-val');
    DOM.mapLoading       = document.getElementById('map-loading');
    DOM.toast            = document.getElementById('toast');
    DOM.placeModal       = document.getElementById('place-modal');
    DOM.modalContent     = document.getElementById('modal-content');
    DOM.modalClose       = document.getElementById('modal-close');
    DOM.modalBackdrop    = document.getElementById('modal-backdrop');

    boot();
});

// ───────────────────────────────────────────────────────
//  BOOT
// ───────────────────────────────────────────────────────
function boot() {
    loadTheme();
    initMap();
    bindEvents();

    // Hide page loader after map initialises
    setTimeout(() => {
        DOM.pageLoader.classList.add('hidden');
    }, 900);

    // Try auto-locate silently
    tryAutoLocate();
}

// ───────────────────────────────────────────────────────
//  THEME
// ───────────────────────────────────────────────────────
function loadTheme() {
    const saved = localStorage.getItem('spf-theme') || 'dark';
    applyTheme(saved, false);
}

function applyTheme(theme, save = true) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = DOM.themeIcon;
    if (theme === 'dark') {
        icon.className = 'fa-solid fa-moon';
        DOM.themeToggle.title = 'Switch to Light Mode';
    } else {
        icon.className = 'fa-solid fa-sun';
        DOM.themeToggle.title = 'Switch to Dark Mode';
    }
    if (save) localStorage.setItem('spf-theme', theme);

    // Update Leaflet tile layer if map exists
    if (STATE.map && theme !== document.documentElement.getAttribute('data-theme-prev')) {
        updateTileLayer(theme);
    }
    document.documentElement.setAttribute('data-theme-prev', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ───────────────────────────────────────────────────────
//  MAP INITIALISATION
// ───────────────────────────────────────────────────────
function initMap() {
    const { lat, lng } = STATE.currentPos;

    STATE.map = L.map('map', {
        center: [lat, lng],
        zoom: CONFIG.DEFAULT_ZOOM,
        zoomControl: true,
        attributionControl: true,
    });

    // Add tile layer based on theme
    const theme = document.documentElement.getAttribute('data-theme');
    addTileLayer(theme);

    // Marker cluster group
    STATE.clusterGroup = L.markerClusterGroup({
        chunkedLoading: true,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        maxClusterRadius: 60,
    });
    STATE.map.addLayer(STATE.clusterGroup);
}

let currentTileLayer = null;
function addTileLayer(theme) {
    // Use a slightly styled tile for dark mode
    const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const attr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    currentTileLayer = L.tileLayer(tileUrl, {
        attribution: attr,
        maxZoom: 19,
    });
    currentTileLayer.addTo(STATE.map);
}

function updateTileLayer(theme) {
    if (currentTileLayer) {
        STATE.map.removeLayer(currentTileLayer);
    }
    addTileLayer(theme);
}

// ───────────────────────────────────────────────────────
//  EVENT BINDING
// ───────────────────────────────────────────────────────
function bindEvents() {
    // Theme toggle
    DOM.themeToggle.addEventListener('click', toggleTheme);

    // Category buttons
    DOM.catBtns.forEach(btn => {
        btn.addEventListener('click', () => handleCategoryClick(btn));
    });

    // Search bar
    DOM.searchBtn.addEventListener('click', handleLocationSearch);
    DOM.locationSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLocationSearch();
        if (e.key === 'ArrowDown') navigateAutocomplete(1);
        if (e.key === 'ArrowUp') navigateAutocomplete(-1);
        if (e.key === 'Escape') hideAutocomplete();
    });
    DOM.locationSearch.addEventListener('input', debounce(handleAutocompleteInput, CONFIG.DEBOUNCE_MS));
    DOM.locationSearch.addEventListener('blur', () => setTimeout(hideAutocomplete, 200));

    // Locate button
    DOM.locateBtn.addEventListener('click', locateUser);

    // Filter input
    DOM.filterInput.addEventListener('input', debounce(() => {
        STATE.filterText = DOM.filterInput.value.trim().toLowerCase();
        DOM.clearFilterBtn.style.display = STATE.filterText ? 'flex' : 'none';
        applyFilterAndSort();
    }, 250));

    DOM.clearFilterBtn.addEventListener('click', () => {
        DOM.filterInput.value = '';
        STATE.filterText = '';
        DOM.clearFilterBtn.style.display = 'none';
        applyFilterAndSort();
    });

    // Sort
    DOM.sortSelect.addEventListener('change', () => {
        STATE.sortBy = DOM.sortSelect.value;
        applyFilterAndSort();
    });

    // Modal close
    DOM.modalClose.addEventListener('click', closeModal);
    DOM.modalBackdrop.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

// ───────────────────────────────────────────────────────
//  CATEGORY CLICK
// ───────────────────────────────────────────────────────
function handleCategoryClick(btn) {
    const type = btn.getAttribute('data-type');

    // Toggle off if clicked again
    if (STATE.activeCategory === type) {
        STATE.activeCategory = null;
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
        clearResults();
        return;
    }

    // Update button states
    DOM.catBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    STATE.activeCategory = type;

    fetchNearbyPlaces(type);
}

// ───────────────────────────────────────────────────────
//  GEOLOCATION
// ───────────────────────────────────────────────────────
function tryAutoLocate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => updateUserPosition(pos.coords.latitude, pos.coords.longitude, false),
        () => {} // silent fail on auto-locate
    );
}

function locateUser() {
    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by your browser.', 'error');
        return;
    }
    DOM.locateBtn.classList.add('loading');
    DOM.locateBtn.querySelector('i').className = 'fa-solid fa-circle-notch';

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            resetLocateBtn();
            updateUserPosition(pos.coords.latitude, pos.coords.longitude, true);
            // Re-fetch if category active
            if (STATE.activeCategory) fetchNearbyPlaces(STATE.activeCategory);
        },
        (err) => {
            resetLocateBtn();
            const msgs = {
                1: 'Location access denied. Please enable permissions.',
                2: 'Location unavailable.',
                3: 'Location request timed out.',
            };
            showToast(msgs[err.code] || 'Could not get location.', 'error');
        },
        { timeout: 10000, enableHighAccuracy: true }
    );
}

function resetLocateBtn() {
    DOM.locateBtn.classList.remove('loading');
    DOM.locateBtn.querySelector('i').className = 'fa-solid fa-crosshairs';
}

function updateUserPosition(lat, lng, panMap = true) {
    STATE.currentPos = { lat, lng };

    // Remove old user marker
    if (STATE.userMarker) STATE.map.removeLayer(STATE.userMarker);

    const userIcon = L.divIcon({
        className: '',
        html: '<div class="user-location-marker"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    });

    STATE.userMarker = L.marker([lat, lng], { icon: userIcon })
        .addTo(STATE.map)
        .bindPopup('<div class="map-popup"><div class="map-popup-name">📍 You are here</div></div>');

    if (panMap) {
        STATE.map.flyTo([lat, lng], CONFIG.DEFAULT_ZOOM, { duration: 1.2 });
        showToast('Location found!', 'success');
    }
}

// ───────────────────────────────────────────────────────
//  LOCATION SEARCH (Geocoding via Nominatim)
// ───────────────────────────────────────────────────────
async function handleLocationSearch() {
    const query = DOM.locationSearch.value.trim();
    if (!query) return;
    hideAutocomplete();

    // Throttle Nominatim calls
    const now = Date.now();
    if (now - STATE.lastNominatimCall < CONFIG.NOMINATIM_DELAY_MS) {
        showToast('Please wait a moment before searching again.', 'info');
        return;
    }
    STATE.lastNominatimCall = now;

    showToast('Searching for location...', 'info');

    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        if (!res.ok) throw new Error('Geocoding failed');
        const data = await res.json();

        if (!data || data.length === 0) {
            showToast('Location not found. Try a different name.', 'error');
            return;
        }

        const place = data[0];
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lon);
        STATE.currentPos = { lat, lng };

        STATE.map.flyTo([lat, lng], CONFIG.DEFAULT_ZOOM, { duration: 1.5 });
        showToast(`Found: ${place.display_name.split(',').slice(0, 2).join(',')}`, 'success');

        // Refresh results if category active
        if (STATE.activeCategory) {
            setTimeout(() => fetchNearbyPlaces(STATE.activeCategory), 1600);
        }
    } catch (err) {
        console.error('Geocoding error:', err);
        showToast('Geocoding failed. Check your connection.', 'error');
    }
}

// ───────────────────────────────────────────────────────
//  AUTOCOMPLETE (Nominatim)
// ───────────────────────────────────────────────────────
async function handleAutocompleteInput() {
    const query = DOM.locationSearch.value.trim();
    if (query.length < 3) { hideAutocomplete(); return; }

    // Cancel previous request
    if (STATE.autocompleteAbort) STATE.autocompleteAbort.abort();
    STATE.autocompleteAbort = new AbortController();

    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
        const res = await fetch(url, {
            signal: STATE.autocompleteAbort.signal,
            headers: { 'Accept-Language': 'en' },
        });
        if (!res.ok) return;
        const data = await res.json();
        renderAutocomplete(data);
    } catch (e) {
        if (e.name !== 'AbortError') console.warn('Autocomplete error:', e);
    }
}

function renderAutocomplete(results) {
    if (!results || results.length === 0) { hideAutocomplete(); return; }

    DOM.autocomplete.innerHTML = results.map((r, i) => {
        const name = r.display_name;
        const short = name.split(',').slice(0, 3).join(', ');
        return `<div class="autocomplete-item" data-lat="${r.lat}" data-lng="${r.lon}" data-name="${escapeHtml(name)}" tabindex="0">
            <i class="fa-solid fa-location-dot"></i>
            <span>${escapeHtml(short)}</span>
        </div>`;
    }).join('');

    DOM.autocomplete.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
            const lat = parseFloat(item.dataset.lat);
            const lng = parseFloat(item.dataset.lng);
            const name = item.dataset.name;
            DOM.locationSearch.value = name.split(',').slice(0, 2).join(',').trim();
            hideAutocomplete();
            STATE.currentPos = { lat, lng };
            STATE.lastNominatimCall = Date.now();
            STATE.map.flyTo([lat, lng], CONFIG.DEFAULT_ZOOM, { duration: 1.2 });
            showToast(`Moved to ${name.split(',')[0]}`, 'success');
            if (STATE.activeCategory) setTimeout(() => fetchNearbyPlaces(STATE.activeCategory), 1600);
        });
    });

    DOM.autocomplete.classList.add('visible');
}

function hideAutocomplete() {
    DOM.autocomplete.classList.remove('visible');
}

function navigateAutocomplete(dir) {
    const items = DOM.autocomplete.querySelectorAll('.autocomplete-item');
    if (!items.length) return;
    const current = DOM.autocomplete.querySelector('.highlighted');
    let idx = current ? Array.from(items).indexOf(current) + dir : (dir > 0 ? 0 : items.length - 1);
    idx = Math.max(0, Math.min(idx, items.length - 1));
    items.forEach(i => i.classList.remove('highlighted'));
    items[idx].classList.add('highlighted');
    DOM.locationSearch.value = items[idx].dataset.name.split(',').slice(0, 2).join(',').trim();
}

// ───────────────────────────────────────────────────────
//  FETCH NEARBY PLACES  (Overpass API — multi-mirror)
// ───────────────────────────────────────────────────────

/**
 * Fetch with an AbortController-based timeout.
 * Throws on network error, non-OK status, or timeout.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.OVERPASS_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) {
            // Surface the HTTP status so callers can decide whether to retry
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return res;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build the Overpass QL query string.
 */
function buildOverpassQuery(cat, lat, lng) {
    const r = CONFIG.SEARCH_RADIUS_M;
    // timeout directive is slightly less than our fetch timeout so the
    // server has time to reply with a graceful error instead of a silent drop.
    return (
        `[out:json][timeout:15];` +
        `(node[${cat.tag}](around:${r},${lat},${lng});` +
        `way[${cat.tag}](around:${r},${lat},${lng}););` +
        `out center ${CONFIG.MAX_RESULTS};`
    );
}

/**
 * Try one Overpass mirror with up to OVERPASS_MAX_RETRIES retries.
 * Returns parsed JSON on success, throws on all retries exhausted.
 */
async function tryMirror(mirrorUrl, encodedQuery, mirrorIndex) {
    const url = `${mirrorUrl}?data=${encodedQuery}`;
    let lastErr;

    for (let attempt = 0; attempt <= CONFIG.OVERPASS_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            // Exponential backoff: 800 ms, 1600 ms, …
            const delay = CONFIG.OVERPASS_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
            console.warn(`[Overpass] Mirror ${mirrorIndex + 1} retry ${attempt} in ${delay} ms …`);
            await sleep(delay);
        }

        try {
            const res = await fetchWithTimeout(url, {}, CONFIG.OVERPASS_TIMEOUT_MS);
            return await res.json();
        } catch (err) {
            lastErr = err;
            const isRetryable =
                err.name === 'AbortError' ||          // timeout
                err.status === 429 ||                 // rate limited
                err.status === 502 ||                 // Bad Gateway
                err.status === 503 ||                 // Service Unavailable
                err.status === 504;                   // Gateway Timeout

            if (!isRetryable) throw err;              // e.g. 400 Bad Request — don't retry
            console.warn(`[Overpass] Mirror ${mirrorIndex + 1} attempt ${attempt + 1} failed:`, err.message);
        }
    }

    throw lastErr;
}

/**
 * Main fetch entry point.
 * Cycles through all OVERPASS_MIRRORS.  Falls back to Nominatim if every
 * mirror fails after its retries.
 */
async function fetchNearbyPlaces(type) {
    if (STATE.isLoading) return;
    const cat = CATEGORIES[type];
    if (!cat) return;

    // ── Cache check ──────────────────────────────────────
    const cacheKey = `${type}:${STATE.currentPos.lat.toFixed(3)}:${STATE.currentPos.lng.toFixed(3)}`;
    const cached = STATE.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CONFIG.CACHE_TTL_MS) {
        renderResults(cached.data, type);
        showToast('Loaded from cache ⚡', 'info');
        return;
    }

    STATE.isLoading = true;
    setLoading(true, cat);

    const { lat, lng } = STATE.currentPos;
    const encodedQuery = encodeURIComponent(buildOverpassQuery(cat, lat, lng));
    const mirrors = CONFIG.OVERPASS_MIRRORS;

    let data = null;
    let lastErr = null;

    // ── Try each mirror in sequence ───────────────────────
    for (let i = 0; i < mirrors.length; i++) {
        // Update the loading label so the user can see we're trying
        if (i > 0) {
            DOM.sidebarTitle.textContent =
                `Retrying… (server ${i + 1}/${mirrors.length})`;
            showToast(`Server ${i} busy — trying mirror ${i + 1}…`, 'info');
        }

        try {
            data = await tryMirror(mirrors[i], encodedQuery, i);
            console.info(`[Overpass] Success on mirror ${i + 1} (${mirrors[i]})`);
            break; // ✅ got data — stop trying mirrors
        } catch (err) {
            lastErr = err;
            console.warn(`[Overpass] Mirror ${i + 1} exhausted:`, err.message);
        }
    }

    // ── Handle result or total failure ───────────────────
    try {
        if (data) {
            const elements = data.elements || [];
            const processed = processOverpassResults(elements, type);

            STATE.cache.set(cacheKey, { data: processed, ts: Date.now() });
            renderResults(processed, type);

            if (processed.length === 0) {
                showToast(`No ${cat.label} found nearby. Try increasing the area.`, 'info');
            }
        } else {
            // All mirrors failed — fall back to Nominatim
            console.error('[Overpass] All mirrors failed:', lastErr);
            showToast('All map servers busy — using fallback data…', 'error');
            await fetchOverpassFallback(type, cat);
        }
    } catch (err) {
        console.error('[Overpass] Processing error:', err);
        showErrorState(`Could not load ${cat.label}. Please try again in a moment.`);
    } finally {
        STATE.isLoading = false;
        setLoading(false);
    }
}

/**
 * Process raw Overpass elements → enriched place objects
 */
function processOverpassResults(elements, type) {
    const { lat: userLat, lng: userLng } = STATE.currentPos;

    return elements
        .filter(el => {
            const lat = el.lat || el.center?.lat;
            const lon = el.lon || el.center?.lon;
            return lat && lon;
        })
        .map(el => {
            const lat = el.lat || el.center.lat;
            const lon = el.lon || el.center.lon;
            const tags = el.tags || {};
            const name = tags.name || tags['name:en'] || getCategoryDefault(type, tags);
            const distance = haversine(userLat, userLng, lat, lon);
            const rating = simulateRating(el.id);

            return {
                id: el.id,
                name,
                type,
                lat,
                lng: lon,
                tags,
                address: buildAddress(tags),
                distance,
                rating,
                phone: tags.phone || tags['contact:phone'] || null,
                website: tags.website || tags['contact:website'] || null,
                opening_hours: tags.opening_hours || null,
            };
        })
        .sort((a, b) => a.distance - b.distance);
}

function getCategoryDefault(type, tags) {
    if (tags.amenity) return capitalise(tags.amenity.replace(/_/g, ' '));
    if (tags.tourism) return capitalise(tags.tourism.replace(/_/g, ' '));
    return capitalise(type);
}

function buildAddress(tags) {
    const parts = [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:suburb'],
        tags['addr:city'] || tags['addr:town'],
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
}

/** Fallback: use Nominatim when Overpass is down */
async function fetchOverpassFallback(type, cat) {
    const { lat, lng } = STATE.currentPos;
    const searchQuery = type === 'toilets' ? 'public toilet' : type;
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&lat=${lat}&lon=${lng}&limit=15&bounded=1&viewbox=${lng-0.05},${lat+0.05},${lng+0.05},${lat-0.05}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.length) return;

        const processed = data.map((el, i) => ({
            id: el.place_id,
            name: el.name || el.display_name.split(',')[0],
            type,
            lat: parseFloat(el.lat),
            lng: parseFloat(el.lon),
            tags: {},
            address: el.display_name,
            distance: haversine(STATE.currentPos.lat, STATE.currentPos.lng, parseFloat(el.lat), parseFloat(el.lon)),
            rating: simulateRating(el.place_id),
            phone: null, website: null, opening_hours: null,
        }));

        renderResults(processed.sort((a, b) => a.distance - b.distance), type);
        showToast('Using fallback data source.', 'info');
    } catch (e) {
        console.warn('Fallback also failed:', e);
    }
}

// ───────────────────────────────────────────────────────
//  RENDER RESULTS
// ───────────────────────────────────────────────────────
function renderResults(results, type) {
    STATE.allResults = results;
    STATE.activeCategory = type;

    // Update sidebar header
    const cat = CATEGORIES[type];
    DOM.sidebarTitle.textContent = `Nearby ${cat.label}`;

    // Show filter row
    DOM.filterRow.style.display = 'flex';
    DOM.filterInput.value = '';
    STATE.filterText = '';
    DOM.clearFilterBtn.style.display = 'none';

    // Reset sort
    STATE.sortBy = DOM.sortSelect.value;

    applyFilterAndSort();

    // Update map overlay stats
    DOM.mapStats.style.display = 'flex';
    DOM.statCatLabel.textContent = cat.label;
}

function applyFilterAndSort() {
    const text = STATE.filterText.toLowerCase();
    let filtered = STATE.allResults;

    // Filter by name
    if (text) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(text));
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
        if (STATE.sortBy === 'distance') return a.distance - b.distance;
        if (STATE.sortBy === 'rating')   return b.rating - a.rating;
        if (STATE.sortBy === 'name')     return a.name.localeCompare(b.name);
        return 0;
    });

    STATE.filteredResults = filtered;
    renderCards(filtered);
    renderMarkers(filtered);

    // Count label
    DOM.resultsCount.textContent = `${filtered.length} place${filtered.length !== 1 ? 's' : ''}`;
    DOM.statCountVal.textContent = filtered.length;
}

function renderCards(results) {
    DOM.resultsList.innerHTML = '';

    if (results.length === 0) {
        const msg = STATE.filterText
            ? `No places match "<strong>${escapeHtml(STATE.filterText)}</strong>"`
            : `No ${CATEGORIES[STATE.activeCategory]?.label || 'places'} found in this area.`;

        DOM.resultsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-illustration"><i class="fa-solid fa-face-frown-open"></i></div>
                <h3>Nothing Found</h3>
                <p>${msg}</p>
            </div>`;
        return;
    }

    const cat = CATEGORIES[STATE.activeCategory];
    const fragment = document.createDocumentFragment();

    results.forEach((place, i) => {
        const card = createPlaceCard(place, cat, i);
        fragment.appendChild(card);
    });

    DOM.resultsList.appendChild(fragment);
}

function createPlaceCard(place, cat, index) {
    const card = document.createElement('div');
    card.className = 'place-card';
    card.setAttribute('role', 'listitem');
    card.setAttribute('data-id', place.id);
    card.style.animationDelay = `${Math.min(index * 0.04, 0.4)}s`;

    const starsHtml = buildStarsHtml(place.rating);
    const distText = formatDistance(place.distance);
    const address = place.address || 'Address not available';
    const catIcon = `<i class="fa-solid ${cat.icon}"></i>`;

    card.innerHTML = `
        <div class="card-header">
            <div class="card-cat-badge" style="--cat-color: ${cat.color}">${catIcon}</div>
            <div class="card-main">
                <div class="card-name" title="${escapeHtml(place.name)}">${escapeHtml(place.name)}</div>
                <div class="card-type">${cat.label}</div>
            </div>
            <div class="card-distance-badge">
                <i class="fa-solid fa-route" style="margin-right:3px;font-size:0.65rem;"></i>${distText}
            </div>
        </div>
        <div class="card-stars">
            ${starsHtml}
            <span class="rating-val">${place.rating.toFixed(1)}</span>
        </div>
        <div class="card-address">
            <i class="fa-solid fa-location-dot"></i>
            <span title="${escapeHtml(address)}">${escapeHtml(address)}</span>
        </div>
        <div class="card-actions">
            <button class="card-action-btn primary" data-action="view">
                <i class="fa-solid fa-eye"></i> View
            </button>
            <button class="card-action-btn secondary" data-action="directions">
                <i class="fa-solid fa-diamond-turn-right"></i> Directions
            </button>
        </div>
    `;

    // Click card → fly to marker
    card.addEventListener('click', (e) => {
        if (!e.target.closest('.card-action-btn')) {
            flyToMarker(place);
            highlightCard(card);
        }
    });

    // Action buttons
    card.querySelector('[data-action="view"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openPlaceModal(place, cat);
    });
    card.querySelector('[data-action="directions"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openDirections(place);
    });

    return card;
}

// ───────────────────────────────────────────────────────
//  MARKERS
// ───────────────────────────────────────────────────────
function renderMarkers(results) {
    STATE.clusterGroup.clearLayers();
    STATE.activeMarker = null;

    if (results.length === 0) return;

    const cat = CATEGORIES[STATE.activeCategory];
    const bounds = L.latLngBounds();

    results.forEach(place => {
        const marker = createCustomMarker(place, cat);
        STATE.clusterGroup.addLayer(marker);
        bounds.extend([place.lat, place.lng]);
    });

    // Include user position in bounds
    if (STATE.userMarker) bounds.extend(STATE.userMarker.getLatLng());

    // Fit map with padding
    if (bounds.isValid()) {
        setTimeout(() => {
            STATE.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        }, 300);
    }
}

function createCustomMarker(place, cat) {
    const markerHtml = `
        <div class="custom-marker" style="background: ${cat.color};">
            <i class="fa-solid ${cat.icon}"></i>
        </div>
    `;

    const icon = L.divIcon({
        className: '',
        html: markerHtml,
        iconSize: [38, 38],
        iconAnchor: [19, 38],
        popupAnchor: [0, -40],
    });

    const marker = L.marker([place.lat, place.lng], { icon });

    // Popup
    const starsHtml = buildStarsHtml(place.rating);
    const popupContent = `
        <div class="map-popup">
            <div class="map-popup-name">${escapeHtml(place.name)}</div>
            <div class="map-popup-type">${cat.label}</div>
            <div class="map-popup-stars">${starsHtml}<span style="font-size:0.75rem;color:var(--text-muted);margin-left:4px;">${place.rating.toFixed(1)}</span></div>
            <div class="map-popup-dist"><i class="fa-solid fa-route" style="margin-right:4px;"></i>${formatDistance(place.distance)}</div>
            <button class="map-popup-btn" onclick="openPlaceModalById(${place.id})">
                <i class="fa-solid fa-circle-info"></i> Details
            </button>
        </div>
    `;
    marker.bindPopup(popupContent, { maxWidth: 240, minWidth: 200 });

    // Cross-link marker ↔ card
    marker._placeId = place.id;
    marker.on('click', () => {
        highlightCardById(place.id);
    });

    return marker;
}

function flyToMarker(place) {
    STATE.map.flyTo([place.lat, place.lng], 17, { duration: 1 });

    // Open that marker's popup
    STATE.clusterGroup.eachLayer(layer => {
        if (layer._placeId === place.id) {
            setTimeout(() => layer.openPopup(), 1100);
            STATE.activeMarker = layer;
        }
    });
}

function highlightCard(el) {
    if (STATE.activeCardEl) STATE.activeCardEl.classList.remove('active');
    el.classList.add('active');
    STATE.activeCardEl = el;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function highlightCardById(id) {
    const card = DOM.resultsList.querySelector(`[data-id="${id}"]`);
    if (card) highlightCard(card);
}

// Called from popup button (global)
window.openPlaceModalById = function(id) {
    const place = STATE.allResults.find(p => p.id === id);
    if (place) openPlaceModal(place, CATEGORIES[place.type]);
};

// ───────────────────────────────────────────────────────
//  PLACE DETAIL MODAL
// ───────────────────────────────────────────────────────
function openPlaceModal(place, cat) {
    const starsHtml = buildStarsHtml(place.rating, 'large');

    DOM.modalContent.innerHTML = `
        <div class="modal-place-icon" style="background: color-mix(in srgb, ${cat.color} 15%, transparent); color: ${cat.color};">
            <i class="fa-solid ${cat.icon}" style="font-size:1.75rem;"></i>
        </div>
        <div class="modal-place-name">${escapeHtml(place.name)}</div>
        <div class="modal-place-type">${cat.label}</div>
        <div class="modal-stars-row">
            ${starsHtml}
            <span class="modal-rating-text">${place.rating.toFixed(1)} / 5.0</span>
        </div>
        <div class="modal-info">
            <div class="modal-info-row">
                <i class="fa-solid fa-route"></i>
                <span>${formatDistance(place.distance)} away</span>
            </div>
            ${place.address ? `
            <div class="modal-info-row">
                <i class="fa-solid fa-location-dot"></i>
                <span>${escapeHtml(place.address)}</span>
            </div>` : ''}
            ${place.phone ? `
            <div class="modal-info-row">
                <i class="fa-solid fa-phone"></i>
                <a href="tel:${escapeHtml(place.phone)}" style="color:var(--accent-primary)">${escapeHtml(place.phone)}</a>
            </div>` : ''}
            ${place.website ? `
            <div class="modal-info-row">
                <i class="fa-solid fa-globe"></i>
                <a href="${escapeHtml(place.website)}" target="_blank" rel="noopener" style="color:var(--accent-primary)">Visit Website</a>
            </div>` : ''}
            ${place.opening_hours ? `
            <div class="modal-info-row">
                <i class="fa-solid fa-clock"></i>
                <span>${escapeHtml(place.opening_hours)}</span>
            </div>` : ''}
            <div class="modal-info-row">
                <i class="fa-solid fa-map-pin"></i>
                <span>${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}</span>
            </div>
        </div>
        <div class="modal-action-row">
            <button class="modal-action-btn primary" onclick="(function(){closeModal();flyToMarker({lat:${place.lat},lng:${place.lng},id:${place.id}})})()">
                <i class="fa-solid fa-location-dot"></i> Show on Map
            </button>
            <button class="modal-action-btn secondary" onclick="openDirections({lat:${place.lat},lng:${place.lng}})">
                <i class="fa-solid fa-diamond-turn-right"></i> Directions
            </button>
        </div>
    `;

    DOM.placeModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    DOM.placeModal.style.display = 'none';
    document.body.style.overflow = '';
}

// Expose for modal buttons
window.closeModal = closeModal;
window.flyToMarker = flyToMarker;
window.openDirections = openDirections;

// ───────────────────────────────────────────────────────
//  LOADING STATES
// ───────────────────────────────────────────────────────
function setLoading(loading, cat = null) {
    if (loading) {
        // Show skeleton cards
        DOM.resultsList.innerHTML = generateSkeletons(5);
        DOM.mapLoading.style.display = 'flex';
        if (cat) {
            DOM.sidebarTitle.textContent = `Loading ${cat.label}...`;
            DOM.resultsCount.textContent = '';
        }
        DOM.filterRow.style.display = 'none';
    } else {
        DOM.mapLoading.style.display = 'none';
    }
}

function generateSkeletons(count) {
    return Array.from({ length: count }, () => `
        <div class="skeleton-card">
            <div class="skeleton-line w-70"></div>
            <div class="skeleton-line w-50"></div>
            <div class="skeleton-line w-90"></div>
            <div class="skeleton-line w-40"></div>
        </div>
    `).join('');
}

function showErrorState(msg) {
    DOM.resultsList.innerHTML = `
        <div class="empty-state">
            <div class="empty-illustration" style="font-size:3rem;">
                <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);-webkit-text-fill-color: var(--danger);"></i>
            </div>
            <h3>Something went wrong</h3>
            <p>${msg}</p>
        </div>
    `;
    DOM.filterRow.style.display = 'none';
    DOM.resultsCount.textContent = '';
    DOM.mapStats.style.display = 'none';
}

function clearResults() {
    STATE.allResults = [];
    STATE.filteredResults = [];
    STATE.clusterGroup.clearLayers();
    DOM.resultsList.innerHTML = '';
    const emptyClone = createEmptyState();
    DOM.resultsList.appendChild(emptyClone);
    DOM.filterRow.style.display = 'none';
    DOM.resultsCount.textContent = '';
    DOM.sidebarTitle.textContent = 'Nearby Places';
    DOM.mapStats.style.display = 'none';
    if (STATE.activeCardEl) STATE.activeCardEl.classList.remove('active');
    STATE.activeCardEl = null;
}

function createEmptyState() {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.id = 'empty-state';
    el.innerHTML = `
        <div class="empty-illustration"><i class="fa-solid fa-map-location-dot"></i></div>
        <h3>Start Exploring</h3>
        <p>Select a category above or search for a location to discover nearby places.</p>
    `;
    return el;
}

// ───────────────────────────────────────────────────────
//  TOAST NOTIFICATIONS
// ───────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = '') {
    clearTimeout(toastTimer);
    DOM.toast.textContent = message;
    DOM.toast.className = `toast ${type} visible`;
    toastTimer = setTimeout(() => {
        DOM.toast.classList.remove('visible');
    }, 3500);
}

// ───────────────────────────────────────────────────────
//  DIRECTIONS
// ───────────────────────────────────────────────────────
function openDirections(place) {
    const { lat, lng: lon } = STATE.currentPos;
    const url = `https://www.openstreetmap.org/directions?engine=fossil_osrm_car&route=${lat},${lon};${place.lat},${place.lng}`;
    window.open(url, '_blank', 'noopener');
}

// ───────────────────────────────────────────────────────
//  UTILITY FUNCTIONS
// ───────────────────────────────────────────────────────

/** Haversine distance (metres) between two lat/lng points */
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Format distance nicely */
function formatDistance(metres) {
    if (metres < 100) return `${Math.round(metres)} m`;
    if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
    return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * Simulate a realistic rating (3.0–5.0) deterministically per place ID.
 * Uses a simple hash so the same place always gets the same rating.
 */
function simulateRating(id) {
    const seed = parseInt(String(id).replace(/\D/g, '').slice(-6) || '12345', 10);
    const pseudo = ((seed * 9301 + 49297) % 233280) / 233280;
    return Math.round((3.0 + pseudo * 2.0) * 10) / 10; // 3.0 – 5.0
}

/** Build HTML for star rating display */
function buildStarsHtml(rating, size = 'small') {
    const full  = Math.floor(rating);
    const half  = rating % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    const cls   = size === 'large' ? 'stars large-stars' : 'stars';

    return `<div class="${cls}">
        ${'<i class="fa-solid fa-star filled"></i>'.repeat(full)}
        ${half ? '<i class="fa-solid fa-star-half-stroke filled half-filled"></i>' : ''}
        ${'<i class="fa-regular fa-star"></i>'.repeat(empty)}
    </div>`;
}

/** Debounce utility */
function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/** Capitalise first letter */
function capitalise(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Escape HTML to prevent XSS */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
