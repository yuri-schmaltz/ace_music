# ACE-Step UI — Pinokio Launcher

[![launcher checks](https://github.com/yuri-schmaltz/ace_music/actions/workflows/ci.yml/badge.svg)](https://github.com/yuri-schmaltz/ace_music/actions/workflows/ci.yml)

A [Pinokio](https://pinokio.computer) launcher for [ACE-Step UI](https://github.com/fspecii/ace-step-ui), the local-first web interface for [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) music generation.

The launcher clones both upstream projects into `app/`, installs them, and then starts three processes: the **ACE-Step engine** (Gradio + REST API), the **UI backend** (Express + SQLite) and the **built frontend** (Vite preview server).

> [!IMPORTANT]
> **This repository is a mirror of an upstream project, plus local fixes.**
>
> It mirrors <https://github.com/cocktailpeanut/ace-step-ui.pinokio>. On **2026-10-21** the two repositories had **identical file trees and identical commit history**, both at `96d4993`.
>
> The changes in this repository are **not** upstream and have **not** been pushed back. Before integrating an upstream commit, read [Syncing with upstream](#syncing-with-upstream) — the local fixes touch the same files upstream keeps changing, so a blind merge is not safe. That section also lists **every file** this fork changed.
>
> The upstream ships no `LICENSE` file. This repository therefore grants no license over the upstream files either — see [`NOTICE`](NOTICE).

---

## Table of contents

1. [What the launcher actually does](#what-the-launcher-actually-does)
2. [Requirements](#requirements)
3. [How to use](#how-to-use)
4. [Local URLs and ports](#local-urls-and-ports)
5. [Configuration](#configuration)
6. [First start: the model download](#first-start-the-model-download)
7. [Contract checks](#contract-checks)
8. [Continuous integration](#continuous-integration)
9. [Local API](#local-api)
10. [Known limits and open items](#known-limits-and-open-items)
11. [Reference commits](#reference-commits)
12. [Syncing with upstream](#syncing-with-upstream)

---

## What the launcher actually does

**Install** (`install.js`) runs, in order:

| # | Step | What it does |
|---|------|--------------|
| 1 | `git clone` | Clones `fspecii/ace-step-ui` into `app/` |
| 2 | `git clone` | Clones `ace-step/ACE-Step-1.5` into `app/ACE-Step-1.5` |
| 3 | `node check_compat.js` | Verifies the contract with both upstreams **before** any heavy download ([details](#contract-checks)) |
| 4 | `npm install` + `npm run build` | Installs and builds the frontend in `app/` |
| 5 | `npm install` + `npm run db:migrate` + `npm run build` | Installs, migrates the SQLite schema and compiles the backend in `app/server/` |
| 6 | `uv pip install -e .` | Installs the engine into the `env` virtualenv (Python 3.11) |
| 7 | `fs.link` | Links `app/ACE-Step-1.5/checkpoints` to the shared Pinokio model drive ([details](#first-start-the-model-download)) |

**Start** (`start.js`) runs:

1. `node check_port.js 3001` — pre-flight, fails fast if the fixed backend port is busy.
2. `npm run build` in `app/` and `app/server/` — only if `app/dist` or `app/server/dist` is missing.
3. `acestep --port <port> --enable-api --backend pt --server-name 127.0.0.1` — the engine. The launcher **waits** for the log line `API endpoints enabled` before continuing.
4. `npm run preview -- --host 127.0.0.1 --port <port> --strictPort` — the built frontend. The launcher captures the printed URL and stores it as `local.url`.
5. `npm start` in `app/server/` — the backend, on the fixed port `3001`. The launcher waits for `ACE-Step UI Server running`.

**Update** (`update.js`) pulls the launcher, `app/` and `app/ACE-Step-1.5`, re-runs `node check_compat.js`, re-installs the engine into the virtualenv (`uv pip install -e .`) and rebuilds both npm packages.

**Download Models** (`download_models.js`, optional) runs the engine's `acestep-download` inside the same virtualenv, with `ACESTEP_PROJECT_ROOT` pinned to `app/ACE-Step-1.5`, so the checkpoints are fetched into the linked `checkpoints` folder before the first start.

**Reset** (`reset.js`) deletes the `app/` directory.

---

## Requirements

| Requirement | Notes |
|---|---|
| **Node.js 18+** | The frontend is built and served by Vite 6, which declares `node: "^18.0.0 || ^20.0.0 || >=22.0.0"`. The backend is plain Node with a compiled `better-sqlite3` native module. |
| **Python 3.11** | The launcher creates its virtualenv with `venv_python: "3.11"`, and the engine declares `requires-python = ">=3.11,<3.13"`. |
| **[uv](https://docs.astral.sh/uv/)** | The engine is installed with `uv pip install -e .`. |
| **NVIDIA GPU (CUDA)** | The engine installs CUDA builds of PyTorch (`torch==2.10.0+cu128` on Linux x86_64). The launcher starts it with `--backend pt` and `ACESTEP_LM_OFFLOAD_TO_CPU=true`, i.e. the engine's low-VRAM path — its own compatibility table maps a 6–8 GB card to the 2B turbo DiT with the 0.6B LM. **8 GB+ of VRAM is a comfortable minimum.** |
| **FFmpeg on `PATH`** | The engine exports MP3 by invoking the `ffmpeg` binary and raises `ffmpeg executable not found` when it is missing (`acestep/audio_utils.py` in the engine). |
| **Disk space** | Several GB: the model weights alone are ≈4.7 GB for the 2B DiT, on top of the CUDA PyTorch wheels, the npm dependencies and the SQLite database. |

---

## How to use

1. Click **Install** in Pinokio and wait for it to finish. The console shows every step; the last one is the `fs.link` of the checkpoints folder.
2. Click **Start**. **The first start is slow — see [First start](#first-start-the-model-download).** The Pinokio window may look frozen while the model is downloaded.
3. When the launcher prints the frontend URL, open it with the **Open Web UI** button in the Pinokio menu.

The Pinokio menu offers **Start**, **Update**, **Install**, **Download Models** and **Reset**; while the app is running it shows **Open Web UI** and **Terminal**.

**Download Models** (optional) fetches the checkpoints up front, so that the first **Start** only has to load the model instead of downloading it while the launcher waits. It calls the engine's own `acestep-download` entry point with `ACESTEP_PROJECT_ROOT` pinned to `app/ACE-Step-1.5`, so the files land in the same linked `checkpoints` folder the engine would use anyway. Use it when you know the first start will be on a slow link; it is not required.

---

## Local URLs and ports

| Service | Address | How the port is chosen |
|---|---|---|
| **Frontend (UI)** | `http://127.0.0.1:<port>` | **Dynamic.** Pinokio allocates a free port per step and the launcher passes it to `npm run preview --port <port> --strictPort`. The real URL is parsed from the preview server output and is the one behind the **Open Web UI** button. |
| **Backend API** | `http://127.0.0.1:3001` | **Fixed.** See below. |
| **ACE-Step engine API** | `http://127.0.0.1:<port>` | **Dynamic.** Allocated by Pinokio and passed to the backend as `ACESTEP_API_URL`. The engine binds `127.0.0.1` only. |

### Why the backend port is fixed at 3001

This is not an arbitrary choice — three things in the upstream UI assume port `3001`:

1. **The frontend talks to the backend through a same-origin proxy.** All API calls in the UI use relative paths (`/api/...` — 88 call sites in the upstream frontend sources), and `vite.config.ts` proxies `/api`, `/audio`, `/editor`, `/blog` and `/demucs-web` to `http://127.0.0.1:3001`. Vite's `preview.proxy` defaults to `server.proxy`, so the **built** frontend served by `npm run preview` uses the same target. If the backend moved, the UI would have nothing to talk to.
2. **Two components build an absolute backend URL with `:3001`** — `components/RightSidebar.tsx:321` and `components/SongDropdownMenu.tsx:128` (the "extract stems" links).
3. **The backend's own default is 3001** (`server/src/config/index.ts:11`), and the upstream dev workflow relies on that.

Because the port cannot move, the launcher checks it before starting anything: `node check_port.js 3001` fails with an actionable message instead of leaving a half-started stack with a bare `EADDRINUSE`.

> **Note:** the backend listens on **all interfaces** (`app.listen(config.port, '0.0.0.0')`, `server/src/index.ts:429` in the upstream server) and therefore is reachable from the LAN on port 3001, while the frontend and the engine are bound to `127.0.0.1` only. See [Known limits](#known-limits-and-open-items).

---

## Configuration

**There is no `.env` file.** The launcher never creates one — the upstream README's claim that it "creates a local configuration in `app/.env`" is wrong. Every variable is passed by `start.js` in the `env` block of the backend step.

For reference, the upstream UI ships a **template** at `app/.env.example` (it lists the same variable names, plus `VITE_API_URL`, which the current sources do not use). The launcher neither copies nor creates that file. The backend calls `dotenv.config()` at startup, so it *would* pick up an `app/server/.env` if you created one — but `dotenv` does not override variables that are already set, so the values below always win.

| Variable | Value passed by `start.js` | Read by the server | Effect |
|---|---|---|---|
| `PORT` | `3001` | `server/src/config/index.ts:11` | TCP port of the backend. |
| `ACESTEP_API_URL` | `http://127.0.0.1:<engine port>` | `server/src/config/index.ts:21` | Base URL the backend uses to call the engine API. |
| `NODE_ENV` | `development` | `server/src/config/index.ts:12` | Selects the CORS rule (see below). |
| `DATABASE_PATH` | `./data/acestep.db` | `server/src/config/index.ts:16` | SQLite file, resolved against `app/server/`. |
| `AUDIO_DIR` | `./public/audio` | `server/src/config/index.ts:35` | Audio folder. The current upstream server actually stores and serves audio from `app/server/public/audio` (its own location), which is the same path. |
| `FRONTEND_URL` | `http://127.0.0.1:<frontend port>` | `server/src/config/index.ts:30` | Origin allowed by CORS, and used by the share/oEmbed redirects. It is **not** printed in the startup log. |
| `ACESTEP_PATH` | absolute path to `app/ACE-Step-1.5` | `server/src/routes/generate.ts:601` | Where the engine lives; used by the model/limits helpers. |
| `JWT_SECRET` | `ace-step-ui-local-secret` | `server/src/config/index.ts:46` | Secret used to sign the local JWT. |
| `PEXELS_API_KEY` | `""` (empty placeholder) | `server/src/config/index.ts:26` | Optional Pexels key for video/photo backgrounds. |

The engine process gets four variables of its own: `MASTER_ADDR=127.0.0.1`, `VLLM_HOST_IP=127.0.0.1`, `ACESTEP_LM_BACKEND=pt` and `ACESTEP_LM_OFFLOAD_TO_CPU=true`.

### Enabling `PEXELS_API_KEY`

`PEXELS_API_KEY` is shipped **empty** in `start.js`. To use it:

1. Open `start.js` and find the backend step (`shell.run`, `path: "app/server"`).
2. Replace the placeholder with your key:
   ```js
   PEXELS_API_KEY: "your-key-here"
   ```
3. Restart the app.

The key is optional. Without it, the video-background feature answers `400 Pexels API key not configured`, and the UI also accepts a key typed in the browser (sent per request in the `X-Pexels-Api-Key` header), so the env var is only a server-side default.

### `NODE_ENV` is `development` on purpose

The upstream server's CORS rule (`server/src/index.ts:55-77`) accepts **any** `localhost`/`127.0.0.1` origin (any port) and LAN addresses **only** when `NODE_ENV === "development"`; in `production` it requires an exact match with `FRONTEND_URL`, which is a dynamic port. With `production`, opening the UI as `http://localhost:<port>` (instead of `http://127.0.0.1:<port>`) or from another machine on the LAN is rejected with `Not allowed by CORS`. The launcher therefore runs the local, non-exposed backend in development mode.

---

## First start: the model download

**No model is downloaded during Install.** The `fs.link` step only *links* the folder `app/ACE-Step-1.5/checkpoints` into the shared Pinokio model drive, so the checkpoints are shared with the sibling apps `cocktailpeanut/ace-step.pinokio` and `cocktailpeanut/ace-step-ui.pinokio` instead of being downloaded twice. (The sibling `ace-step.pinokio` app *does* download the models at install time with `uv run acestep-download`; this launcher does not.)

The download happens **inside the engine process, during the first Start**:

1. The engine initializes the DiT model and the LM, downloading the checkpoints into `app/ACE-Step-1.5/checkpoints` (which is the linked folder) if they are not there yet.
2. Only **after** that does it print `API endpoints enabled: /health, /v1/models, ...`.
3. The launcher waits for that exact line before it starts the frontend and the backend.

Consequences: **the first Start can take a long time** — the checkpoints are a multi-GB download plus the model initialization — and the Pinokio window looks stuck. This is expected: watch the **Terminal** tab for the download progress. Subsequent starts reuse the downloaded checkpoints and are much faster.

**Doing the download ahead of time.** The **Download Models** entry of the Pinokio menu runs the engine's own `acestep-download` command (`download_models.js`) in the engine's virtualenv, with `ACESTEP_PROJECT_ROOT` pinned to `app/ACE-Step-1.5` so the files land in the linked `checkpoints` folder. The default is the main model (including the 1.7B LM); the engine's own CLI also accepts `--all`, `--model <name>`, `--list` and `--dir <path>` if you want a different set — run it by hand inside `app/ACE-Step-1.5` with the virtualenv activated.

---

## Contract checks

Both upstreams are cloned **without a pinned version** (see [Known limits](#known-limits-and-open-items)), so the launcher verifies that the upstream still matches what it expects. The two scripts use only Node built-ins — no dependencies.

### `node check_compat.js [ROOT]`

Runs during **Install** (right after the two clones, before any npm/torch download) and during **Update** (right after the `git pull`). `ROOT` is optional and defaults to `app/`; relative paths are resolved against the script's own directory. Exit code `0` = contract intact, `1` = broken, with a per-item report and a "what to do" message.

| # | Check | Files inspected |
|---|---|---|
| 1 | `package.json` has the `build` and `preview` scripts | `app/package.json` |
| 2 | `vite.config.ts` declares a proxy for `/api` | `app/vite.config.ts` |
| 3 | `server/package.json` has the `build`, `start` and `db:migrate` scripts | `app/server/package.json` |
| 4 | The server prints the banner the launcher waits for | `app/server/src/index.ts` (`ACE-Step UI Server running`) |
| 5 | The engine declares `requires-python` and a `torchao` range that covers the 0.16.x series (the range found is printed) | `app/ACE-Step-1.5/pyproject.toml` |
| 6 | The engine still exposes the CLI the launcher calls: `--enable-api`, `--port`, `--server-name`, `--backend` and the string `API endpoints enabled` | `app/ACE-Step-1.5/acestep/acestep_v15_pipeline.py` |
| 7 | No launcher script pins `torchao` manually below `0.16` (the engine already declares the right range itself) | every `.js` file next to the launcher |

### `node check_port.js [PORT]`

The pre-flight of the fixed backend port. `PORT` is optional and defaults to `3001`. It binds `0.0.0.0:PORT` to test availability — the same address the backend uses — and exits `0` when the port is free, `1` when it is busy, with a message naming the port and telling you how to release it (`lsof -i :3001` / `netstat -ano | findstr :3001`). It runs as the **first** step of `start.js`, before the engine (the most expensive step) is launched.

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push and on every pull request, and does exactly what a developer can do by hand:

| Step | What it proves |
|---|---|
| `node --check` on every `.js` | no launcher script has a syntax error |
| smoke test | every script loads, and the Pinokio menu renders the expected entries (including **Download Models**) |
| `node check_port.js 3001` | the port pre-flight passes on a free port |
| clone both upstreams and run `node check_compat.js app` | the **latest** upstream still matches the contract the launcher expects |
| grep for manual `torchao` pins | the launcher never overrides the engine's own dependency range |

The contract step clones the current `main` of both upstreams on every run, so an upstream change that breaks the launcher fails the build instead of failing on a user's machine. The workflow needs no secrets and no GPU.

---

## Local API

The UI backend exposes local endpoints on `http://127.0.0.1:3001`. The minimal flow is:

1. Create or fetch a local user via `POST /api/auth/setup` to get a JWT token.
2. Start a generation job with `POST /api/generate` using the token.
3. Poll status with `GET /api/generate/status/:jobId` using the token.

These routes exist in the current upstream: `POST /api/auth/setup` (`server/src/routes/auth.ts:61`), `POST /api/generate` (`server/src/routes/generate.ts:210`) and `GET /api/generate/status/:jobId` (`server/src/routes/generate.ts:366`), all mounted under `/api/...` in `server/src/index.ts:401-403`.

`POST /api/generate` accepts (among others) `customMode`, `songDescription` and `instrumental`; body fields are destructured in `server/src/routes/generate.ts:212-268` (55 fields); the ones below are a subset (`lyrics`, `style`, `title`, `vocalLanguage`, `duration`, `bpm`, `keyScale`, `timeSignature`, `inferenceSteps`, `guidanceScale`, `batchSize`, `randomSeed`, `seed`, `thinking`, `audioFormat`, `inferMethod`, `shift`, `lmTemperature`, `lmCfgScale`, `lmTopK`, `lmTopP`, `lmNegativePrompt`, `lmBackend`, `lmModel`, `referenceAudioUrl`, `sourceAudioUrl`, `referenceAudioTitle`, `sourceAudioTitle`, `audioCodes`, `repaintingStart`, `repaintingEnd`, `instruction`, `audioCoverStrength`, `taskType`, `useAdg`, …).

JavaScript:

```javascript
const base = "http://127.0.0.1:3001";

const setupRes = await fetch(`${base}/api/auth/setup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "localuser" })
});
const { token } = await setupRes.json();

const genRes = await fetch(`${base}/api/generate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({
    customMode: false,
    songDescription: "An upbeat pop song about summer adventures",
    instrumental: false
  })
});
const { jobId } = await genRes.json();

const statusRes = await fetch(`${base}/api/generate/status/${jobId}`, {
  headers: { "Authorization": `Bearer ${token}` }
});
const status = await statusRes.json();
console.log(status);
```

Python:

```python
import requests

base = "http://127.0.0.1:3001"

setup = requests.post(f"{base}/api/auth/setup", json={"username": "localuser"})
setup.raise_for_status()
token = setup.json()["token"]

gen = requests.post(
    f"{base}/api/generate",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "customMode": False,
        "songDescription": "An upbeat pop song about summer adventures",
        "instrumental": False,
    },
)
gen.raise_for_status()
job_id = gen.json()["jobId"]

status = requests.get(
    f"{base}/api/generate/status/{job_id}",
    headers={"Authorization": f"Bearer {token}"},
)
status.raise_for_status()
print(status.json())
```

Curl:

```bash
curl -s http://127.0.0.1:3001/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"localuser"}'
```

```bash
curl -s http://127.0.0.1:3001/api/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"customMode":false,"songDescription":"An upbeat pop song about summer adventures","instrumental":false}'
```

```bash
curl -s http://127.0.0.1:3001/api/generate/status/YOUR_JOB_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Health checks

```bash
# Is the engine reachable? -> {"healthy": true, "aceStepUrl": "http://127.0.0.1:<engine port>"}
curl -s http://127.0.0.1:3001/api/generate/health

# Is the backend alive? -> {"status":"ok","service":"ACE-Step UI API"}
curl -s http://127.0.0.1:3001/health
```

`GET /api/generate/health` (`server/src/routes/generate.ts:696`) needs no token and reports whether the engine API answers.

---

## Known limits and open items

| Item | Detail | Mitigation / status |
|---|---|---|
| **Fixed backend port** | The backend always listens on `3001` (see [why](#why-the-backend-port-is-fixed-at-3001)). Two apps running side by side will collide. | `node check_port.js 3001` fails the start with an actionable message instead of a half-started stack. **Not fixed.** |
| **Upstreams are not version-pinned** | Install clones the default branch of `fspecii/ace-step-ui` and `ace-step/ACE-Step-1.5` — no tag, no SHA. The engine's HEAD (`ca1e85f`, 2026-08-29) is already 43 days newer than the launcher's last upstream commit (2026-07-17), so a fresh install can get a different code base than the one this launcher was verified against. | The contract checker (`check_compat.js`) fails early when the upstream breaks the expected surface. This is a *detection* mitigation, not a pin. Pinning by SHA was rejected: the UI has no tag and no release, and the engine's tags (`v0.1.0`…`v0.1.8`) do not track its `1.5.0` version, so a tag pin would select the wrong code. **Open.** |
| **No unit-test suite** | There is no test suite for the launcher itself. The only executable checks are `check_compat.js` and `check_port.js`, and they run **automatically** during Install, Update and Start (see [Contract checks](#contract-checks)) and in CI (see [Continuous integration](#continuous-integration)). | **Partially mitigated.** The contract is verified against the latest upstream on every push; the launcher scripts themselves are only syntax-checked and smoke-tested. |
| **No LICENSE file** | Neither this launcher nor the upstream launcher ships a `LICENSE` file, so the terms for the launcher itself are undefined. The engine is MIT (`license = {text = "MIT"}` in its `pyproject.toml`); the UI's README states MIT as well, but its repository also contains no `LICENSE` file. | **Open — pending a decision. No `LICENSE` file has been added.** The attribution and the reasoning behind not adding one are written up in [`NOTICE`](NOTICE). |
| **Backend is reachable from the LAN** | The upstream server binds `0.0.0.0` (`server/src/index.ts:429`), so port `3001` is open to the local network. The frontend and the engine are bound to `127.0.0.1` only. | The backend is a single-user local app with a fixed `JWT_SECRET` (`ace-step-ui-local-secret`) and a token that expires after 365 days. Do not expose the port to an untrusted network. **Open.** |
| **No `GEMINI_API_KEY`** | The launcher does not set it, and the upstream frontend bakes it in at build time (`vite.config.ts`). Without a key, the "generate title/lyrics" helper returns a hard-coded mock response instead of calling the API. | Optional feature, degrades gracefully. **Open.** |
| **`AUDIO_DIR` is effectively decorative** | The current upstream server derives the audio folder from its own location (`app/server/public/audio`) and ignores `config.storage.audioDir` for the actual read/write path. The launcher passes a value that resolves to the same place. | Cosmetic only. **Open.** |
| **The first start downloads the models** | The Install step does not fetch the checkpoints; the first Start does, inside the engine process. | **Mitigated.** The **Download Models** menu entry (`download_models.js`) runs the engine's `acestep-download` console script (`acestep.model_downloader:main`) on demand, with `ACESTEP_PROJECT_ROOT` pinned to `app/ACE-Step-1.5`, so the download can be done before the first Start. |

---

## Reference commits

These are the exact upstream revisions this README was verified against:

| Project | Commit | Date |
|---|---|---|
| `fspecii/ace-step-ui` | `a1fdf91829ec6f7b98844f80e323529cd155dbf2` | 2026-06-27 |
| `ace-step/ACE-Step-1.5` | `ca1e85fe9430179831e6bc6be790c332190a3866` | 2026-08-29 |
| `cocktailpeanut/ace-step-ui.pinokio` (upstream launcher) | `96d4993cce5e16932673376b1f7430f18bfc57ba` | 2026-07-17 |

To check a specific revision by hand (read-only):

```bash
git clone https://github.com/fspecii/ace-step-ui.git /tmp/ui && git -C /tmp/ui checkout a1fdf91829ec6f7b98844f80e323529cd155dbf2
git clone https://github.com/ace-step/ACE-Step-1.5.git /tmp/engine && git -C /tmp/engine checkout ca1e85fe9430179831e6bc6be790c332190a3866
```

---

## Syncing with upstream

The upstream repository is <https://github.com/cocktailpeanut/ace-step-ui.pinokio>. `origin` points to this mirror; the upstream is configured as a **second remote** named `upstream` in the working clone:

```bash
git remote -v                                 # origin = this mirror, upstream = cocktailpeanut
git fetch upstream
git log --oneline HEAD..upstream/main         # commits upstream has that this repo does not
git diff HEAD upstream/main -- install.js start.js update.js
```

If your clone does not have it yet:

```bash
git remote add upstream https://github.com/cocktailpeanut/ace-step-ui.pinokio.git
git fetch upstream
```

On 2026-10-22 the mirror was still exactly `upstream/main` (`96d4993`) plus the local fixes below — `git log HEAD..upstream/main` returned nothing.

**Review before integrating.** The local fixes touch the same files upstream keeps changing:

- `install.js` — the `torchao` pin was removed and `check_compat.js` was added as a step.
- `update.js` — `uv pip install -e .` was added, plus `check_compat.js`.
- `start.js` — `NODE_ENV` changed to `development`, `PEXELS_API_KEY` added, and the `check_port.js` pre-flight added.
- `check_compat.js`, `check_port.js` — new files.
- `download_models.js` — new file (optional pre-download of the checkpoints).
- `pinokio.js` — new **Download Models** entry in the menu.
- `.github/workflows/ci.yml` — new file (the checks described above).
- `NOTICE` — new file (attribution; no license is granted over the upstream files).

A merge that reintroduces the old `torchao<0.16` pin, drops the `check_compat.js` step or resets `NODE_ENV` to `production` will silently undo the fixes. The contract checker catches the first one (`check_compat.js`, item 7); the other two are worth a manual look.

---

## Credits

- [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) — the engine (MIT).
- [ACE-Step UI](https://github.com/fspecii/ace-step-ui) — the web interface.
- [cocktailpeanut/ace-step-ui.pinokio](https://github.com/cocktailpeanut/ace-step-ui.pinokio) — the upstream Pinokio launcher this repository mirrors.
