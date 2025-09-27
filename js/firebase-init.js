/*
  firebase-init.js
  Loads Firebase using config exposed as window.FIREBASE_WEB_CONFIG (from firebase-config.js).
  Exposes a small FirebaseService singleton on window for the rest of the app to use.
  Defers app logic that depends on auth/database until ready via window.dispatchEvent(new Event('firebase-ready')).
*/

(function(){
  const RETRY_MS = 3000;

  function log(msg, ...rest){
    console.log('[FirebaseInit]', msg, ...rest);
  }

  function error(msg, ...rest){
    console.error('[FirebaseInit]', msg, ...rest);
  }

  function ensureConfig(){
    if(!window.FIREBASE_WEB_CONFIG){
      error('FIREBASE_WEB_CONFIG not found. Did you create js/firebase-config.js based on firebase-config.sample.js?');
      return false;
    }
    // Basic validation: apiKey shouldn't contain YOUR_API_KEY placeholder
    const cfg = window.FIREBASE_WEB_CONFIG;
    if(/YOUR_API_KEY/i.test(cfg.apiKey || '')){
      error('firebase-config.js still has placeholder values. Replace them with your real Firebase project config.');
      return false;
    }
    if(!cfg.apiKey || !cfg.projectId){
      error('firebase-config.js missing required fields (apiKey, projectId).');
      return false;
    }
    return true;
  }

  function waitForFirebaseSDK(attempt){
    attempt = attempt || 1;
    if(window.firebase && window.firebase.apps){
      init();
      return;
    }
    if(attempt > 10){
      error('Firebase SDK failed to load after several attempts.');
      return;
    }
    log('Firebase SDK not yet available, retrying...', attempt);
    setTimeout(()=>waitForFirebaseSDK(attempt+1), RETRY_MS);
  }

  function init(){
    if(!ensureConfig()) return;
    if(window.firebase.app){
      // Using compat sdk interface
      let app;
      try {
        app = window.firebase.initializeApp(window.FIREBASE_WEB_CONFIG);
      } catch(initErr){
        error('Firebase init failed:', initErr.message || initErr);
        return;
      }
      const auth = window.firebase.auth();
      const db = window.firebase.firestore();

      window.FirebaseService = {
        app,
        auth,
        db,
        providerGoogle: new window.firebase.auth.GoogleAuthProvider(),
        // Helpers
        onAuthStateChanged(cb){ return auth.onAuthStateChanged(cb); },
        signInWithGoogle(){ return auth.signInWithPopup(this.providerGoogle); },
        createUserEmail(email, password){ return auth.createUserWithEmailAndPassword(email, password); },
        signInEmail(email, password){ return auth.signInWithEmailAndPassword(email, password); },
        signOut(){ return auth.signOut(); }
      };

      log('Firebase initialized.');
      window.dispatchEvent(new Event('firebase-ready'));
    } else {
      error('Firebase global not found, cannot initialize.');
    }
  }

  // Kick off when DOM is ready so we can safely dispatch events.
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', waitForFirebaseSDK);
  } else {
    waitForFirebaseSDK();
  }
})();
