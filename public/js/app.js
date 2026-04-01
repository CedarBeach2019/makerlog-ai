/* makerlog-ai — app.js — Vanilla JS IDE logic, no external deps */

(function () {
  'use strict';

  // ===== Global State =====
  const state = {
    openFiles: [],
    activeFile: null,
    chatHistory: [],
    terminalHistory: [],
    termHistoryIdx: -1,
    splitView: false,
    splitFile: null,
    totalTokens: 0,
    totalCost: 0,
    connected: false,
    streaming: false,
    treeData: null,
    contextTarget: null,
    terminalCollapsed: false,
  };

  // ===== Utilities =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = {
      js: ['\u{1F4C4}', 'file-js'], mjs: ['\u{1F4C4}', 'file-js'],
      ts: ['\u{1F4C4}', 'file-ts'], tsx: ['\u{1F4C4}', 'file-ts'],
      json: ['\u{1F4C4}', 'file-json'],
      md: ['\u{1F4C4}', 'file-md'], txt: ['\u{1F4C4}', 'file-md'],
      css: ['\u{1F4C4}', 'file-css'],
      html: ['\u{1F4C4}', 'file-html'], htm: ['\u{1F4C4}', 'file-html']
    };
    return map[ext] || ['\u{1F4C4}', 'file-default'];
  }

  function timeStr() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ===== Syntax Highlighting =====
  const highlightRules = {
    js: [
      [/(\/\/.*$)/gm, 'tok-comment'],
      [/\/\*[\s\S]*?\*\//gm, 'tok-comment'],
      [/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/gm, 'tok-string'],
      [/\b(true|false)\b/g, 'tok-bool'],
      [/\b(null|undefined|NaN|Infinity)\b/g, 'tok-null'],
      [/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, 'tok-number'],
      [/\b(const|let|var|function|class|extends|return|if|else|for|while|do|switch|case|break|continue|new|this|typeof|instanceof|import|export|from|default|async|await|try|catch|finally|throw|yield|of|in|delete|void|with|static|get|set|super)\b/g, 'tok-keyword'],
      [/(\b\w+)(?=\s*\()/g, 'tok-function'],
      [/\b(console|document|window|Math|JSON|Array|Object|String|Number|Boolean|Date|Promise|Map|Set|Error|RegExp)\b/g, 'tok-type'],
    ],
    ts: [
      [/(\/\/.*$)/gm, 'tok-comment'],
      [/\/\*[\s\S]*?\*\//gm, 'tok-comment'],
      [/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/gm, 'tok-string'],
      [/\b(true|false)\b/g, 'tok-bool'],
      [/\b(null|undefined|NaN|Infinity)\b/g, 'tok-null'],
      [/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, 'tok-number'],
      [/\b(const|let|var|function|class|extends|return|if|else|for|while|do|switch|case|break|continue|new|this|typeof|instanceof|import|export|from|default|async|await|try|catch|finally|throw|yield|of|in|delete|void|with|static|get|set|super|interface|type|enum|namespace|implements|declare|abstract|as|is|keyof|readonly|never|unknown|any|public|private|protected)\b/g, 'tok-keyword'],
      [/(\b\w+)(?=\s*[\(<])/g, 'tok-function'],
      [/\b(string|number|boolean|void|object|any|unknown|never|undefined|null|Record|Partial|Required|Omit|Pick|Array|Promise|Map|Set)\b/g, 'tok-type'],
      [/(:\s*)(\w+)/g, '$1<span class="tok-type">$2</span>'],
    ],
    json: [
      [/("(?:[^"\\]|\\.)*")\s*:/gm, '<span class="tok-property">$1</span>:'],
      [/:\s*("(?:[^"\\]|\\.)*")/gm, ': <span class="tok-string">$1</span>'],
      [/\b(true|false)\b/g, 'tok-bool'],
      [/\b(null)\b/g, 'tok-null'],
      [/\b(-?\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, 'tok-number'],
    ],
    md: [
      [/^(#{1,6}\s.*)$/gm, 'tok-heading'],
      [/\*\*(.+?)\*\*/g, '<span class="tok-bold">**$1**</span>'],
      [/\*(.+?)\*/g, '<span class="tok-italic">*$1*</span>'],
      [/`([^`]+)`/g, '<span class="tok-string">`$1`</span>'],
      [/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="tok-link">[$1]($2)</span>'],
    ],
    css: [
      [/(\/\*[\s\S]*?\*\/)/gm, 'tok-comment'],
      [/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gm, 'tok-string'],
      [/([.#][\w-]+)/g, 'tok-function'],
      [/\b(\d+\.?\d*)(px|em|rem|%|vh|vw|fr|s|ms|deg|fr)\b/g, 'tok-number'],
      [/([a-z-]+)(\s*:)/g, '<span class="tok-property">$1</span>$2'],
    ],
    html: [
      [/(&lt;!--[\s\S]*?--&gt;)/gm, 'tok-comment'],
      [/(&lt;\/?)([\w-]+)/g, '$1<span class="tok-tag">$2</span>'],
      [/\b([\w-]+)(=)/g, '<span class="tok-attr">$1</span>$2'],
      [/("(?:[^"\\]|\\.)*")/g, 'tok-string'],
    ]
  };

  function highlightCode(text, ext) {
    let html = escapeHtml(text);
    const rules = highlightRules[ext] || highlightRules.js;

    // For JSON we need special handling since we already escaped
    if (ext === 'json') {
      html = text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      rules.forEach(([regex, cls]) => {
        if (typeof cls === 'string' && cls.includes('$')) {
          html = html.replace(regex, cls);
        } else {
          html = html.replace(regex, (match) => `<span class="${cls}">${match}</span>`);
        }
      });
      return html;
    }

    // Tokenize approach: replace matches with placeholders, then restore
    const tokens = [];
    rules.forEach(([regex, cls]) => {
      html = html.replace(regex, (match) => {
        const idx = tokens.length;
        if (typeof cls === 'string' && cls.includes('$')) {
          tokens.push(match.replace(regex, cls));
        } else {
          tokens.push(`<span class="${cls}">${match}</span>`);
        }
        return `\x00T${idx}\x00`;
      });
    });

    tokens.forEach((tok, i) => {
      html = html.replace(`\x00T${i}\x00`, tok);
    });

    return html;
  }

  function getExt(path) {
    const name = path.split('/').pop();
    return name.split('.').pop().toLowerCase();
  }

  // ===== FileTree Class =====
  class FileTree {
    constructor(containerEl) {
      this.el = containerEl;
      this.expanded = new Set();
      this.initEvents();
    }

    initEvents() {
      this.el.addEventListener('click', (e) => {
        const item = e.target.closest('.tree-item');
        if (!item) return;
        const path = item.dataset.path;
        const isDir = item.dataset.dir === 'true';
        if (isDir) {
          this.toggleFolder(path);
        } else {
          this.openFile(path);
        }
      });

      this.el.addEventListener('contextmenu', (e) => {
        const item = e.target.closest('.tree-item');
        if (!item) return;
        e.preventDefault();
        state.contextTarget = item.dataset.path;
        const menu = $('#context-menu');
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.classList.add('visible');
      });

      $('#btn-new-file').addEventListener('click', () => this.promptNew('file'));
      $('#btn-new-folder').addEventListener('click', () => this.promptNew('folder'));
    }

    async load(path) {
      try {
        const res = await fetch('/api/files?path=' + encodeURIComponent(path || ''));
        const data = await res.json();
        state.treeData = data;
        this.render(data);
      } catch (err) {
        console.error('[FileTree] load error:', err);
      }
    }

    render(tree, parentPath, depth) {
      depth = depth || 0;
      parentPath = parentPath || '';
      let html = '';

      const dirs = (tree.directories || []).sort((a, b) => a.name.localeCompare(b.name));
      const files = (tree.files || []).sort((a, b) => a.name.localeCompare(b.name));

      dirs.forEach((dir) => {
        const fullPath = parentPath ? parentPath + '/' + dir.name : dir.name;
        const isOpen = this.expanded.has(fullPath);
        html += `<div class="tree-item" data-path="${escapeHtml(fullPath)}" data-dir="true" style="padding-left:${depth * 16 + 8}px">`;
        html += `<span class="chevron${isOpen ? ' open' : ''}">\u25B6</span>`;
        html += `<span class="icon folder">\u{1F4C1}</span>`;
        html += `<span class="name">${escapeHtml(dir.name)}</span>`;
        html += `</div>`;
        if (isOpen && dir.children) {
          html += this.render(dir.children, fullPath, depth + 1);
        }
      });

      files.forEach((file) => {
        const fullPath = parentPath ? parentPath + '/' + file.name : file.name;
        const [icon, cls] = fileIcon(file.name);
        const active = state.activeFile === fullPath ? ' active' : '';
        html += `<div class="tree-item${active}" data-path="${escapeHtml(fullPath)}" data-dir="false" style="padding-left:${depth * 16 + 24}px">`;
        html += `<span class="icon ${cls}">${icon}</span>`;
        html += `<span class="name">${escapeHtml(file.name)}</span>`;
        html += `</div>`;
      });

      if (depth === 0) {
        this.el.innerHTML = html;
      }
      return html;
    }

    toggleFolder(path) {
      if (this.expanded.has(path)) {
        this.expanded.delete(path);
      } else {
        this.expanded.add(path);
      }
      this.load('');
    }

    openFile(path) {
      editor.openFile(path);
    }

    promptNew(type) {
      const name = prompt(type === 'file' ? 'New file name:' : 'New folder name:');
      if (!name || !name.trim()) return;
      const parentPath = state.contextTarget || '';
      const fullPath = parentPath ? parentPath + '/' + name.trim() : name.trim();
      if (type === 'file') {
        editor.createNewFile(fullPath);
      }
      // Refresh tree
      this.load('');
    }
  }

  // ===== Editor Class =====
  class Editor {
    constructor() {
      this.panes = {
        primary: { el: $('#editor-pane-primary'), codeEl: $('#code-view-primary'), file: null },
        secondary: { el: $('#editor-pane-secondary'), codeEl: $('#code-view-secondary'), file: null }
      };
      this.contents = {};
      this.dirty = new Set();
      this.initEvents();
    }

    initEvents() {
      $('#btn-save').addEventListener('click', () => this.saveCurrent());
      $('#btn-split').addEventListener('click', () => this.toggleSplit());
      $('#btn-compare').addEventListener('click', () => this.compareBranches());

      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          this.saveCurrent();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
          e.preventDefault();
          if (state.activeFile) this.closeTab(state.activeFile);
        }
      });
    }

    async openFile(path) {
      // Check if already open
      if (state.openFiles.includes(path)) {
        this.switchToTab(path);
        return;
      }

      try {
        const res = await fetch('/api/files/content?path=' + encodeURIComponent(path));
        const data = await res.json();
        const content = data.content || '';
        this.contents[path] = content;

        state.openFiles.push(path);
        state.activeFile = path;
        this.renderTabs();
        this.renderCode(content, path);
        fileTree.load(''); // refresh active highlight
      } catch (err) {
        term.write('Error opening file: ' + path + ' — ' + err.message, 'error');
      }
    }

    async createNewFile(path) {
      this.contents[path] = '';
      state.openFiles.push(path);
      state.activeFile = path;
      this.dirty.add(path);
      this.renderTabs();
      this.renderCode('', path);
      await this.saveFile(path);
    }

    renderTabs() {
      const bar = $('#tab-bar');
      bar.innerHTML = state.openFiles.map((path) => {
        const name = path.split('/').pop();
        const [icon] = fileIcon(name);
        const active = path === state.activeFile ? ' active' : '';
        const dirty = this.dirty.has(path) ? '<span class="dirty-dot"></span>' : '';
        return `<div class="tab${active}" data-path="${escapeHtml(path)}">`
          + `<span class="tab-icon">${icon}</span>`
          + `<span class="tab-name">${escapeHtml(name)}</span>`
          + dirty
          + `<span class="tab-close" data-close="${escapeHtml(path)}">&times;</span>`
          + `</div>`;
      }).join('');

      // Tab click handlers
      bar.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', (e) => {
          if (e.target.classList.contains('tab-close')) {
            this.closeTab(e.target.dataset.close);
            return;
          }
          this.switchToTab(tab.dataset.path);
        });
      });
    }

    switchToTab(path) {
      if (!state.openFiles.includes(path)) return;
      state.activeFile = path;
      this.renderTabs();
      this.renderCode(this.contents[path] || '', path);
      fileTree.load('');
    }

    closeTab(path) {
      const idx = state.openFiles.indexOf(path);
      if (idx === -1) return;

      if (this.dirty.has(path)) {
        if (!confirm('Unsaved changes in ' + path.split('/').pop() + '. Close anyway?')) return;
      }

      state.openFiles.splice(idx, 1);
      delete this.contents[path];
      this.dirty.delete(path);

      if (state.activeFile === path) {
        state.activeFile = state.openFiles.length > 0
          ? state.openFiles[Math.min(idx, state.openFiles.length - 1)]
          : null;
      }

      this.renderTabs();
      if (state.activeFile) {
        this.renderCode(this.contents[state.activeFile] || '', state.activeFile);
      } else {
        this.showEmpty();
      }
    }

    renderCode(content, path) {
      const ext = getExt(path);
      const lines = content.split('\n');
      const highlighted = highlightCode(content, ext);
      const hLines = highlighted.split('\n');

      const pane = state.splitView && state.splitFile && state.splitFile !== path
        ? 'secondary'
        : 'primary';

      const paneObj = this.panes[pane];
      let html = '';
      for (let i = 0; i < hLines.length; i++) {
        html += `<div class="code-line">`
          + `<span class="line-number">${i + 1}</span>`
          + `<span class="line-content">${hLines[i] || ' '}</span>`
          + `</div>`;
      }
      paneObj.codeEl.innerHTML = html;
      paneObj.el.classList.remove('hidden');
      paneObj.file = path;

      if (pane === 'primary' && !state.splitView) {
        this.panes.secondary.el.classList.add('hidden');
      }

      $('#editor-empty').style.display = 'none';
      $('#toolbar-file-info').textContent = path + ' — ' + lines.length + ' lines';
    }

    showEmpty() {
      $('#editor-empty').style.display = '';
      this.panes.primary.el.classList.add('hidden');
      this.panes.secondary.el.classList.add('hidden');
      $('#toolbar-file-info').textContent = '';
    }

    markDirty(path) {
      if (!this.dirty.has(path)) {
        this.dirty.add(path);
        this.renderTabs();
      }
    }

    async saveCurrent() {
      if (!state.activeFile) return;
      await this.saveFile(state.activeFile);
    }

    async saveFile(path) {
      const content = this.contents[path];
      if (content === undefined) return;
      try {
        await fetch('/api/files/content', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content })
        });
        this.dirty.delete(path);
        this.renderTabs();
        term.write('Saved: ' + path, 'success');
      } catch (err) {
        term.write('Save failed: ' + err.message, 'error');
      }
    }

    toggleSplit() {
      state.splitView = !state.splitView;
      if (state.splitView) {
        if (state.openFiles.length >= 2) {
          state.splitFile = state.openFiles.find(f => f !== state.activeFile) || state.activeFile;
          this.renderCode(this.contents[state.splitFile] || '', state.splitFile);
        }
        $('#btn-split').classList.add('primary');
      } else {
        this.panes.secondary.el.classList.add('hidden');
        this.panes.secondary.file = null;
        state.splitFile = null;
        $('#btn-split').classList.remove('primary');
      }
    }

    compareBranches() {
      chat.sendCommand('/compare-branches');
    }
  }

  // ===== Chat Class =====
  class Chat {
    constructor() {
      this.el = $('#chat-messages');
      this.input = $('#chat-input');
      this.sendBtn = $('#chat-send');
      this.eventSource = null;
      this.initEvents();
    }

    initEvents() {
      this.sendBtn.addEventListener('click', () => this.send());
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.send();
        }
      });
      // Auto-resize textarea
      this.input.addEventListener('input', () => {
        this.input.style.height = 'auto';
        this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
      });

      $('#btn-chat-clear').addEventListener('click', () => this.clear());
    }

    async send() {
      const text = this.input.value.trim();
      if (!text) return;

      // Handle commands
      if (text.startsWith('/')) {
        this.handleCommand(text);
        this.input.value = '';
        this.input.style.height = 'auto';
        return;
      }

      this.addMessage('user', text);
      state.chatHistory.push({ role: 'user', content: text });
      this.input.value = '';
      this.input.style.height = 'auto';
      this.sendBtn.disabled = true;
      state.streaming = true;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: state.chatHistory.slice(-20) })
        });

        const contentType = res.headers.get('Content-Type') || '';

        if (contentType.includes('text/event-stream')) {
          this.handleStream(res);
        } else {
          const data = await res.json();
          const reply = data.content || data.message || data.reply || '(no response)';
          this.addMessage('agent', reply);
          state.chatHistory.push({ role: 'assistant', content: reply });
          if (data.tokens) status.updateTokens(data.tokens);
          if (data.cost) status.updateCost(data.cost);
        }
      } catch (err) {
        this.addMessage('system', 'Error: ' + err.message);
      } finally {
        this.sendBtn.disabled = false;
        state.streaming = false;
      }
    }

    async handleStream(res) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let agentMsg = '';
      const msgEl = this.addMessage('agent', '', true);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // Parse SSE lines
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.content || parsed.delta || parsed.text || '';
                agentMsg += delta;
                msgEl.textContent = agentMsg;
                this.scrollToBottom();
              } catch {
                // plain text delta
                agentMsg += data;
                msgEl.textContent = agentMsg;
                this.scrollToBottom();
              }
            }
          }
        }
      } catch (err) {
        agentMsg += '\n[stream interrupted]';
      }

      msgEl.classList.remove('streaming-cursor');
      // Add timestamp
      const timeEl = document.createElement('div');
      timeEl.className = 'msg-time';
      timeEl.textContent = timeStr();
      msgEl.appendChild(timeEl);

      state.chatHistory.push({ role: 'assistant', content: agentMsg });
    }

    addMessage(role, text, isStreaming) {
      const div = document.createElement('div');
      div.className = 'chat-msg ' + role;
      if (isStreaming) div.classList.add('streaming-cursor');
      div.textContent = text;
      if (!isStreaming && text) {
        const timeEl = document.createElement('div');
        timeEl.className = 'msg-time';
        timeEl.textContent = timeStr();
        div.appendChild(timeEl);
      }
      this.el.appendChild(div);
      this.scrollToBottom();
      return div;
    }

    scrollToBottom() {
      this.el.scrollTop = this.el.scrollHeight;
    }

    clear() {
      this.el.innerHTML = '';
      state.chatHistory = [];
      this.addMessage('system', 'Chat cleared');
    }

    handleCommand(cmd) {
      const parts = cmd.split(' ');
      const base = parts[0].toLowerCase();

      switch (base) {
        case '/help':
          this.addMessage('system',
            'Commands:\n/help — Show commands\n/clear — Clear chat\n/model <name> — Switch model\n/provider <name> — Switch provider\n/compare-branches — Compare git branches');
          break;
        case '/clear':
          this.clear();
          break;
        case '/model':
          if (parts[1]) {
            status.updateModel(parts.slice(1).join(' '));
            this.addMessage('system', 'Model set to: ' + parts.slice(1).join(' '));
          } else {
            this.addMessage('system', 'Usage: /model <model-name>');
          }
          break;
        case '/provider':
          if (parts[1]) {
            status.updateProvider(parts[1]);
            this.addMessage('system', 'Provider set to: ' + parts[1]);
          } else {
            this.addMessage('system', 'Usage: /provider <provider-name>');
          }
          break;
        case '/compare-branches':
          this.addMessage('user', cmd);
          this.sendToAgent('Compare the current git branches and summarize the differences.');
          break;
        default:
          this.addMessage('system', 'Unknown command: ' + base + '. Type /help for available commands.');
      }
    }

    sendCommand(cmd) {
      this.handleCommand(cmd);
    }

    async sendToAgent(message) {
      this.sendBtn.disabled = true;
      state.streaming = true;
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history: state.chatHistory.slice(-20) })
        });
        const data = await res.json();
        const reply = data.content || data.message || data.reply || '(no response)';
        this.addMessage('agent', reply);
        state.chatHistory.push({ role: 'assistant', content: reply });
      } catch (err) {
        this.addMessage('system', 'Error: ' + err.message);
      } finally {
        this.sendBtn.disabled = false;
        state.streaming = false;
      }
    }
  }

  // ===== Terminal Class =====
  class Terminal {
    constructor() {
      this.output = $('#terminal-output');
      this.input = $('#terminal-input');
      this.collapsed = false;
      this.initEvents();
      this.write('Makerlog AI Terminal ready', 'info');
    }

    initEvents() {
      // Toggle collapse on header click
      const header = $('#terminal-header');
      if (header) {
        header.style.cursor = 'pointer';
        header.addEventListener('dblclick', () => this.toggleCollapse());
      }

      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const cmd = this.input.value.trim();
          if (!cmd) return;
          state.terminalHistory.push(cmd);
          state.termHistoryIdx = state.terminalHistory.length;
          this.write('$ ' + cmd, '');
          this.execute(cmd);
          this.input.value = '';
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (state.termHistoryIdx > 0) {
            state.termHistoryIdx--;
            this.input.value = state.terminalHistory[state.termHistoryIdx] || '';
          }
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (state.termHistoryIdx < state.terminalHistory.length - 1) {
            state.termHistoryIdx++;
            this.input.value = state.terminalHistory[state.termHistoryIdx] || '';
          } else {
            state.termHistoryIdx = state.terminalHistory.length;
            this.input.value = '';
          }
        }
      });
    }

    async execute(command) {
      try {
        const res = await fetch('/api/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command })
        });
        const data = await res.json();
        if (data.stdout) this.write(data.stdout, data.exitCode === 0 ? 'success' : 'error');
        if (data.stderr) this.write(data.stderr, 'error');
        if (!data.stdout && !data.stderr) this.write('(no output)', 'info');
      } catch (err) {
        this.write('Execution error: ' + err.message, 'error');
      }
    }

    write(text, cls) {
      const line = document.createElement('div');
      line.className = 'term-line' + (cls ? ' ' + cls : '');
      line.textContent = text;
      this.output.appendChild(line);
      this.output.scrollTop = this.output.scrollHeight;
    }

    toggleCollapse() {
      this.collapsed = !this.collapsed;
      const area = $('#terminal-area');
      if (this.collapsed) {
        area.style.height = '32px';
        area.style.overflow = 'hidden';
      } else {
        area.style.height = '';
        area.style.overflow = '';
      }
    }
  }

  // ===== StatusBar Class =====
  class StatusBar {
    constructor() {
      this.dotEl = $('#status-dot');
      this.connEl = $('#status-connection');
      this.providerEl = $('#status-provider');
      this.modelEl = $('#status-model');
      this.tokensEl = $('#status-tokens');
      this.costEl = $('#status-cost');
    }

    async poll() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        this.updateConnection(data.status || 'disconnected');
        this.updateProvider(data.provider || '—');
        this.updateModel(data.model || '—');
        if (data.tokens) this.updateTokens(data.tokens);
        if (data.cost) this.updateCost(data.cost);
        state.connected = data.status === 'connected';

        // Fetch cost analytics
        try {
          const costRes = await fetch('/api/analytics/costs');
          if (costRes.ok) {
            const costData = await costRes.json();
            if (costData.totalCost !== undefined) {
              state.totalCost = costData.totalCost;
              this.costEl.textContent = 'Cost: $' + state.totalCost.toFixed(4);
            }
            if (costData.totalTokens !== undefined) {
              state.totalTokens = costData.totalTokens;
              this.tokensEl.textContent = 'Tokens: ' + state.totalTokens.toLocaleString();
            }
          }
        } catch { /* analytics optional */ }
      } catch {
        this.updateConnection('disconnected');
        state.connected = false;
      }
    }

    updateConnection(status) {
      this.dotEl.className = 'dot ' + status;
      const labels = { connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting...' };
      this.connEl.textContent = labels[status] || status;
    }

    updateProvider(name) {
      this.providerEl.textContent = 'Provider: ' + name;
    }

    updateModel(name) {
      this.modelEl.textContent = 'Model: ' + name;
    }

    updateTokens(count) {
      state.totalTokens += count;
      this.tokensEl.textContent = 'Tokens: ' + state.totalTokens.toLocaleString();
    }

    updateCost(cost) {
      state.totalCost += cost;
      this.costEl.textContent = 'Cost: $' + state.totalCost.toFixed(4);
    }
  }

  // ===== Settings Modal =====
  function initSettings() {
    const modal = $('#settings-modal');
    const openBtn = $('#status-settings');
    const closeBtn = $('#settings-close');
    const cancelBtn = $('#settings-cancel');
    const saveBtn = $('#settings-save');

    function open() {
      modal.classList.add('visible');
      // Populate from current status
      fetch('/api/status').then(r => r.json()).then((data) => {
        if (data.provider) $('#setting-provider').value = data.provider;
        if (data.model) $('#setting-model').value = data.model;
      }).catch(() => {});
    }
    function close() { modal.classList.remove('visible'); }

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    saveBtn.addEventListener('click', () => {
      // In a real app this would POST to /api/settings
      status.updateProvider($('#setting-provider').value);
      status.updateModel($('#setting-model').value);
      close();
      term.write('Settings saved (provider: ' + $('#setting-provider').value + ', model: ' + $('#setting-model').value + ')', 'success');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  // ===== Context Menu =====
  function initContextMenu() {
    const menu = $('#context-menu');

    document.addEventListener('click', () => menu.classList.remove('visible'));

    menu.querySelectorAll('.ctx-item').forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        const target = state.contextTarget;
        if (!target) return;

        switch (action) {
          case 'rename':
            const newName = prompt('Rename to:', target.split('/').pop());
            if (newName) term.write('Rename: ' + target + ' -> ' + newName, 'info');
            break;
          case 'delete':
            if (confirm('Delete ' + target + '?')) term.write('Deleted: ' + target, 'info');
            break;
          case 'copy-path':
            navigator.clipboard.writeText(target).then(() => term.write('Copied path: ' + target, 'info'));
            break;
          case 'copy-content':
            if (state.contents[target] !== undefined) {
              navigator.clipboard.writeText(state.contents[target]).then(() => term.write('Copied content: ' + target, 'info'));
            }
            break;
        }
        menu.classList.remove('visible');
      });
    });
  }

  // ===== Initialize =====
  const status = new StatusBar();
  const term = new Terminal();
  const fileTree = new FileTree($('#file-tree'));
  const editor = new Editor();
  const chat = new Chat();

  initSettings();
  initContextMenu();

  // Load file tree and status
  fileTree.load('');
  status.poll();
  setInterval(() => status.poll(), 15000);

  // Initial chat greeting
  chat.addMessage('system', 'Agent ready. Type a message or /help for commands.');

  // ===== Vision Panel (Sprite Generator) =====
  const visionModal = $('#vision-modal');
  const statusVision = $('#status-vision');

  if (statusVision) {
    statusVision.addEventListener('click', () => visionModal.classList.toggle('open'));
  }
  const visionClose = $('#vision-close');
  if (visionClose) {
    visionClose.addEventListener('click', () => visionModal.classList.remove('open'));
  }

  // Type selector toggles
  const visionType = $('#vision-type');
  const themeRow = $('#vision-theme-row');
  const uiRow = $('#vision-ui-row');
  if (visionType) {
    visionType.addEventListener('change', () => {
      if (themeRow) themeRow.style.display = visionType.value === 'tileset' ? '' : 'none';
      if (uiRow) uiRow.style.display = visionType.value === 'ui' ? '' : 'none';
    });
  }

  let currentAssetId = null;
  const galleryAssets = [];

  // Generate button
  const generateBtn = $('#vision-generate-btn');
  if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
      const prompt = $('#vision-prompt').value.trim();
      if (!prompt) return;

      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating...';

      try {
        const type = visionType.value;
        let endpoint, body;

        if (type === 'tileset') {
          endpoint = '/api/generate/tileset';
          body = { theme: $('#vision-theme').value, options: { tileSize: parseInt($('#vision-size').value), tileCount: 16 } };
        } else if (type === 'ui') {
          endpoint = '/api/generate/ui';
          body = { prompt, options: { element: $('#vision-ui-element').value, width: 64, height: 24 } };
        } else if (type === 'background') {
          endpoint = '/api/generate/background';
          body = { scene: prompt, parallax: ['sky', 'background', 'mid', 'foreground'] };
        } else {
          endpoint = '/api/generate/sprite';
          body = {
            prompt,
            options: {
              size: parseInt($('#vision-size').value),
              style: $('#vision-style').value,
              category: $('#vision-category').value,
              animate: $('#vision-animate').checked,
            }
          };
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const asset = await res.json();

        currentAssetId = asset.id;
        galleryAssets.unshift(asset);
        renderPreview(asset);
        renderGallery();

        // Show pipeline controls for sprites
        const pipeline = $('#vision-pipeline');
        if (pipeline) pipeline.style.display = type === 'sprite' ? '' : 'none';
        const exportDiv = $('#vision-export');
        if (exportDiv) exportDiv.style.display = '';
      } catch (err) {
        console.error('[vision] Generate failed:', err);
      } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate';
      }
    });
  }

  function renderPreview(asset) {
    const canvas = $('#vision-canvas');
    const empty = $('#vision-preview-empty');
    const meta = $('#vision-preview-meta');
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      canvas.style.display = '';
      if (empty) empty.style.display = 'none';
      if (meta) {
        meta.style.display = '';
        const sizeSpan = $('#vision-preview-size');
        const idSpan = $('#vision-preview-id');
        if (sizeSpan) sizeSpan.textContent = `${img.width}x${img.height}`;
        if (idSpan) idSpan.textContent = asset.id?.slice(0, 12) ?? '';
      }
    };
    img.src = `data:image/png;base64,${asset.data}`;
  }

  function renderGallery() {
    const grid = $('#vision-gallery-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const asset of galleryAssets) {
      const thumb = document.createElement('img');
      thumb.className = 'gallery-thumb';
      thumb.src = `data:image/png;base64,${asset.data}`;
      thumb.title = asset.prompt ?? asset.id;
      thumb.addEventListener('click', () => {
        currentAssetId = asset.id;
        renderPreview(asset);
      });
      grid.appendChild(thumb);
    }
  }

  // Pipeline controls
  ['refine-btn', 'final-btn', 'upscale-btn'].forEach((id) => {
    const btn = $(`#vision-${id}`);
    if (!btn) return;
    const stage = id.replace('-btn', '');
    btn.addEventListener('click', async () => {
      if (!currentAssetId) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/generate/refine', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assetId: currentAssetId, feedback: `${stage} it`, targetStage: stage }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const state = await res.json();
        const asset = state.stages?.[state.currentStage]?.asset;
        if (asset) {
          currentAssetId = asset.id;
          galleryAssets.unshift(asset);
          renderPreview(asset);
          renderGallery();
          // Update pipeline stage indicators
          document.querySelectorAll('.pipeline-stage').forEach((el) => {
            const s = el.dataset.stage;
            el.classList.toggle('done', STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(state.currentStage));
            el.classList.toggle('active', s === state.currentStage);
          });
        }
      } catch (err) {
        console.error('[vision] Refine failed:', err);
      } finally {
        btn.disabled = false;
      }
    });
  });

  const STAGE_ORDER = ['draft', 'refine', 'final', 'upscale'];

  // Export buttons
  const exportPng = $('#vision-export-png');
  if (exportPng) {
    exportPng.addEventListener('click', () => {
      const asset = galleryAssets.find(a => a.id === currentAssetId);
      if (!asset) return;
      const link = document.createElement('a');
      link.download = `${asset.id ?? 'sprite'}.png`;
      link.href = `data:image/png;base64,${asset.data}`;
      link.click();
    });
  }

  const exportB64 = $('#vision-export-base64');
  if (exportB64) {
    exportB64.addEventListener('click', () => {
      const asset = galleryAssets.find(a => a.id === currentAssetId);
      if (!asset) return;
      navigator.clipboard.writeText(asset.data).then(() => {
        exportB64.textContent = 'Copied!';
        setTimeout(() => { exportB64.textContent = 'Copy Base64'; }, 1500);
      });
    });
  }

  // Load gallery on open
  if (statusVision) {
    statusVision.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/gallery');
        if (res.ok) {
          const data = await res.json();
          galleryAssets.length = 0;
          galleryAssets.push(...(data.assets ?? []));
          renderGallery();
        }
      } catch { /* gallery fetch failed */ }
    });
  }

})();
