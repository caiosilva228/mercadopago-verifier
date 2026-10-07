# Mercado Pago Verifier (Argentina) 🇦🇷

Sistema privado de verificação e conciliação automática de transferências recebidas na conta Mercado Pago Argentina a partir de comprovantes bancários (fotos e PDFs).

---

## 🚀 1. Visão Geral e Arquitetura

O sistema automatiza a conferência de comprovantes de transferências bancárias argentinas (Cuenta DNI, Banco Nación, Mercado Pago, Santander, Galicia, etc.) contra o relatório contábil oficial (**Settlement Report**) da API do Mercado Pago Argentina.

### Fluxo de Ponta a Ponta:

```
[ Upload Comprovante (JPG/PNG/WEBP/PDF) ]
                   ↓
   [ Cálculo SHA-256 (Anti-duplicidade) ]
                   ↓
 [ Upload Seguro no Supabase Storage ] (Bucket Privado)
                   ↓
   [ ReceiptTextExtractor (PDF / OCR) ]
                   ↓
 [ Zod ReceiptExtraction Schema ] (Valor, Moeda, Data, Hora, Banco)
                   ↓
 [ Interface de Conferência / Correção ]
                   ↓
    [ Disparo do Verification Job ]
                   ↓
[ MercadoPagoProvider: ensureConfiguration ]
                   ↓
  [ Cache de Relatório mercadopago_reports ]
   ├─ Se já existe para o dia → Reutiliza CSV
   └─ Se não existe → Solicita POST /v1/account/settlement_report
                   ↓
 [ Polling Assíncrono a cada 15s (Timeout 10m) ]
                   ↓
    [ Download do CSV e Parsing Seguro ] (Inteiro em Minor Units)
                   ↓
 [ PaymentMatcher: Algoritmo Conservador ]
   ├─ Filtro Estrito: SETTLEMENT, cvu, bank_transfer, mesmo dia e valor
   ├─ Proximidade Temporal: 0-2min (+30), 2-10min (+20), 10-30min (+10)
   ├─ Verificação de Unicidade: 1 candidata (Verified), >1 (Ambiguous)
   └─ Anti-Fraude: Verifica se SOURCE_ID já foi usado anteriormente
                   ↓
 [ Resultado Visual: Card Verde / Amarelo / Vermelho / Laranja ]
```

---

## 🛠️ 2. Tecnologias Utilizadas

- **Linguagem**: TypeScript em modo strict (`strict = true`).
- **Framework**: Next.js 14 (App Router, Server Actions, Route Handlers, Standalone output).
- **Estilização**: Tailwind CSS com design moderno, responsivo e mobile-first.
- **Validação de Dados**: Zod para todas as entradas e respostas externas da API do Mercado Pago.
- **OCR e Processamento de Imagens**: Tesseract.js (espanhol `spa` e inglês), Sharp (grayscale, contraste, auto-rotate) e `pdf-parse`.
- **Banco de Dados**: Supabase PostgreSQL (schema isolado `mercadopago`, índices otimizados e RLS habilitado).
- **Armazenamento**: Supabase Storage (bucket privado `payment-receipts` com Signed URLs de 1h).
- **Autenticação**: Supabase Auth (e-mail e senha, sessão persistente, middleware de proteção de rotas).
- **Deploy & Infraestrutura**: Dockerfile multi-stage com Tesseract OCR nativo e deploy via EasyPanel na VPS.

---

## 🔐 3. Variáveis de Ambiente

Crie um arquivo `.env` baseado no `.env.example`:

```env
# URL da Aplicação
NEXT_PUBLIC_APP_URL="https://seu-dominio.com"

# Supabase (Banco de Dados, Auth & Storage)
NEXT_PUBLIC_SUPABASE_URL="https://nnqlnbgfbixckrxmxdzt.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="sua_chave_anon"
SUPABASE_URL="https://nnqlnbgfbixckrxmxdzt.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="sua_chave_service_role"

# Mercado Pago Argentina
# AVISO: Nunca hardcode nem exponha no frontend!
MERCADOPAGO_ACCESS_TOKEN="APP_USR-xxxxxx-xxxxxx-xxxxxx"

# Ambiente
NODE_ENV="production"
PORT=3000
```

---

## 💻 4. Executando Localmente

1. **Instalar dependências**:
   ```bash
   npm install
   ```

2. **Rodar os testes unitários**:
   ```bash
   npm run test
   ```

3. **Iniciar o servidor de desenvolvimento**:
   ```bash
   npm run dev
   ```
   Acesse: `http://localhost:3000`

---

## 🐳 5. Execução com Docker

Construa e execute a imagem de produção contendo Tesseract OCR nativo:

```bash
docker build -t mercadopago-verifier:latest .
docker run -p 3000:3000 --env-file .env mercadopago-verifier:latest
```

Ou usando Docker Compose:
```bash
docker-compose up -d --build
```

---

## 🗄️ 6. Estrutura do Banco de Dados (PostgreSQL)

O sistema reside no schema `mercadopago` do Supabase:

- **`receipts`**: Comprovantes enviados, metadados de arquivo, hash SHA-256, texto OCR bruto e campos extraídos.
- **`verification_jobs`**: Máquina de estados dos trabalhos de conferência em background.
- **`mercadopago_reports`**: Cache de relatórios de conciliação por data para evitar chamadas redundantes.
- **`mercadopago_transactions`**: Transações detalhadas parseadas a partir do CSV do relatório contábil.
- **`verification_matches`**: Resultado da comparação, pontuação de confiança, razões detalhadas e índice único condicional anti-reutilização:
  ```sql
  CREATE UNIQUE INDEX unique_verified_transaction_id 
  ON mercadopago.verification_matches (transaction_id) 
  WHERE status = 'verified';
  ```
- **`audit_logs`**: Trilha imutável de auditoria de eventos e ações operacionais.

---

## 💳 7. Configuração no Mercado Pago Argentina

1. Obtenha seu **Access Token de Produção** no painel [Mercado Pago Developers](https://www.mercadopago.com.ar/developers).
2. Configure a variável `MERCADOPAGO_ACCESS_TOKEN` no `.env` ou no painel do EasyPanel.
3. O sistema configura automaticamente as colunas necessárias do Settlement Report na primeira execução através do método `ensureConfiguration()`.

---

## 🔍 8. Diagnóstico e Investigação de Erros

- **Healthcheck**: Endpoint `GET /api/health` retorna status de banco e worker sem vazar secrets.
- **Logs Estruturados**: Logs em formato JSON com sanitização automática para nunca exibir tokens, Authorization headers ou senhas.
- **Timeout**: Caso o Mercado Pago demore mais de 10 minutos para gerar o CSV, o job é marcado com mensagem amigável solicitando nova tentativa.
