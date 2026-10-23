#!/usr/bin/env node
/**
 * verify.js - portao de verificacao do launcher ACE-Step UI (Pinokio).
 *
 * Roda todas as checagens que o projeto garante:
 *   - sintaxe de todos os scripts
 *   - o check de contrato contra os dois upstreams, nos DOIS lados
 *     (passa no layout real e falha num layout quebrado de proposito)
 *   - o pre-flight de porta, nos dois lados (livre e ocupada)
 *   - coerencia do fluxo do Pinokio (ordem dos passos, env, regexes de evento)
 *   - o contrato com o upstream (flags, strings e scripts que o launcher espiona)
 *   - a veracidade das afirmacoes factuais do README
 *   - os artefatos do projeto (menu, pre-download, CI, NOTICE)
 *
 * Uso:
 *   node tools/verify.js                       # usa app/ se existir, senao clona os upstreams
 *   node tools/verify.js --root /tmp/app       # usa um layout ja montado
 *   node tools/verify.js --base origin/main    # compara os arquivos alterados com uma base
 *   node tools/verify.js --no-clone            # nao clona nada (falha se app/ estiver vazio)
 *
 * Saida: 0 = tudo verde, 1 = alguma checagem falhou.
 * Nao usa dependencias externas (apenas Node built-ins) e nao precisa de GPU.
 */
"use strict"

const { execFileSync, spawn } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

// ------------------------------------------------------------------ opcoes
const argv = process.argv.slice(2)
function opt (name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const REPO = path.resolve(opt("--repo", process.env.GATE_REPO || path.join(__dirname, "..")))
const BASE = opt("--base", process.env.GATE_BASE || "")
const NO_CLONE = argv.includes("--no-clone")
const UI_REPO = "https://github.com/fspecii/ace-step-ui.git"
const ENGINE_REPO = "https://github.com/ace-step/ACE-Step-1.5.git"

// Arquivos que o launcher possui. Qualquer alteracao fora desta lista e um erro
// de escopo (e a lista cresce junto com o projeto, de proposito).
const OWNED_FILES = [
  ".github/workflows/ci.yml",
  ".gitignore",
  "HANDOFF.md",
  "NOTICE",
  "README.md",
  "check_compat.js",
  "check_port.js",
  "download_models.js",
  "icon.jpeg",
  "install.js",
  "pinokio.js",
  "pinokio.json",
  "reset.js",
  "start.js",
  "tools/verify.js",
  "update.js"
].sort()

let pass = 0
let fail = 0
const fails = []

function chk (label, cond, extra) {
  if (cond) {
    pass++
    console.log("  [OK  ] " + label + (extra !== undefined ? "  -> " + extra : ""))
  } else {
    fail++
    fails.push(label + (extra !== undefined ? " -> " + extra : ""))
    console.log("  [FAIL] " + label + (extra !== undefined ? "  -> " + extra : ""))
  }
}
function sh (cmd, args, opts) {
  try {
    const out = execFileSync(cmd, args, Object.assign({ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }, opts || {}))
    return { code: 0, out }
  } catch (e) {
    return { code: e.status === undefined ? 1 : e.status, out: (e.stdout || "") + (e.stderr || "") }
  }
}
function git (args, cwd) { return sh("git", (cwd ? ["-C", cwd] : []).concat(args)) }
// leitura que nao derruba o script quando o arquivo nao existe: vira um FAIL limpo
function readOrNull (file) {
  try { return fs.readFileSync(file, "utf8") } catch (_) { return null }
}

// ------------------------------------------------- preparar o layout do app
function clone (url, dest) {
  // O sandbox de CI nao sempre tem a CA do sistema; tenta normal e depois sem SSL.
  let r = sh("git", ["clone", "--depth", "1", url, dest])
  if (r.code !== 0) r = sh("git", ["-c", "http.sslVerify=false", "clone", "--depth", "1", url, dest])
  return r.code === 0
}

let root = path.resolve(REPO, opt("--root", "app"))
let tempRoot = null
const appReady = fs.existsSync(path.join(root, "package.json")) &&
  fs.existsSync(path.join(root, "server", "package.json")) &&
  fs.existsSync(path.join(root, "ACE-Step-1.5", "pyproject.toml"))

if (!appReady) {
  if (NO_CLONE) {
    console.error("verify: layout nao encontrado em " + root + " e --no-clone foi usado")
    process.exit(1)
  }
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ace-verify-"))
  root = tempRoot
  console.log("verify: clonando os upstreams em " + root)
  if (!clone(UI_REPO, path.join(root, "ace-step-ui"))) {
    console.error("verify: falha ao clonar " + UI_REPO)
    process.exit(1)
  }
  // O check de contrato espera o clone da UI na raiz do layout: cada entrada do
  // clone vira um symlink na raiz. O clone original e MANTIDO - os symlinks
  // apontam para dentro dele.
  const uiEntries = fs.readdirSync(path.join(root, "ace-step-ui"))
  for (const e of uiEntries) {
    try { fs.symlinkSync(path.join(root, "ace-step-ui", e), path.join(root, e)) } catch (_) {}
  }
  if (!clone(ENGINE_REPO, path.join(root, "ACE-Step-1.5"))) {
    console.error("verify: falha ao clonar " + ENGINE_REPO)
    process.exit(1)
  }
}

const UI = root
const ENGINE = path.join(root, "ACE-Step-1.5")

console.log("=".repeat(78))
console.log("verify — portao de verificacao do launcher ACE-Step UI")
console.log("=".repeat(78))
console.log("launcher: " + REPO)
console.log("layout  : " + root + (tempRoot ? "  (clonado para esta execucao)" : ""))
console.log("")

// ------------------------------------------------------- 1. escopo das mudancas
console.log("[1] Escopo das mudancas")
const status = git(["status", "--porcelain", "-uall"], REPO).out.split("\n").filter((l) => l.trim().length)
const workingTreeFiles = status.map((l) => l.replace(/^.. /, "").trim())
let baseResolved = null
for (const candidate of [BASE, "origin/main", "main"].filter(Boolean)) {
  if (git(["rev-parse", "--verify", candidate + "^{commit}"], REPO).code === 0) { baseResolved = candidate; break }
}
let committedFiles = []
if (baseResolved) {
  committedFiles = git(["diff", "--name-only", baseResolved, "HEAD"], REPO).out.split("\n").filter((l) => l.trim())
}
const changed = Array.from(new Set(workingTreeFiles.concat(committedFiles))).sort()
const outside = changed.filter((f) => !OWNED_FILES.includes(f))
chk("nenhum arquivo alterado fora do conjunto do launcher", outside.length === 0, outside.join(", ") || "nenhum")
console.log("      base: " + (baseResolved || "(nenhuma resolvivel - so o working tree foi conferido)"))
console.log("      arquivos no escopo: " + (changed.join(", ") || "(nenhum)"))
console.log("      diff --stat:\n" + git(["diff", "--stat"], REPO).out.trim().split("\n").map((l) => "        " + l).join("\n"))

// ------------------------------------------------------------ 2. sintaxe
console.log("\n[2] Sintaxe (node --check) em todos os .js")
const launcherJs = fs.readdirSync(REPO).filter((f) => f.endsWith(".js")).sort()
for (const f of launcherJs) {
  chk("node --check " + f, sh("node", ["--check", path.join(REPO, f)]).code === 0)
}
const toolsJs = fs.existsSync(path.join(REPO, "tools"))
  ? fs.readdirSync(path.join(REPO, "tools")).filter((f) => f.endsWith(".js"))
  : []
for (const f of toolsJs) {
  chk("node --check tools/" + f, sh("node", ["--check", path.join(REPO, "tools", f)]).code === 0)
}

// ------------------------------------------- 3. check de contrato (2 lados)
console.log("\n[3] check_compat.js — precisa passar no layout real e falhar no quebrado")
const layout = fs.mkdtempSync(path.join(os.tmpdir(), "ace-verify-layout-"))
for (const e of fs.readdirSync(UI)) {
  try { fs.symlinkSync(path.join(UI, e), path.join(layout, e)) } catch (_) {}
}
try { fs.symlinkSync(ENGINE, path.join(layout, "ACE-Step-1.5")) } catch (_) {}

const good = sh("node", [path.join(REPO, "check_compat.js"), layout])
chk("layout real -> exit 0", good.code === 0, "exit " + good.code)
chk("layout real -> 7/7 itens OK", /7\/7 itens OK/.test(good.out))
chk("faixa de torchao do engine reportada", /torchao>=0\.16\.0,<0\.17\.0/.test(good.out))

const broken = fs.mkdtempSync(path.join(os.tmpdir(), "ace-verify-broken-"))
fs.cpSync(layout, broken, { recursive: true, dereference: false })
fs.rmSync(path.join(broken, "vite.config.ts"), { force: true })
const bad = sh("node", [path.join(REPO, "check_compat.js"), broken])
chk("layout quebrado -> exit != 0", bad.code !== 0, "exit " + bad.code)
chk("layout quebrado -> acusa o item 2", /\[2\]/.test(bad.out))
fs.rmSync(layout, { recursive: true, force: true })
fs.rmSync(broken, { recursive: true, force: true })

// ------------------------------------------------- 4. pre-flight de porta (2 lados)
console.log("\n[4] check_port.js — porta livre vs porta ocupada")
const free = sh("node", [path.join(REPO, "check_port.js"), "3001"])
chk("porta livre -> exit 0", free.code === 0, "exit " + free.code)
chk("porta livre -> mensagem de sucesso", /is free/.test(free.out))

const BUSY = 4571
const server = spawn(process.execPath, ["-e", "require('http').createServer((q,s)=>s.end('x')).listen(" + BUSY + ")"], { stdio: "ignore" })
setTimeout(() => {
  const busy = sh("node", [path.join(REPO, "check_port.js"), String(BUSY)])
  chk("porta ocupada -> exit != 0", busy.code !== 0, "exit " + busy.code)
  chk("porta ocupada -> mensagem cita a porta", busy.out.includes(String(BUSY)))
  chk("porta ocupada -> contem 'error:' (e o Pinokio que aborta o start)", /error:/.test(busy.out))
  server.kill()

  // ---------------------------------------------------- 5. coerencia do fluxo
  console.log("\n[5] Coerencia do fluxo do Pinokio")
  const start = require(path.join(REPO, "start.js"))
  const install = require(path.join(REPO, "install.js"))
  const update = require(path.join(REPO, "update.js"))
  chk("start.js: daemon true", start.daemon === true)
  chk("start.js: 8 passos", start.run.length === 8, start.run.length)
  chk("start.js: passo 0 e o pre-flight de porta", start.run[0].params.message[0] === "node check_port.js 3001")
  const evts = start.run.flatMap((s) => (s.params && s.params.on) || []).map((h) => h.event)
  chk("start.js: regex 'API endpoints enabled' preservada", evts.includes("/API endpoints enabled/i"))
  chk("start.js: regex 'ACE-Step UI Server running' preservada", evts.includes("/ACE-Step UI Server running/"))
  chk("start.js: regex da URL do preview preservada", evts.some((e) => e.includes("http")))
  chk("start.js: comando do engine preservado",
    start.run[4].params.message[0] === "acestep --port {{local.api_port}} --enable-api --backend pt --server-name 127.0.0.1")
  chk("start.js: frontend ainda em 'npm run preview'", /npm run preview/.test(start.run[5].params.message[0]))
  chk("start.js: backend ainda em 'npm start'", start.run[7].params.message[0] === "npm start")
  chk("start.js: backend na porta fixa 3001", start.run[7].params.env.PORT === "3001")
  chk("start.js: NODE_ENV development (CORS por match exato no modo production)",
    start.run[7].params.env.NODE_ENV === "development")
  chk("start.js: PEXELS_API_KEY presente e vazio", start.run[7].params.env.PEXELS_API_KEY === "")
  chk("start.js: 9 variaveis de ambiente no backend", Object.keys(start.run[7].params.env).length === 9,
    Object.keys(start.run[7].params.env).join(","))
  const engineStep = install.run.find((s) => s.params && s.params.path === "app/ACE-Step-1.5")
  chk("install.js: passo de venv do engine existe", !!engineStep)
  chk("install.js: venv env + venv_python 3.11", engineStep.params.venv === "env" && engineStep.params.venv_python === "3.11")
  chk("install.js: uv pip install -e . presente",
    engineStep.params.message.some((m) => m.includes("uv pip install -e .")))
  chk("install.js: nenhum pin de torchao", !JSON.stringify(install).includes("torchao<"))
  const compatIdx = (arr) => arr.findIndex((s) => Array.isArray(s.params.message) && s.params.message.includes("node check_compat.js"))
  chk("install.js: check_compat roda antes do build pesado",
    compatIdx(install.run) < install.run.findIndex((s) => s.params.path === "app"))
  const updEngine = update.run.find((s) => s.params && s.params.path === "app/ACE-Step-1.5" && s.params.venv === "env")
  chk("update.js: reinstall do engine presente", !!updEngine && updEngine.params.message.some((m) => m.includes("uv pip install -e .")))
  chk("update.js: git pull do engine vem antes do pip install",
    update.run.findIndex((s) => s.params.path === "app/ACE-Step-1.5" && s.params.message === "git pull") <
    update.run.findIndex((s) => s.params.path === "app/ACE-Step-1.5" && s.params.venv === "env"))

  // --------------------------------------------- 6. contrato com o upstream
  console.log("\n[6] Contrato com o upstream (as strings que o launcher espiona)")
  const pipe = readOrNull(path.join(ENGINE, "acestep/acestep_v15_pipeline.py")) || ""
  for (const flag of ["--enable-api", "--port", "--server-name", "--backend"]) {
    chk("engine expoe " + flag, pipe.includes(flag))
  }
  chk("engine imprime 'API endpoints enabled'", pipe.includes("API endpoints enabled"))
  const enginePyproject = readOrNull(path.join(ENGINE, "pyproject.toml")) || ""
  chk("engine declara requires-python >=3.11,<3.13", /requires-python\s*=\s*">=3\.11,<3\.13"/.test(enginePyproject))
  chk("engine declara torchao >=0.16.0,<0.17.0", /torchao>=0\.16\.0,<0\.17\.0/.test(enginePyproject))
  const srv = readOrNull(path.join(UI, "server/src/index.ts")) || ""
  chk("server imprime 'ACE-Step UI Server running'", srv.includes("ACE-Step UI Server running"))
  const uiPkg = JSON.parse(readOrNull(path.join(UI, "package.json")) || "{}")
  const srvPkg = JSON.parse(readOrNull(path.join(UI, "server/package.json")) || "{}")
  chk("UI tem scripts build e preview", !!(uiPkg.scripts.build && uiPkg.scripts.preview))
  chk("server tem scripts build, start e db:migrate",
    !!(srvPkg.scripts.build && srvPkg.scripts.start && srvPkg.scripts["db:migrate"]))
  chk("vite.config.ts tem proxy para /api",
    (readOrNull(path.join(UI, "vite.config.ts")) || "").includes("'/api'"))

  // ------------------------------------------------------------ 7. sem pins
  console.log("\n[7] torchao — nenhum pin manual sobrou no launcher")
  const pinHits = launcherJs.concat(toolsJs.map((f) => "tools/" + f))
    .filter((f) => /torchao\s*<\s*0?\.\d+/.test(readOrNull(path.join(REPO, f)) || ""))
  chk("nenhum .js do launcher fixa torchao", pinHits.length === 0, pinHits.join(", "))

  // ------------------------------------------------ 8. veracidade do README
  console.log("\n[8] Verdade do README (afirmacoes factuais checadas)")
  const rd = readOrNull(path.join(REPO, "README.md")) || ""
  const realCount = sh("bash", ["-c", "grep -roF '/api/' components/ services/ App.tsx | wc -l"], { cwd: UI }).out.trim()
  chk("README: contagem de call sites = 88 (confere com o grep real)",
    rd.includes("88 call sites") && realCount === "88", "grep real: " + realCount)
  chk("README: nao afirma que FRONTEND_URL e impresso no startup log",
    !/FRONTEND_URL[^|]*printed in the startup log\./.test(rd))
  chk("README: diz que os checks rodam automaticamente (nao 'run by hand')",
    !rd.includes("run by hand") && /automatically/.test(rd))
  chk("README: cita server/src/index.ts:429 (linha da chamada, nao do comentario)",
    rd.includes("server/src/index.ts:429") && !rd.includes("server/src/index.ts:428"))
  chk("README: cita o intervalo 212-268 dos campos do body",
    rd.includes("server/src/routes/generate.ts:212-268") && !rd.includes("210-240"))
  chk("README: nao promete criar app/.env", !/Creates a local configuration in `app\/\.env`/.test(rd))
  chk("README: documenta os dois checks executaveis", rd.includes("check_compat.js") && rd.includes("check_port.js"))
  chk("README: documenta que e um espelho do upstream cocktailpeanut",
    rd.includes("cocktailpeanut/ace-step-ui.pinokio"))
  chk("README: endpoints citados existem no servidor upstream",
    ["router.post('/setup'", "router.post('/',", "router.get('/status/:jobId'", "router.get('/health'"]
      .every((needle) => {
        const a = readOrNull(path.join(UI, "server/src/routes/auth.ts")) || ""
        const g = readOrNull(path.join(UI, "server/src/routes/generate.ts")) || ""
        return (a + g).includes(needle)
      }))

  // --------------------------------------- 9. artefatos do projeto
  console.log("\n[9] Artefatos do projeto (menu, pre-download, CI, NOTICE, handoff)")
  const dm = require(path.join(REPO, "download_models.js"))
  const dmStep = dm.run[0].params
  chk("download_models.js: usa o venv do engine (env / 3.11)",
    dmStep.venv === "env" && dmStep.venv_python === "3.11")
  chk("download_models.js: roda em app/ACE-Step-1.5", dmStep.path === "app/ACE-Step-1.5")
  chk("download_models.js: fixa ACESTEP_PROJECT_ROOT no dir do engine",
    typeof dmStep.env.ACESTEP_PROJECT_ROOT === "string" && dmStep.env.ACESTEP_PROJECT_ROOT.endsWith("app/ACE-Step-1.5"))
  chk("download_models.js: chama acestep-download", dmStep.message.some((m) => m.includes("acestep-download")))

  const menuFn = require(path.join(REPO, "pinokio.js")).menu
  ;(async () => {
    const items = await menuFn({}, { exists: () => true, running: () => false, local: () => undefined })
    chk("pinokio.js: menu expoe 'Download Models'", items.some((i) => i.text === "Download Models"))
    const busy = await menuFn({}, { exists: () => true, running: (s) => s === "download_models.js", local: () => undefined })
    chk("pinokio.js: menu mostra 'Downloading Models' durante o download",
      busy.length === 1 && busy[0].text === "Downloading Models")
    const notInstalled = await menuFn({}, { exists: () => false, running: () => false, local: () => undefined })
    chk("pinokio.js: sem install, o menu so expoe Install",
      notInstalled.length === 1 && notInstalled[0].text === "Install")
  })()

  const ciPath = path.join(REPO, ".github/workflows/ci.yml")
  chk(".github/workflows/ci.yml existe", fs.existsSync(ciPath))
  const ci = fs.existsSync(ciPath) ? fs.readFileSync(ciPath, "utf8") : ""
  chk("CI: roda o portao de verificacao", ci.includes("tools/verify.js"))
  chk("CI: delega as regras ao portao em vez de duplica-las", !ci.includes("torchao"))
  chk("CI: nao usa secrets", !/secrets\./.test(ci))

  const noticePath = path.join(REPO, "NOTICE")
  chk("NOTICE existe", fs.existsSync(noticePath))
  const notice = fs.existsSync(noticePath) ? fs.readFileSync(noticePath, "utf8") : ""
  chk("NOTICE: atribui o upstream pelo nome/URL", notice.includes("cocktailpeanut/ace-step-ui.pinokio"))
  chk("NOTICE: declara que nao concede licenca", /grants no license/.test(notice))
  chk("NOTICE: nao contem concessao de licenca (sem 'Permission is hereby granted')",
    !notice.includes("Permission is hereby granted"))
  chk("NOTICE: nao existe arquivo LICENSE no repo (decisao juridica do dono)",
    !fs.existsSync(path.join(REPO, "LICENSE")))

  const handoffPath = path.join(REPO, "HANDOFF.md")
  chk("HANDOFF.md existe", fs.existsSync(handoffPath))
  const handoff = fs.existsSync(handoffPath) ? fs.readFileSync(handoffPath, "utf8") : ""
  chk("HANDOFF: aponta para o portao dentro do repo", handoff.includes("tools/verify.js"))
  chk("HANDOFF: registra o que falta fazer", /O que falta fazer/.test(handoff))

  console.log("\n" + "=".repeat(78))
  console.log("RESULTADO: " + pass + " verificacoes OK, " + fail + " falhas")
  if (fails.length) { console.log("\nFALHAS:"); fails.forEach((f) => console.log("  - " + f)) }
  console.log("\nLIMITACOES (exigem GPU CUDA - nao valido aqui):")
  console.log("  - install completo do Pinokio (clones + npm install + uv pip install do torch 2.10+cu128)")
  console.log("  - download dos checkpoints do modelo e o primeiro start do engine")
  console.log("  - runtime do engine (acestep --enable-api) e geracao de audio")
  console.log("  - CORS em um navegador real (o comportamento foi deduzido do codigo do servidor)")
  console.log("=".repeat(78))
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}, 1200)
