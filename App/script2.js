// ====== MAP SETUP ======
// Initialize the map and set its view to a starting location (Delhi coordinates)
var map = L.map('map').setView([28.6139, 77.2090], 12);

// Add the visual map layer from OpenStreetMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
}).addTo(map);

// We will use this array to keep track of map pins (markers) so we can clear them later
var mapMarkers = [];

// ====== SELECT ELEMENTS ======
var searchBtn = document.getElementById("search-btn");
var searchInput = document.getElementById("location-search");
var resultsBox = document.getElementById("results-list"); 

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

// Loop through each category button and add a click event
for (var i = 0; i < categoryButtons.length; i++) {
  categoryButtons[i].addEventListener("click", function() {
    // Get the category name from 'data-type' attribute in HTML
    var categoryName = this.getAttribute("data-type");
    fetchAndShowPlaces(categoryName);
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

      // Remove old markers from the map before adding new ones
      for (var j = 0; j < mapMarkers.length; j++) {
        map.removeLayer(mapMarkers[j]);
      }
      mapMarkers = []; // reset markers list to empty

      // Check if API returned empty data
      if (data.length === 0) {
        resultsBox.innerHTML = "<p>No results found for '" + searchWord + "'.</p>";
        return;
      }

      // Loop through the data to show each place in list AND on map
      for (var k = 0; k < data.length; k++) {
        var placeName = data[k].display_name;
        var placeLat = data[k].lat;
        var placeLon = data[k].lon;
        
        // 1. Create a list element for the sidebar
        var placeElement = document.createElement("div");
        placeElement.className = "place-card"; 
        placeElement.innerHTML = "<strong>Found: </strong>" + placeName;
        // When clicking a place card, move the map there
        placeElement.onclick = (function(lat, lon) {
             return function() { map.setView([lat, lon], 16); };
        })(placeLat, placeLon);

        resultsBox.appendChild(placeElement);

        // 2. Put a pin (marker) on the map for this place
        var marker = L.marker([placeLat, placeLon]).addTo(map);
        
        // Add a small popup text when marker is clicked
        marker.bindPopup("<strong>" + searchWord.toUpperCase() + "</strong><br>" + placeName);
        
        // Save marker in our list so we can remove it next time
        mapMarkers.push(marker);
      }

      // Automatically move the map view to the very first result found!
      if (data.length > 0) {
        map.setView([data[0].lat, data[0].lon], 13);
      }
    })
    .catch(function (error) {
      resultsBox.innerHTML = "<p>Error: Could not load data.</p>";
    });
}
