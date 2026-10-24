(() => {
  // Shared-world overlay for the browser client. The original WASM engine is
  // local-only; this layer synchronizes visible player avatars and movement.
  const WS_URL = "wss://mu-online-multiplayer-gateway.onrender.com/ws";
  const style = document.createElement("style");
  style.textContent = `
    #muMultiPanel{position:fixed;z-index:99999;right:12px;top:74px;width:min(310px,calc(100vw - 24px));max-height:48vh;background:rgba(12,16,25,.94);color:#f5f7ff;border:1px solid #c69b4a;border-radius:12px;box-shadow:0 8px 28px #0008;font:13px system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden;backdrop-filter:blur(8px)}
    #muMultiPanel *{box-sizing:border-box} #muMultiHead{display:flex;align-items:center;gap:8px;padding:9px 10px;background:#1c2637;border-bottom:1px solid #65502d;font-weight:700}
    #muMultiStatus{width:8px;height:8px;border-radius:50%;background:#d74b4b;flex:none}#muMultiTitle{flex:1}#muMultiToggle{border:0;background:transparent;color:#fff;font-size:18px;padding:0 4px}
    #muMultiBody{display:flex;flex-direction:column;min-height:0}#muMultiSetup{display:flex;gap:5px;padding:8px}#muMultiSetup input,#muMultiCompose input{min-width:0;flex:1;background:#0b111b;color:#fff;border:1px solid #48556a;border-radius:6px;padding:8px;font-size:12px}
    #muMultiSetup button,#muMultiCompose button{background:#b8862d;color:#111;border:0;border-radius:6px;padding:7px 10px;font-weight:700}
    #muMultiPlayers{padding:0 9px 7px;color:#b8c8dc;font-size:11px}#muMultiMessages{height:100px;overflow:auto;padding:8px;border-top:1px solid #344052;border-bottom:1px solid #344052;overflow-wrap:anywhere}
    .muMultiMsg{margin:0 0 7px}.muMultiMsg strong{color:#f3ca73}.muMultiSys{color:#93a8c2;font-style:italic}
    #muMultiCompose{display:flex;gap:5px;padding:8px}#muMultiFoot{font-size:10px;color:#8f9db0;padding:0 9px 8px}
    #muMultiPanel.mu-collapsed #muMultiBody{display:none}#muMultiPanel.mu-collapsed{max-height:none;width:auto}
    #muMultiWorld{position:fixed;left:0;top:40px;width:100vw;height:calc(100vh - 40px);z-index:4;pointer-events:none;overflow:hidden}
    .muWorldPlayer{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:1px;min-width:42px;filter:drop-shadow(0 2px 3px #000)}
    .muWorldSprite{width:28px;height:34px;position:relative;display:block}
    .muWorldSprite:before{content:"";position:absolute;left:8px;top:1px;width:12px;height:12px;border:2px solid #ffe4a1;border-radius:4px;background:linear-gradient(135deg,#f4d08a,#97601e);box-shadow:0 0 0 2px #261b16}
    .muWorldSprite:after{content:"";position:absolute;left:4px;top:15px;width:20px;height:15px;border:2px solid #f4d08a;border-radius:4px 4px 2px 2px;background:linear-gradient(90deg,#4a6eac 0 32%,#e7bd69 32% 68%,#4a6eac 68%);box-shadow:0 0 0 1px #241b16}
    .muWorldPlayer.me .muWorldSprite{filter:drop-shadow(0 0 5px #f4ca68)}
    .muWorldName{font:700 10px system-ui,sans-serif;color:#fff;background:#111d;border:1px solid #d6ad60;border-radius:4px;padding:2px 5px;white-space:nowrap;max-width:100px;overflow:hidden;text-overflow:ellipsis}
    @media(max-width:600px){#muMultiPanel{top:auto;bottom:12px;right:8px;width:min(270px,calc(100vw - 16px));max-height:38vh}#muMultiMessages{height:72px}#muMultiWorld{top:40px;height:calc(100dvh - 40px)}.muWorldSprite{transform:scale(.9)}}
  `;
  document.head.appendChild(style);
  const panel = document.createElement("section");
  panel.id = "muMultiPanel";
  panel.innerHTML = `
    <div id="muMultiHead"><span id="muMultiStatus"></span><span id="muMultiTitle">🌐 MU MULTIPLAYER</span><span id="muMultiCount">0 online</span><button id="muMultiToggle" aria-label="Minimizar">−</button></div>
    <div id="muMultiBody">
      <div id="muMultiSetup"><input id="muMultiName" maxlength="18" placeholder="Seu nome"><input id="muMultiRoom" maxlength="24" placeholder="Sala" value="Lorencia"><button id="muMultiJoin">Entrar</button></div>
      <div id="muMultiPlayers">Conectando ao servidor público…</div>
      <div id="muMultiMessages" aria-live="polite"><p class="muMultiMsg muMultiSys">Entre na sala para ver os outros personagens no mapa e conversar.</p></div>
      <form id="muMultiCompose"><input id="muMultiText" maxlength="240" autocomplete="off" placeholder="Mensagem…"><button type="submit">Enviar</button></form>
      <div id="muMultiFoot">Personagens sincronizados na tela • Todos podem entrar na sala Lorencia</div>
    </div>`;
  document.body.appendChild(panel);
  const world = document.createElement("div");
  world.id = "muMultiWorld";
  world.setAttribute("aria-hidden", "true");
  document.body.appendChild(world);
  const $ = id => document.getElementById(id);
  const status = $("muMultiStatus"), count = $("muMultiCount"), players = $("muMultiPlayers"), messages = $("muMultiMessages");
  let socket = null, myId = null, joined = false, reconnectTimer = null, currentRoom = "Lorencia", moveTimer = null;
  const roster = new Map();
  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  $("muMultiName").value = sessionStorage.getItem("muMultiName") || ("Player" + Math.floor(100 + Math.random()*900));
  $("muMultiToggle").addEventListener("click", () => {
    panel.classList.toggle("mu-collapsed");
    $("muMultiToggle").textContent = panel.classList.contains("mu-collapsed") ? "+" : "−";
  });
  function addMessage(text, name, system) {
    const p = document.createElement("p"); p.className = "muMultiMsg" + (system ? " muMultiSys" : "");
    if (name) { const b = document.createElement("strong"); b.textContent = name + ": "; p.appendChild(b); }
    p.appendChild(document.createTextNode(text)); messages.appendChild(p);
    while (messages.children.length > 60) messages.removeChild(messages.firstChild);
    messages.scrollTop = messages.scrollHeight;
  }
  function renderRoster() {
    count.textContent = roster.size + " online";
    players.textContent = roster.size ? "Na sala: " + [...roster.values()].map(p => p.name).join(", ") : "Sala vazia — entre para jogar.";
    for (const [id,p] of roster) renderAvatar(id,p);
    for (const node of [...world.children]) if (!roster.has(node.dataset.playerId)) node.remove();
  }
  function renderAvatar(id,p) {
    let node = world.querySelector('[data-player-id="' + CSS.escape(id) + '"]');
    if (!node) {
      node = document.createElement("div"); node.className = "muWorldPlayer"; node.dataset.playerId = id;
      node.innerHTML = '<span class="muWorldSprite"></span><span class="muWorldName"></span>';
      world.appendChild(node);
    }
    node.classList.toggle("me",id===myId);
    node.querySelector(".muWorldName").textContent = p.name || "Player";
    const rect = world.getBoundingClientRect();
    // Server coordinates are normalized to a shared 1000 x 1000 virtual map.
    node.style.left = (clamp(Number(p.x)||500,0,1000)/1000*rect.width) + "px";
    node.style.top = (clamp(Number(p.y)||620,0,1000)/1000*rect.height) + "px";
    node.style.display = (p.map || "Lorencia") === currentRoom ? "flex" : "none";
  }
  function drawAll() { for (const [id,p] of roster) renderAvatar(id,p); }
  function send(data) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
  function sendJoin() { send({type:"join",name:$("muMultiName").value,room:currentRoom}); }
  function connect() {
    if (socket && (socket.readyState===WebSocket.OPEN || socket.readyState===WebSocket.CONNECTING)) return;
    socket = new WebSocket(WS_URL);
    socket.addEventListener("open", () => {
      status.style.background="#49d17d";
      addMessage("Conectado ao servidor multiplayer público.", "", true);
      if (joined) sendJoin();
    });
    socket.addEventListener("message", ev => {
      let m; try { m=JSON.parse(ev.data); } catch { return; }
      if (m.type==="welcome") {
        myId=m.id; roster.clear();
        (m.players||[]).forEach(p=>roster.set(p.id,p));
        if (!roster.has(myId)) roster.set(myId,{id:myId,name:$("muMultiName").value,x:460+Math.random()*80,y:570+Math.random()*90,map:currentRoom});
        renderRoster(); drawAll();
        addMessage("Você entrou na sala " + m.room + ".", "", true);
        // Publish an initial position so everyone sees this player immediately.
        const spawn=roster.get(myId); send({type:"move",x:spawn.x,y:spawn.y,map:currentRoom});
      } else if (m.type==="join") {
        roster.set(m.player.id,m.player); renderRoster();
        addMessage(m.player.name+" entrou na sala.", "", true);
      } else if (m.type==="leave") {
        roster.delete(m.id); renderRoster();
      } else if (m.type==="move") {
        const p=roster.get(m.id);
        if (p) { p.x=m.x; p.y=m.y; p.map=m.map||p.map; renderAvatar(m.id,p); }
      } else if (m.type==="system") addMessage(m.text,"",true);
      else if (m.type==="chat") addMessage(m.text,m.name,false);
      else if (m.type==="error") addMessage(m.message,"",true);
    });
    socket.addEventListener("close", () => {
      status.style.background="#d74b4b"; myId=null; roster.clear(); renderRoster(); world.innerHTML="";
      addMessage("Conexão perdida. Reconectando…","",true);
      clearTimeout(reconnectTimer); reconnectTimer=setTimeout(connect,2000);
    });
    socket.addEventListener("error", () => { try { socket.close(); } catch (_) {} });
  }
  $("muMultiJoin").addEventListener("click", () => {
    const name=$("muMultiName").value.trim().slice(0,18)||"Player";
    currentRoom=$("muMultiRoom").value.trim().slice(0,24)||"Lorencia";
    $("muMultiName").value=name; $("muMultiRoom").value=currentRoom;
    sessionStorage.setItem("muMultiName",name); joined=true;
    if (!socket||socket.readyState!==WebSocket.OPEN) connect(); else sendJoin();
  });
  $("muMultiCompose").addEventListener("submit",e=>{
    e.preventDefault(); const input=$("muMultiText"),text=input.value.trim();
    if (!text) return;
    if (!joined) { addMessage("Entre na sala antes de conversar.","",true); return; }
    if (!socket||socket.readyState!==WebSocket.OPEN) { addMessage("Conectando ao servidor…","",true); return; }
    send({type:"chat",text}); input.value="";
  });
  // Click/tap on the actual game canvas places the shared avatar at that screen
  // position. The existing game still receives the same click for its own movement.
  const gameCanvas=$("canvas");
  if (gameCanvas) gameCanvas.addEventListener("pointerdown",ev=>{
    if (!joined||!myId||ev.button===2) return;
    const rect=gameCanvas.getBoundingClientRect();
    const x=clamp((ev.clientX-rect.left)/rect.width*1000,0,1000);
    const y=clamp((ev.clientY-rect.top)/rect.height*1000,0,1000);
    const me=roster.get(myId); if (!me) return;
    me.x=x; me.y=y; me.map=currentRoom; renderAvatar(myId,me);
    send({type:"move",x,y,map:currentRoom});
  },{passive:true});
  // Share joystick direction with the server, so all players see movement while
  // the original mobile joystick continues controlling the local WASM client.
  const stick=$("muStick"),knob=$("muStickKnob");
  let stickPid=null,dirX=0,dirY=0;
  function stickPlace(ev) {
    const rect=stick.getBoundingClientRect(),dx=ev.clientX-(rect.left+rect.width/2),dy=ev.clientY-(rect.top+rect.height/2);
    const len=Math.hypot(dx,dy); if(len<7){dirX=dirY=0;return;}
    const scale=Math.min(1,40/len); dirX=dx/len*scale; dirY=dy/len*scale;
  }
  if(stick) {
    stick.addEventListener("pointerdown",ev=>{stickPid=ev.pointerId;stickPlace(ev);},{passive:true});
    stick.addEventListener("pointermove",ev=>{if(ev.pointerId===stickPid)stickPlace(ev);},{passive:true});
    const release=ev=>{if(stickPid!==null && (!ev || ev.pointerId===stickPid)){stickPid=null;dirX=dirY=0;}};
    stick.addEventListener("pointerup",release); stick.addEventListener("pointercancel",release);
  }
  moveTimer=setInterval(()=>{
    if(!joined||!myId||!dirX&&!dirY)return;
    const me=roster.get(myId); if(!me)return;
    me.x=clamp((Number(me.x)||500)+dirX*11,0,1000);
    me.y=clamp((Number(me.y)||620)+dirY*11,0,1000);
    me.map=currentRoom; renderAvatar(myId,me);
    send({type:"move",x:me.x,y:me.y,map:currentRoom});
  },100);
  window.addEventListener("resize",drawAll);
  connect();
})();