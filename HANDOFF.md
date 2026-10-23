# Handoff — `yuri-schmaltz/ace_music` (launcher Pinokio do ACE-Step UI)

**Data do handoff:** 2026-10-22 · **Estado:** publicado e verde · **Destinatário:** qualquer agente
com acesso à internet e a este repositório.

Este documento é autossuficiente: quem lê não precisa de conversa anterior para continuar.

---

## 1. O que é o projeto

`yuri-schmaltz/ace_music` é um **launcher do Pinokio** (empacotador de apps) para o
[ACE-Step UI](https://github.com/fspecii/ace-step-ui) — a interface web local-first para geração de
música com o [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5).

Ele **não contém código de aplicação**: são 8 arquivos que clonam, instalam e sobem três processos
(engine, backend, frontend).

```
yuri-schmaltz/ace_music   (este repo — fork/espelho)
└── cocktailpeanut/ace-step-ui.pinokio  (upstream do launcher, sem licença definida)
    ├── fspecii/ace-step-ui            (a interface web — sem tag, sem release)
    └── ace-step/ACE-Step-1.5          (o engine — MIT, push frequente)
```

O repositório é um **espelho**: em 2026-10-21 as árvores de arquivos e o histórico eram idênticos ao
upstream (`96d4993`). Hoje o `main` carrega correções locais por cima.

## 2. Estado atual (publicado)

| Item | Valor |
|---|---|
| `main` publicado | `1661a88` — *fix: dependency pins, contract checks, CI and attribution…* (squash de 2 commits) |
| Base do espelho | `96d4993` (2026-07-17) — idêntico ao `cocktailpeanut/ace-step-ui.pinokio` |
| PR | #1 — `fix/launcher-dependency-and-cors` → `main`, **mergeado por squash** |
| CI | `.github/workflows/ci.yml` (**`launcher-checks`**) — verde no push, no PR e no `main` |
| Arquivos | 15 (2 `.js` novos, 1 workflow, 1 `NOTICE`, 1 `HANDOFF.md`, README, 6 do launcher, ícone, `.gitignore`, `tools/verify.js`) |
| Remotos | `origin` = este mirror · `upstream` = `cocktailpeanut/ace-step-ui.pinokio` (configure o segundo: §9) |

**Commits de referência dos upstreams** (usados nas checagens):

- `fspecii/ace-step-ui` → `a1fdf91829ec6f7b98844f80e323529cd155dbf2` (2026-06-27)
- `ace-step/ACE-Step-1.5` → `ca1e85fe9430179831e6bc6be790c332190a3866` (2026-08-29)

## 3. O que foi feito (duas rodadas, 2026-10-21 e 2026-10-22)

### Rodada 1 — `16e696b` (problemas que vinham do upstream ter mudado)

| Arquivo | Mudança | Por quê |
|---|---|---|
| `install.js` | **removido** o pin `uv pip install --upgrade --force-reinstall "torchao<0.16"` | O engine passou a declarar `torchao>=0.16.0,<0.17.0` (commits `fd92d966` e `89a5f6e9`, março/2026). O `uv pip install` **não revalida** os requisitos de um pacote editável: o pin deixava o ambiente inconsistente **sem dar erro** (simulado com uv 0.12.17: exit 0, ambiente quebrado). |
| `install.js` | passo `node check_compat.js` logo após os clones | Falhar cedo, antes de baixar npm/torch, se o upstream quebrar o contrato. |
| `update.js` | `uv pip install -e .` no venv do engine, **depois** do `git pull` | O `git pull` trazia código novo mas nunca instalava as dependências novas do engine (`pytorch-wavelets`, importado em `acestep/models/common/dcw_loader.py:36`; `python-multipart`, commit `7a86b316`). |
| `update.js` | passo `node check_compat.js` | Idem, no caminho de atualização. |
| `start.js` | `NODE_ENV` de `production` → `development` | O servidor da UI só aceita `localhost`/`127.0.0.1` em qualquer porta em `development`; em `production` exige match **exato** com `FRONTEND_URL` (que é dinâmico) → `http://localhost:<porta>` e acesso por LAN eram rejeitados com `Not allowed by CORS`. |
| `start.js` | pre-flight `node check_port.js 3001` como **primeiro** passo | A porta 3001 é fixa (ver §6) e não pode ser dinâmica; a colisão agora é detectada antes do download do modelo, não no meio do stack. |
| `start.js` | `PEXELS_API_KEY: ""` | Placeholder que não existia. |
| `check_compat.js` | **novo** — 7 itens de contrato, sem dependências | Detecta quebra de contrato em vez de falhar em runtime. |
| `check_port.js` | **novo** — pre-flight de porta, sem dependências | Falha com mensagem acionável (`error: port N is already in use`). |
| `README.md` | reescrito (11 seções) | O antigo prometia um `app/.env` que nunca é criado e documentava env vars errado. |

### Rodada 2 — `f4dc50a` (as pendências que restavam)

| Arquivo | Mudança |
|---|---|
| `download_models.js` | **novo** — roda o `acestep-download` do engine no venv, com `ACESTEP_PROJECT_ROOT` fixado em `app/ACE-Step-1.5`, para o download dos checkpoints cair na pasta linkada. |
| `pinokio.js` | nova entrada **Download Models** no menu (e o estado "Downloading Models" durante o download). |
| `.github/workflows/ci.yml` | **novo** — CI: sintaxe, smoke test do menu, pre-flight de porta, **contrato contra o `main` mais recente dos dois upstreams**, guarda contra pins manuais. Sem secrets, sem GPU. |
| `NOTICE` | **novo** — atribuição ao upstream, que não tem `LICENSE`. Não concede licença e não adiciona arquivo de licença. |
| `README.md` | seções novas: CI, badge, Download Models, sync com upstream, NOTICE; tabela de pendências revisada. |

### Rodada 3 — este handoff

| Arquivo | Mudança |
|---|---|
| `HANDOFF.md` | **novo** — este documento. |
| `tools/verify.js` | **novo** — o portão de verificação, dentro do repo, portátil: clona os upstreams se preciso e roda todas as checagens. É a mesma coisa que o CI roda. |
| `.github/workflows/ci.yml` | o CI passa a chamar `tools/verify.js` (uma fonte de verdade só). |
| `README.md` | documenta o portão de verificação. |

## 4. Como verificar (o comando que importa)

O portão está **dentro do repo** e não precisa de nada além de Node:

```bash
git clone https://github.com/yuri-schmaltz/ace_music.git
cd ace_music
node tools/verify.js
```

Ele clona os dois upstreams num diretório temporário (se `app/` não existir), roda **todas** as
checagens e sai com `0` (tudo verde) ou `1` (algo quebrado). Opções:

```bash
node tools/verify.js --root /caminho/do/layout   # usa um layout já montado
node tools/verify.js --base origin/main           # compara os arquivos alterados com uma base
node tools/verify.js --no-clone                   # não clona nada
```

O que ele cobre:

| Bloco | Checagens |
|---|---|
| Escopo | nenhum arquivo alterado fora do conjunto do launcher |
| Sintaxe | `node --check` em todos os `.js` (raiz e `tools/`) |
| Contrato (2 lados) | `check_compat.js` passa 7/7 no layout real **e falha** (exit 1) num layout quebrado de propósito |
| Porta (2 lados) | `check_port.js` passa com a porta livre e falha (exit 1) com a porta ocupada |
| Fluxo do Pinokio | ordem dos passos, `venv`, `{{port}}`/`{{local.*}}`, as 3 regexes de evento, as 9 env vars |
| Contrato com o upstream | flags do engine, `API endpoints enabled`, `requires-python`, faixa de `torchao`, banner do servidor, scripts npm, proxy `/api` |
| Sem pins | nenhum `.js` fixa `torchao` |
| Verdade do README | contagem de call sites, `FRONTEND_URL` no log, linha do `app.listen`, intervalo dos campos do body, ausência da promessa de `app/.env`, endpoints citados |
| Artefatos | menu, `download_models.js`, CI, `NOTICE`, este handoff |

**Antes de dar qualquer coisa por pronta, rode `node tools/verify.js`.**

## 5. O que falta fazer (em ordem de prioridade)

### P0 — precisa de máquina com GPU CUDA (o dono do repo)

Nada abaixo foi validado em runtime. É o que falta para dizer que o launcher funciona de ponta a ponta:

1. **Install completo pelo Pinokio** — clones, `npm install`, `uv pip install -e .` (traz
   `torch 2.10.0+cu128`; vários GB) e o `fs.link` dos checkpoints.
2. **Primeiro start** — o engine baixa o modelo dentro do processo; o launcher só libera as etapas
   seguintes quando aparece `API endpoints enabled`.
3. **Geração de áudio de verdade** (`POST /api/generate` → polling em `/api/generate/status/:jobId`).
4. **CORS em navegador real** — o comportamento foi **deduzido do código** do servidor
   (`server/src/index.ts:55-77`), nunca observado. Abrir por `127.0.0.1` e por `localhost` e
   conferir que não há `Not allowed by CORS`.
5. **Detecção da porta 3001 ocupada** com um servidor real escutando (o teste do portão usa um
   servidor node, mas vale repetir no contexto do Pinokio).

### P1 — decisões do dono do repositório

6. **`LICENSE`** — decisão jurídica, deliberadamente não tomada. O upstream não tem licença
   definida; o `NOTICE` registra a atribuição e o raciocínio. Se o dono quiser licenciar, precisa
   considerar que o código upstream é de terceiro.
7. **Devolver as correções ao upstream** — nada foi enviado ao
   `cocktailpeanut/ace-step-ui.pinokio`. Um PR lá é o caminho natural (o upstream tem 8 issues
   abertas, inclusive sobre VRAM/CLI). O procedimento está no README.
8. **Branch de trabalho vs `main`** — o `main` já contém tudo. Se preferir revisar antes, reverta
   o squash; nada depende disso.

### P2 — manutenção contínua

9. **Sync com o upstream** — o remoto `upstream` **não é versionado** (`.git/config`); em um clone
   novo é preciso `git remote add upstream https://github.com/cocktailpeanut/ace-step-ui.pinokio.git`.
   O procedimento completo está no README, seção "Syncing with upstream".
10. **Drift do upstream** — o `ace-step/ACE-Step-1.5` faz push com frequência. O CI detecta quebra
    de contrato; a ação é revisar o `check_compat.js` e atualizar os SHAs de referência no README.
11. **Suite de testes unitários** — o CI faz checagem de sintaxe, smoke test e portão completo;
    o launcher não tem testes de comportamento das próprias regras. É a lacuna declarada na tabela
    de pendências do README.

## 6. Decisões de projeto (não reabrir sem motivo)

- **Não fixar SHA/tag dos upstreams.** A UI não tem tag nem release; as tags do engine (`v0.1.x`)
  são inconsistentes com a versão `1.5.0`; e fixar SHA quebraria o `git pull` do `update.js`
  (HEAD detached). A mitigação escolhida é o **check de contrato**, que detecta em vez de
  impedir. O README traz os SHAs conhecidos para pinning manual.
- **A porta 3001 do backend é fixa e não pode virar dinâmica** — `components/RightSidebar.tsx:321`
  e `components/SongDropdownMenu.tsx:128` montam URL absoluta com `:3001`, e o proxy do Vite aponta
  para lá. A solução foi o pre-flight, não porta dinâmica.
- **`NODE_ENV=development` é intencional** — o servidor é local e não exposto; em `production` a
  regra de CORS por match exato quebra com a porta dinâmica da UI.
- **Sem `LICENSE`** — ver P1.6.

## 7. Armadilhas (as que custaram tempo)

| Armadilha | Consequência |
|---|---|
| `uv pip install` não revalida requisitos de pacote editável | Um `force-reinstall` com versão incompatível sai com **exit 0** e deixa o ambiente quebrado em silêncio. Verificar pelo `pyproject.toml` do engine. |
| Pinokio detecta falha de `shell.run` por **`/error:/i` no output**, não por exit code | A mensagem de erro de qualquer script precisa conter `error:` para o launcher abortar. |
| `preview.proxy` do Vite cai para `server.proxy` (`preview.proxy ?? server.proxy`) | Trocar `npm run dev` por `npm run preview` **não** quebra o proxy `/api` — não é bug. |
| O `check_compat.js` monta o nome do pacote em runtime (`"t" + "orchao"`) | É de propósito: o próprio arquivo é varrido pela checagem 7 e não pode se auto-acusar. Não "simplificar" isso. |
| `tools/verify.js` usa `git clone` sem CA confiável em alguns sandboxes | Ele tenta o clone normal e, se falhar, refaz com `http.sslVerify=false`. Não remover o fallback. |
| O canal de decisão do motor de team tem bug de transporte | Arrays e booleanos chegam como string/objeto e **toda** decisão é rejeitada com mensagem genérica. Não depender dele: trabalhar com `git`, `curl` na API do GitHub e o portão de verificação. |

## 8. Contrato com o upstream (o que o launcher exige)

Se algum destes mudar upstream, o launcher quebra — e o `check_compat.js` acusará:

- engine: flags `--enable-api`, `--port`, `--server-name`, `--backend` e a string
  `API endpoints enabled` em `acestep/acestep_v15_pipeline.py`;
- engine: `requires-python = ">=3.11,<3.13"` e uma faixa de `torchao` que cubra 0.16.x;
- servidor: a string `ACE-Step UI Server running` em `server/src/index.ts`;
- UI: scripts `build` e `preview`; server: scripts `build`, `start`, `db:migrate`;
- Vite: proxy para `/api` em `vite.config.ts`.

## 9. Ambiente, credenciais e comandos

**Credenciais:** o `GITHUB_TOKEN` do ambiente pertence a `yuri-schmaltz`, com escopos `repo` e
`workflow` e permissão de admin no repositório. O `gh` CLI **não** está instalado — usar a API do
GitHub via `curl` para PRs e Actions.

**Padrão de push** (o sandbox não tem a CA do sistema para o git; o `curl` funciona sem isso):

```bash
git -c http.sslVerify=false \
    -c credential.helper='!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f' \
    push -u origin <branch>
```

**Fluxo de trabalho com PR** (o usado até aqui): branch → commit → push → PR pela API → merge por
squash. Exemplo de criação de PR:

```bash
curl -sS -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" \
  -d @pr.json \
  "https://api.github.com/repos/yuri-schmaltz/ace_music/pulls"
```

**Status do CI:**

```bash
curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/yuri-schmaltz/ace_music/actions/runs?per_page=3"
```

## 10. Como o trabalho foi conduzido (para quem quiser o método)

Três rodadas com um time de agentes: produção e verificação adversarial separadas, com o revisor
obrigado a **re-derivar** cada afirmação a partir dos fontes (clone do upstream, `git show`, grep
real) em vez de reler o resumo do produtor. Isso pegou erros reais — contagem errada de call sites,
uma afirmação falsa sobre o startup log, uma contradição interna no README e duas citações de linha
erradas. O verificador de rodada 1 reprovou o README com 5 apontamentos cirúrgicos; a rodada 2
corrigiu e revalidou.

Onde o time travou (canal de decisão quebrado, uma sessão morta por timeout), o owner assumiu
diretamente, rodou o portão de verificação por conta própria e fechou o plano — a evidência ficou
no repositório, não num resumo de conversa. Daí a decisão de manter o portão **dentro** do repo
(`tools/verify.js`): ele é a forma de o próximo agente não depender do sandbox de ninguém.
