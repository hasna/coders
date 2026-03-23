/**
 * Dashboard HTML — single-page app served inline (zero dependencies)
 */
export function dashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>open-coders dashboard</title>
  <style>
    :root {
      --bg: #0d1117; --bg2: #161b22; --bg3: #21262d;
      --fg: #e6edf3; --fg2: #8b949e; --fg3: #484f58;
      --cyan: #58a6ff; --green: #3fb950; --yellow: #d29922;
      --red: #f85149; --purple: #bc8cff; --blue: #388bfd;
      --radius: 8px; --gap: 16px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg); color: var(--fg); line-height: 1.5; }
    a { color: var(--cyan); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Layout */
    .app { display: flex; min-height: 100vh; }
    .sidebar { width: 220px; background: var(--bg2); border-right: 1px solid var(--bg3);
      padding: var(--gap); position: fixed; height: 100vh; overflow-y: auto; }
    .main { margin-left: 220px; flex: 1; padding: calc(var(--gap) * 2); max-width: 1200px; }

    /* Sidebar */
    .logo { font-size: 18px; font-weight: 700; color: var(--cyan); margin-bottom: var(--gap); }
    .logo span { color: var(--fg2); font-weight: 400; }
    .nav-item { display: block; padding: 8px 12px; border-radius: var(--radius); color: var(--fg2);
      cursor: pointer; font-size: 14px; margin-bottom: 2px; transition: all 0.15s; }
    .nav-item:hover { background: var(--bg3); color: var(--fg); }
    .nav-item.active { background: var(--bg3); color: var(--cyan); font-weight: 600; }
    .nav-section { font-size: 11px; text-transform: uppercase; color: var(--fg3); margin: 16px 0 8px; letter-spacing: 0.5px; }

    /* Cards */
    .card { background: var(--bg2); border: 1px solid var(--bg3); border-radius: var(--radius);
      padding: var(--gap); margin-bottom: var(--gap); }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .card-title { font-size: 16px; font-weight: 600; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .badge-cyan { background: rgba(88,166,255,0.15); color: var(--cyan); }
    .badge-green { background: rgba(63,185,80,0.15); color: var(--green); }
    .badge-yellow { background: rgba(210,153,34,0.15); color: var(--yellow); }
    .badge-purple { background: rgba(188,140,255,0.15); color: var(--purple); }
    .badge-red { background: rgba(248,81,73,0.15); color: var(--red); }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 8px 12px; color: var(--fg2); font-weight: 500;
      border-bottom: 1px solid var(--bg3); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 8px 12px; border-bottom: 1px solid var(--bg3); }
    tr:hover { background: rgba(88,166,255,0.04); }
    .mono { font-family: 'SF Mono', Menlo, Monaco, 'Cascadia Code', monospace; font-size: 13px; }

    /* Grid */
    .grid { display: grid; gap: var(--gap); }
    .grid-2 { grid-template-columns: 1fr 1fr; }
    .grid-3 { grid-template-columns: 1fr 1fr 1fr; }
    .grid-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }

    /* Stat cards */
    .stat { text-align: center; padding: 20px; }
    .stat-value { font-size: 32px; font-weight: 700; color: var(--cyan); }
    .stat-label { font-size: 13px; color: var(--fg2); margin-top: 4px; }

    /* Filter */
    .filter-bar { display: flex; gap: 8px; margin-bottom: var(--gap); flex-wrap: wrap; }
    .filter-btn { padding: 6px 14px; border-radius: 20px; border: 1px solid var(--bg3);
      background: transparent; color: var(--fg2); cursor: pointer; font-size: 13px; transition: all 0.15s; }
    .filter-btn:hover { border-color: var(--cyan); color: var(--cyan); }
    .filter-btn.active { background: var(--cyan); color: var(--bg); border-color: var(--cyan); }

    /* Page header */
    .page-header { margin-bottom: calc(var(--gap) * 1.5); }
    .page-title { font-size: 24px; font-weight: 700; }
    .page-subtitle { color: var(--fg2); font-size: 14px; margin-top: 4px; }

    /* Toggle */
    .toggle { display: inline-block; width: 36px; height: 20px; background: var(--bg3);
      border-radius: 10px; position: relative; cursor: pointer; transition: background 0.2s; }
    .toggle.on { background: var(--green); }
    .toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
      background: white; border-radius: 50%; transition: transform 0.2s; }
    .toggle.on::after { transform: translateX(16px); }

    /* Hidden pages */
    .page { display: none; }
    .page.active { display: block; }

    /* Responsive */
    @media (max-width: 768px) {
      .sidebar { display: none; }
      .main { margin-left: 0; }
      .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <nav class="sidebar">
      <div class="logo">open-coders <span>dashboard</span></div>
      <div class="nav-section">Overview</div>
      <div class="nav-item active" data-page="commands">Slash Commands</div>
      <div class="nav-item" data-page="models">Models</div>
      <div class="nav-item" data-page="settings">Settings</div>
      <div class="nav-section">Infrastructure</div>
      <div class="nav-item" data-page="mcp">MCP Servers</div>
      <div class="nav-item" data-page="plugins">Plugins</div>
      <div class="nav-item" data-page="skills">Skills</div>
      <div class="nav-section">Live</div>
      <a class="nav-item" href="/terminal" style="color:var(--fg2)">Terminal</a>
      <div class="nav-section">History</div>
      <div class="nav-item" data-page="sessions">Sessions</div>
      <div class="nav-item" data-page="checkpoints">Checkpoints</div>
      <div class="nav-item" data-page="cost">Cost Analytics</div>
    </nav>

    <div class="main">
      <!-- Slash Commands Page -->
      <div id="page-commands" class="page active">
        <div class="page-header">
          <div class="page-title">Slash Commands</div>
          <div class="page-subtitle">All available commands with categories and usage</div>
        </div>
        <div class="filter-bar" id="cmd-filters"></div>
        <div class="card">
          <table>
            <thead><tr><th>Command</th><th>Category</th><th>Description</th><th>Aliases</th></tr></thead>
            <tbody id="cmd-table"></tbody>
          </table>
        </div>
      </div>

      <!-- Models Page -->
      <div id="page-models" class="page">
        <div class="page-header">
          <div class="page-title">Model Registry</div>
          <div class="page-subtitle">All available models with provider variants and capabilities</div>
        </div>
        <div class="card">
          <table>
            <thead><tr><th>Alias</th><th>First-Party ID</th><th>Context</th><th>Max Out</th><th>Thinking</th><th>Vision</th></tr></thead>
            <tbody id="model-table"></tbody>
          </table>
        </div>
      </div>

      <!-- Settings Page -->
      <div id="page-settings" class="page">
        <div class="page-header">
          <div class="page-title">Settings</div>
          <div class="page-subtitle">Current configuration — click values to edit</div>
        </div>
        <div class="card">
          <table>
            <thead><tr><th>Key</th><th>Value</th><th>Type</th></tr></thead>
            <tbody id="settings-table"></tbody>
          </table>
        </div>
      </div>

      <!-- MCP Servers Page -->
      <div id="page-mcp" class="page">
        <div class="page-header">
          <div class="page-title">MCP Servers</div>
          <div class="page-subtitle">Configured Model Context Protocol servers</div>
        </div>
        <div id="mcp-content"></div>
      </div>

      <!-- Plugins Page -->
      <div id="page-plugins" class="page">
        <div class="page-header">
          <div class="page-title">Plugins</div>
          <div class="page-subtitle">Installed plugins and marketplace</div>
        </div>
        <div id="plugins-content"></div>
      </div>

      <!-- Skills Page -->
      <div id="page-skills" class="page">
        <div class="page-header">
          <div class="page-title">Skills</div>
          <div class="page-subtitle">Available skills from .coders/skills/ and .claude/skills/</div>
        </div>
        <div id="skills-content"></div>
      </div>

      <!-- Sessions Page -->
      <div id="page-sessions" class="page">
        <div class="page-header">
          <div class="page-title">Sessions</div>
          <div class="page-subtitle">Conversation history and session details</div>
        </div>
        <div id="session-stats" class="grid grid-4" style="margin-bottom:var(--gap)"></div>
        <div class="card">
          <table>
            <thead><tr><th>Date</th><th>Model</th><th>Messages</th><th>Tokens</th><th>Cost</th><th>ID</th></tr></thead>
            <tbody id="session-table"></tbody>
          </table>
        </div>
      </div>

      <!-- Checkpoints Page -->
      <div id="page-checkpoints" class="page">
        <div class="page-header">
          <div class="page-title">File Checkpoints</div>
          <div class="page-subtitle">Saved file states for rewind/restore</div>
        </div>
        <div class="card">
          <table>
            <thead><tr><th>Date</th><th>File</th><th>Operation</th></tr></thead>
            <tbody id="checkpoint-table"></tbody>
          </table>
        </div>
      </div>

      <!-- Cost Analytics Page -->
      <div id="page-cost" class="page">
        <div class="page-header">
          <div class="page-title">Cost Analytics</div>
          <div class="page-subtitle">Token usage and cost breakdown</div>
        </div>
        <div id="cost-stats" class="grid grid-4" style="margin-bottom:var(--gap)"></div>
        <div class="card">
          <div class="card-header"><div class="card-title">Cost by Model</div></div>
          <table>
            <thead><tr><th>Model</th><th>Messages</th><th>Tokens In</th><th>Tokens Out</th><th>Cost</th></tr></thead>
            <tbody id="cost-model-table"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <script>
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);
    const api = (path) => fetch('/api/' + path).then(r => r.json());

    // Navigation
    $$('.nav-item').forEach(el => {
      el.addEventListener('click', () => {
        $$('.nav-item').forEach(n => n.classList.remove('active'));
        $$('.page').forEach(p => p.classList.remove('active'));
        el.classList.add('active');
        $('#page-' + el.dataset.page).classList.add('active');
        loadPage(el.dataset.page);
      });
    });

    function badge(text, color) {
      return '<span class="badge badge-' + color + '">' + text + '</span>';
    }

    function fmtNum(n) { return n.toLocaleString(); }
    function fmtCost(n) { return '$' + n.toFixed(4); }
    function fmtCtx(n) { return (n / 1000) + 'K'; }

    const categoryColors = {
      core: 'cyan', mode: 'purple', system: 'green',
      task: 'yellow', git: 'red', navigation: 'cyan', plugin: 'purple',
    };

    // Page loaders
    async function loadCommands() {
      const data = await api('commands');
      const categories = [...new Set(data.commands.map(c => c.category))];

      // Filters
      let activeFilter = 'all';
      const filterBar = $('#cmd-filters');
      filterBar.innerHTML = '<button class="filter-btn active" data-cat="all">All (' + data.total + ')</button>' +
        categories.map(c => {
          const count = data.commands.filter(cmd => cmd.category === c).length;
          return '<button class="filter-btn" data-cat="' + c + '">' + c + ' (' + count + ')</button>';
        }).join('');

      filterBar.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeFilter = btn.dataset.cat;
          renderCommands();
        });
      });

      function renderCommands() {
        const filtered = activeFilter === 'all' ? data.commands : data.commands.filter(c => c.category === activeFilter);
        const isTop = new Set(data.topCommands);
        $('#cmd-table').innerHTML = filtered.map(c =>
          '<tr>' +
          '<td class="mono">/' + c.name + (isTop.has(c.name) ? ' ⭐' : '') + '</td>' +
          '<td>' + badge(c.category, categoryColors[c.category] || 'cyan') + '</td>' +
          '<td>' + c.description + '</td>' +
          '<td class="mono" style="color:var(--fg3)">' + (c.aliases?.join(', ') || '—') + '</td>' +
          '</tr>'
        ).join('');
      }
      renderCommands();
    }

    async function loadModels() {
      const data = await api('models');
      $('#model-table').innerHTML = data.models.map(m =>
        '<tr>' +
        '<td class="mono" style="color:var(--cyan);font-weight:600">' + m.alias + '</td>' +
        '<td class="mono">' + m.firstParty + '</td>' +
        '<td>' + fmtCtx(m.contextWindow) + '</td>' +
        '<td>' + fmtNum(m.maxOutput) + '</td>' +
        '<td>' + (m.supportsThinking ? badge('✓', 'green') : badge('✗', 'red')) + '</td>' +
        '<td>' + (m.supportsVision ? badge('✓', 'green') : badge('✗', 'red')) + '</td>' +
        '</tr>'
      ).join('');
    }

    async function loadSettings() {
      const data = await api('settings');
      $('#settings-table').innerHTML = Object.entries(data)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) =>
          '<tr>' +
          '<td class="mono">' + k + '</td>' +
          '<td class="mono">' + (typeof v === 'object' ? JSON.stringify(v) : String(v)) + '</td>' +
          '<td>' + badge(typeof v, 'cyan') + '</td>' +
          '</tr>'
        ).join('');
    }

    async function loadMcp() {
      const data = await api('mcp');
      if (data.total === 0) {
        $('#mcp-content').innerHTML = '<div class="card"><p style="color:var(--fg2)">No MCP servers configured. Add servers to .mcp.json or settings.</p></div>';
        return;
      }
      $('#mcp-content').innerHTML = '<div class="card"><table><thead><tr><th>Name</th><th>Scope</th><th>Transport</th><th>Command/URL</th></tr></thead><tbody>' +
        data.servers.map(s =>
          '<tr><td class="mono" style="color:var(--cyan)">' + s.name + '</td>' +
          '<td>' + badge(s.scope || '—', 'green') + '</td>' +
          '<td>' + badge(s.transport || 'stdio', 'purple') + '</td>' +
          '<td class="mono">' + (s.command ? s.command + ' ' + (s.args||[]).join(' ') : s.url || '—') + '</td></tr>'
        ).join('') + '</tbody></table></div>';
    }

    async function loadPlugins() {
      const data = await api('plugins');
      if (data.total === 0) {
        $('#plugins-content').innerHTML = '<div class="card"><p style="color:var(--fg2)">No plugins installed.</p></div>';
        return;
      }
      $('#plugins-content').innerHTML = '<div class="card"><table><thead><tr><th>Name</th><th>Version</th><th>Status</th><th>Source</th></tr></thead><tbody>' +
        data.plugins.map(p =>
          '<tr><td class="mono">' + p.name + '</td><td>' + (p.version||'—') + '</td>' +
          '<td>' + badge(p.enabled ? 'enabled' : 'disabled', p.enabled ? 'green' : 'red') + '</td>' +
          '<td>' + (p.source||'—') + '</td></tr>'
        ).join('') + '</tbody></table></div>';
    }

    async function loadSessions() {
      const data = await api('sessions');
      const totalTokens = data.sessions.reduce((s, x) => s + (x.tokens_in||0) + (x.tokens_out||0), 0);
      const totalCost = data.sessions.reduce((s, x) => s + (x.cost||0), 0);
      $('#session-stats').innerHTML =
        '<div class="card stat"><div class="stat-value">' + data.total + '</div><div class="stat-label">Sessions</div></div>' +
        '<div class="card stat"><div class="stat-value">' + data.sessions.reduce((s,x) => s + (x.msg_count||0), 0) + '</div><div class="stat-label">Messages</div></div>' +
        '<div class="card stat"><div class="stat-value">' + fmtNum(totalTokens) + '</div><div class="stat-label">Total Tokens</div></div>' +
        '<div class="card stat"><div class="stat-value">' + fmtCost(totalCost) + '</div><div class="stat-label">Total Cost</div></div>';
      $('#session-table').innerHTML = data.sessions.map(s =>
        '<tr>' +
        '<td>' + (s.created_at||'—') + '</td>' +
        '<td>' + badge(s.model||'?', 'purple') + '</td>' +
        '<td>' + (s.msg_count||0) + '</td>' +
        '<td class="mono">' + fmtNum((s.tokens_in||0) + (s.tokens_out||0)) + '</td>' +
        '<td class="mono">' + fmtCost(s.cost||0) + '</td>' +
        '<td class="mono" style="color:var(--fg3)">' + (s.id||'').slice(0,8) + '</td>' +
        '</tr>'
      ).join('');
    }

    async function loadCheckpoints() {
      const data = await api('checkpoints');
      $('#checkpoint-table').innerHTML = data.checkpoints.map(cp =>
        '<tr>' +
        '<td>' + cp.createdAt + '</td>' +
        '<td class="mono">' + cp.filePath + '</td>' +
        '<td class="mono" style="color:var(--fg2)">' + cp.operation + '</td>' +
        '</tr>'
      ).join('') || '<tr><td colspan="3" style="color:var(--fg2)">No checkpoints found</td></tr>';
    }

    async function loadCost() {
      const data = await api('cost');
      $('#cost-stats').innerHTML =
        '<div class="card stat"><div class="stat-value">' + fmtNum(data.totalIn) + '</div><div class="stat-label">Tokens In</div></div>' +
        '<div class="card stat"><div class="stat-value">' + fmtNum(data.totalOut) + '</div><div class="stat-label">Tokens Out</div></div>' +
        '<div class="card stat"><div class="stat-value">' + fmtCost(data.totalCost) + '</div><div class="stat-label">Total Cost</div></div>' +
        '<div class="card stat"><div class="stat-value">' + data.sessionCount + '</div><div class="stat-label">Sessions</div></div>';
      $('#cost-model-table').innerHTML = data.byModel.map(m =>
        '<tr>' +
        '<td>' + badge(m.model||'unknown', 'purple') + '</td>' +
        '<td>' + fmtNum(m.msg_count) + '</td>' +
        '<td class="mono">' + fmtNum(m.tokens_in) + '</td>' +
        '<td class="mono">' + fmtNum(m.tokens_out) + '</td>' +
        '<td class="mono" style="color:var(--cyan)">' + fmtCost(m.cost) + '</td>' +
        '</tr>'
      ).join('') || '<tr><td colspan="5" style="color:var(--fg2)">No cost data yet</td></tr>';
    }

    function loadPage(page) {
      const loaders = {
        commands: loadCommands, models: loadModels, settings: loadSettings,
        mcp: loadMcp, plugins: loadPlugins, sessions: loadSessions,
        checkpoints: loadCheckpoints, cost: loadCost, skills: loadPlugins,
      };
      if (loaders[page]) loaders[page]();
    }

    // Initial load
    loadCommands();
  </script>
</body>
</html>`;
}
