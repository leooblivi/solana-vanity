// Worker: generates random Solana (ed25519) keypairs and checks the
// base58-encoded public key against the requested pattern.
// Runs entirely in-browser — nothing here ever leaves the device.

// nacl.min.js ships inside this project (no external CDN call, no network
// dependency at runtime, nothing leaves the browser)
importScripts('nacl.min.js');

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes) {
  // standard base58 (bitcoin alphabet), same one Solana addresses use
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

let running = false;
let config = null;
let tries = 0;
let lastReportTries = 0;
const REPORT_EVERY = 1500; // post a progress message every N attempts

function matches(address) {
  const target = config.caseSensitive ? config.keyword : config.keyword.toLowerCase();
  const haystack = config.caseSensitive ? address : address.toLowerCase();
  if (config.position === 'start') return haystack.startsWith(target);
  if (config.position === 'end') return haystack.endsWith(target);
  return haystack.includes(target);
}

function grindBatch() {
  if (!running) return;

  const batchSize = 400;
  for (let i = 0; i < batchSize; i++) {
    const seed = nacl.randomBytes(32);
    const keyPair = nacl.sign.keyPair.fromSeed(seed);
    const address = base58Encode(keyPair.publicKey);
    tries++;

    if (matches(address)) {
      running = false;
      // secretKey from tweetnacl is the 64-byte seed+publicKey, the exact
      // format solana-keygen / the Solana CLI expects in a keypair .json
      postMessage({
        type: 'found',
        address,
        secretKey: Array.from(keyPair.secretKey),
      });
      return;
    }
  }

  if (tries - lastReportTries >= REPORT_EVERY) {
    lastReportTries = tries;
    postMessage({ type: 'progress', tries });
  }

  // yield back to the event loop so postMessage/terminate can interleave
  setTimeout(grindBatch, 0);
}

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'start') {
    config = {
      keyword: msg.keyword,
      position: msg.position,
      caseSensitive: !!msg.caseSensitive,
    };
    tries = 0;
    lastReportTries = 0;
    running = true;
    grindBatch();
  } else if (msg.type === 'stop') {
    running = false;
  }
};
