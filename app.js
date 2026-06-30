// ---- base58 encode (mirrors worker.js, needed here to render the secret key) ----
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes) {
  let digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let leadingZeros = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) leadingZeros++;
  let result = '';
  for (let i = 0; i < leadingZeros; i++) result += '1';
  for (let i = digits.length - 1; i >= 0; i--) result += B58_ALPHABET[digits[i]];
  return result;
}

// ---- DOM refs ----
const keywordInput = document.getElementById('keyword');
const keywordError = document.getElementById('keyword-error');
const positionRow = document.getElementById('position-row');
const caseSensitiveBox = document.getElementById('case-sensitive');
const estimateValue = document.getElementById('estimate-value');
const estimateDetail = document.getElementById('estimate-detail');
const warningBox = document.getElementById('warning-box');
const grindBtn = document.getElementById('grind-btn');
const stopBtn = document.getElementById('stop-btn');
const progressBox = document.getElementById('progress-box');
const progressFill = document.getElementById('progress-fill');
const progressTries = document.getElementById('progress-tries');
const progressRate = document.getElementById('progress-rate');
const progressEta = document.getElementById('progress-eta');
const resultBox = document.getElementById('result-box');
const resultAddress = document.getElementById('result-address');
const copyKeyBtn = document.getElementById('copy-key-btn');
const saveJsonBtn = document.getElementById('save-json-btn');

// base58 chars Solana addresses can contain — used to reject invalid input
const VALID_CHARS = new Set(B58_ALPHABET.split(''));

let position = 'start';
let workers = [];
let grinding = false;
let totalTries = 0;
let startTime = 0;
let measuredRate = null;
let foundResult = null;

// Fallback only, used for the very first instant before calibration
// finishes. Real devices vary a lot (200/s on a throttled mobile tab to
// 20,000+/s on a fast desktop), so this is deliberately conservative.
const FALLBACK_RATE_PER_CORE = 800;
const cores = navigator.hardwareConcurrency || 4;
let calibratedRatePerCore = null;

function calibrate() {
  const probe = new Worker('worker.js');
  let lastTries = 0;
  probe.onmessage = (e) => {
    if (e.data.type === 'progress') lastTries = e.data.tries;
  };
  // impossible keyword, never matches — we just want raw throughput
  probe.postMessage({ type: 'start', keyword: '\u0000\u0000\u0000', position: 'start', caseSensitive: true });
  setTimeout(() => {
    probe.postMessage({ type: 'stop' });
    probe.terminate();
    if (lastTries > 0) {
      calibratedRatePerCore = lastTries / 0.6;
      updateEstimate();
    }
  }, 600);
}
calibrate();

// ---- keyword validation ----
keywordInput.addEventListener('input', () => {
  let value = keywordInput.value;
  let cleaned = '';
  let hadInvalid = false;
  for (const ch of value) {
    if (VALID_CHARS.has(ch)) {
      cleaned += ch;
    } else {
      hadInvalid = true;
    }
  }
  if (cleaned !== value) keywordInput.value = cleaned;

  if (hadInvalid) {
    keywordError.textContent = '0, O, I and l are not used in base58 addresses — skipped.';
    keywordError.hidden = false;
  } else {
    keywordError.hidden = true;
  }

  updateEstimate();
});

positionRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.pos-btn');
  if (!btn) return;
  position = btn.dataset.pos;
  [...positionRow.children].forEach((b) => b.classList.toggle('active', b === btn));
  updateEstimate();
});

caseSensitiveBox.addEventListener('change', updateEstimate);

// We deliberately overestimate rather than underestimate — better to
// surprise someone with "that was faster than I thought" than the reverse.
// Also floor the display so "< 1 sec" never gets shown for something that
// realistically takes a few seconds once browser overhead is accounted for.
const ESTIMATE_BUFFER = 3;
const MIN_DISPLAYED_SECONDS = 5;

function expectedTries(n, pos, caseSensitive) {
  if (n === 0) return 0;
  const alphabetSize = caseSensitive ? 58 : 33; // ~33 case-insensitive buckets in base58
  const base = Math.pow(alphabetSize, n);
  if (pos === 'anywhere') {
    const addressLen = 44;
    const positions = Math.max(1, addressLen - n);
    return base / positions;
  }
  return base;
}

function formatDuration(seconds) {
  if (seconds < 1) return '< 1 sec';
  if (seconds < 60) return `~${Math.round(seconds)} sec`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `~${(seconds / 3600).toFixed(1)} hr`;
  return `~${(seconds / 86400).toFixed(1)} days`;
}

function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}

function updateEstimate() {
  const keyword = keywordInput.value.trim();
  // warning box is now a standing desktop-app upsell, always visible

  if (!keyword) {
    estimateValue.textContent = '—';
    estimateDetail.textContent = 'type a keyword to see an estimate';
    return;
  }

  const caseSensitive = caseSensitiveBox.checked;
  const tries = expectedTries(keyword.length, position, caseSensitive);
  const rate = measuredRate || (calibratedRatePerCore ? calibratedRatePerCore * cores : FALLBACK_RATE_PER_CORE * cores);
  const seconds = Math.max(MIN_DISPLAYED_SECONDS, (tries / rate) * ESTIMATE_BUFFER);

  estimateValue.textContent = formatDuration(seconds);
  const basis = (measuredRate || calibratedRatePerCore)
    ? "based on this device's speed"
    : 'measuring this device\'s speed...';
  estimateDetail.textContent = `roughly ${formatNumber(tries)} addresses to check. speed depends on your device's power — please be patient. ${basis}.`;
}

updateEstimate();

// ---- grind controls ----
grindBtn.addEventListener('click', startGrind);
stopBtn.addEventListener('click', () => stopGrind(true));

function startGrind() {
  const keyword = keywordInput.value.trim();
  if (!keyword) return;

  foundResult = null;
  resultBox.hidden = true;
  totalTries = 0;
  startTime = performance.now();
  grinding = true;

  grindBtn.hidden = true;
  stopBtn.hidden = false;
  progressBox.hidden = false;
  progressFill.style.width = '0%';
  progressTries.textContent = '0 TRIES';
  progressRate.textContent = '0/s';
  progressEta.textContent = 'ETA —';

  window.addEventListener('beforeunload', beforeUnloadHandler);

  const caseSensitive = caseSensitiveBox.checked;
  const workerCount = Math.max(1, Math.min(cores, 8));
  const progressByWorker = new Array(workerCount).fill(0);

  workers = [];
  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker('worker.js');
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        progressByWorker[i] = msg.tries;
        totalTries = progressByWorker.reduce((a, b) => a + b, 0);
        renderProgress(keyword, caseSensitive);
      } else if (msg.type === 'found') {
        onFound(msg.address, msg.secretKey);
      }
    };
    worker.onerror = (err) => {
      console.error('Vanity worker error:', err.message);
      stopGrind(true);
      estimateDetail.textContent = 'Something went wrong running the search. Try reloading the page.';
    };
    worker.postMessage({ type: 'start', keyword, position, caseSensitive });
    workers.push(worker);
  }
}

function renderProgress(keyword, caseSensitive) {
  const elapsedSec = (performance.now() - startTime) / 1000;
  if (elapsedSec > 0.5) {
    measuredRate = totalTries / elapsedSec;
  }
  const rate = measuredRate || (calibratedRatePerCore ? calibratedRatePerCore * cores : FALLBACK_RATE_PER_CORE * cores);

  progressTries.textContent = `${formatNumber(totalTries)} TRIES`;
  progressRate.textContent = `${formatNumber(rate)}/s`;

  const expected = expectedTries(keyword.length, position, caseSensitive);
  const pct = Math.min(95, (totalTries / expected) * 100);
  progressFill.style.width = `${pct}%`;

  const remaining = Math.max(0, expected - totalTries);
  const etaSec = (remaining / rate) * ESTIMATE_BUFFER;
  progressEta.textContent = `ETA ${formatDuration(etaSec)} left`;
}

function stopGrind(userInitiated) {
  grinding = false;
  workers.forEach((w) => {
    w.postMessage({ type: 'stop' });
    w.terminate();
  });
  workers = [];
  window.removeEventListener('beforeunload', beforeUnloadHandler);

  grindBtn.hidden = false;
  stopBtn.hidden = true;
  if (userInitiated) progressBox.hidden = true;
}

function onFound(address, secretKeyArray) {
  foundResult = { address, secretKeyArray };
  stopGrind(false);
  progressBox.hidden = true;

  const keyword = keywordInput.value.trim();
  resultAddress.innerHTML = highlightMatch(address, keyword, position, caseSensitiveBox.checked);
  resultBox.hidden = false;
}

function highlightMatch(address, keyword, pos, caseSensitive) {
  const haystack = caseSensitive ? address : address.toLowerCase();
  const target = caseSensitive ? keyword : keyword.toLowerCase();
  let idx = -1;
  if (pos === 'start') idx = haystack.startsWith(target) ? 0 : -1;
  else if (pos === 'end') idx = haystack.endsWith(target) ? address.length - keyword.length : -1;
  else idx = haystack.indexOf(target);

  if (idx === -1) return address;
  const before = address.slice(0, idx);
  const match = address.slice(idx, idx + keyword.length);
  const after = address.slice(idx + keyword.length);
  return `${before}<span class="hit">${match}</span>${after}`;
}

function beforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = '';
}

// ---- result actions ----
copyKeyBtn.addEventListener('click', async () => {
  if (!foundResult) return;
  const secretKeyB58 = base58Encode(new Uint8Array(foundResult.secretKeyArray));
  try {
    await navigator.clipboard.writeText(secretKeyB58);
    flashButton(copyKeyBtn, 'COPIED');
  } catch {
    flashButton(copyKeyBtn, 'COPY FAILED');
  }
});

saveJsonBtn.addEventListener('click', () => {
  if (!foundResult) return;
  const blob = new Blob([JSON.stringify(foundResult.secretKeyArray)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${keywordInput.value.trim() || 'vanity'}-${foundResult.address.slice(0, 6)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  flashButton(saveJsonBtn, 'SAVED');
});

function flashButton(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1500);
}

// Desktop builds aren't published yet — swap these hrefs for real release
// URLs (e.g. a GitHub Releases page) once the Windows/macOS app ships.
document.getElementById('download-windows').addEventListener('click', (e) => {
  e.preventDefault();
  alert('Windows app is coming soon — check back shortly!');
});
document.getElementById('download-mac').addEventListener('click', (e) => {
  e.preventDefault();
  alert('macOS app is coming soon — check back shortly!');
});
