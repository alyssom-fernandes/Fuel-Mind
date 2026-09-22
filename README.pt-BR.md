# ⛽ Fuel Mind — Sistema de Gestão de Combustíveis

> **Plataforma de lançamento de notas e gestão de fretes** construída com JS puro + Firebase, projetada para distribuidoras e transportadoras. Tempo real, multi-empresa, com analítico e cálculo de fretes.

### ➤ [Abrir a demonstração](https://controle-entradas-posto.web.app) — sem cadastro

Abra o link, clique em **"Acessar modo demo"** e escolha um dos três perfis
(Supremo, Admin, Operador) para ver o acesso mudar conforme o papel. São
oito meses de dados fictícios, nada é gravado na nuvem e a base volta ao
normal todo dia.

![JS puro](https://img.shields.io/badge/JavaScript-puro-f7df1e?style=flat-square&logo=javascript&logoColor=black)
![Sem build](https://img.shields.io/badge/etapa_de_build-nenhuma-success?style=flat-square)
![Firebase](https://img.shields.io/badge/Firebase-Firestore_%2B_Auth-ff6f00?style=flat-square&logo=firebase&logoColor=white)
![Testes](https://img.shields.io/badge/testes-23_passando-success?style=flat-square)

---

## ✨ Funcionalidades

### 📋 Lançamentos e Notas Fiscais
- Registro de notas com importação de XML (NF-e)
- Múltiplos tipos de combustível por lançamento
- Conversão automática de placas para o formato Mercosul
- Quantidade carga / descarga com badge de perda
- Clonar e editar com log de auditoria completo

### 📊 Relatórios e Exportação
- Central de relatórios: tudo que o sistema emite numa lista só, com o mês escolhido ali aplicado na tela de origem antes de gerar o arquivo
- Histórico de lançamentos com filtro por data de emissão e por data de descarga ao mesmo tempo: é o cruzamento que isola a nota da virada de mês
- Tabela filtrável com paginação e detalhe inline
- Colunas ordenáveis (data, litros, total)
- Exportação PDF com logo, margens e cores personalizadas, quebra por mês
- Exportação Excel, CSV, WhatsApp e e-mail
- Relatório mensal gerencial (resumo executivo + por combustível + evolução)
- Busca global (Ctrl+K)

### 📈 Analítico
- Abas: mensal, motorista, veículo, combustível, distribuição, preços por litro
- Cards KPI com variação vs. mês anterior
- Alternar Valor (R$) / Litros
- Gráfico de evolução de preços por combustível
- Alertas inteligentes (preço alto, volume suspeito, data suspeita) com descarte em um clique

### 🔎 Conferência
- Importação de relatório AutoSystem — compara entradas do relatório com os lançamentos do sistema e aponta divergências

### 🚛 Fretes
- Taxa de frete por empresa (R$/L), definida no cadastro de cada empresa
- Cálculo automático por placa, motorista, empresa e conjunto de veículos
- Conjuntos de veículos com composição histórica (respeita data do carregamento)
- Exportação Excel, PDF, CSV, impressão

### 🔧 Cadastros
- Motoristas, veículos, empresas (com município e taxa de frete), combustíveis (com % de perda), bases, conjuntos de veículos
- Inativar/reativar com propagação em cascata para lançamentos

### 👥 Usuários e Permissões
- Firebase Auth (e-mail/senha ou @usuario)
- Perfis: Supremo (acesso total) · Admin · Usuário
- Controle de acesso por empresa

### ⚙️ Sistema
- Backup manual e automático (a cada 3 dias, guarda os 3 últimos)
- Importação de planilhas (formato por produto, formato largo e formato padrão)
- Detecção de duplicatas com reimportação seletiva
- Correção em massa (empresa, motorista, placa, combustível, base)
- Auditoria de datas suspeitas
- Layout de PDF personalizável (logo por empresa, fontes, margens, cores, rodapé)
- Cor de destaque customizável em tempo real (variáveis CSS em cascata)

---

## 🏗️ Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | Vanilla JS (ES6+), HTML5, CSS3 |
| Backend / DB | Firebase Firestore (tempo real) |
| Auth | Firebase Authentication |
| Gráficos | Chart.js 4 |
| PDF | jsPDF + jsPDF-AutoTable |
| Excel | SheetJS (XLSX) |
| Hospedagem | Firebase Hosting |

Sem build. Sem frameworks. Sem node_modules. Abra `index.html` e comece a usar.

---

## 🚀 Como Começar

### 1. Clone o repositório
```bash
git clone https://github.com/seu-usuario/fuel-mind.git
cd fuel-mind
```

### 2. Crie um Projeto no Firebase
1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Crie um projeto (Analytics opcional)
3. Habilite **Firestore Database** (modo produção)
4. Habilite **Authentication** → E-mail/Senha

### 3. Configure o Firebase
Copie a configuração do seu projeto e substitua em `firebase.js`:

```js
const firebaseConfig = {
  apiKey:            "SUA_API_KEY",
  authDomain:        "SEU_PROJETO.firebaseapp.com",
  projectId:         "SEU_PROJETO",
  storageBucket:     "SEU_PROJETO.firebasestorage.app",
  messagingSenderId: "SEU_SENDER_ID",
  appId:             "SEU_APP_ID"
};
```

### 4. Regras do Firestore (mínimo)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /dados/{document} {
      allow read, write: if request.auth != null;
    }
    match /usuarios/{uid} {
      allow read: if true; // necessário para login com @usuario
      allow write: if request.auth != null;
    }
  }
}
```

### 5. Crie o primeiro usuário Supremo
No Console Firebase → Authentication → Adicione um usuário manualmente, depois crie no Firestore:

```
Coleção: usuarios
Documento: {UID}
Campos:
  nome:      "Admin"
  email:     "admin@exemplo.com"
  role:      "supremo"
  empresas:  []
  ativo:     true
```

### 6. Deploy (opcional)
```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

Ou sirva localmente com qualquer servidor estático:
```bash
npx serve .
```

---

## 📁 Estrutura de Arquivos

```
fuel-mind/
├── index.html              # Shell do app (uma página só) + todos os modais
├── 404.html                # Página de erro própria
├── favicon.ico
├── firebase.json           # Hosting: cache e arquivos ignorados
├── firestore.rules         # Regras de segurança do banco
│
├── assets/
│   ├── style.css           # Design system (claro/escuro, variáveis CSS)
│   └── logo-{dark,light}.svg
│
├── src/
│   ├── core/               # Base: dados, sessão e infraestrutura
│   │   ├── firebase.js     # Inicialização + métodos de DB e Auth
│   │   ├── sessao.js       # Login, papéis e empresa ativa
│   │   ├── dados.js        # Estado do banco em memória
│   │   ├── sincronizacao.js# Gravação, fila offline e tempo real
│   │   ├── erros.js        # Registro de falhas
│   │   ├── navegacao.js    # Troca de telas
│   │   ├── tema.js         # Tema claro/escuro e cor da marca
│   │   └── backup.js       # Backup e restauração
│   │
│   ├── shared/             # Reaproveitado por todas as telas
│   │   ├── utils.js        # Formatação, avisos, cores dos gráficos
│   │   ├── ui.js           # Barra lateral, cabeçalho, busca, atalhos
│   │   ├── combobox.js     # Campo com sugestões
│   │   ├── numerico.js     # Entrada de números em pt-BR
│   │   ├── validacao.js    # Validação dos formulários
│   │   └── rascunho.js     # Memória do formulário
│   │
│   └── screens/            # Uma tela, um arquivo
│       ├── lancamentos.js  # Formulário, XML da NF-e, salvar/editar/clonar
│       ├── central.js      # Central de relatórios: tudo que o sistema emite
│       ├── relatorios.js   # Histórico: tabela, filtros, paginação e exportações
│       ├── analitico.js    # Seis abas de análise + gráficos
│       ├── dashboard.js    # Números, alertas e detalhe por combustível
│       ├── fretes.js       # Cálculo e exportação de fretes
│       ├── fechamento.js   # O fechamento do mês em PDF
│       ├── grupo.js        # Comparativo entre as empresas
│       ├── cadastros.js    # Motoristas, veículos, empresas, combustíveis…
│       ├── cadastros-importar.js # Importar a frota de uma planilha
│       ├── sistema.js      # Backup, config do PDF e conferência
│       ├── importacao.js   # Planilhas com detecção de formato
│       ├── usuarios.js     # Usuários e permissões
│       └── demo.js         # Modo demonstração
│
└── tests/                  # node --test, sem dependências
```

---

## 🎨 Design System

- **Dark-first** com suporte completo ao modo claro
- Propriedades CSS customizadas para todas as cores, raios e sombras
- Cor de destaque 100% personalizável em tempo real (sem rebuild)
- Fontes: Syne (títulos) + DM Sans (corpo) + JetBrains Mono (números)
- Responsivo: sidebar overlay em mobile, colunas de tabela colapsáveis, touch-friendly

---

## 🔐 Notas de Segurança

- Nunca faça commit do `firebase.js` com credenciais reais em repositório público — use variáveis de ambiente ou segredos do Firebase App Hosting
- Restrinja as regras do Firestore em produção (adicione regras por usuário/documento)
- A coleção `usuarios` precisa de leitura pública apenas para o fluxo de login com `@usuario`; restrinja se não usar essa funcionalidade

---

## 📄 Licença

MIT — use, modifique e distribua livremente.

---

## 🙏 Agradecimentos

Construído com [Firebase](https://firebase.google.com), [Chart.js](https://www.chartjs.org), [jsPDF](https://parall.ax/products/jspdf) e [SheetJS](https://sheetjs.com).
