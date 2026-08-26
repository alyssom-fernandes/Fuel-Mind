# ⛽ Fuel Mind — Fuel Management System

> **Fuel entry & freight management platform** built with vanilla JS + Firebase, designed for fuel distributors and transport companies. Real-time, multi-company, with analytics and freight calculation.

---

## ✨ Features

### 📋 Entries & Invoices
- Invoice registration with XML import (NF-e)
- Multiple fuel types per entry
- Automatic Mercosul plate conversion
- Cargo / unload quantity with loss badge
- Attachments via Firebase Storage (PDF, images)
- Clone and edit with full audit log

### 📊 Reports & Analytics
- Filterable table with pagination and inline detail
- Sortable columns (date, liters, total)
- PDF export with logo, custom margins, colors, and per-month page break
- Excel, CSV, WhatsApp, and e-mail sharing
- Monthly managerial report (executive summary + by fuel + evolution)
- Global quick search (Ctrl+K)

### 📈 Analytics Dashboard
- Monthly, per-driver, per-vehicle, per-fuel, comparative, distribution, price evolution tabs
- KPI cards with delta vs. previous month
- Toggle Value (R$) / Liters
- Price evolution chart by fuel type
- Smart alerts (high price, suspicious volume, suspicious date) with one-click dismiss

### 🔎 Conference
- AutoSystem report import — compares entries against system entries to flag divergences

### 🚛 Freight
- Per-fuel rate configuration (R$/L)
- Automatic calculation by plate, driver, company, and vehicle set
- Vehicle sets with historical composition (respects date-of-haul)
- Excel, PDF, CSV, print export

### 🔧 Registrations
- Drivers, vehicles, companies (with municipality), fuel types (with loss %), bases, vehicle sets
- Inactive/reactivate with cascade propagation to entries

### 👥 Users & Permissions
- Firebase Auth (email/password or @username)
- Roles: Supremo (full access) · Admin · User
- Per-company access control

### ⚙️ System
- Manual and automatic backup (every 3 days, last 3 kept)
- Spreadsheet import (Fabiandra, Posto Rosário wide format, standard)
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
| Storage | Firebase Storage (attachments & logos) |
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
5. Enable **Storage**

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
├── index.html          # Single-page app shell + all modals
├── style.css           # Design system (dark/light, CSS variables)
├── firebase.js         # Firebase init + all DB/Auth/Storage methods
├── app.js              # Auth flow, DB load/save, real-time listener
├── utils.js            # Formatting, spinners, toast, chart colors
├── ui.js               # Sidebar, header, search, keyboard shortcuts
├── cadastros.js        # CRUD for drivers, vehicles, companies, fuels, bases, sets
├── lancamentos.js      # Entry form, XML import, save/edit/clone/delete
├── relatorios.js       # Reports table, filters, pagination, exports
├── analitico.js        # Analytics tabs + Chart.js graphs
├── dashboard.js        # Dashboard KPIs, alerts, per-fuel breakdown
├── fretes.js           # Freight calculation and export
├── sistema.js          # Backup, import, PDF config, AutoSystem conference
├── importacao.js       # Spreadsheet import with multi-format detection
├── usuarios.js         # User management and permissions
└── firebase.json       # Firebase Hosting config
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
