(function () {
  "use strict";

  /* ---------------- state ---------------- */
  const STORAGE_KEY = "jarvis:state";
  const MIC_HINT_KEY = "jarvis:seenMicHint";

  const defaults = {
    apiKey: "",
    model: "gemini-2.5-flash", // Updated to Gemini as default
    systemPrompt:
      "You are Jarvis, a personal AI assistant. Be warm, concise, and a little dry-witted. " +
      "Default to short, conversational replies unless the person asks for detail.",
    voiceEnabled: true,
    homeCity: "",
    homeLat: null,
    homeLon: null,
    notes: [],
    timers: [],
    chat: []
  };

  let state = loadState();
  const timerHandles = {};

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, defaults);
      const parsed = JSON.parse(raw);
      return Object.assign({}, defaults, parsed);
    } catch (e) {
      return Object.assign({}, defaults);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage full or unavailable — fail quietly */
    }
  }

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);

  const el = {
    netDot: $("netDot"),
    netLabel: $("netLabel"),
    clock: $("clock"),
    settingsBtn: $("settingsBtn"),
    core: $("core"),
    greeting: $("greeting"),
    transcript: $("transcript"),
    chips: $("quickChips"),
    inputBar: $("inputBar"),
    micHint: $("micHint"),
    textInput: $("textInput"),
    sendBtn: $("sendBtn"),
    overlay: $("settingsOverlay"),
    apiKeyInput: $("apiKeyInput"),
    toggleKeyVisible: $("toggleKeyVisible"),
    modelSelect: $("modelSelect"),
    systemPromptInput: $("systemPromptInput"),
    homeCityInput: $("homeCityInput"),
    voiceToggle: $("voiceToggle"),
    clearDataBtn: $("clearDataBtn"),
    closeSettings: $("closeSettings"),
    toast: $("toast")
  };

  /* ---------------- boot ---------------- */
  function init() {
    renderHistory();
    updateGreeting();
    updateClock();
    setInterval(updateClock, 1000);
    updateNetStatus();
    window.addEventListener("online", updateNetStatus);
    window.addEventListener("offline", updateNetStatus);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }

    rescheduleSavedTimers();
    wireEvents();

    if (state.chat.length === 0) {
      addMessage("jarvis", "Hello. I'm online and ready when you are.", false);
    }
  }

  function updateGreeting() {
    const h = new Date().getHours();
    let g = "Good evening.";
    if (h < 12) g = "Good morning.";
    else if (h < 18) g = "Good afternoon.";
    el.greeting.textContent = g;
  }

  function updateClock() {
    el.clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function updateNetStatus() {
    const on = navigator.onLine;
    el.netDot.classList.toggle("dot--on", on);
    el.netLabel.textContent = on ? "ONLINE" : "OFFLINE";
  }

  /* ---------------- transcript ---------------- */
  function addMessage(role, text, persist) {
    if (persist !== false) {
      state.chat.push({ role: role, text: text, ts: Date.now() });
      if (state.chat.length > 200) state.chat = state.chat.slice(-200);
      saveState();
    }
    renderMessage(role, text);
  }

  function renderMessage(role, text) {
    const div = document.createElement("div");
    div.className = "msg msg--" + (role === "user" ? "user" : role === "system" ? "system" : "jarvis");
    div.textContent = text;
    el.transcript.appendChild(div);
    el.transcript.scrollTop = el.transcript.scrollHeight;
  }

  function renderHistory() {
    el.transcript.innerHTML = "";
    state.chat.forEach(function (m) {
      renderMessage(m.role, m.text);
    });
  }

  /* ---------------- core visual state ---------------- */
  function setCoreState(mode) {
    el.core.classList.remove("core--thinking", "core--speaking");
    if (mode === "thinking") el.core.classList.add("core--thinking");
    if (mode === "speaking") el.core.classList.add("core--speaking");
  }

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.classList.add("toast--show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove("toast--show");
    }, ms || 2400);
  }

  /* ---------------- voice ---------------- */
  function speak(text) {
    if (!state.voiceEnabled) return;
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.pitch = 1.0;
      u.onstart = function () { setCoreState("speaking"); };
      u.onend = function () { setCoreState("idle"); };
      u.onerror = function () { setCoreState("idle"); };
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---------------- beep ---------------- */
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      [0, 220, 440].forEach(function (delay) {
        setTimeout(function () {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.value = 880;
          g.gain.value = 0.0001;
          o.connect(g);
          g.connect(ctx.destination);
          o.start();
          g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
          o.stop(ctx.currentTime + 0.4);
        }, delay);
      });
    } catch (e) {}
  }

  /* ---------------- timers & reminders ---------------- */
  function unitToMs(amount, unit) {
    unit = unit.toLowerCase();
    if (unit.indexOf("sec") === 0) return amount * 1000;
    if (unit.indexOf("hour") === 0 || unit.indexOf("hr") === 0) return amount * 3600000;
    return amount * 60000;
  }

  function parseAbsoluteTime(hourStr, minStr, ampm) {
    let h = parseInt(hourStr, 10);
    const m = minStr ? parseInt(minStr, 10) : 0;
    if (ampm) {
      ampm = ampm.toLowerCase();
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
    }
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (target.getTime() <= now.getTime() + 5000) target.setDate(target.getDate() + 1);
    return target;
  }

  function maybeAskNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(function () {});
    }
  }

  function addTimerItem(label, targetDate, kind) {
    const item = {
      id: "t" + Date.now() + Math.random().toString(36).slice(2, 7),
      label: label,
      targetTs: targetDate.getTime(),
      kind: kind
    };
    state.timers.push(item);
    saveState();
    maybeAskNotificationPermission();
    scheduleItem(item, true);
    return item;
  }

  function scheduleItem(item, isNew) {
    const ms = item.targetTs - Date.now();
    if (ms <= 0) {
      fireItem(item, !isNew);
      return;
    }
    timerHandles[item.id] = setTimeout(function () {
      fireItem(item, false);
    }, ms);
  }

  function fireItem(item, silent) {
    state.timers = state.timers.filter(function (t) { return t.id !== item.id; });
    saveState();
    delete timerHandles[item.id];
    const noun = item.kind === "reminder" ? "Reminder" : "Timer";
    const msg = silent
      ? "⏰ " + noun + " (while you were away): " + item.label
      : "⏰ " + noun + ": " + item.label;
    addMessage("jarvis", msg);
    if (!silent) {
      beep();
      speak(item.label);
      if ("Notification" in window && Notification.permission === "granted") {
        try { new Notification("Jarvis", { body: item.label }); } catch (e) {}
      }
    }
  }

  function rescheduleSavedTimers() {
    state.timers.forEach(function (item) {
      scheduleItem(item, item.targetTs <= Date.now());
    });
  }

  function listTimersText() {
    if (state.timers.length === 0) return "No active timers or reminders.";
    return state.timers
      .slice()
      .sort(function (a, b) { return a.targetTs - b.targetTs; })
      .map(function (t, i) {
        const when = new Date(t.targetTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return (i + 1) + ". " + t.label + " — " + when;
      })
      .join("\n");
  }

  function cancelTimerByIndex(idx) {
    const sorted = state.timers.slice().sort(function (a, b) { return a.targetTs - b.targetTs; });
    const item = sorted[idx - 1];
    if (!item) return false;
    clearTimeout(timerHandles[item.id]);
    delete timerHandles[item.id];
    state.timers = state.timers.filter(function (t) { return t.id !== item.id; });
    saveState();
    return true;
  }

  /* ---------------- notes ---------------- */
  function addNote(text) {
    state.notes.push({ id: Date.now(), text: text, ts: Date.now() });
    saveState();
  }
  function listNotesText() {
    if (state.notes.length === 0) return "You don't have any notes yet.";
    return state.notes.map(function (n, i) { return (i + 1) + ". " + n.text; }).join("\n");
  }
  function deleteNoteByIndex(idx) {
    if (idx < 1 || idx > state.notes.length) return false;
    state.notes.splice(idx - 1, 1);
    saveState();
    return true;
  }

  /* ---------------- calculator ---------------- */
  function tryCalculator(text) {
    const calcPrefix = /^calc(ulate)?[:\s]+/i;
    const isExplicit = calcPrefix.test(text);
    const expr = (isExplicit ? text.replace(calcPrefix, "") : text).trim();
    const safe = /^[\d\s+\-*/().%]+$/;
    if (!safe.test(expr)) return null;
    if (!/\d/.test(expr)) return null;
    if (!isExplicit && !/[+\-*/%]/.test(expr)) return null;
    try {
      const result = Function('"use strict"; return (' + expr + ")")();
      if (typeof result !== "number" || !isFinite(result)) return null;
      const rounded = Math.round(result * 100000) / 100000;
      return expr.trim() + " = " + rounded;
    } catch (e) {
      return null;
    }
  }

  /* ---------------- weather (Open-Meteo, no key required) ---------------- */
  const WEATHER_CODES = {
    0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
    45: "foggy", 48: "foggy", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow",
    80: "rain showers", 81: "rain showers", 82: "violent showers",
    95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail"
  };

  async function geocodeHomeCity() {
    if (!state.homeCity) return false;
    const url = "https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + encodeURIComponent(state.homeCity);
    const res = await fetch(url);
    const data = await res.json();
    if (!data.results || !data.results.length) return false;
    state.homeLat = data.results[0].latitude;
    state.homeLon = data.results[0].longitude;
    saveState();
    return true;
  }

  async function getWeatherText() {
    if (!navigator.onLine) return "I need an internet connection to check the weather.";
    if (!state.homeCity) return "Set a home city in Settings first, then ask me again.";
    if (state.homeLat == null || state.homeLon == null) {
      const ok = await geocodeHomeCity();
      if (!ok) return "I couldn't find \"" + state.homeCity + "\". Double check the spelling in Settings.";
    }
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast?latitude=" + state.homeLat +
        "&longitude=" + state.homeLon + "&current=temperature_2m,weather_code";
      const res = await fetch(url);
      const data = await res.json();
      const c = data.current;
      const desc = WEATHER_CODES[c.weather_code] || "unclear skies";
      return "It's " + Math.round(c.temperature_2m) + "°C and " + desc + " in " + state.homeCity + " right now.";
    } catch (e) {
      return "I couldn't reach the weather service just now.";
    }
  }

  /* ---------------- local command router ---------------- */
  async function tryLocalCommand(text) {
    let m;

    // notes
    if ((m = text.match(/^note[:\-]?\s+(.+)/i))) {
      addNote(m[1].trim());
      addMessage("jarvis", "Noted: \u201c" + m[1].trim() + "\u201d");
      return true;
    }
    if ((m = text.match(/^remember(?: that)?[:\-]?\s+(.+)/i))) {
      addNote(m[1].trim());
      addMessage("jarvis", "I'll remember that.");
      return true;
    }
    if (/^(list|show|read)( my)? notes\??$/i.test(text)) {
      addMessage("jarvis", listNotesText());
      return true;
    }
    if ((m = text.match(/^(?:delete|remove) note (\d+)/i))) {
      const ok = deleteNoteByIndex(parseInt(m[1], 10));
      addMessage("jarvis", ok ? "Deleted." : "I couldn't find a note with that number.");
      return true;
    }
    if (/^clear notes$/i.test(text)) {
      state.notes = [];
      saveState();
      addMessage("jarvis", "All notes cleared.");
      return true;
    }

    // timers (relative, duration-based)
    if ((m = text.match(/^(?:set (?:a )?)?timer (?:for )?(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b\s*(?:for |to |called )?(.*)$/i))) {
      const amount = parseInt(m[1], 10);
      const ms = unitToMs(amount, m[2]);
      const label = m[3] && m[3].trim() ? m[3].trim() : amount + " " + m[2];
      const target = new Date(Date.now() + ms);
      addTimerItem(label, target, "timer");
      addMessage("jarvis", "Timer set for " + label + " — I'll let you know at " +
        target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ".");
      return true;
    }

    // reminders, relative
    if ((m = text.match(/^remind me (?:to |about )?(.+?) in (\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)$/i))) {
      const label = m[1].trim();
      const ms = unitToMs(parseInt(m[2], 10), m[3]);
      const target = new Date(Date.now() + ms);
      addTimerItem(label, target, "reminder");
      addMessage("jarvis", "Got it — I'll remind you to " + label + " at " +
        target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ".");
      return true;
    }

    // reminders, absolute time
    if ((m = text.match(/^remind me (?:to |about )?(.+?) at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i))) {
      const label = m[1].trim();
      const target = parseAbsoluteTime(m[2], m[3], m[4]);
      addTimerItem(label, target, "reminder");
      addMessage("jarvis", "Got it — I'll remind you to " + label + " at " +
        target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ".");
      return true;
    }

    if (/^(list|show) (timers|reminders)\??$/i.test(text)) {
      addMessage("jarvis", listTimersText());
      return true;
    }
    if ((m = text.match(/^cancel (?:timer|reminder) (\d+)/i))) {
      const ok = cancelTimerByIndex(parseInt(m[1], 10));
      addMessage("jarvis", ok ? "Cancelled." : "I couldn't find one with that number.");
      return true;
    }

    // time / date
    if (/^(what'?s|what is)?\s*(the )?time( is it)?\??$/i.test(text)) {
      addMessage("jarvis", "It's " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ".");
      return true;
    }
    if (/^(what'?s|what is)?\s*(the )?date\??$|^what day is it\??$/i.test(text)) {
      addMessage("jarvis", new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + ".");
      return true;
    }

    // weather
    if (/^weather\b/i.test(text)) {
      addMessage("jarvis", await getWeatherText());
      return true;
    }

    // calculator
    const calcResult = tryCalculator(text);
    if (calcResult) {
      addMessage("jarvis", calcResult);
      return true;
    }

    return false;
  }

  /* ---------------- Google AI Studio (Gemini) API ---------------- */
  function buildApiMessages() {
    const apiMessages = [
      { role: "system", content: state.systemPrompt }
    ];

    const context = state.chat
      .filter(function (m) { return m.role === "user" || m.role === "assistant" || m.role === "jarvis"; })
      .slice(-20)
      .map(function (m) {
        return { 
          role: m.role === "user" ? "user" : "assistant", 
          content: m.text 
        };
      });

    return apiMessages.concat(context);
  }

  async function callGemini() {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": "Bearer " + state.apiKey
      },
      body: JSON.stringify({
        model: state.model,
        messages: buildApiMessages(),
        temperature: 0.7
      })
    });

    if (!res.ok) {
      let message = "Request failed (" + res.status + ")";
      try {
        const errBody = await res.json();
        if (errBody && errBody.error && errBody.error.message) message = errBody.error.message;
      } catch (e) {}
      throw new Error(message);
    }
    const data = await res.json();
    const text = data.choices[0].message.content;
    return text ? text.trim() : "(no response)";
  }

  /* ---------------- submit handling ---------------- */
  async function handleSubmit(rawText) {
    const text = (rawText || "").trim();
    if (!text) return;

    addMessage("user", text);
    el.textInput.value = "";

    const handled = await tryLocalCommand(text);
    if (handled) return;

    if (!navigator.onLine) {
      addMessage("jarvis", "I'm offline right now — I can still take notes, set timers, do quick math, or check the time and date.");
      return;
    }
    if (!state.apiKey) {
      addMessage("jarvis", "I don't have an API key yet, so I can't hold an open conversation. Add one in Settings (tap the gear) — notes, timers, and quick math work without it.");
      return;
    }

    setCoreState("thinking");
    try {
      const reply = await callGemini(); // Correctly triggers the new Gemini caller
      addMessage("jarvis", reply);
      speak(reply);
    } catch (e) {
      addMessage("jarvis", "I couldn't reach the model: " + e.message);
    } finally {
      setCoreState("idle");
    }
  }

  /* ---------------- settings sheet ---------------- */
  function openSettings() {
    el.apiKeyInput.value = state.apiKey;
    el.modelSelect.value = state.model;
    el.systemPromptInput.value = state.systemPrompt;
    el.homeCityInput.value = state.homeCity;
    el.voiceToggle.checked = state.voiceEnabled;
    el.overlay.hidden = false;
  }

  async function closeSettingsAndSave() {
    state.apiKey = el.apiKeyInput.value.trim();
    state.model = el.modelSelect.value;
    state.systemPrompt = el.systemPromptInput.value.trim() || defaults.systemPrompt;
    state.voiceEnabled = el.voiceToggle.checked;

    const newCity = el.homeCityInput.value.trim();
    if (newCity !== state.homeCity) {
      state.homeCity = newCity;
      state.homeLat = null;
      state.homeLon = null;
    }
    saveState();
    el.overlay.hidden = true;
    toast("Settings saved.");

    if (state.homeCity && state.homeLat == null) {
      const ok = await geocodeHomeCity();
      if (!ok) toast("Couldn't find that city — check spelling in Settings.");
    }
  }

  function eraseAllData() {
    const sure = window.confirm("Erase all Jarvis data on this device? This clears notes, timers, chat history, and your API key. This can't be undone.");
    if (!sure) return;
    Object.keys(timerHandles).forEach(function (id) { clearTimeout(timerHandles[id]); delete timerHandles[id]; });
    localStorage.removeItem(STORAGE_KEY);
    state = Object.assign({}, defaults);
    saveState();
    renderHistory();
    el.overlay.hidden = true;
    toast("All data erased.");
  }

  /* ---------------- events ---------------- */
  function wireEvents() {
    el.inputBar.addEventListener("submit", function (e) {
      e.preventDefault();
      handleSubmit(el.textInput.value);
    });

    el.micHint.addEventListener("click", function () {
      el.textInput.focus();
      if (!localStorage.getItem(MIC_HINT_KEY)) {
        toast("Tap the microphone on your keyboard to dictate.", 3200);
        localStorage.setItem(MIC_HINT_KEY, "1");
      }
    });

    el.chips.addEventListener("click", function (e) {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const fill = btn.getAttribute("data-fill");
      if (/:\s*$/.test(fill)) {
        el.textInput.value = fill;
        el.textInput.focus();
      } else {
        handleSubmit(fill);
      }
    });

    el.settingsBtn.addEventListener("click", openSettings);
    el.closeSettings.addEventListener("click", closeSettingsAndSave);
    el.overlay.addEventListener("click", function (e) {
      if (e.target === el.overlay) closeSettingsAndSave();
    });
    el.clearDataBtn.addEventListener("click", eraseAllData);

    el.toggleKeyVisible.addEventListener("click", function () {
      const showing = el.apiKeyInput.type === "text";
      el.apiKeyInput.type = showing ? "password" : "text";
      el.toggleKeyVisible.textContent = showing ? "show" : "hide";
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
