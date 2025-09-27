// Copy this file to firebase-config.js and fill in your real Firebase web config.
// NEVER commit firebase-config.js if it will contain non-public keys for other environments.
// These web keys are okay to expose client-side, but keeping a sample promotes clean repo hygiene.

window.FIREBASE_WEB_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
  // measurementId: "G-XXXXXXX" // optional
};

// After creating firebase-config.js with real values, the init script will automatically pick it up.
