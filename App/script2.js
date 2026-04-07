// ====== MAP SETUP ======
// Initialize the map and set its view to a starting location (Delhi coordinates)
var map = L.map('map').setView([28.6139, 77.2090], 12);

// Add the visual map layer from OpenStreetMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
}).addTo(map);

// We will use this array to keep track of map pins (markers) so we can clear them later
var mapMarkers = [];
// This array holds our fetched data so we can use filter on it later
var fetchedData = [];

// ====== SELECT ELEMENTS ======
var searchBtn = document.getElementById("search-btn");
var searchInput = document.getElementById("location-search");
var resultsBox = document.getElementById("results-list"); 
var filterInput = document.getElementById("filter-input");
var filterRow = document.getElementById("filter-row");

// ====== SEARCH BUTTON EVENT ======
searchBtn.addEventListener("click", function () {
  var userSearch = searchInput.value;
  if (userSearch === "") {
    resultsBox.innerHTML = "<p>Please type something to search!</p>";
    return;
  }
  // Call our main function to fetch the data
  fetchAndShowPlaces(userSearch);
});

// ====== CATEGORY BUTTONS EVENT ======
// Select all buttons that have the class 'cat-btn' (Hospitals, Banks etc.)
var categoryButtons = document.querySelectorAll(".cat-btn");

// Use array forEach instead of a for loop
Array.from(categoryButtons).forEach(function(button) {
  button.addEventListener("click", function() {
    // Get the category name from 'data-type' attribute in HTML
    var categoryName = this.getAttribute("data-type");
    fetchAndShowPlaces(categoryName);
  });
});

// ====== FILTER DIRECTLY ON RESULTS ======
// Listen for user typing in the filter box
filterInput.addEventListener("input", function(event) {
  var typedWord = event.target.value.toLowerCase();
  
  // Use filter() to find matching items from our fetched data
  var matchingResults = fetchedData.filter(function(place) {
    var placeName = place.display_name.toLowerCase();
    return placeName.includes(typedWord);
  });
  
  // Show the matching results dynamically
  var currentSearch = searchInput.value || "Filtered";
  displayPlaces(matchingResults, currentSearch);
});

// ====== FUNCTION TO DISPLAY PLACES ======
function displayPlaces(placesArray, searchWord) {
  resultsBox.innerHTML = "";

  // Remove old markers using array forEach (no for loop)
  mapMarkers.forEach(function(marker) {
    map.removeLayer(marker);
  });
  mapMarkers = [];

  if (placesArray.length === 0) {
    resultsBox.innerHTML = "<p>No results match your filter.</p>";
    return;
  }

  // Use array forEach to show place list and map markers (no for loop)
  placesArray.forEach(function(place) {
    var placeName = place.display_name;
    var placeLat = place.lat;
    var placeLon = place.lon;
    
    // 1. Create sidebar element
    var placeElement = document.createElement("div");
    placeElement.className = "place-card"; 
    placeElement.innerHTML = "<strong>Found: </strong>" + placeName;
    placeElement.onclick = function() { map.setView([placeLat, placeLon], 16); };

    resultsBox.appendChild(placeElement);

    // 2. Map marker
    var marker = L.marker([placeLat, placeLon]).addTo(map);
    marker.bindPopup("<strong>" + searchWord.toUpperCase() + "</strong><br>" + placeName);
    mapMarkers.push(marker);
  });
}

// ====== MAIN FUNCTION TO GET DATA AND SHOW ON MAP ======
function fetchAndShowPlaces(searchWord) {
  // Show a simple loading text
  resultsBox.innerHTML = "<p>Loading...</p>";

  // A free public API url to search for places (restricted specifically to India)
  var apiUrl = "https://nominatim.openstreetmap.org/search?format=json&q=" + searchWord + "&countrycodes=in&limit=5";

  // Use fetch() to get the data
  fetch(apiUrl)
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      // Clear the loading text
      resultsBox.innerHTML = "";

      // Save the fetched data to our variable
      fetchedData = data;
      
      // Make the filter input row visible
      filterRow.style.display = "flex";
      filterInput.value = ""; // clear old text

      // Check if API returned empty data
      if (data.length === 0) {
        resultsBox.innerHTML = "<p>No results found for '" + searchWord + "'.</p>";
        return;
      }

      // Automatically move the map view to the very first result found
      map.setView([data[0].lat, data[0].lon], 13);
      
      // Display the fetched places
      displayPlaces(fetchedData, searchWord);
    })
    .catch(function (error) {
      resultsBox.innerHTML = "<p>Error: Could not load data.</p>";
    });
}
