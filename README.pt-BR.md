# ⛽ Fuel Mind — Sistema de Gestão de Combustíveis

> **Plataforma completa de gestão de combustíveis** construída com JS puro + Firebase, projetada para distribuidoras, transportadoras e postos de combustível. Tempo real, multi-empresa, com analítico, controle de estoque e cálculo de fretes.

---

## ✨ Funcionalidades

### 📋 Lançamentos e Notas Fiscais
- Registro de notas com importação de XML (NF-e)
- Múltiplos tipos de combustível por lançamento
- Conversão automática de placas para o formato Mercosul
- Quantidade carga / descarga com badge de perda
- Anexos via Firebase Storage (PDF, imagens)
- Clonar e editar com log de auditoria completo

### 📊 Relatórios e Exportação
- Tabela filtrável com paginação e detalhe inline
- Colunas ordenáveis (data, litros, total)
- Exportação PDF com logo, margens e cores personalizadas, quebra por mês
- Exportação Excel, CSV, WhatsApp e e-mail
- Relatório mensal gerencial (resumo executivo + por combustível + evolução)
- Busca global (Ctrl+K)

### 📈 Analítico
- Abas: mensal, motorista, veículo, combustível, comparativo, distribuição, evolução de preços
- Cards KPI com variação vs. mês anterior
- Alternar Valor (R$) / Litros
- Gráfico de evolução de preços por combustível
- Alertas inteligentes (preço alto, volume suspeito, data suspeita) com descarte em um clique

### 🛢️ Controle de Estoque
- Controle por empresa, combustível e dia
- Estoque calculado (entradas – vendas – evaporação)
- Evaporação em % ou litros por dia
- Leituras Veeder-Root com tooltip por tanque
- Fechamento de mês (bloqueio de edição) + log de auditoria
- Importação de relatório AutoSystem (comparação entradas + saídas de bombas)
- Importação Veeder-Root (multi-tanque, preenchimento automático)
- Banner de capacidade dos tanques com alerta de estouro

### 🚛 Fretes
- Taxa por combustível configurável (R$/L)
- Cálculo automático por placa, motorista, empresa e conjunto de veículos
- Conjuntos de veículos com composição histórica (respeita data do carregamento)
- Exportação Excel, PDF, CSV, impressão

### 🔧 Cadastros
- Motoristas, veículos, empresas (com município), combustíveis (com % de perda), bases, tanques, conjuntos de veículos
- Inativar/reativar com propagação em cascata para lançamentos
- Tanques com compartimentos, histórico de combustível por compartimento, capacidade de filtro

### 👥 Usuários e Permissões
- Firebase Auth (e-mail/senha ou @usuario)
- Perfis: Supremo (acesso total) · Admin · Usuário
- Controle de acesso por empresa
- Log de auditoria por usuário nas edições de estoque

### ⚙️ Sistema
- Backup manual e automático (a cada 3 dias, guarda os 3 últimos)
- Importação de planilhas (TRR Fabiandra, Posto Rosário wide, formato padrão)
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
| Storage | Firebase Storage (anexos e logos) |
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
5. Habilite **Storage**

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
├── index.html          # Shell do app (SPA) + todos os modais
├── style.css           # Design system (dark/light, variáveis CSS)
├── firebase.js         # Inicialização + todos os métodos DB/Auth/Storage
├── app.js              # Fluxo de auth, carregamento/salvamento do DB, listener em tempo real
├── utils.js            # Formatação, spinners, toast, cores dos gráficos
├── ui.js               # Sidebar, header, busca, atalhos de teclado
├── cadastros.js        # CRUD de motoristas, veículos, empresas, combustíveis, bases, conjuntos
├── lancamentos.js      # Formulário de lançamento, importação XML, salvar/editar/clonar/excluir
├── relatorios.js       # Tabela de relatórios, filtros, paginação, exportações
├── analitico.js        # Abas analítico + gráficos Chart.js
├── dashboard.js        # KPIs do dashboard, alertas, detalhamento por combustível
├── estoque.js          # Tabela de estoque, evaporação, Veeder-Root, auditoria
├── fretes.js           # Cálculo e exportação de fretes
├── tanques.js          # CRUD de tanques com compartimentos e histórico de combustível
├── sistema.js          # Backup, importação, config PDF, conferência AutoSystem/Veeder
├── importacao.js       # Importação de planilhas com detecção de múltiplos formatos
├── usuarios.js         # Gerenciamento de usuários e permissões
└── firebase.json       # Configuração do Firebase Hosting
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
