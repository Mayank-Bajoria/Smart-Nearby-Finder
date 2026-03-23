# 🌍 Smart Nearby Finder

## 📌 Overview

Smart Nearby Finder is a location-based web application that allows users to discover essential services around them in real-time. The app helps users find nearby hospitals, restaurants, hotels, ATMs, schools, medical shops, and more using map-based APIs.

This project demonstrates practical implementation of JavaScript concepts such as API integration, asynchronous programming, array higher-order functions, and responsive UI design.

---

## 🎯 Objectives

* To build a real-world useful application using public APIs
* To implement dynamic data fetching using JavaScript (Fetch API)
* To apply array methods like `map()`, `filter()`, and `sort()`
* To create an interactive and responsive user interface
* To allow users to search, filter, and explore nearby services

---

## 🚀 Key Features

### 📍 Location Detection

* Uses browser Geolocation API
* Automatically detects user's current location

### 🔎 Smart Search

* Search places by name or keyword
* Debounced search input for performance

### 🧭 Category Filtering

* Filter results by categories:

  * Hospitals
  * Restaurants
  * Hotels
  * ATMs
  * Schools
  * Medical Stores
  * Public Restrooms

### ⭐ Sorting Options

* Sort by:

  * Distance
  * Rating
  * Popularity

### 🗺️ Map Integration

* Display locations on interactive map
* Show directions using external map service

### 📱 Responsive Design

* Works on mobile, tablet, and desktop

### 🌙 Dark Mode (Optional)

* Toggle between light and dark theme

### ❤️ Favorites (Optional)

* Save and view favorite places using Local Storage

---

## 🔌 API Integration

### Primary API

* Google Maps Places API
  OR
* Foursquare Places API

### Additional APIs (Optional)

* OpenWeatherMap API (for weather data)

---

## 🛠️ Technologies Used

### Frontend

* HTML5
* CSS3 / Tailwind CSS / Bootstrap
* JavaScript (ES6+)

### Core Concepts

* Fetch API
* Promises & Async/Await
* DOM Manipulation
* Array Higher-Order Functions

### Tools

* Git & GitHub
* VS Code

---

## 📁 Folder Structure

```
Smart-Nearby-Finder/
│
├── index.html
├── README.md
│
├── css/
│   └── styles.css
│
├── js/
│   ├── app.js            # Main logic
│   ├── api.js            # API calls
│   ├── ui.js             # DOM rendering
│   ├── utils.js          # Helper functions
│
├── assets/
│   ├── icons/
│   ├── images/
│
├── config/
│   └── config.js         # API keys (hidden in real projects)
│
└── components/ (optional if advanced)
    ├── navbar.js
    ├── card.js
```

---

## ⚙️ Installation & Setup

### 1. Clone the Repository

```
git clone https://github.com/your-username/smart-nearby-finder.git
```

### 2. Navigate to Project Folder

```
cd smart-nearby-finder
```

### 3. Add API Key

* Open `config/config.js`
* Add your API key:

```
const API_KEY = "YOUR_API_KEY";
```

### 4. Run the Project

* Open `index.html` in browser
  OR
* Use Live Server in VS Code

---

## 🔄 Application Flow

1. User opens the application
2. Location is fetched using Geolocation API
3. API request is sent to fetch nearby places
4. Data is displayed dynamically on UI
5. User can:

   * Search
   * Filter
   * Sort results

---

## 📊 Milestone Mapping

### ✅ Milestone 1

* Project idea finalized
* API selected
* README created

### 🔄 Milestone 2

* API integration using fetch
* Dynamic data rendering

### 🔄 Milestone 3

* Search functionality (using filter)
* Sorting (using sort)
* Category filtering
* Interactive UI

### 🔄 Milestone 4

* Documentation completed
* Deployment

---

## ⚡ Performance Enhancements

* Debouncing for search
* Lazy loading
* Efficient DOM updates

---

## 🧠 Future Enhancements

* 🚨 Emergency Mode
* 📶 Offline Support (PWA)
* 🗺️ Route Optimization
* 🤖 AI Recommendations
* 📊 Analytics Dashboard

---

## ⚠️ Challenges Faced

* Handling asynchronous API calls
* Managing large datasets
* Making UI responsive
* API key security

---

## 📸 Screenshots

(Add screenshots here after UI is ready)

---

## 🌐 Live Demo

(Add deployed link here)

---

## 🙌 Author

* Mayank Bajoria

---

## 📜 License

This project is for educational purposes only.
