const $ = (id) => document.getElementById(id);
let currentRecords = [];
let pricing = {};

function money(value, digits = 4) {
  return '$' + Number(value || 0).toFixed(digits);
}
function compact(value) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function drawChart(records) {
  const canvas = $('tokenChart');
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  const list = records.slice(0, 8).reverse();
  $('chartEmpty').style.display = list.length ? 'none' : 'grid';
  const left = 31, right = 8, top = 10, bottom = 24;
  const cw = w - left - right, ch = h - top - bottom;
  ctx.font = '9px DM Sans, sans-serif';
  ctx.textAlign = 'right';
  const max = Math.max(100, ...list.map(r => Math.max(r.prompt_tokens, r.completion_tokens))) * 1.15;
  for (let i = 0; i < 4; i++) {
    const y = top + ch * i / 3;
    ctx.strokeStyle = '#2a3040'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
    ctx.fillStyle = '#747e95';
    ctx.fillText(compact(Math.round(max * (1 - i / 3))), left - 7, y + 3);
  }
  const group = cw / Math.max(list.length, 1);
  const bw = Math.min(15, group * .27);
  list.forEach((r, i) => {
    const center = left + group * (i + .5);
    const ih = (r.prompt_tokens / max) * ch, oh = (r.completion_tokens / max) * ch;
    ctx.fillStyle = '#9c85f1';
    roundRect(ctx, center - bw - 2, top + ch - ih, bw, ih, 3); ctx.fill();
    ctx.fillStyle = '#57cdb3';
    roundRect(ctx, center + 2, top + ch - oh, bw, oh, 3); ctx.fill();
    ctx.fillStyle = '#7c859a'; ctx.textAlign = 'center';
    ctx.fillText('#' + r.id, center, h - 7);
  });
}
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}
function renderHistory(records) {
  const body = $('historyBody');
  if (!records.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-row">No requests yet. Run a prompt above to get started.</td></tr>';
    return;
  }
  body.innerHTML = records.slice(0, 12).map(r => {
    const prompt = escapeHtml(r.prompt_preview || 'Prompt request');
    const date = new Date(r.created_at).toLocaleString();
    const mode = r.mode === 'live' ? 'LIVE' : 'DEMO';
    return `<tr><td><div class="request-cell"><span class="request-icon">⌘</span><div><b title="${prompt}">${prompt || 'Prompt request'}</b><small>${escapeHtml(date)}</small></div></div></td><td>${escapeHtml(r.model)}</td><td>${Number(r.total_tokens).toLocaleString()}</td><td>${Number(r.latency_ms).toFixed(1)} ms</td><td>${money(r.cost_usd, 6)}</td><td><span class="mode-badge ${r.mode === 'live' ? 'live' : ''}">${mode}</span></td></tr>`;
  }).join('');
}
function renderSummary(data) {
  currentRecords = data.records || [];
  pricing = data.pricing || {};
  const m = data.metrics || {};
  $('requestsMetric').textContent = Number(m.requests || 0).toLocaleString();
  $('tokensMetric').textContent = compact(m.total_tokens || 0);
  $('costMetric').textContent = money(m.total_cost_usd, 4);
  $('latencyMetric').innerHTML = `${Number(m.avg_latency_ms || 0).toFixed(1)} <small>ms</small>`;
  $('donutCost').textContent = money(m.total_cost_usd, 4);
  let input = 0, output = 0;
  currentRecords.forEach(r => {
    const rates = pricing[r.model] || pricing['gpt-4o-mini'] || {input:.15,output:.60};
    input += Number(r.prompt_tokens) * rates.input / 1e6;
    output += Number(r.completion_tokens) * rates.output / 1e6;
  });
  $('inputCost').textContent = money(input, 6);
  $('outputCost').textContent = money(output, 6);
  const total = input + output;
  const inputDeg = total ? input / total * 360 : 0;
  $('costDonut').style.background = total
    ? `conic-gradient(#9c85f1 0deg ${inputDeg}deg,#57cdb3 ${inputDeg}deg 360deg)`
    : 'conic-gradient(#2a3040 0deg 360deg)';
  renderHistory(currentRecords);
  drawChart(currentRecords);
  const live = currentRecords.some(r => r.mode === 'live');
  $('connectionTitle').textContent = live ? 'Live telemetry' : 'Local workspace';
  $('connectionText').textContent = live ? 'Live requests recorded' : 'Demo mode · ready';
  if (live) $('modeNotice').style.display = 'none';
}

async function loadApiStatus() {
  try {
    const response = await fetch('/api/status', {cache: 'no-store'});
    if (!response.ok) throw new Error('Status check failed');
    const status = await response.json();
    const notice = $('modeNotice');
    if (status.api_key_configured) {
      $('modeNoticeTitle').textContent = 'API key detected';
      $('modeNoticeText').textContent = 'The server found an API key. Live requests still require valid provider billing and quota.';
      notice.style.display = 'flex';
    } else {
      $('modeNoticeTitle').textContent = 'Demo mode is active';
      $('modeNoticeText').textContent = 'No API key detected by the server. Add OPENAI_API_KEY to the .env file in the same folder as app.py, then restart the server.';
      notice.style.display = 'flex';
    }
  } catch (e) {
    $('modeNoticeTitle').textContent = 'Unable to check API configuration';
    $('modeNoticeText').textContent = 'Make sure the Flask server is running, then refresh this page.';
  }
}
function showDemoFallback(message) {
  $('modeNoticeTitle').textContent = 'Demo fallback is active';
  $('modeNoticeText').textContent = message || 'The live request could not be completed. The dashboard is showing estimated demo data.';
  $('modeNotice').style.display = 'flex';
}

async function loadSummary() {
  try {
    const response = await fetch('/api/summary');
    if (!response.ok) throw new Error('Unable to load dashboard data.');
    renderSummary(await response.json());
  } catch (e) {
    showError(e.message);
  }
}
function showError(message) {
  $('errorBox').hidden = false;
  $('errorBox').textContent = message;
}
function hideError() {
  $('errorBox').hidden = true;
  $('errorBox').textContent = '';
}
$('promptInput').addEventListener('input', () => {
  $('charCount').textContent = `${$('promptInput').value.length.toLocaleString()} / 12,000 characters`;
});
$('promptForm').addEventListener('submit', async (event) => {
  event.preventDefault(); hideError();
  const button = $('runBtn');
  button.disabled = true; button.innerHTML = '<span>◌</span> Analyzing…';
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        prompt: $('promptInput').value,
        model: $('modelSelect').value,
        max_output_tokens: Number($('maxTokens').value)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error([data.error, data.details].filter(Boolean).join(' '));
    $('resultBox').hidden = false;
    $('resultMode').textContent = data.mode === 'live' ? `Live API · ${data.model}` : `Demo estimate · ${data.model}`;
    $('resultInput').textContent = Number(data.prompt_tokens).toLocaleString();
    $('resultOutput').textContent = Number(data.completion_tokens).toLocaleString();
    $('resultLatency').textContent = `${Number(data.latency_ms).toFixed(1)} ms`;
    $('resultCost').textContent = money(data.cost_usd, 6);
    $('responseText').textContent = data.response || data.response_preview || '';
    $('pricingNote').textContent = data.pricing_note || '';
    if (data.mode === 'demo' && data.pricing_note && data.pricing_note.toLowerCase().includes('fallback')) {
      showDemoFallback(data.pricing_note);
    } else if (data.mode === 'live') {
      $('modeNotice').style.display = 'none';
    }
    await loadSummary();
    $('resultBox').scrollIntoView({behavior:'smooth', block:'nearest'});
  } catch (e) {
    showError(e.message);
  } finally {
    button.disabled = false; button.innerHTML = '<span>▶</span> Analyze prompt';
  }
});
$('closeResult').addEventListener('click', () => $('resultBox').hidden = true);
$('refreshBtn').addEventListener('click', loadSummary);
$('clearHistoryBtn').addEventListener('click', async () => {
  if (!confirm('Delete all locally stored request history? This cannot be undone.')) return;
  try {
    const response = await fetch('/api/history', {method:'DELETE'});
    if (!response.ok) throw new Error('Could not clear history.');
    $('resultBox').hidden = true;
    await loadSummary();
  } catch (e) { showError(e.message); }
});
window.addEventListener('resize', () => drawChart(currentRecords));
loadSummary();
loadApiStatus();
