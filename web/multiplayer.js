(() => {
  const WS_URL = "wss://mu-online-multiplayer-gateway.onrender.com/ws";
  const style = document.createElement("style");
  style.textContent = `
    #muMultiPanel{position:fixed;z-index:99999;right:12px;top:74px;width:min(310px,calc(100vw - 24px));max-height:48vh;background:rgba(12,16,25,.94);color:#f5f7ff;border:1px solid #c69b4a;border-radius:12px;box-shadow:0 8px 28px #0008;font:13px system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden;backdrop-filter:blur(8px)}
    #muMultiPanel *{box-sizing:border-box} #muMultiHead{display:flex;align-items:center;gap:8px;padding:9px 10px;background:#1c2637;border-bottom:1px solid #65502d;font-weight:700}
    #muMultiStatus{width:8px;height:8px;border-radius:50%;background:#d74b4b;flex:none}#muMultiTitle{flex:1}#muMultiToggle{border:0;background:transparent;color:#fff;font-size:18px;padding:0 4px}
    #muMultiBody{display:flex;flex-direction:column;min-height:0}#muMultiSetup{display:flex;gap:5px;padding:8px}#muMultiSetup input,#muMultiCompose input{min-width:0;flex:1;background:#0b111b;color:#fff;border:1px solid #48556a;border-radius:6px;padding:8px;font-size:12px}
    #muMultiSetup button,#muMultiCompose button{background:#b8862d;color:#111;border:0;border-radius:6px;padding:7px 10px;font-weight:700}
    #muMultiPlayers{padding:0 9px 7px;color:#b8c8dc;font-size:11px}#muMultiMessages{height:150px;overflow:auto;padding:8px;border-top:1px solid #344052;border-bottom:1px solid #344052;overflow-wrap:anywhere}
    .muMultiMsg{margin:0 0 7px}.muMultiMsg strong{color:#f3ca73}.muMultiSys{color:#93a8c2;font-style:italic}
    #muMultiCompose{display:flex;gap:5px;padding:8px}#muMultiFoot{font-size:10px;color:#8f9db0;padding:0 9px 8px}
    #muMultiPanel.mu-collapsed #muMultiBody{display:none}#muMultiPanel.mu-collapsed{max-height:none;width:auto}
    @media(max-width:600px){#muMultiPanel{top:auto;bottom:12px;right:8px;width:min(280px,calc(100vw - 16px));max-height:42vh}#muMultiMessages{height:105px}#muMultiPanel.mu-collapsed{bottom:12px}}
  `;
  document.head.appendChild(style);
  const panel = document.createElement("section");
  panel.id = "muMultiPanel";
  panel.innerHTML = `
    <div id="muMultiHead"><span id="muMultiStatus"></span><span id="muMultiTitle">🌐 MULTIPLAYER BETA</span><span id="muMultiCount">0 online</span><button id="muMultiToggle" aria-label="Minimizar">−</button></div>
    <div id="muMultiBody">
      <div id="muMultiSetup"><input id="muMultiName" maxlength="18" placeholder="Seu nome"><input id="muMultiRoom" maxlength="24" placeholder="Sala" value="Lorencia"><button id="muMultiJoin">Entrar</button></div>
      <div id="muMultiPlayers">Conecte-se para ver jogadores online.</div>
      <div id="muMultiMessages" aria-live="polite"><p class="muMultiMsg muMultiSys">O chat global está pronto. Entre na sala para conversar.</p></div>
      <form id="muMultiCompose"><input id="muMultiText" maxlength="240" autocomplete="off" placeholder="Mensagem..."><button type="submit">Enviar</button></form>
      <div id="muMultiFoot">Chat e presença em tempo real. O motor WASM original ainda roda localmente.</div>
    </div>`;
  document.body.appendChild(panel);
  const $ = id => document.getElementById(id);
  const status = $("muMultiStatus"), count = $("muMultiCount"), players = $("muMultiPlayers"), messages = $("muMultiMessages");
  let socket = null, myId = null, joined = false, reconnectTimer = null, currentRoom = "Lorencia";
  const roster = new Map();
  $("muMultiName").value = sessionStorage.getItem("muMultiName") || ("Player" + Math.floor(100 + Math.random()*900));
  $("muMultiToggle").addEventListener("click", () => {
    panel.classList.toggle("mu-collapsed");
    $("muMultiToggle").textContent = panel.classList.contains("mu-collapsed") ? "+" : "−";
  });
  function addMessage(text, name, system) {
    const p = document.createElement("p"); p.className = "muMultiMsg" + (system ? " muMultiSys" : "");
    if (name) { const b = document.createElement("strong"); b.textContent = name + ": "; p.appendChild(b); }
    p.appendChild(document.createTextNode(text));
    messages.appendChild(p); while (messages.children.length > 80) messages.removeChild(messages.firstChild);
    messages.scrollTop = messages.scrollHeight;
  }
  function renderRoster() {
    count.textContent = roster.size + " online";
    players.textContent = roster.size ? "Jogadores: " + [...roster.values()].map(p => p.name).join(", ") : "Nenhum jogador nesta sala ainda.";
  }
  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    socket = new WebSocket(WS_URL);
    socket.addEventListener("open", () => {
      status.style.background = "#49d17d";
      addMessage("Conexão com servidor estabelecida.", "", true);
      if (joined) sendJoin();
    });
    socket.addEventListener("message", ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "welcome") {
        myId = m.id; roster.clear(); (m.players || []).forEach(p => roster.set(p.id,p)); renderRoster();
        addMessage("Você entrou na sala " + m.room + ".", "", true);
      } else if (m.type === "join") { roster.set(m.player.id,m.player); renderRoster(); }
      else if (m.type === "leave") { roster.delete(m.id); renderRoster(); }
      else if (m.type === "system") addMessage(m.text, "", true);
      else if (m.type === "chat") addMessage(m.text, m.name, false);
      else if (m.type === "error") addMessage(m.message, "", true);
    });
    socket.addEventListener("close", () => {
      status.style.background = "#d74b4b"; myId = null; roster.clear(); renderRoster();
      addMessage("Conexão perdida. Tentando reconectar…", "", true);
      clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 2500);
    });
    socket.addEventListener("error", () => { try { socket.close(); } catch {} });
  }
  function send(data) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
  function sendJoin() {
    send({type:"join",name:$("muMultiName").value,room:currentRoom});
  }
  $("muMultiJoin").addEventListener("click", () => {
    const name = $("muMultiName").value.trim().slice(0,18) || "Player";
    currentRoom = $("muMultiRoom").value.trim().slice(0,24) || "Lorencia";
    $("muMultiName").value = name; sessionStorage.setItem("muMultiName",name); joined = true;
    if (!socket || socket.readyState !== WebSocket.OPEN) connect(); else sendJoin();
  });
  $("muMultiCompose").addEventListener("submit", e => {
    e.preventDefault();
    const input = $("muMultiText"), text = input.value.trim();
    if (!text) return;
    if (!joined) { addMessage("Entre em uma sala antes de enviar mensagens.", "", true); return; }
    if (!socket || socket.readyState !== WebSocket.OPEN) { addMessage("Ainda conectando ao servidor.", "", true); return; }
    send({type:"chat",text}); input.value = "";
  });
  // Keep the service warm and display whether its HTTP health endpoint is reachable.
  connect();
})();
