#!/usr/bin/env node
/**
 * check_compat.js — verificador de contrato do launcher ACE-Step UI (Pinokio).
 *
 * Roda no install e no update, ANTES de qualquer instalacao pesada, e falha
 * cedo (exit 1) com mensagem acionavel quando os upstreams
 * (fspecii/ace-step-ui e ace-step/ACE-Step-1.5) deixam de expor a superficie
 * que o launcher assume.
 *
 * Uso:
 *   node check_compat.js [RAIZ]
 *
 *   RAIZ  opcional. Default: "app/" relativo ao diretorio deste script.
 *         Caminhos relativos sao resolvidos a partir do diretorio do script,
 *         de modo que o script funciona independente do cwd.
 *
 *   Layout esperado dentro de RAIZ:
 *     RAIZ/package.json, RAIZ/vite.config.ts, RAIZ/server/...   (fspecii/ace-step-ui)
 *     RAIZ/ACE-Step-1.5/pyproject.toml, RAIZ/ACE-Step-1.5/acestep/...  (engine)
 *
 * Sem dependencia externa: apenas modulos nativos do Node (fs, path).
 */

const fs = require("fs")
const path = require("path")

const LAUNCHER_DIR = __dirname
const DEFAULT_ROOT = "app/"

const UI_SERVER_BANNER = "ACE-Step UI Server running"

// ---------------------------------------------------------------------------
// Deteccao de pin manual do pacote torchao nos scripts do launcher.
//
// O nome do pacote e montado em runtime de proposito: este proprio arquivo e
// varrido pela checagem 7 e nao pode se auto-acusar.
// ---------------------------------------------------------------------------
const PKG_TOKEN = "t" + "orchao"
const PIN_BELOW_016 = new RegExp(PKG_TOKEN + "\\s*<\\s*0", "i")
const PIN_MENTION = new RegExp(
  PKG_TOKEN + "\\s*((?:[<>=!~]{1,2}\\s*)?[0-9][0-9A-Za-z.*+]*(?:\\s*,\\s*(?:[<>=!~]{1,2}\\s*)?[0-9][0-9A-Za-z.+]*)*)",
  "gi"
)

// Versao minima de torchao aceita pelo engine (faixa 0.16.x).
const MIN_TORCHAO = [0, 16, 0]

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------

function readFileOrNull(file) {
  try {
    return fs.readFileSync(file, "utf8")
  } catch (err) {
    return null
  }
}

function readJsonOrNull(file) {
  const raw = readFileOrNull(file)
  if (raw === null) return { error: "arquivo inexistente" }
  try {
    return { value: JSON.parse(raw) }
  } catch (err) {
    return { error: "JSON invalido (" + err.message + ")" }
  }
}

function parseVersion(text) {
  const cleaned = String(text).trim().split(/[^0-9A-Za-z.+*-]/)[0]
  const head = cleaned.split(/[+*]/)[0]
  const parts = head.split(".").map((p) => {
    const n = parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
  while (parts.length < 3) parts.push(0)
  return parts
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1
    if (a[i] < b[i]) return -1
  }
  return 0
}

/**
 * Extrai os limites de versao de um specifier PEP 440 ("<0.16", ">=0.16.0,<0.17.0").
 * Devolve null quando nao ha nenhum limite numerico.
 */
function parseSpecifier(spec) {
  const bounds = []
  const re = /(>=|<=|==|!=|~=|>|<)\s*([0-9][0-9A-Za-z.*+]*)/g
  let m
  while ((m = re.exec(spec)) !== null) {
    bounds.push({ op: m[1], version: m[2] })
  }
  return bounds
}

/**
 * Verdadeiro quando existe alguma versao >= 0.16.0 satisfeita pelo specifier.
 * Ex.: ">=0.16.0,<0.17.0" -> true; "<0.16" -> false; "==0.15.0" -> false.
 *
 * So o limite superior e o pin exato restringem a pergunta "a faixa contem
 * alguma versao >= 0.16.0?". Limites inferiores nunca mudam a resposta, mas
 * sao usados para detectar faixa vazia (ex.: ">=0.17,<0.16").
 */
function allowsTorchaoAtLeast016(spec) {
  const bounds = parseSpecifier(spec)
  if (bounds.length === 0) return true

  let lower = null
  let upper = null
  let exact = null

  for (const b of bounds) {
    const v = parseVersion(b.version)
    if (b.op === ">=" || b.op === ">" || b.op === "~=") {
      if (lower === null || compareVersions(v, lower.version) > 0) {
        lower = { op: b.op, version: v }
      }
    } else if (b.op === "<" || b.op === "<=") {
      if (upper === null || compareVersions(v, upper.version) < 0) {
        upper = { op: b.op, version: v }
      }
    } else if (b.op === "==") {
      exact = v
    }
  }

  if (lower !== null && upper !== null && compareVersions(lower.version, upper.version) > 0) {
    return false
  }
  if (exact !== null) return compareVersions(exact, MIN_TORCHAO) >= 0
  if (upper === null) return true
  if (upper.op === "<") return compareVersions(upper.version, MIN_TORCHAO) > 0
  return compareVersions(upper.version, MIN_TORCHAO) >= 0
}

/**
 * Extrai o valor de uma chave TOML simples (requires-python).
 */
function readTomlString(toml, key) {
  const re = new RegExp("^\\s*" + key + "\\s*=\\s*[\"']([^\"']+)[\"']", "m")
  const m = re.exec(toml)
  return m ? m[1] : null
}

/**
 * Extrai o array `dependencies` do pyproject.toml como linhas cruas.
 * A varredura ignora strings, para que dependencias como "uvicorn[standard]"
 * nao encurtem o bloco no primeiro ']' literal.
 */
function readDependenciesBlock(toml) {
  const m = /^[ \t]*dependencies[ \t]*=[ \t]*\[/m.exec(toml)
  if (m === null) return null
  const open = toml.indexOf("[", m.index)
  if (open === -1) return null
  let depth = 0
  let quote = null
  for (let i = open; i < toml.length; i++) {
    const ch = toml[i]
    if (quote !== null) {
      if (ch === "\\") { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === "[") depth++
    else if (ch === "]") {
      depth--
      if (depth === 0) return toml.slice(open + 1, i)
    }
  }
  return null
}

/**
 * Extrai o valor de uma chave JSON (objeto simples).
 */
function getProp(obj, key) {
  if (!obj || typeof obj !== "object") return undefined
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined
  return obj[key]
}

/**
 * Bloco entre chaves balanceadas a partir de um '{'. Tolera strings e comentarios.
 */
function extractBraceBlock(src, openIdx) {
  let depth = 0
  let quote = null
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (quote !== null) {
      if (ch === "\\") { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i)
      if (nl === -1) return null
      i = nl
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2)
      if (end === -1) return null
      i = end + 1
      continue
    }
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return src.slice(openIdx + 1, i)
    }
  }
  return null
}

/**
 * Verifica se o vite.config.ts declara proxy para '/api'.
 */
function findApiProxy(source) {
  const proxyIdx = /\bproxy\s*:/.exec(source)
  if (proxyIdx === null) {
    return { found: false, reason: "vite.config.ts nao declara a chave 'proxy'" }
  }
  const braceIdx = source.indexOf("{", proxyIdx.index)
  if (braceIdx === -1) {
    return { found: false, reason: "nao foi possivel localizar o objeto 'proxy' em vite.config.ts" }
  }
  const block = extractBraceBlock(source, braceIdx)
  if (block === null) {
    return { found: false, reason: "nao foi possivel ler o objeto 'proxy' de vite.config.ts" }
  }
  if (!/["']\/api["']\s*:/.test(block)) {
    return { found: false, reason: "o objeto 'proxy' de vite.config.ts nao tem entrada '/api'" }
  }
  return { found: true }
}

// ---------------------------------------------------------------------------
// Relatorio
// ---------------------------------------------------------------------------

const items = []

function report(id, title, problems, fix) {
  const list = problems.filter(Boolean)
  if (list.length === 0) {
    items.push({ id, title, ok: true })
    console.log("OK: [" + id + "] " + title)
    return
  }
  items.push({ id, title, ok: false, problems: list, fix })
  console.log("FALHA: [" + id + "] " + title)
  for (const p of list) console.log("        - " + p)
}

// ---------------------------------------------------------------------------
// Checagens
// ---------------------------------------------------------------------------

function checkUiScripts(root) {
  const file = path.join(root, "package.json")
  const parsed = readJsonOrNull(file)
  if (parsed.error) {
    report("1", "package.json do UI tem os scripts \"build\" e \"preview\"",
      ["app/package.json nao encontrado ou ilegivel (" + parsed.error + ") — o clone de fspecii/ace-step-ui nao foi concluido?"],
      "Rode o install novamente: o clone de https://github.com/fspecii/ace-step-ui precisa estar em app/.")
    return
  }
  const scripts = getProp(parsed.value, "scripts") || {}
  const problems = []
  for (const name of ["build", "preview"]) {
    if (!scripts[name]) problems.push("script ausente em app/package.json: \"" + name + "\"")
  }
  report("1", "package.json do UI tem os scripts \"build\" e \"preview\"", problems,
    "O launcher chama 'npm run build' e 'npm run preview' em app/. Sem esses scripts o install/update falha; o upstream mudou o contrato de scripts.")
}

function checkViteProxy(root) {
  const file = path.join(root, "vite.config.ts")
  const source = readFileOrNull(file)
  if (source === null) {
    report("2", "vite.config.ts declara proxy para '/api'", [
      "app/vite.config.ts nao encontrado — o clone de fspecii/ace-step-ui nao foi concluido?"
    ], "Rode o install novamente: vite.config.ts precisa estar em app/.")
    return
  }
  const res = findApiProxy(source)
  report("2", "vite.config.ts declara proxy para '/api'",
    res.found ? [] : [res.reason],
    "O front-end depende do proxy '/api' para falar com o server (porta 3001). Sem ele a UI nao alcanca a API.")
}

function checkServerScripts(root) {
  const file = path.join(root, "server", "package.json")
  const parsed = readJsonOrNull(file)
  if (parsed.error) {
    report("3", "server/package.json tem os scripts \"build\", \"start\" e \"db:migrate\"", [
      "app/server/package.json nao encontrado ou ilegivel (" + parsed.error + ")"
    ], "Rode o install novamente: o diretorio app/server precisa existir no clone de fspecii/ace-step-ui.")
    return
  }
  const scripts = getProp(parsed.value, "scripts") || {}
  const problems = []
  for (const name of ["build", "start", "db:migrate"]) {
    if (!scripts[name]) problems.push("script ausente em app/server/package.json: \"" + name + "\"")
  }
  report("3", "server/package.json tem os scripts \"build\", \"start\" e \"db:migrate\"", problems,
    "O launcher roda 'npm run db:migrate', 'npm run build' e 'npm start' em app/server. Sem eles o install/update e o start falham.")
}

function checkServerBanner(root) {
  const file = path.join(root, "server", "src", "index.ts")
  const source = readFileOrNull(file)
  if (source === null) {
    report("4", "server/src/index.ts contem \"" + UI_SERVER_BANNER + "\"", [
      "app/server/src/index.ts nao encontrado — o clone de fspecii/ace-step-ui nao foi concluido?"
    ], "Rode o install novamente: app/server/src/index.ts precisa existir.")
    return
  }
  report("4", "server/src/index.ts contem \"" + UI_SERVER_BANNER + "\"",
    source.includes(UI_SERVER_BANNER) ? [] : ["a string \"" + UI_SERVER_BANNER + "\" nao foi encontrada"],
    "O start.js usa essa string como evento de 'on' para detectar que o server subiu. Se o upstream renomeou a mensagem, o start fica travado esperando.")
}

function checkEngineMetadata(root) {
  const file = path.join(root, "ACE-Step-1.5", "pyproject.toml")
  const toml = readFileOrNull(file)
  if (toml === null) {
    report("5", "pyproject.toml do engine declara requires-python e a faixa de torchao", [
      "app/ACE-Step-1.5/pyproject.toml nao encontrado — o clone de ace-step/ACE-Step-1.5 nao foi concluido?"
    ], "Rode o install novamente: o engine precisa estar clonado em app/ACE-Step-1.5.")
    return
  }

  const problems = []
  const details = []

  const requiresPython = readTomlString(toml, "requires-python")
  if (!requiresPython) {
    problems.push("pyproject.toml nao declara 'requires-python'")
  } else {
    details.push("requires-python = \"" + requiresPython + "\"")
  }

  const deps = readDependenciesBlock(toml)
  if (deps === null) {
    problems.push("pyproject.toml nao declara o array 'dependencies'")
  } else {
    const entries = []
    for (const rawLine of deps.split("\n")) {
      const line = rawLine.trim()
      if (line === "" || line.startsWith("#")) continue
      const m = /^["'](.*)["'],?$/.exec(line)
      if (m === null) continue
      const value = m[1]
      if (!new RegExp("\\b" + PKG_TOKEN + "\\b").test(value)) continue
      entries.push(value)
    }
    if (entries.length === 0) {
      problems.push("nenhuma dependencia de " + PKG_TOKEN + " encontrada em 'dependencies'")
    } else {
      const versioned = entries.filter((e) => {
        const spec = e.split(";")[0]
        const at = spec.indexOf(PKG_TOKEN)
        return at !== -1 && parseSpecifier(spec.slice(at + PKG_TOKEN.length)).length > 0
      })
      if (versioned.length === 0) {
        problems.push("as dependencias de torchao nao trazem nenhum limitador de versao: " + entries.join(" | "))
      } else {
        for (const entry of versioned) {
          const head = entry.split(";")[0]
          const at = head.indexOf(PKG_TOKEN)
          const spec = head.slice(at + PKG_TOKEN.length)
          if (!allowsTorchaoAtLeast016(spec)) {
            problems.push("a faixa declarada (\"" + entry.trim() + "\") exclui a versao 0.16.x, que e a minima aceita pelo engine")
          }
        }
        details.push(PKG_TOKEN + " = \"" + versioned[0].trim() + "\"")
      }
    }
  }

  report("5", "pyproject.toml do engine declara requires-python e a faixa de torchao",
    problems,
    "O launcher instala o engine com 'uv pip install -e .'. A faixa de torchao precisa existir e cobrir a serie 0.16.x; se o upstream rebaixar o piso, o proprio engine fica inconsistente com o diffusers que ele fixa.")

  if (details.length > 0 && problems.length === 0) {
    console.log("        faixa encontrada: " + details.join(" | "))
  }
}

function checkEngineCli(root) {
  const file = path.join(root, "ACE-Step-1.5", "acestep", "acestep_v15_pipeline.py")
  const source = readFileOrNull(file)
  if (source === null) {
    report("6", "acestep_v15_pipeline.py expoe a CLI de API usada pelo start.js", [
      "app/ACE-Step-1.5/acestep/acestep_v15_pipeline.py nao encontrado — o clone do engine nao foi concluido?"
    ], "Rode o install novamente: o engine precisa estar clonado em app/ACE-Step-1.5.")
    return
  }
  const required = ["--enable-api", "--port", "--server-name", "--backend", "API endpoints enabled"]
  const problems = required.filter((needle) => !source.includes(needle))
    .map((needle) => " marcador ausente no pipeline: \"" + needle + "\"")
  report("6", "acestep_v15_pipeline.py expoe a CLI de API usada pelo start.js", problems,
    "O start.js chama 'acestep --port ... --enable-api --backend pt --server-name 127.0.0.1' e espera o log 'API endpoints enabled'. Sem esses marcadores o start trava ou sobe sem API.")
}

function checkLauncherPins() {
  const required = ["install.js", "update.js", "start.js"]
  const problems = []

  for (const name of required) {
    if (readFileOrNull(path.join(LAUNCHER_DIR, name)) === null) {
      problems.push("script do launcher ausente: " + name)
    }
  }

  let entries = []
  try {
    entries = fs.readdirSync(LAUNCHER_DIR, { withFileTypes: true })
  } catch (err) {
    problems.push("nao foi possivel listar o diretorio do launcher: " + err.message)
  }

  const jsFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => e.name)
    .sort()

  for (const name of jsFiles) {
    const source = readFileOrNull(path.join(LAUNCHER_DIR, name))
    if (source === null) continue

    if (PIN_BELOW_016.test(source)) {
      problems.push(name + " fixa o pacote " + PKG_TOKEN + " manualmente numa versao abaixo de 0.16 (pin legado do install.js)")
    }

    const mentions = source.match(PIN_MENTION)
    if (mentions) {
      for (const mention of mentions) {
        if (allowsTorchaoAtLeast016(mention)) continue
        problems.push(name + " declara o specifier \"" + mention.trim() + "\" para o pacote " + PKG_TOKEN + ", que exclui a serie 0.16.x")
      }
    }
  }

  report("7", "nenhum script do launcher fixa o pacote torchao manualmente", problems,
    "Apague o pin manual do torchao: o engine ja declara a faixa correta em pyproject.toml e 'uv pip install -e .' instala a versao certa. Fixar por fora deixa o ambiente inconsistente em silencio (o uv nao revalida o requisito do pacote editavel).")
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv[2]
  if (argv === "--help" || argv === "-h") {
    console.log("Uso: node check_compat.js [RAIZ]")
    console.log("RAIZ opcional (default: \"" + DEFAULT_ROOT + "\" relativo ao diretorio do script).")
    console.log("Layout: RAIZ/<fspecii/ace-step-ui> e RAIZ/ACE-Step-1.5/<ace-step/ACE-Step-1.5>")
    process.exit(0)
  }

  const rootArg = argv || DEFAULT_ROOT
  const root = path.resolve(LAUNCHER_DIR, rootArg)
  const engineRoot = path.join(root, "ACE-Step-1.5")

  console.log("check_compat.js — verificacao de contrato do launcher ACE-Step UI")
  console.log("raiz do launcher: " + LAUNCHER_DIR)
  console.log("raiz verificada:  " + root)
  console.log("UI:               " + root)
  console.log("engine:           " + engineRoot)
  console.log("")

  checkUiScripts(root)
  checkViteProxy(root)
  checkServerScripts(root)
  checkServerBanner(root)
  checkEngineMetadata(root)
  checkEngineCli(root)
  checkLauncherPins()

  const failed = items.filter((i) => !i.ok)
  console.log("")
  if (failed.length === 0) {
    console.log("Contrato verificado: " + items.length + "/" + items.length + " itens OK.")
    process.exit(0)
  }

  console.log("FALHA: " + failed.length + " de " + items.length + " itens de contrato quebrados.")
  console.log("")
  console.log("O que fazer:")
  for (const item of failed) {
    console.log("  [" + item.id + "] " + (item.fix || "verifique o upstream correspondente."))
  }
  console.log("")
  console.log("O launcher nao deve prosseguir com o install/update enquanto o contrato estiver quebrado.")
  process.exit(1)
}

main()
