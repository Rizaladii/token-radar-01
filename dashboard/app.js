// Token Radar dashboard: renders window.RADAR (written by main.ts as data.js).
// No network, no fetch: the whole board is already in the page's data.
(function () {
  var D = window.RADAR;
  if (!D) {
    document.body.innerHTML = '<p style="padding:24px">Token Radar: no data loaded.</p>';
    return;
  }
  var watch = {};
  D.rows.forEach(function (r) { watch[r.slug] = true; });
  var watchSet = {};
  (D.watchlist || []).forEach(function (s) { watchSet[s] = true; });

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 365) return (n / 365).toFixed(1) + 'y';
    return n + 'd';
  }
  function chainList(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Header meta.
  document.getElementById('meta').innerHTML =
    'Snapshot <b>' + esc(D.as_of) + '</b> · Watchlist floor <b>$50M TVL</b><br>' +
    '<b>' + D.board_size + '</b> ranked rows · <b>' + D.watchlist_size + '</b> watchlist · <b>' +
    D.early_size + '</b> early finds · Model <b>' + esc(D.model_version) + '</b>';
  document.getElementById('asof').textContent = D.as_of;

  // Category filter options.
  var cats = {};
  D.rows.forEach(function (r) { if (r.category) cats[r.category] = true; });
  var catSel = document.getElementById('cat');
  catSel.innerHTML = '<option value="">All categories</option>' +
    Object.keys(cats).sort().map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');

  var params = new URLSearchParams(location.search);
  var qEl = document.getElementById('q');
  var statusEl = document.getElementById('status');
  var sortEl = document.getElementById('sort');
  if (params.get('q')) qEl.value = params.get('q');
  if (params.get('cat')) catSel.value = params.get('cat');
  if (params.get('status')) statusEl.value = params.get('status');
  if (params.get('sort')) sortEl.value = params.get('sort');

  var maxVal = D.rows.length ? D.rows[0].implied_value_usd : 1;

  function filtered() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catSel.value;
    var st = statusEl.value;
    var rows = D.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (st === 'watchlist' && !watchSet[r.slug]) return false;
      if (st === 'early' && watchSet[r.slug]) return false;
      return true;
    });
    var s = sortEl.value;
    rows = rows.slice();
    if (s === 'tvl') rows.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (s === 'growth') rows.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (s === 'age') rows.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else rows.sort(function (a, b) { return a.rank - b.rank; });
    return rows;
  }

  function renderBoard() {
    var rows = filtered();
    var tb = document.getElementById('rows');
    document.getElementById('count').textContent =
      rows.length + ' of ' + D.board_size + ' rows shown · ' +
      D.watchlist_size + ' watchlist protocols, ' + D.early_size + ' early finds below the floor';
    tb.innerHTML = rows.map(function (r) {
      var badge = watchSet[r.slug]
        ? '<span class="badge watch">WATCHLIST</span>'
        : '<span class="badge early">EARLY FIND</span>';
      var chg = r.change_7d === null ? '—' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
      var bar = Math.max(2, Math.round((r.implied_value_usd / maxVal) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num rank">' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + badge + '<br><span class="slug">' + esc(r.slug) + ' · ' + esc(chainList(r.chains)) + '</span></td>' +
        '<td><span class="cat">' + esc(r.category || '—') + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><span class="val">' + money(r.implied_value_usd) + '</span><div class="bar"><i style="width:' + bar + '%"></i></div></td></tr>';
    }).join('');
    tb.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }

  function showDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    document.getElementById('view-board').hidden = true;
    document.getElementById('view-live').hidden = true;
    document.getElementById('view-method').hidden = true;
    document.getElementById('view-detail').hidden = false;
    setTab(null);
    var m = r.model;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var listNote = watchSet[r.slug]
      ? ' · on the $50M watchlist'
      : (r.tvl_usd < D.floor_usd ? ' · an early find below the watchlist floor' : ' · outside the house watchlist, ranked here as an early find');
    document.getElementById('detail').innerHTML =
      '<div class="detail"><h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
      '<p class="lede">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + esc(r.chains.join(', ') || '—') + listNote + '</p>' +
      '<div class="facts">' +
      '<div class="fact"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div></div>' +
      '<div class="fact"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div></div>' +
      '<div class="fact"><div class="k">7-day change</div><div class="v">' + pct(r.change_7d) + '</div></div>' +
      '<div class="fact"><div class="k">Age</div><div class="v">' + age(r.age_days) + '</div></div>' +
      '</div>' +
      '<p class="model-line">Model ' + esc(D.model_version) + ': TVL ' + money(r.tvl_usd) +
      ' × sector <b>' + m.sector_multiple + '</b> × growth <b>' + m.growth_multiplier + '</b> (' + m.growth_pct + '%)' +
      ' × maturity <b>' + m.maturity_multiplier + '</b> × breadth <b>' + m.breadth_multiplier + '</b>' +
      ' = <b>' + money(r.implied_value_usd) + '</b>. The protocol records no token.</p>' +
      '<h3>Farm plan — six steps</h3><ol class="steps">' + steps + '</ol></div>';
    window.scrollTo(0, 0);
  }

  function renderLive() {
    document.getElementById('live-rows').innerHTML = D.live.map(function (r) {
      var chg = r.change_7d === null ? '—' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
      return '<tr><td><b>' + esc(r.name) + '</b><br><span class="slug">' + esc(r.slug) + ' · ' + esc(chainList(r.chains)) + '</span></td>' +
        '<td><span class="cat">' + esc(r.category || '—') + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num"><span class="val">' + money(r.mcap_usd) + '</span></td>' +
        '<td class="num">' + chg + '</td></tr>';
    }).join('');
  }

  function setTab(name) {
    document.getElementById('tab-board').classList.toggle('on', name === 'board');
    document.getElementById('tab-live').classList.toggle('on', name === 'live');
    document.getElementById('tab-method').classList.toggle('on', name === 'method');
  }
  function show(name) {
    document.getElementById('view-board').hidden = name !== 'board';
    document.getElementById('view-detail').hidden = true;
    document.getElementById('view-live').hidden = name !== 'live';
    document.getElementById('view-method').hidden = name !== 'method';
    setTab(name);
    if (name === 'live') renderLive();
  }
  document.getElementById('tab-board').addEventListener('click', function () { show('board'); });
  document.getElementById('tab-live').addEventListener('click', function () { show('live'); });
  document.getElementById('tab-method').addEventListener('click', function () { show('method'); });
  document.getElementById('back').addEventListener('click', function () { show('board'); });
  [qEl, catSel, statusEl, sortEl].forEach(function (el) {
    el.addEventListener('input', renderBoard);
    el.addEventListener('change', renderBoard);
  });

  renderBoard();
  if (params.get('detail')) showDetail(params.get('detail'));
  if (params.get('view') === 'live') show('live');
  if (params.get('view') === 'method') show('method');
})();
