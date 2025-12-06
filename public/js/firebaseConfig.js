// public/js/firebaseConfig.js
// ---------------------------------------------
// Firebase initialization for the Trivia Game
// ---------------------------------------------

// Your Firebase configuration (you provided this earlier)
const firebaseConfig = {
  apiKey: "AIzaSyAZtG1Bc0RjwN4juzgzd6WPSk1ixIg87x0",
  authDomain: "trivia-game-f3c34.firebaseapp.com",
  projectId: "trivia-game-f3c34",
  storageBucket: "trivia-game-f3c34.firebasestorage.app",
  messagingSenderId: "57817673958",
  appId: "1:57817673958:web:96d9e228967a8a9b250b27",
  measurementId: "G-DRPN3J0XSV"
};

// Load Firebase modules from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
const db = getFirestore(app);

// Export Firestore instance
export { db };
