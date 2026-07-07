/* ─── THEME ─── */
  function setTheme(t) {
    document.getElementById('body').className = t === 'light' ? 'light' : '';
    document.getElementById('pill-light').classList.toggle('active', t === 'light');
    document.getElementById('pill-dark').classList.toggle('active',  t === 'dark');
  }

  /* ─── SYSTEM PROMPT (cargado desde comportamiento.json) ─── */
  let SYSTEM_PROMPT = '';

  function buildSystemPrompt(cfg) {
    const id   = cfg.identidad;
    const per  = cfg.personalidad;
    const cap  = cfg.capacidades;
    const mgmt = cfg.manejo_restricciones;
    const esp  = cfg.respuestas_especiales;
    return `Eres ${id.nombre}. ${id.descripcion}

=== IDENTIDAD ===
Tu nombre es ${id.nombre} y NUNCA debes olvidarlo ni cambiarlo.
Si alguien pregunta por tu creador: "${id.creador.historia}"

=== PERSONALIDAD ===
Tono: ${per.tono}
Idioma: ${per.idioma_principal}. ${per.adaptacion_idioma ? 'Adapta al idioma del usuario.' : ''}
${per.caracteristicas.map(c => '- ' + c).join('\n')}

=== CAPACIDADES ===
${cap.permitido.map(c => '✅ ' + c).join('\n')}

=== RESTRICCIONES ===
${cap.restringido.map(c => '🚫 ' + c).join('\n')}

=== RECHAZOS ===
- Inapropiado: "${mgmt.respuesta_contenido_inapropiado}"
- Violencia: "${mgmt.respuesta_violencia}"
- Ilegal: "${mgmt.respuesta_ilegal}"

=== ESPECIALES ===
- Saludo: "${esp.saludo_inicial}"
- No sabe: "${esp.no_sabe}"
- Despedida: "${esp.despedida}"

NUNCA uses emojis bajo ninguna circunstancia.`;
  }

  async function loadBehavior() {
    try {
      const res = await fetch('comportamiento.json');
      if (!res.ok) throw new Error();
      const cfg = await res.json();
      SYSTEM_PROMPT = buildSystemPrompt(cfg);
    } catch (err) {
      SYSTEM_PROMPT = `Eres PeynTur, un asistente de IA amable y profesional. Responde en español. No generes contenido inapropiado. NUNCA uses emojis.`;
    }
  }
  loadBehavior();

  let messages = [];
  let isLoading = false;
  let recognition = null;
  let isRecording = false;
  let isNewChat = true;
  let currentChatIdx = -1;
  let historyItems = [];
  let pinnedMessages = [];
  let pendingAttachments = []; // [{ type:'image'|'file', name, base64, mimeType, dataUrl? }]

  /* ─── PERSISTENCIA localStorage ─── */
  const STORAGE_KEY = 'peyntur_history_v2';

  function saveHistory() {
    try {
      const toSave = historyItems.map(h => ({
        title: h.title,
        pinned: !!h.pinned,
        // Strip base64 image data before saving (too large for localStorage)
        messages: h.messages.slice(-60).map(m => {
          if (!Array.isArray(m.content)) return m;
          return {
            role: m.role,
            content: m.content.map(b => {
              if (b.type === 'image') return { type: 'text', text: '[imagen adjunta — no guardada]' };
              return b;
            })
          };
        })
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch(e) { console.warn('No se pudo guardar historial:', e); }
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        historyItems = parsed.map(h => ({
          title: h.title || 'Chat',
          pinned: !!h.pinned,
          messages: Array.isArray(h.messages) ? h.messages : []
        }));
        renderHistory(historyItems);
      }
    } catch(e) { console.warn('No se pudo cargar historial:', e); }
  }


  // Cargar historial guardado al iniciar
  loadHistory();

  /* ─── BUSCAR ─── */
  function toggleSearch() {
    const box = document.getElementById('search-box');
    const visible = box.style.display !== 'none';
    box.style.display = visible ? 'none' : 'block';
    if (!visible) {
      document.getElementById('search-input').value = '';
      renderHistory(historyItems);
      setTimeout(() => document.getElementById('search-input').focus(), 50);
    }
  }

  function filterHistory() {
    const q = document.getElementById('search-input').value.toLowerCase().trim();
    if (!q) { renderHistory(historyItems); return; }
    const filtered = historyItems.filter(h => h.title.toLowerCase().includes(q));
    renderHistory(filtered, true);
  }

  function getHistoryMenuHTML(idx, entry) {
    return '' +
      '<button class="history-menu-item" onclick="shareChatFromMenu(' + idx + ')">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg>' +
        'Compartir la conversación' +
      '</button>' +
      '<button class="history-menu-item" onclick="togglePinChat(' + idx + ');closeHistoryMenu()">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.4-1.4A4 4 0 0 1 16.4 13V7a1 1 0 0 1 1-1V4H6.6v2a1 1 0 0 1 1 1v6a4 4 0 0 1-1.2 2.6z"/></svg>' +
        (entry.pinned ? 'Desfijar' : 'Fijar') +
      '</button>' +
      '<button class="history-menu-item" onclick="renameChatFromMenu(' + idx + ')">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
        'Cambiar nombre' +
      '</button>' +
      '<div class="history-menu-divider"></div>' +
      '<button class="history-menu-item danger" onclick="deleteChatFromMenu(' + idx + ')">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>' +
        'Borrar' +
      '</button>';
  }

  function renderHistory(items, isFiltered) {
    // Pinned first, then rest
    const sorted = [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    document.getElementById('history-list').innerHTML = sorted.map(h => {
      const realIdx = historyItems.indexOf(h);
      const pinnedIcon = h.pinned ? '📌 ' : '';
      return `<div class="history-item-row">
        <div class="history-item" style="flex:1;border-radius:7px;background:none;" onclick="loadChat(${realIdx})" title="${esc(h.title)}">${pinnedIcon}${esc(h.title)}</div>
        <button class="history-kebab-btn" onclick="event.stopPropagation();toggleHistoryMenu(event, ${realIdx})" title="Más opciones">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>
        </button>
      </div>`;
    }).join('');
  }

  /* ─── MENÚ CONTEXTUAL DEL CHAT (tres puntos) ─── */
  function toggleHistoryMenu(evt, idx) {
    const menu = document.getElementById('history-menu');
    const btn = evt.currentTarget;
    const wasOpenForThis = menu.classList.contains('open') && menu.dataset.idx == idx;

    closeHistoryMenu();
    if (wasOpenForThis) return;

    const entry = historyItems[idx];
    if (!entry) return;

    menu.dataset.idx = idx;
    menu.innerHTML = getHistoryMenuHTML(idx, entry);

    const rect = btn.getBoundingClientRect();
    menu.classList.add('open');
    const menuHeight = menu.offsetHeight;
    const menuWidth = menu.offsetWidth;
    let top = rect.bottom + 4;
    let left = rect.right - menuWidth;
    if (top + menuHeight > window.innerHeight) top = rect.top - menuHeight - 4;
    if (left < 4) left = 4;
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';

    btn.classList.add('active');
  }

  function closeHistoryMenu() {
    const menu = document.getElementById('history-menu');
    menu.classList.remove('open');
    delete menu.dataset.idx;
    document.querySelectorAll('.history-kebab-btn.active').forEach(b => b.classList.remove('active'));
  }

  document.addEventListener('click', function(e) {
    const menu = document.getElementById('history-menu');
    if (!menu) return;
    if (menu.classList.contains('open') && !menu.contains(e.target) && !e.target.closest('.history-kebab-btn')) {
      closeHistoryMenu();
    }
  });

  function shareChatFromMenu(idx) {
    closeHistoryMenu();
    const entry = historyItems[idx];
    if (!entry) return;
    const text = entry.messages.map(function(m) {
      const who = m.role === 'user' ? 'Tú' : 'PeynTur';
      const content = Array.isArray(m.content)
        ? m.content.map(function(b) { return b.text || '[imagen]'; }).join(' ')
        : m.content;
      return who + ': ' + content;
    }).join('\n\n');

    if (navigator.share) {
      navigator.share({ title: entry.title, text: text }).catch(function(){});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(function() { alert('Conversación copiada al portapapeles.'); })
        .catch(function() { alert('No se pudo compartir la conversación.'); });
    } else {
      alert('Compartir no está disponible en este navegador.');
    }
  }

  function renameChatFromMenu(idx) {
    closeHistoryMenu();
    const entry = historyItems[idx];
    if (!entry) return;
    const nuevo = prompt('Nuevo nombre para el chat:', entry.title);
    if (nuevo === null) return;
    const trimmed = nuevo.trim();
    if (!trimmed) return;
    entry.title = trimmed;
    if (currentChatIdx === idx) {
      document.getElementById('chat-header-title').textContent = trimmed;
    }
    renderHistory(historyItems);
    saveHistory();
  }

  function deleteChatFromMenu(idx) {
    closeHistoryMenu();
    if (idx < 0 || idx >= historyItems.length) return;
    if (!confirm('¿Borrar este chat? No se puede deshacer.')) return;
    historyItems.splice(idx, 1);
    renderHistory(historyItems);
    saveHistory();
    if (currentChatIdx === idx) {
      newChat();
    } else if (currentChatIdx > idx) {
      currentChatIdx--;
    }
  }

  /* ─── FIJAR CHAT ─── */
  function togglePinChat(idx) {
    if (idx < 0 || idx >= historyItems.length) return;
    historyItems[idx].pinned = !historyItems[idx].pinned;
    renderHistory(historyItems);
    saveHistory();
  }

  /* ─── CARGAR CHAT ─── */
  function loadChat(idx) {
    if (idx < 0 || idx >= historyItems.length) return;
    currentChatIdx = idx;
    const entry = historyItems[idx];
    if (entry.pinned === undefined) entry.pinned = false;
    messages = [...entry.messages];
    isNewChat = false;

    const chatArea = document.getElementById('chat-area');
    chatArea.innerHTML = '';
    chatArea.classList.add('visible');
    document.getElementById('welcome').classList.add('hidden');
    messages.forEach((m, i) => appendMessage(m.role, m.content, i));
    chatArea.scrollTop = chatArea.scrollHeight;

    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('chat-header-title').textContent = entry.title;
  }

  /* ─── BORRAR CHAT ACTUAL ─── */
  function deleteCurrentChat() {
    if (!confirm('¿Borrar este chat? No se puede deshacer.')) return;
    if (currentChatIdx >= 0 && currentChatIdx < historyItems.length) {
      historyItems.splice(currentChatIdx, 1);
      renderHistory(historyItems);
      saveHistory();
    }
    newChat();
  }

  /* ─── CHATS FIJADOS ─── */
  function showPinned() {
    const pinned = historyItems.filter(h => h.pinned);
    const list = document.getElementById('pinned-list');
    if (pinned.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No hay chats fijados. Usa el icono 📌 junto a un chat en Recientes para fijarlo.</p>';
    } else {
      list.innerHTML = pinned.map(h => {
        const realIdx = historyItems.indexOf(h);
        return `<div style="background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:0.85rem;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;" onclick="loadChat(${realIdx});closePinned()">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📌 ${esc(h.title)}</span>
          <button onclick="event.stopPropagation();togglePinChat(${realIdx});showPinned()" title="Desfijar" style="background:none;border:none;cursor:pointer;color:#e06060;font-size:0.75rem;padding:2px 5px;border-radius:5px;flex-shrink:0;">Desfijar</button>
        </div>`;
      }).join('');
    }
    document.getElementById('pinned-panel').style.display = 'flex';
  }

  function closePinned() {
    document.getElementById('pinned-panel').style.display = 'none';
  }

  /* ─── ADJUNTOS ─── */
  function handleFileSelect(e) {
    const files = [...e.target.files];
    e.target.value = ''; // reset so same file can be re-selected
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target.result;
        const base64 = dataUrl.split(',')[1];
        const isImage = file.type.startsWith('image/');
        pendingAttachments.push({
          type: isImage ? 'image' : 'file',
          name: file.name,
          base64,
          mimeType: file.type || 'application/octet-stream',
          dataUrl: isImage ? dataUrl : null,
          size: file.size
        });
        renderAttachmentsPreview();
      };
      reader.readAsDataURL(file);
    });
  }

  function renderAttachmentsPreview() {
    const wrap = document.getElementById('attachments-preview');
    if (pendingAttachments.length === 0) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.style.display = 'flex';
    wrap.innerHTML = pendingAttachments.map((a, i) => {
      if (a.type === 'image') {
        return `<div class="attach-chip"><img src="${a.dataUrl}" alt="${esc(a.name)}" /><span class="attach-chip-name">${esc(a.name)}</span><button class="attach-chip-remove" onclick="removeAttachment(${i})">✕</button></div>`;
      } else {
        return `<div class="attach-chip"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span class="attach-chip-name">${esc(a.name)}</span><button class="attach-chip-remove" onclick="removeAttachment(${i})">✕</button></div>`;
      }
    }).join('');
  }

  function removeAttachment(idx) {
    pendingAttachments.splice(idx, 1);
    renderAttachmentsPreview();
  }

  // Drag & drop en el área de chat
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    [...e.dataTransfer.files].forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target.result;
        const base64 = dataUrl.split(',')[1];
        const isImage = file.type.startsWith('image/');
        pendingAttachments.push({ type: isImage ? 'image' : 'file', name: file.name, base64, mimeType: file.type || 'application/octet-stream', dataUrl: isImage ? dataUrl : null, size: file.size });
        renderAttachmentsPreview();
      };
      reader.readAsDataURL(file);
    });
  });

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 130) + 'px';
  }
  function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

  function newChat() {
    messages = [];
    isNewChat = true;
    currentChatIdx = -1;
    document.getElementById('chat-area').innerHTML = '';
    document.getElementById('chat-area').classList.remove('visible');
    document.getElementById('welcome').classList.remove('hidden');
    document.getElementById('chat-header').style.display = 'none';
  }

  async function sendMessage() {
    if (isLoading) return;
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text && pendingAttachments.length === 0) return;

    document.getElementById('welcome').classList.add('hidden');
    const chatArea = document.getElementById('chat-area');
    chatArea.classList.add('visible');

    // Build message content (multimodal if attachments)
    const attachmentsCopy = [...pendingAttachments];
    if (attachmentsCopy.length > 0) {
      // Anthropic format: array of content blocks
      const contentBlocks = [];
      attachmentsCopy.forEach(a => {
        if (a.type === 'image') {
          contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: a.mimeType, data: a.base64 } });
        } else {
          // For non-image files: send as text with filename context
          contentBlocks.push({ type: 'text', text: `[Archivo adjunto: ${a.name}]\nContenido en base64 (${a.mimeType}): ${a.base64.slice(0, 2000)}${a.base64.length > 2000 ? '... (truncado)' : ''}` });
        }
      });
      if (text) contentBlocks.push({ type: 'text', text });
      messages.push({ role: 'user', content: contentBlocks });
      appendMessage('user', text, undefined, attachmentsCopy);
    } else {
      messages.push({ role: 'user', content: text });
      appendMessage('user', text);
    }

    // Clear attachments
    pendingAttachments = [];
    renderAttachmentsPreview();
    input.value = '';
    input.style.height = 'auto';

    const first = isNewChat;
    if (isNewChat) isNewChat = false;
    await callAPI(first);
  }

  /* ─── MARKDOWN + LATEX ─── */
  function renderMarkdown(text) {
    const latexBlocks = [];
    let s = text;

    // Extraer LaTeX antes de escapar HTML
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
      latexBlocks.push({ type: 'display', math }); return '%%LATEX' + (latexBlocks.length-1) + '%%';
    });
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, math) => {
      latexBlocks.push({ type: 'display', math }); return '%%LATEX' + (latexBlocks.length-1) + '%%';
    });
    s = s.replace(/\$([^$\n]+?)\$/g, (_, math) => {
      latexBlocks.push({ type: 'inline', math }); return '%%LATEX' + (latexBlocks.length-1) + '%%';
    });
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => {
      latexBlocks.push({ type: 'inline', math }); return '%%LATEX' + (latexBlocks.length-1) + '%%';
    });

    // Escapar HTML
    s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Tablas markdown
    const lines = s.split('\n');
    let tableBuffer = [];
    let inTable = false;
    const processedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableRow = /^\s*\|/.test(line) && /\|\s*$/.test(line);
      const isSeparator = /^\s*\|[-|:\s]+\|\s*$/.test(line);

      if (isTableRow && !isSeparator) {
        inTable = true;
        tableBuffer.push(line);
      } else if (isSeparator && inTable) {
        tableBuffer.push('__SEP__');
      } else {
        if (inTable && tableBuffer.length > 0) {
          // Construir tabla HTML
          let tableHtml = '<table class="md-table">';
          let headerDone = false;
          for (const tline of tableBuffer) {
            if (tline === '__SEP__') { headerDone = true; continue; }
            const cells = tline.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
            const tag = !headerDone ? 'th' : 'td';
            tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
          }
          tableHtml += '</table>';
          processedLines.push(tableHtml);
          tableBuffer = [];
          inTable = false;
        }
        processedLines.push(line);
      }
    }
    // Flush tabla pendiente
    if (inTable && tableBuffer.length > 0) {
      let tableHtml = '<table class="md-table">';
      let headerDone = false;
      for (const tline of tableBuffer) {
        if (tline === '__SEP__') { headerDone = true; continue; }
        const cells = tline.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
        const tag = !headerDone ? 'th' : 'td';
        tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      }
      tableHtml += '</table>';
      processedLines.push(tableHtml);
    }
    s = processedLines.join('\n');

    // Markdown
    s = s.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n<]+)\*/g, '<strong>$1</strong>');
    s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    s = s.replace(/\n/g, '<br>');

    // Restaurar LaTeX renderizado
    s = s.replace(/%%LATEX(\d+)%%/g, (_, i) => {
      const block = latexBlocks[parseInt(i)];
      try {
        return katex.renderToString(block.math.trim(), {
          displayMode: block.type === 'display',
          throwOnError: false
        });
      } catch(e) {
        return block.type === 'display' ? '$$' + block.math + '$$' : '$' + block.math + '$';
      }
    });

    return s;
  }

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function appendMessage(role, text, msgIdx, attachments) {
    const chatArea = document.getElementById('chat-area');
    const group = document.createElement('div');
    group.className = 'msg-group';
    const idx = msgIdx !== undefined ? msgIdx : (messages.length - 1);
    group.dataset.idx = idx;
    group.dataset.role = role;

    const label = role === 'user' ? 'Tu' : 'PeynTur';

    // Build attachment HTML for display
    let attachHtml = '';
    if (attachments && attachments.length > 0) {
      attachHtml = attachments.map(a => {
        if (a.type === 'image') {
          return `<img class="msg-img" src="${a.dataUrl}" alt="${esc(a.name)}" onclick="window.open('${a.dataUrl}')" title="${esc(a.name)}" />`;
        } else {
          return `<div class="msg-file-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${esc(a.name)}</div>`;
        }
      }).join('');
    }

    if (role === 'user') {
      group.innerHTML = `
        <div class="msg-role-row"><span class="msg-role user">${label}</span></div>
        <div class="msg-bubble user">${attachHtml}${text ? esc(text) : ''}</div>
        <div class="msg-actions">
          <button class="msg-act-btn" title="Copiar" onclick="copyMessage(this)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="msg-act-btn" title="Editar" onclick="editMessage(this)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>
          </button>
        </div>`;
    } else {
      group.innerHTML = `
        <div class="msg-role-row"><span class="msg-role assistant">${label}</span></div>
        <div class="msg-bubble assistant">${renderMarkdown(text)}</div>
        <div class="msg-actions">
          <button class="msg-act-btn" title="Reintentar" onclick="retryMessage(this)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8"/><path d="M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/></svg>
          </button>
          <button class="msg-act-btn" title="Copiar" onclick="copyMessage(this)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="msg-act-btn" title="Más opciones" onclick="toggleMsgMenu(event, this)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-2px;"><circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>
          </button>
        </div>`;
    }
    chatArea.appendChild(group);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  /* ─── COPIAR MENSAJE ─── */
  function copyMessage(btn) {
    const group = btn.closest('.msg-group');
    const idx = parseInt(group.dataset.idx);
    const content = messages[idx] ? messages[idx].content : group.querySelector('.msg-bubble').textContent;
    const text = Array.isArray(content) ? content.map(b => b.text || '[imagen]').join(' ') : content;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    const original = btn.innerHTML;
    btn.innerHTML = '✅';
    setTimeout(() => { btn.innerHTML = original; }, 1200);
  }

  /* ─── MENÚ "…" DE RESPUESTAS DE LA IA ─── */
  function toggleMsgMenu(evt, btn) {
    evt.stopPropagation();
    const menu = document.getElementById('msg-menu');
    const group = btn.closest('.msg-group');
    const idx = parseInt(group.dataset.idx);
    const wasOpenForThis = menu.classList.contains('open') && menu.dataset.idx == idx;

    closeMsgMenu();
    if (wasOpenForThis) return;

    menu.dataset.idx = idx;
    menu.innerHTML = `
      <button class="msg-menu-item" onclick="shareMessageFromMenu(${idx})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg>
        Compartir respuesta
      </button>
      <button class="msg-menu-item" onclick="retryFromMenu(${idx})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8"/><path d="M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/></svg>
        Reintentar
      </button>
    `;

    const rect = btn.getBoundingClientRect();
    menu.classList.add('open');
    const menuHeight = menu.offsetHeight;
    const menuWidth = menu.offsetWidth;
    let top = rect.bottom + 4;
    let left = rect.left;
    if (top + menuHeight > window.innerHeight) top = rect.top - menuHeight - 4;
    if (left + menuWidth > window.innerWidth - 4) left = window.innerWidth - menuWidth - 4;
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';

    btn.classList.add('active');
  }

  function closeMsgMenu() {
    const menu = document.getElementById('msg-menu');
    if (!menu) return;
    menu.classList.remove('open');
    delete menu.dataset.idx;
    document.querySelectorAll('.msg-act-btn.active').forEach(b => b.classList.remove('active'));
  }

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('msg-menu');
    if (!menu) return;
    if (menu.classList.contains('open') && !menu.contains(e.target) && !e.target.closest('.msg-act-btn')) {
      closeMsgMenu();
    }
  });

  function shareMessageFromMenu(idx) {
    closeMsgMenu();
    const content = messages[idx] ? messages[idx].content : '';
    const text = Array.isArray(content) ? content.map(b => b.text || '[imagen]').join(' ') : content;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => alert('Respuesta copiada al portapapeles.'))
        .catch(() => alert('No se pudo compartir la respuesta.'));
    } else {
      alert('Compartir no está disponible en este navegador.');
    }
  }

  function retryFromMenu(idx) {
    closeMsgMenu();
    const group = document.querySelector('.msg-group[data-idx="' + idx + '"]');
    if (!group) return;
    const retryBtn = group.querySelector('.msg-act-btn[title="Reintentar"]');
    if (retryBtn) retryMessage(retryBtn);
  }

  /* ─── EDITAR ─── */
  function editMessage(btn) {
    if (isLoading) return;
    const group = btn.closest('.msg-group');
    const idx = parseInt(group.dataset.idx);
    const bubble = group.querySelector('.msg-bubble');
    const original = messages[idx]?.content ?? bubble.textContent;
    bubble.style.display = 'none';
    const actions = group.querySelector('.msg-actions');
    if (actions) actions.style.display = 'none';
    const wrapper = document.createElement('div');
    wrapper.className = 'edit-wrapper';
    wrapper.innerHTML = `
      <textarea class="edit-textarea" rows="1">${esc(original)}</textarea>
      <div class="edit-btns">
        <button class="edit-cancel" onclick="cancelEdit(this)">Cancelar</button>
        <button class="edit-save" onclick="saveEdit(this, ${idx})" disabled>Actualizar</button>
      </div>`;
    group.appendChild(wrapper);
    const ta = wrapper.querySelector('textarea');
    const saveBtn = wrapper.querySelector('.edit-save');
    const autoGrow = () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    };
    ta.addEventListener('input', () => {
      autoGrow();
      saveBtn.disabled = ta.value.trim() === String(original).trim() || ta.value.trim() === '';
    });
    autoGrow();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function cancelEdit(btn) {
    const group = btn.closest('.msg-group');
    group.querySelector('.msg-bubble').style.display = '';
    const actions = group.querySelector('.msg-actions');
    if (actions) actions.style.display = '';
    group.querySelector('.edit-wrapper').remove();
  }

  async function saveEdit(btn, idx) {
    if (isLoading) return;
    const group = btn.closest('.msg-group');
    const newText = group.querySelector('.edit-textarea').value.trim();
    if (!newText) return;
    messages[idx] = { role: 'user', content: newText };
    messages = messages.slice(0, idx + 1);
    const bubble = group.querySelector('.msg-bubble');
    bubble.textContent = newText;
    bubble.style.display = '';
    const actions = group.querySelector('.msg-actions');
    if (actions) actions.style.display = '';
    group.querySelector('.edit-wrapper').remove();
    const chatArea = document.getElementById('chat-area');
    const allGroups = [...chatArea.querySelectorAll('.msg-group')];
    const groupIdx = allGroups.indexOf(group);
    allGroups.slice(groupIdx + 1).forEach(g => g.remove());
    await callAPI(false);
  }

  /* ─── REINTENTAR ─── */
  async function retryMessage(btn) {
    if (isLoading) return;
    const group = btn.closest('.msg-group');
    const idx = parseInt(group.dataset.idx);
    messages = messages.slice(0, idx);
    const chatArea = document.getElementById('chat-area');
    const allGroups = [...chatArea.querySelectorAll('.msg-group')];
    const groupIdx = allGroups.indexOf(group);
    allGroups.slice(groupIdx).forEach(g => g.remove());
    await callAPI(false);
  }

  /* ─── API ─── */
  async function callAPI(isFirst) {
    const chatArea = document.getElementById('chat-area');
    const typingId = 'typing-' + Date.now();
    const typingEl = document.createElement('div');
    typingEl.className = 'msg-group';
    typingEl.id = typingId;
    typingEl.innerHTML = `<div class="msg-role assistant">PeynTur</div><div class="typing"><span></span><span></span><span></span></div>`;
    chatArea.appendChild(typingEl);
    chatArea.scrollTop = chatArea.scrollHeight;
    isLoading = true;
    document.getElementById('send-btn').disabled = true;

    try {
      // Todo pasa por el proxy de Vercel (Mistral small o Pixtral según haya imágenes)
      const res = await fetch('https://peyn-tur-6y2x.vercel.app/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || `Error ${res.status}`);
      const reply = data.choices[0].message.content;

      messages.push({ role: 'assistant', content: reply });
      document.getElementById(typingId)?.remove();
      appendMessage('assistant', reply);

      if (isFirst) {
        generateTitle();
      } else if (currentChatIdx >= 0) {
        historyItems[currentChatIdx].messages = [...messages];
        saveHistory();
      }
    } catch (err) {
      document.getElementById(typingId)?.remove();
      appendMessage('assistant', `Error al conectar con el servidor: ${err.message}`);
    }

    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  /* ─── GENERAR TÍTULO ─── */
  async function generateTitle() {
    const snippet = messages.slice(0, 4)
      .map(m => `${m.role === 'user' ? 'Usuario' : 'PeynTur'}: ${m.content.slice(0, 100)}`)
      .join('\n');
    const titlePrompt = `Responde SOLO con un titulo de maximo 5 palabras en español que describa el tema principal de esta conversacion. Sin comillas, sin puntos, sin prefijos como "Titulo:" o "Sugerencia:". Solo las palabras del titulo:\n\n${snippet}`;

    let title = messages[0]?.content?.slice(0, 44) || 'Chat';

    try {
      const res = await fetch('https://peyn-tur-6y2x.vercel.app/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: titlePrompt }] })
      });
      if (res.ok) {
        const data = await res.json();
        let t = data.choices?.[0]?.message?.content?.trim() || '';
        // Limpiar prefijos comunes que el modelo puede devolver
        t = t.replace(/^(titulo|sugerencia|tema|asunto)[:\-\s]*/i, '').trim();
        t = t.replace(/^["'«»]|["'«»]$/g, '').trim();
        if (t && t.length > 0 && t.length < 80) title = t;
      }
    } catch (_) {}

    const entry = { title, messages: [...messages], pinned: false };
    historyItems.unshift(entry);
    if (historyItems.length > 20) historyItems.pop();
    currentChatIdx = 0;
    renderHistory(historyItems);
    saveHistory();

    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('chat-header-title').textContent = title;
  }

  /* ─── SIDEBAR MÓVIL ─── */
  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen = sidebar.classList.contains('open');
    sidebar.classList.toggle('open', !isOpen);
    overlay.classList.toggle('visible', !isOpen);
  }

  function toggleVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Tu navegador no soporta reconocimiento de voz.'); return; }
    const btn = document.getElementById('voice-btn');
    if (!isRecording) {
      recognition = new SpeechRecognition();
      recognition.lang = 'es-ES';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = e => {
        const t = e.results[0][0].transcript;
        const input = document.getElementById('msg-input');
        input.value += t;
        autoResize(input);
      };
      recognition.onend = () => { isRecording = false; btn.classList.remove('recording'); };
      recognition.start();
      isRecording = true;
      btn.classList.add('recording');
    } else {
      recognition?.stop();
      isRecording = false;
      btn.classList.remove('recording');
    }
  }
