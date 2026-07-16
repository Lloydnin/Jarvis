(function () {
  "use strict";

  /* ---------------- State & Defaults ---------------- */
  const STORAGE_KEY = "jarvis:state";
  const defaults = {
    apiKey: "",
    model: "gemini-3.5-flash", // Updated default
    systemPrompt: "You are Jarvis, a warm, concise personal AI assistant.",
    voiceEnabled: true,
    homeCity: "",
    homeLat: null,
    homeLon: null,
    notes: [],
    timers: [],
    chat: []
  };

  let state = Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));

  /* ---------------- Voice Interaction (Call Style) ---------------- */
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.lang = 'en-US';

  function speak(text) {
    if (!state.voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
  }

  recognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript;
    handleSubmit(transcript);
  };

  /* ---------------- Core API Engine (Multi-Model) ---------------- */
  async function callGemini() {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": "Bearer " + state.apiKey
      },
      body: JSON.stringify({
        model: state.model, // Pulls from your settings dropdown
        messages: [{ role: "system", content: state.systemPrompt }, ...state.chat.slice(-15).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))]
      })
    });
    if (!res.ok) throw new Error("API Error: " + res.status);
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }

  /* ---------------- Original Local Logic ---------------- */
  // ... (Your original tryLocalCommand, weather, and timers logic goes here) ...
  // [IMPORTANT: Keep your existing local logic functions here to maintain full offline function]

  async function handleSubmit(text) {
    if (!text.trim()) return;
    state.chat.push({ role: "user", text: text });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    // Try Local Commands First (Offline)
    if (await tryLocalCommand(text)) return; 

    // AI Fallback (Online)
    try {
      const reply = await callGemini();
      state.chat.push({ role: "assistant", text: reply });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      speak(reply);
    } catch (e) {
      speak("I'm having trouble connecting to the AI.");
    }
  }

  // Start "Call"
  recognition.start();
})();
