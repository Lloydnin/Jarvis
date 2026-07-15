(function () {
  'use strict';

  // ---------------- State Management ----------------
  var state = {
    apiKey: localStorage.getItem('jarvis_api_key') || '',
    model: 'gemini-2.5-flash',
    systemPrompt: 'You are Jarvis, a helpful and highly efficient AI assistant.',
    chat: JSON.parse(localStorage.getItem('jarvis_chat_history')) || []
  };

  function saveState() {
    localStorage.setItem('jarvis_api_key', state.apiKey);
    localStorage.setItem('jarvis_chat_history', JSON.stringify(state.chat));
  }

  // ---------------- DOM Elements ----------------
  var elements = {
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    closeSettings: document.getElementById('closeSettings'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    modelSelect: document.getElementById('modelSelect'),
    systemPromptInput: document.getElementById('systemPromptInput'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    chatContainer: document.getElementById('chatContainer'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    bootScreen: document.getElementById('bootScreen')
  };

  // ---------------- Google AI Studio (Gemini) API ----------------
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

  // ---------------- UI Functions ----------------
  function appendMessage(role, text) {
    var msgDiv = document.createElement('div');
    msgDiv.className = 'message ' + role;
    
    var textDiv = document.createElement('div');
    textDiv.className = 'text';
    textDiv.textContent = text;
    
    msgDiv.appendChild(textDiv);
    elements.chatContainer.appendChild(msgDiv);
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
  }

  function renderChat() {
    elements.chatContainer.innerHTML = '';
    state.chat.forEach(function (m) {
      appendMessage(m.role, m.text);
    });
  }

  async function handleSubmit() {
    var text = elements.chatInput.value.trim();
    if (!text) return;

    if (!state.apiKey) {
      alert('Please enter your Gemini API key in Settings first.');
      elements.settingsPanel.classList.add('active');
      return;
    }

    elements.chatInput.value = '';
    state.chat.push({ role: 'user', text: text });
    appendMessage('user', text);
    saveState();

    // Show Jarvis typing indicator/state
    var typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant typing';
    typingDiv.textContent = 'Jarvis is thinking...';
    elements.chatContainer.appendChild(typingDiv);
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;

    try {
      const reply = await callGemini();
      typingDiv.remove();
      state.chat.push({ role: 'assistant', text: reply });
      appendMessage('assistant', reply);
      saveState();
    } catch (err) {
      typingDiv.remove();
      appendMessage('assistant', 'Error: ' + err.message);
    }
  }

  // ---------------- Event Listeners ----------------
  elements.settingsBtn.addEventListener('click', function () {
    elements.apiKeyInput.value = state.apiKey;
    elements.modelSelect.value = state.model;
    elements.systemPromptInput.value = state.systemPrompt;
    elements.settingsPanel.classList.add('active');
  });

  elements.closeSettings.addEventListener('click', function () {
    elements.settingsPanel.classList.remove('active');
  });

  elements.saveSettingsBtn.addEventListener('click', function () {
    state.apiKey = elements.apiKeyInput.value.trim();
    state.model = elements.modelSelect.value;
    state.systemPrompt = elements.systemPromptInput.value.trim();
    saveState();
    elements.settingsPanel.classList.remove('active');
  });

  elements.sendBtn.addEventListener('click', handleSubmit);
  elements.chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') handleSubmit();
  });

  // ---------------- App Init ----------------
  function init() {
    renderChat();
    // Hide the boot screen once everything is set up
    if (elements.bootScreen) {
      elements.bootScreen.style.display = 'none';
    }
  }

  // Delay init slightly to mimic a booting sequence
  setTimeout(init, 1000);

})();
