(function () {
  "use strict";

  // 1. Settings Button Logic (Essential for the button to work)
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsOverlay = document.getElementById("settingsOverlay");
  const closeSettings = document.getElementById("closeSettings");

  settingsBtn.addEventListener("click", () => {
    settingsOverlay.hidden = false;
  });

  closeSettings.addEventListener("click", () => {
    settingsOverlay.hidden = true;
  });

  // 2. Simple Status UI
  document.getElementById('greeting').innerText = "Jarvis is ready.";
  console.log("Settings logic loaded successfully.");

})();
