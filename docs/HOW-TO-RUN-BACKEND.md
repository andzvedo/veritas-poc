
## Config

1.  Copy the `.env.example` file to `.env` and fill in the values
2.  Get a Google API key and add it to the `.env` file
3.  Get a Tavily API key and add it to the `.env` file

You must have Node.js + pnpm installed too

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

## Running the Backend

1. `cd backend`
2. `pnpm install`
3. `pnpm dev`

## Transcrição do Veritas Live (microfone)

O modo **Áudio ao vivo** precisa de um transcritor no backend. Sem ele, o
backend agora **recusa a sessão já no início** com o código
`TRANSCRIPTION_UNAVAILABLE` e a UI mostra o passo a passo abaixo. Antes, a
sessão "começava", a primeira janela de 8 s falhava e cada bloco de áudio
virava uma lacuna.

O provedor é escolhido em `backend/src/live/transcription.ts`
(`createTranscriptionProvider`), nesta ordem:

1. **whisper.cpp local**, quando o modelo existe e o binário responde a `--help` em até 3 s.
2. **Gemini (nuvem)**, só com `ALLOW_CLOUD_TRANSCRIPTION=true` **e** uma chave
   Google cadastrada na tela de Configurações (`/setup`).
3. Caso contrário, **indisponível**: a sessão Live é recusada com uma mensagem acionável.

### Opção A: whisper.cpp local (recomendado, o áudio não sai da máquina)

No macOS:

```bash
brew install whisper.cpp          # instala o binário `whisper-cli` (antigo nome da fórmula: whisper-cpp)
which whisper-cli                 # confirme o caminho
mkdir -p ~/models/whisper
curl -L -o ~/models/whisper/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

Use um modelo **multilíngue**. A transcrição roda com `-l pt`, então não sirvam
os modelos `*.en`. O `small` equilibra qualidade e velocidade; o `base` é mais
leve e o `large-v3-turbo` é mais preciso.

Em `backend/.env` (crie o arquivo você mesmo, ele não é versionado):

```dotenv
# obrigatório: caminho ABSOLUTO do modelo ggml (.bin); não use "~"
WHISPER_CPP_MODEL=/Users/<voce>/models/whisper/ggml-small.bin
# opcional: binário (padrão: whisper-cli no PATH)
# WHISPER_CPP_BIN=/opt/homebrew/bin/whisper-cli
# opcional: timeout por janela em ms (padrão: 60000)
# WHISPER_TIMEOUT_MS=60000
```

### Opção B: Gemini na nuvem (envia o áudio ao Google)

```dotenv
ALLOW_CLOUD_TRANSCRIPTION=true
# opcional: força o provedor (auto | whisper | gemini | unavailable; padrão auto)
# TRANSCRIPTION_PROVIDER=gemini
# opcional: modelo de transcrição (padrão no código: gemini-3.6-flash)
# GEMINI_TRANSCRIBE_MODEL=gemini-3.6-flash
```

A chave Google **não** vai no `.env` para este fluxo: ela segue da tela de
Configurações junto com o `START_LIVE_SESSION`.

### Aplicar a configuração

O backend lê `backend/.env` (`import 'dotenv/config'`) **só na inicialização**.
Depois de editar o arquivo, pare e suba de novo:

```bash
cd backend && pnpm dev
```

Para conferir sem abrir a UI:

```bash
whisper-cli --help >/dev/null && echo "whisper-cli ok"
ls -l "$WHISPER_CPP_MODEL"   # depois de exportar a variável no shell, ou use o caminho direto
```

Na UI, ao clicar em **Iniciar escuta**:

- Se a configuração estiver certa, o status muda para **Escutando** e a transcrição aparece cerca de 8 s depois da primeira fala.
- Se ainda faltar algo, aparece o aviso "A sessão ao vivo não pôde continuar" com a causa enviada pelo servidor, e o microfone é liberado na hora.

Se a UI ainda mencionar **"aba"** ou **"compartilhamento de tela"**, o frontend
está rodando um código anterior ao modo microfone. Atualize e reinicie com
`git pull`, `rm -rf frontend/.next` e `cd frontend && pnpm dev`.
