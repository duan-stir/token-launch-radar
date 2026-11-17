// Token Launch Radar's dashboard. It reads window.RADAR, written beside dashboard/ by main.ts
// from the same board the program writes to board.json, so the page and the board agree by
// construction: the rows below ARE the board's rows, farm plans included, and the detail view shows
// each row's own model breakdown. No network: every byte the page shows is in data.js.
//
// The page recomputes nothing for the board itself. The one exception is the sandbox in the Model
// view, which re-ranks live from the same snapshot figures under tuning the reader chooses, through
// impliedWith() — the same arithmetic as lib/model.ts scoreProtocol, with the growth weight and a
// multiple scale the sliders set.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var WATCHLIST = new Set(DATA.watchlist || []);
  var TUNING = DATA.tuning;

  // --------------------------------------------------------------- state from the URL
  var params = new URLSearchParams(location.search);
  var state = {
    tab: params.get('tab') || 'board',
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    watchlist: params.get('watchlist') === '1',
    sort: params.get('sort') || 'implied',
    dir: params.get('dir') === 'asc' ? 1 : -1,
    selected: params.get('detail') || null,
    weight: parseFloat(params.get('weight') || 'NaN'),
    scale: parseFloat(params.get('scale') || 'NaN'),
  };
  if (!isFinite(state.weight)) state.weight = TUNING.growth_weight;
  if (!isFinite(state.scale)) state.scale = 1;
  if (['board', 'live', 'model'].indexOf(state.tab) === -1) state.tab = 'board';

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watchlist) p.set('watchlist', '1');
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir === 1) p.set('dir', 'asc');
    if (state.selected) p.set('detail', state.selected);
    var q = p.toString();
    history.replaceState(null, '', q ? '?' + q : location.pathname);
  }

  // --------------------------------------------------------------- formatting
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return days + ' days';
  }
  function pctClass(n) {
    if (n === null || n === undefined || !isFinite(n) || n === 0) return '';
    return n > 0 ? 'up' : 'down';
  }

  // --------------------------------------------------------------- the model, in the page
  // impliedWith: the same arithmetic as the program's scoreProtocol, under sandbox tuning.
  function impliedWith(row, weight, scale) {
    var growth = Math.min(TUNING.growth_cap, Math.max(TUNING.growth_floor, row.change_7d || 0));
    var growthMult = 1 + (growth / 100) * weight;
    var age = row.age_days === null || row.age_days === undefined ? DATA.unknown_age_days : row.age_days;
    var maturity = TUNING.maturity_floor + (Math.min(Math.max(age, 0), TUNING.maturity_days) / TUNING.maturity_days) * TUNING.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.model.multiple * scale * growthMult * maturity));
  }

  // --------------------------------------------------------------- filtering and sorting
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlist && !WATCHLIST.has(r.slug)) return false;
      if (state.category !== 'all' && (r.category || '(none)') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function sortValue(r, key) {
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? -1 : r.age_days;
    if (key === 'name') return r.name.toLowerCase();
    return r.implied_value_usd;
  }
  function sortedRows(rows) {
    var dir = state.dir;
    return rows.slice().sort(function (a, b) {
      var va = sortValue(a, state.sort);
      var vb = sortValue(b, state.sort);
      var cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return cmp * dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  // --------------------------------------------------------------- board
  var rowsEl = document.getElementById('rows');
  var countEl = document.getElementById('count');

  function boardRowHtml(r) {
    var onWatch = WATCHLIST.has(r.slug);
    return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
      '<td class="rank">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' + (onWatch ? '<span class="badge">Watchlist</span>' : '') +
      '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      '<td class="num"><strong>' + fmtUsd(r.implied_value_usd) + '</strong></td>' +
      '<td class="num">×' + r.model.multiple.toFixed(2) + '</td>' +
      '</tr>';
  }

  function renderBoard() {
    var rows = sortedRows(filteredRows());
    rowsEl.innerHTML = rows.map(boardRowHtml).join('');
    countEl.textContent = 'Showing ' + rows.length + ' of ' + DATA.rows.length + ' protocols';
    var headers = document.querySelectorAll('#board-table thead th[data-sort]');
    headers.forEach(function (th) {
      var base = th.getAttribute('data-label') || th.textContent;
      th.setAttribute('data-label', base);
      var active = th.getAttribute('data-sort') === state.sort;
      th.classList.toggle('sorted', active);
      th.textContent = base + (active ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
    });
  }

  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  document.querySelectorAll('#board-table thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      document.getElementById('sort').value = state.sort;
      syncUrl();
      renderBoard();
    });
  });

  // --------------------------------------------------------------- filter controls
  function fillOptions(select, values) {
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      select.appendChild(o);
    });
  }
  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    var c = r.category || '(none)';
    if (categories.indexOf(c) === -1) categories.push(c);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) === -1) chains.push(ch); });
  });
  categories.sort();
  chains.sort();
  fillOptions(document.getElementById('category'), categories);
  fillOptions(document.getElementById('chain'), chains);

  var qEl = document.getElementById('q');
  var catEl = document.getElementById('category');
  var chainEl = document.getElementById('chain');
  var watchEl = document.getElementById('watchlist');
  var sortEl = document.getElementById('sort');
  qEl.value = state.q;
  catEl.value = state.category;
  chainEl.value = state.chain;
  watchEl.checked = state.watchlist;
  sortEl.value = state.sort;
  qEl.addEventListener('input', function () { state.q = qEl.value; syncUrl(); renderBoard(); });
  catEl.addEventListener('change', function () { state.category = catEl.value; syncUrl(); renderBoard(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; syncUrl(); renderBoard(); });
  watchEl.addEventListener('change', function () { state.watchlist = watchEl.checked; syncUrl(); renderBoard(); });
  sortEl.addEventListener('change', function () {
    state.sort = sortEl.value;
    state.dir = state.sort === 'name' ? 1 : -1;
    syncUrl();
    renderBoard();
  });
  document.getElementById('toolbar').addEventListener('submit', function (ev) { ev.preventDefault(); });

  // --------------------------------------------------------------- detail drawer
  var detailEl = document.getElementById('detail');
  var detailBody = document.getElementById('detail-body');

  function factorRow(label, note, value, lo, hi, display) {
    var pct = Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
    return '<div class="factor"><div>' + label + '<small>' + note + '</small></div>' +
      '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div><b>' + display + '</b></div>';
  }

  function openDetail(slug) {
    var r = null;
    DATA.rows.forEach(function (row) { if (row.slug === slug) r = row; });
    if (!r) return;
    state.selected = slug;
    var m = r.model;
    var compsNote = m.multiple_source === 'category'
      ? m.comps + ' comparables in ' + (r.category || 'this category')
      : m.comps + ' comparables, all categories (fallback)';
    detailBody.innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p>' + esc(r.slug) + (WATCHLIST.has(r.slug) ? ' · <span class="badge">Watchlist</span>' : '') + ' · records no token</p>' +
      '<dl class="facts">' +
      '<div><dt>Implied value</dt><dd>' + fmtUsd(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>Rank</dt><dd>#' + r.rank + ' of ' + DATA.rows.length + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd class="' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</dd></div>' +
      '<div><dt>Category</dt><dd>' + esc(r.category || '—') + '</dd></div>' +
      '<div><dt>Age</dt><dd>' + fmtAge(r.age_days) + (r.listed_at ? ' · since ' + esc(r.listed_at) : '') + '</dd></div>' +
      '<div><dt>Chains</dt><dd>' + esc(r.chains.join(', ')) + '</dd></div>' +
      '<div><dt>Model</dt><dd>' + esc(DATA.model_version) + '</dd></div>' +
      '</dl>' +
      '<h3>How the value is built</h3>' +
      '<div class="breakdown">' +
      factorRow('Multiple', esc(compsNote), m.multiple, TUNING.multiple_floor, TUNING.multiple_cap, '×' + m.multiple.toFixed(2)) +
      factorRow('Growth', '7-day change ' + fmtPct(m.growth_pct) + ', weight ' + TUNING.growth_weight, m.growth_multiplier, 0.7, 1.6, '×' + m.growth_multiplier.toFixed(2)) +
      factorRow('Maturity', m.age_days === null ? 'age unknown: median age used' : fmtAge(m.age_days) + ' old', m.maturity_multiplier, TUNING.maturity_floor, 1, '×' + m.maturity_multiplier.toFixed(2)) +
      '</div>' +
      '<p class="hint">' + fmtUsd(r.tvl_usd) + ' × ' + m.multiple.toFixed(2) + ' × ' + m.growth_multiplier.toFixed(2) + ' × ' + m.maturity_multiplier.toFixed(2) + ' = ' + fmtUsd(r.implied_value_usd) + '</p>' +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.hidden = false;
    syncUrl();
    renderBoard();
  }
  function closeDetail() {
    state.selected = null;
    detailEl.hidden = true;
    syncUrl();
    renderBoard();
  }
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !detailEl.hidden) closeDetail(); });

  // --------------------------------------------------------------- live view
  function renderLive() {
    document.getElementById('live-rows').innerHTML = DATA.live.map(function (p, i) {
      return '<tr><td class="rank">' + (i + 1) + '</td>' +
        '<td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(p.mcap_usd) + '</td>' +
        '<td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="num">×' + p.mcap_tvl_ratio.toFixed(2) + '</td>' +
        '<td class="num ' + pctClass(p.change_7d) + '">' + fmtPct(p.change_7d) + '</td></tr>';
    }).join('');
  }

  // --------------------------------------------------------------- model view
  function renderMultiples() {
    var entries = Object.keys(DATA.multiples).map(function (c) {
      return { category: c, multiple: DATA.multiples[c].multiple, comps: DATA.multiples[c].comps };
    }).sort(function (a, b) { return b.multiple - a.multiple; });
    var html = '<tr><td><strong>All categories (fallback)</strong></td><td class="num">×' + DATA.global_multiple.toFixed(2) + '</td><td class="num">' + DATA.global_comps + '</td></tr>';
    html += entries.map(function (e) {
      return '<tr><td>' + esc(e.category) + '</td><td class="num">×' + e.multiple.toFixed(2) + '</td><td class="num">' + e.comps + '</td></tr>';
    }).join('');
    document.getElementById('multiples-rows').innerHTML = html;
  }

  var weightEl = document.getElementById('weight');
  var scaleEl = document.getElementById('scale');
  function renderSandbox() {
    var weight = parseFloat(weightEl.value);
    var scale = parseFloat(scaleEl.value);
    document.getElementById('weight-out').textContent = weight.toFixed(2);
    document.getElementById('scale-out').textContent = scale.toFixed(2) + '×';
    var rescored = DATA.rows.map(function (r) {
      return { row: r, value: impliedWith(r, weight, scale) };
    }).sort(function (a, b) { return b.value - a.value || (a.row.slug < b.row.slug ? -1 : 1); });
    var top = rescored.slice(0, 10);
    document.getElementById('sandbox-top').innerHTML = top.map(function (entry, i) {
      var moved = entry.row.rank - (i + 1);
      var mark = moved === 0 ? '' : ' <span class="moved">' + (moved > 0 ? '▲' + moved : '▼' + (-moved)) + '</span>';
      return '<li><strong>' + esc(entry.row.name) + '</strong> — ' + fmtUsd(entry.value) + mark + '</li>';
    }).join('');
    var baseTop = DATA.rows.slice(0, 10).map(function (r) { return r.slug; });
    var staying = top.filter(function (entry) { return baseTop.indexOf(entry.row.slug) !== -1; }).length;
    document.getElementById('sandbox-note').textContent =
      staying + ' of the board’s top 10 stay in the top 10 under this tuning. The board itself does not change: it is fixed by the program’s run.';
  }
  weightEl.value = state.weight;
  scaleEl.value = state.scale;
  weightEl.addEventListener('input', renderSandbox);
  scaleEl.addEventListener('input', renderSandbox);
  document.getElementById('reset-sandbox').addEventListener('click', function () {
    weightEl.value = TUNING.growth_weight;
    scaleEl.value = 1;
    renderSandbox();
  });

  // --------------------------------------------------------------- tabs and header
  var tabButtons = document.querySelectorAll('.tabs button');
  function showTab(tab) {
    state.tab = tab;
    tabButtons.forEach(function (b) {
      var active = b.getAttribute('data-tab') === tab;
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.getElementById('view-board').hidden = tab !== 'board';
    document.getElementById('view-live').hidden = tab !== 'live';
    document.getElementById('view-model').hidden = tab !== 'model';
    if (tab === 'live') renderLive();
    if (tab === 'model') { renderMultiples(); renderSandbox(); }
    syncUrl();
  }
  tabButtons.forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  document.getElementById('meta').innerHTML =
    '<div><dt>Snapshot</dt><dd>' + esc(DATA.as_of) + '</dd></div>' +
    '<div><dt>Protocols ranked</dt><dd>' + DATA.board_size + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + DATA.watchlist_size + ' covered</dd></div>' +
    '<div><dt>Below the floor</dt><dd>' + DATA.early_size + ' early</dd></div>' +
    '<div><dt>Model</dt><dd>' + esc(DATA.model_version) + '</dd></div>';

  // --------------------------------------------------------------- first paint
  showTab(state.tab);
  renderBoard();
  if (state.selected) openDetail(state.selected);
})();
