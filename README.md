# ⛽ Fuel Mind — Fuel Management System

> **Fuel entry & freight management platform** built with vanilla JS + Firebase, designed for fuel distributors and transport companies. Real-time, multi-company, with analytics and freight calculation.

### ➤ [Try the live demo](https://controle-entradas-posto.web.app) — no signup

Open the link, click **"Acessar modo demo"** and pick one of three roles
(Supremo, Admin, Operator) to see how access changes per role. It runs on
eight months of fictional data, nothing is written to the cloud, and the
data resets every day.

![Vanilla JS](https://img.shields.io/badge/JavaScript-vanilla-f7df1e?style=flat-square&logo=javascript&logoColor=black)
![No build](https://img.shields.io/badge/build_step-none-success?style=flat-square)
![Firebase](https://img.shields.io/badge/Firebase-Firestore_%2B_Auth-ff6f00?style=flat-square&logo=firebase&logoColor=white)
![Tests](https://img.shields.io/badge/tests-23_passing-success?style=flat-square)
![pt-BR](https://img.shields.io/badge/UI-Portuguese_(pt--BR)-blue?style=flat-square)

> The interface is in Brazilian Portuguese because it is used daily by a
> real fuel operation. Code comments and commits are in Portuguese too;
> this README and the file map below are in English.

---

## ✨ Features

### 📋 Entries & Invoices
- Invoice registration with XML import (NF-e)
- Multiple fuel types per entry
- Automatic Mercosul plate conversion
- Cargo / unload quantity with loss badge
- Clone and edit with full audit log

### 📊 Reports & Analytics
- Report hub: everything the system issues in one list, with the month picked there applied to the source screen before the file is generated
- Entry history filterable by invoice date and by unloading date at the same time: the cross-section isolates month-boundary invoices
- Filterable table with pagination and inline detail
- Sortable columns (date, liters, total)
- PDF export with logo, custom margins, colors, and per-month page break
- Excel, CSV, WhatsApp, and e-mail sharing
- Monthly managerial report (executive summary + by fuel + evolution)
- Global quick search (Ctrl+K)

### 📈 Analytics Dashboard
- Monthly, per-driver, per-vehicle, per-fuel, distribution, price-per-litre tabs
- KPI cards with delta vs. previous month
- Toggle Value (R$) / Liters
- Price evolution chart by fuel type
- Smart alerts (high price, suspicious volume, suspicious date) with one-click dismiss

### 🔎 Conference
- AutoSystem report import — compares entries against system entries to flag divergences

### 🚛 Freight
- Per-company freight rate (R$/L), set in each company's record
- Automatic calculation by plate, driver, company, and vehicle set
- Vehicle sets with historical composition (respects date-of-haul)
- Excel, PDF, CSV, print export

### 🔧 Registrations
- Drivers, vehicles, companies (with municipality and freight rate), fuel types (with loss %), bases, vehicle sets
- Inactive/reactivate with cascade propagation to entries

### 👥 Users & Permissions
- Firebase Auth (email/password or @username)
- Roles: Supremo (full access) · Admin · User
- Per-company access control

### ⚙️ System
- Manual and automatic backup (every 3 days, last 3 kept)
- Spreadsheet import (per-product, wide, and standard layouts)
- Duplicate detection with selective re-import
- Mass correction (company, driver, plate, fuel, base)
- Suspicious date audit
- Customizable PDF layout (logo per company, fonts, margins, colors, footer)
- Custom accent color (CSS variables cascade)

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS (ES6+), HTML5, CSS3 |
| Backend / DB | Firebase Firestore (real-time) |
| Auth | Firebase Authentication |
| Charts | Chart.js 4 |
| PDF | jsPDF + jsPDF-AutoTable |
| Excel | SheetJS (XLSX) |
| Hosting | Firebase Hosting |

No build step. No frameworks. No node_modules. Open `index.html` and go.

---

## 🚀 Getting Started

### 1. Clone
```bash
git clone https://github.com/your-user/fuel-mind.git
cd fuel-mind
```

### 2. Create a Firebase Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a project (Analytics optional)
3. Enable **Firestore Database** (production mode)
4. Enable **Authentication** → Email/Password

### 3. Configure Firebase
Copy your project config and replace in `firebase.js`:

```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

### 4. Firestore Rules (minimum)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /dados/{document} {
      allow read, write: if request.auth != null;
    }
    match /usuarios/{uid} {
      allow read: if true; // needed for @username login lookup
      allow write: if request.auth != null;
    }
  }
}
```

### 5. Create the first Supremo user
In Firebase Console → Authentication → Add user manually, then in Firestore create:

```
Collection: usuarios
Document:   {UID}
Fields:
  nome:      "Admin"
  email:     "admin@example.com"
  role:      "supremo"
  empresas:  []
  ativo:     true
```

### 6. Deploy (optional)
```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

Or serve locally with any static server:
```bash
npx serve .
```

---

## 📁 File Structure

```
fuel-mind/
├── index.html              # Single-page app shell + all modals
├── 404.html                # Custom error page
├── favicon.ico
├── firebase.json           # Hosting: cache and ignored files
├── firestore.rules         # Database security rules
│
├── assets/
│   ├── style.css           # Design system (light/dark, CSS variables)
│   └── logo-{dark,light}.svg
│
├── src/
│   ├── core/               # Foundation: data, session, infrastructure
│   │   ├── firebase.js     # Init + DB and Auth methods
│   │   ├── sessao.js       # Login, roles, active company
│   │   ├── dados.js        # In-memory database state
│   │   ├── sincronizacao.js# Writes, offline queue, real-time
│   │   ├── erros.js        # Failure log
│   │   ├── navegacao.js    # Screen switching
│   │   ├── tema.js         # Light/dark theme, brand color
│   │   └── backup.js       # Backup and restore
│   │
│   ├── shared/             # Shared by every screen
│   │   ├── utils.js        # Formatting, toasts, chart colors
│   │   ├── ui.js           # Sidebar, header, search, shortcuts
│   │   ├── combobox.js     # Autocomplete field
│   │   ├── numerico.js     # pt-BR number input
│   │   ├── validacao.js    # Form validation
│   │   └── rascunho.js     # Form draft memory
│   │
│   └── screens/            # One screen, one file
│       ├── lancamentos.js  # Entry form, NF-e XML, save/edit/clone
│       ├── central.js      # Report hub: everything the system issues
│       ├── relatorios.js   # History: table, filters, pagination, exports
│       ├── analitico.js    # Six analytics tabs + charts
│       ├── dashboard.js    # KPIs, alerts, per-fuel breakdown
│       ├── fretes.js       # Freight calculation and export
│       ├── fechamento.js   # Month-end closing report (PDF)
│       ├── grupo.js        # Company comparison
│       ├── cadastros.js    # Drivers, vehicles, companies, fuels…
│       ├── cadastros-importar.js # Fleet import from a spreadsheet
│       ├── sistema.js      # Backup, PDF settings, reconciliation
│       ├── importacao.js   # Spreadsheets with format detection
│       ├── usuarios.js     # Users and permissions
│       └── demo.js         # Demo mode
│
└── tests/                  # node --test, zero dependencies
```

---

## 🎨 Design System

- **Dark-first** with full light mode support
- CSS custom properties for every color, radius, shadow
- Accent color fully customizable at runtime (no rebuild needed)
- Fonts: Syne (headings) + DM Sans (body) + JetBrains Mono (numbers)
- Responsive: mobile sidebar overlay, collapsible table columns, touch-friendly

---

## 🔐 Security Notes

- Never commit `firebase.js` with real credentials to a public repo — use environment variables or Firebase App Hosting secrets
- Tighten Firestore rules in production (add per-user document rules)
- The `usuarios` collection needs public read only for the `@username` login flow; scope it if you don't use that feature

---

## 📄 License

MIT — feel free to use, modify, and distribute.

---

## 🙏 Acknowledgements

Built with [Firebase](https://firebase.google.com), [Chart.js](https://www.chartjs.org), [jsPDF](https://parall.ax/products/jspdf), and [SheetJS](https://sheetjs.com).
