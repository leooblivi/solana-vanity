# Sol Vanity

Generate a custom Solana wallet address that starts (or ends) with a keyword of your choice — `Leo...`, `fire...`, `1337...` — entirely in your browser.

**Live app:** https://sol-vanity-sage.vercel.app

<img width="504" height="887" alt="image" src="https://github.com/user-attachments/assets/504baa4d-9c2d-49d1-b811-fb349d3fd904" />

## What this is

A vanity address is a normal Solana wallet whose public key happens to contain a pattern you picked, e.g. `Leo8x9Qp2vKmN4rT6sWzYbU3cD7fJ`. There's no way to "design" an address directly — the only way to get one is to generate random keypairs until one matches. This app does exactly that, as fast as your browser allows, using Web Workers to spread the work across your CPU cores.

## Security model

This is the part that matters most, so it's worth stating plainly:

- **Everything runs client-side.** Keypair generation, pattern matching, and encoding all happen in your browser via Web Workers. Nothing is sent to a server, ever.
- **No analytics on key material.** The app doesn't log, transmit, or store the addresses or keys it generates.
- **You control the result.** When a match is found, you choose to copy the private key or download a `.json` keypair file — both actions happen locally, no network request involved.
- **No recovery.** If you lose the downloaded `.json` file or the copied key, the wallet is gone for good. There is no backend, no account, and no way for anyone — including the people running this site — to recover it for you.

Open `app.js` and `worker.js` yourself if you want to verify there's no `fetch`/`XMLHttpRequest` call shipping key data anywhere.

## Features

- Match a 1-4 character keyword at the **start**, **end**, or **anywhere** in the address
- Optional case-sensitive matching
- Live time estimate based on this device's measured speed (deliberately erred on the cautious side — better to overestimate than promise something unrealistic)
- Multi-core brute force via Web Workers (`navigator.hardwareConcurrency`)
- Download the result as a `.json` keypair file compatible with the `solana-keygen` CLI, or copy the base58 secret key for Phantom / Backpack / Solflare import
- A desktop app (Windows / macOS, Rust-native) is in progress for longer keywords (5-7 characters) at much higher speed — web is capped at 4 characters to keep things fast in-browser

## Tech stack

Plain HTML/CSS/JS, no framework, no build step.

- [`tweetnacl`](https://github.com/dchest/tweetnacl-js) for ed25519 keypair generation (bundled locally in `nacl.min.js`, not loaded from a CDN, so the app has zero runtime network dependencies)
- A small hand-rolled base58 encoder (same alphabet Solana addresses use)
- Web Workers for parallel brute-forcing across CPU cores

## Project structure

```
.
├── index.html      UI markup
├── style.css       pixel-art styling
├── app.js          main-thread logic: UI, worker orchestration, estimates, results
├── worker.js       brute-force loop (runs in a Web Worker)
└── nacl.min.js     bundled tweetnacl library
```

## Running locally

This is a static site — any static file server works. Don't open `index.html` directly via `file://`, since Web Workers require an actual HTTP origin.

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed local URL in your browser.

## Deploying

Deploys cleanly to [Vercel](https://vercel.com) as a static project — drag and drop the folder, or connect the repo and deploy with zero configuration.

## Roadmap

- [ ] Windows (.exe) and macOS (.dmg) desktop app, built with Tauri + Rust for native-speed grinding and 5-7 character keywords
- [ ] Code signing for both platforms so downloads don't trigger OS security warnings

## Credits

Built by [@leonardong169](https://x.com/leonardong169) and [@sunnyteehee](https://x.com/sunnyteehee).

Vanity address generation concept based on [Solana's developer cookbook](https://solana.com/vi/developers/cookbook/wallets/generate-vanity-address).

## License

MIT
