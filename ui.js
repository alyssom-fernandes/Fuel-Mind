/*=================================================
  UI.JS — Lógica da Interface v2.4
  Sidebar, Header, Navegação, Cadastros unificados,
  Bases/Distribuidoras, relógio, tema, ícones nas abas,
  busca global, atalhos de teclado e seletor de empresa global
  + Modal de Atalhos de Teclado
=================================================*/

/* ========== TÍTULOS DAS TELAS ========== */
const TITULOS_TELAS = {
    dashboard:    "Dashboard",
    lancamentos:  "Lançamentos",
    relatorios:   "Relatórios",
    historico:    "Histórico",
    analitico:    "Analítico",
    fretes:       "Fretes",
    conferencia:  "Conferências",
    importacao:   "Importar Planilha",
    cadastros:    "Cadastros",
    sistema:      "Sistema",
    usuarios:     "Usuários e Permissões",
};

/* ========== SIDEBAR ========== */
function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const isOpen  = sidebar.classList.contains("aberta");

    if (isOpen) {
        sidebar.classList.remove("aberta");
        overlay.classList.remove("visivel");
    } else {
        sidebar.classList.add("aberta");
        overlay.classList.add("visivel");
    }
}

function fecharSidebar() {
    document.getElementById("sidebar").classList.remove("aberta");
    document.getElementById("sidebarOverlay").classList.remove("visivel");
}

// Fecha a sidebar mobile ao clicar em qualquer item
document.addEventListener("click", function(e) {
    if (window.innerWidth <= 768 && e.target.closest(".sidebar-item")) {
        fecharSidebar();
    }
});

/* ========== MARCAÇÃO DO ITEM ATIVO ========== */
function marcarNavAtivo(telaId) {
    document.querySelectorAll(".sidebar-item").forEach(btn => btn.classList.remove("ativo"));

    const mapa = {
        motoristas:   "cadastros",
        veiculos:     "cadastros",
        empresas:     "cadastros",
        combustiveis: "cadastros",
    };
    const alvoId = "nav-" + (mapa[telaId] || telaId);
    const alvo = document.getElementById(alvoId);
    if (alvo) alvo.classList.add("ativo");
}

/* ========== TÍTULO DO HEADER ========== */
function atualizarTituloHeader(telaId) {
    const titulo = TITULOS_TELAS[telaId] || telaId;
    const el = document.getElementById("headerPageTitle");
    if (el) el.textContent = titulo;
}

/* ========== RELÓGIO NO HEADER ========== */
function atualizarRelogio() {
    const el = document.getElementById("headerDatetime");
    if (!el) return;
    const agora = new Date();
    const data  = agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const hora  = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    el.textContent = `${data} · ${hora}`;
}
setInterval(atualizarRelogio, 1000);
atualizarRelogio();

/* ========== RODAPÉ DA SIDEBAR ========== */
function atualizarFooterSidebar() {
    const el = document.getElementById("sidebar-data-footer");
    if (!el) return;
    el.textContent = new Date().getFullYear();
}
atualizarFooterSidebar();

/*─────────────────────────────────────────────────
  HOOK DE NAVEGAÇÃO
  Chamado por app.js ao final de mostrarTela
─────────────────────────────────────────────────*/
window._uiNavHook = function(telaId) {
    // Redireciona cadastros individuais para a tela unificada
    const redirecionamentos = {
        motoristas:   () => { mostrarTela("cadastros"); trocarAbaCadastro("motoristas"); return true; },
        veiculos:     () => { mostrarTela("cadastros"); trocarAbaCadastro("veiculos");   return true; },
        empresas:     () => { mostrarTela("cadastros"); trocarAbaCadastro("empresas");   return true; },
        combustiveis: () => { mostrarTela("cadastros"); trocarAbaCadastro("combustiveis"); return true; },
    };
    if (redirecionamentos[telaId]) { redirecionamentos[telaId](); return; }

    marcarNavAtivo(telaId);
    atualizarTituloHeader(telaId);

    if (typeof atualizarTitulosInternos === 'function') {
        atualizarTitulosInternos();
    }
};

/* atualizarFiltroEmpresaGlobal está em app.js */

/* ========== ABAS DOS CADASTROS UNIFICADOS ========== */
function trocarAbaCadastro(aba, btnEl) {
    ["motoristas","veiculos","empresas","combustiveis","bases","conjuntos"].forEach(a => {
        const el = document.getElementById("cad-" + a);
        if (el) el.style.display = "none";
    });

    const alvo = document.getElementById("cad-" + aba);
    if (alvo) alvo.style.display = "block";

    const paiBotoes = document.querySelectorAll("#cadastros .analitico-abas .aba-btn");
    paiBotoes.forEach(b => b.classList.remove("ativa"));

    if (btnEl) {
        btnEl.classList.add("ativa");
    } else {
        paiBotoes.forEach(b => {
            if (b.textContent.toLowerCase().includes(aba.toLowerCase().replace("bases","base"))) {
                b.classList.add("ativa");
            }
        });
    }

    atualizarListas();
}

/* ========== BASES / DISTRIBUIDORAS ========== */
function renderizarListaBases() {
    const ulB = document.getElementById("listaBases");
    if (!ulB) return;
    const showInat = document.getElementById("mostrarInativosBases")?.checked;
    const lista = showInat ? db.bases : db.bases.filter(b => b.ativo !== false);
    ulB.innerHTML = lista.length === 0
        ? `<li class="vazio">Nenhuma base cadastrada ainda.</li>`
        : lista.map(b => `
            <li class="${b.ativo !== false ? "" : "inativo"}">
                <span>${escapeHtml(b.nome)}${b.ativo !== false ? "" : ' <em class="tag-inativo">inativo</em>'}</span>
                <div class="acoes-lista">
                    <button class="btn-editar"   onclick="abrirModal('Editar Base','Nome','${escapeJsAttr(b.nome)}','bases','${b.id}')">Editar</button>
                    <button class="btn-inativar" onclick="toggleAtivo('bases','${b.id}')">${b.ativo !== false ? "Inativar" : "Reativar"}</button>
                    <button class="btn-excluir"  onclick="excluirCadastro('bases','${b.id}')">Excluir</button>
                </div>
            </li>`).join("");
}

function preencherSelectBase() {
    const basesAtivas = db.bases.filter(b => b.ativo !== false);
    preencherSelect("baseEntradaSelect", basesAtivas.map(b => ({ valor: b.nome, texto: b.nome })), "Selecione a base");
}

let _baseEntradaListenerRegistrado = false;

function sincronizarBaseEntrada() {
    const sel    = document.getElementById("baseEntradaSelect");
    const hidden = document.getElementById("baseEntrada");
    const input  = document.getElementById("baseEntradaInput");
    if (!sel || !hidden || !input) return;
    if (_baseEntradaListenerRegistrado) return;
    _baseEntradaListenerRegistrado = true;
    sel.addEventListener("change", function() {
        hidden.value = this.value;
        input.value = this.value;
    });
}

/**
 * Define a base ativa no formulário de lançamento, atualizando os três
 * campos simultaneamente: input visível, campo hidden e select.
 *
 * Usar sempre que precisar definir a base programaticamente.
 * Nunca setar `baseEntradaInput`, `baseEntrada` ou `baseEntradaSelect`
 * individualmente — os três devem estar sempre em sincronia.
 *
 * @param {string} valor - Nome da base, ou string vazia para limpar
 */
function setBase(valor) {
    const input  = document.getElementById("baseEntradaInput");
    const hidden = document.getElementById("baseEntrada");
    const sel    = document.getElementById("baseEntradaSelect");
    if (input)  input.value  = valor || "";
    if (hidden) hidden.value = valor || "";
    if (sel)    sel.value    = valor || "";
}

/* ========== MELHORIAS NOS KPI CARDS DO DASHBOARD ========== */
function injetarIconesKPI() {
    const cards = document.querySelectorAll("#kpiDashboard .kpi-card");
    const icones = [
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>`,
    ];

    cards.forEach((card, i) => {
        if (i < icones.length && !card.querySelector(".kpi-icon")) {
            const iconDiv = document.createElement("div");
            iconDiv.className = "kpi-icon";
            iconDiv.innerHTML = icones[i];
            card.insertBefore(iconDiv, card.firstChild);
        }
    });
}

/* ========== NAVEGAÇÃO DIRETA A LANÇAMENTO ========== */
/**
 * Navega diretamente para um lançamento específico, abrindo o modal de edição.
 * Usada por links internos (ex: busca global, dashboard).
 * @param {string} id - ID do lançamento (formato `"timestamp-hash"`)
 */
function irParaLancamento(id) {
    if (!id) return;
    if (typeof editarLancamento === 'function') {
        editarLancamento(id);
    }
}

/* ========== BUSCA GLOBAL ========== */
let _buscaDebounceTimer = null;

/**
 * Abre o modal de busca global (Ctrl+K).
 * Limpa o input e os resultados anteriores, e foca o campo de busca.
 */
function abrirBuscaGlobal() {
    const modal = document.getElementById("buscaGlobalModal");
    if (!modal) return;
    modal.style.display = "flex";
    const input = document.getElementById("buscaGlobalInput");
    input.value = "";
    document.getElementById("buscaGlobalResultados").innerHTML = "";
    input.focus();
}

function fecharBuscaGlobal() {
    const modal = document.getElementById("buscaGlobalModal");
    if (modal) modal.style.display = "none";
    clearTimeout(_buscaDebounceTimer);
}

/**
 * Handler do `oninput` do campo de busca global.
 * Aplica debounce de 300ms antes de chamar `_realizarBusca`,
 * evitando buscas a cada keystroke.
 */
function executarBuscaGlobal() {
    clearTimeout(_buscaDebounceTimer);
    _buscaDebounceTimer = setTimeout(_realizarBusca, 300);
}

function _realizarBusca() {
    const termo = document.getElementById("buscaGlobalInput").value.trim().toLowerCase();
    const resultadosDiv = document.getElementById("buscaGlobalResultados");

    if (termo.length < 2) {
        resultadosDiv.innerHTML = "<p class='dica'>Digite pelo menos 2 caracteres...</p>";
        return;
    }

    // ── Lançamentos ──
    const lancamentos = db.lancamentos.filter(l => {
        const s = `${l.numeroNota} ${l.empresa || ''} ${l.motorista || ''} ${l.placa || ''} ${l.base || ''} ${l.observacoes || ''}`.toLowerCase();
        return s.includes(termo);
    }).slice(0, 20);

    // ── Motoristas ──
    const motoristas = (db.motoristas || []).filter(m =>
        m.nome && m.nome.toLowerCase().includes(termo)
    ).slice(0, 5);

    // ── Placas/Veículos ──
    const placas = (db.veiculos || []).filter(v =>
        v.nome && v.nome.toLowerCase().includes(termo)
    ).slice(0, 5);

    // ── Empresas ──
    const empresas = (db.empresas || []).filter(e =>
        e.nome && e.nome.toLowerCase().includes(termo)
    ).slice(0, 3);

    if (!lancamentos.length && !motoristas.length && !placas.length && !empresas.length) {
        resultadosDiv.innerHTML = "<p class='dica'>Nenhum resultado encontrado.</p>";
        return;
    }

    const secStyle = `margin-bottom:16px`;
    const labelStyle = `font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
                        color:var(--text-muted);margin-bottom:6px;display:block;padding:0 2px`;
    const itemStyle = `display:flex;align-items:center;justify-content:space-between;gap:8px;
                       padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer;
                       border:1px solid var(--border-light);background:var(--surface-alt);
                       margin-bottom:5px;transition:background 0.12s`;

    let html = '';

    // Lançamentos
    if (lancamentos.length) {
        html += `<div style="${secStyle}">
            <span style="${labelStyle}">Lançamentos (${lancamentos.length})</span>
            ${lancamentos.map(l => {
                const litros = l.itens.reduce((s, i) => s + _litrosItem(i), 0);
                const tipos  = [...new Set(l.itens.map(i => i.tipo).filter(Boolean))].join(', ');
                return `<div style="${itemStyle}"
                    onmouseenter="this.style.background='var(--surface-raised)'"
                    onmouseleave="this.style.background='var(--surface-alt)'"
                    onclick="irParaLancamento('${l.id}'); fecharBuscaGlobal();">
                    <div style="min-width:0">
                        <div style="font-weight:600;font-size:0.85rem;color:var(--text)">
                            Nota ${escapeHtml(l.numeroNota) || '—'}
                            <span style="font-weight:400;color:var(--text-muted);font-size:0.78rem;margin-left:6px">${formatarData(l.dataNota)}</span>
                        </div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;
                             white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                            ${[l.motorista, l.placa, l.empresa].filter(Boolean).map(escapeHtml).join(' · ')}
                            ${tipos ? `<span style="margin-left:6px;color:var(--primary);font-size:0.7rem">${escapeHtml(tipos)}</span>` : ''}
                        </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;
                             font-weight:600;color:var(--text)">${fmtR(l.total)}</div>
                        <div style="font-size:0.7rem;color:var(--text-muted)">${fmtL(litros, 0)}</div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }

    // Motoristas
    if (motoristas.length) {
        html += `<div style="${secStyle}">
            <span style="${labelStyle}">Motoristas</span>
            ${motoristas.map(m => `
                <div style="${itemStyle}"
                    onmouseenter="this.style.background='var(--surface-raised)'"
                    onmouseleave="this.style.background='var(--surface-alt)'"
                    onclick="_buscaAbrirFiltrado('motorista','${escapeJsAttr(m.nome)}'); fecharBuscaGlobal();">
                    <span style="font-size:0.85rem;color:var(--text)">${escapeHtml(m.nome)}</span>
                    <span style="font-size:0.72rem;color:var(--primary)">Ver histórico →</span>
                </div>`).join('')}
        </div>`;
    }

    // Placas
    if (placas.length) {
        html += `<div style="${secStyle}">
            <span style="${labelStyle}">Placas / Veículos</span>
            ${placas.map(v => `
                <div style="${itemStyle}"
                    onmouseenter="this.style.background='var(--surface-raised)'"
                    onmouseleave="this.style.background='var(--surface-alt)'"
                    onclick="_buscaAbrirFiltrado('placa','${escapeJsAttr(v.nome)}'); fecharBuscaGlobal();">
                    <span style="font-size:0.85rem;color:var(--text)">${escapeHtml(v.nome)}</span>
                    <span style="font-size:0.72rem;color:var(--primary)">Ver histórico →</span>
                </div>`).join('')}
        </div>`;
    }

    // Empresas
    if (empresas.length) {
        html += `<div style="${secStyle}">
            <span style="${labelStyle}">Empresas</span>
            ${empresas.map(e => `
                <div style="${itemStyle}"
                    onmouseenter="this.style.background='var(--surface-raised)'"
                    onmouseleave="this.style.background='var(--surface-alt)'"
                    onclick="_buscaAbrirFiltrado('empresa','${escapeJsAttr(e.nome)}'); fecharBuscaGlobal();">
                    <span style="font-size:0.85rem;color:var(--text)">${escapeHtml(e.nome)}</span>
                    <span style="font-size:0.72rem;color:var(--primary)">Ver relatório →</span>
                </div>`).join('')}
        </div>`;
    }

    resultadosDiv.innerHTML = html;
}

/**
 * Abre Relatórios pré-filtrado por motorista, placa ou empresa.
 */
function _buscaAbrirFiltrado(tipo, valor) {
    mostrarTela('relatorios');
    setTimeout(() => {
        if (tipo === 'motorista') {
            const sel = document.getElementById('filtroMotorista');
            if (sel) { sel.value = valor; carregarRelatorio(); }
        } else if (tipo === 'placa') {
            const sel = document.getElementById('filtroPlaca');
            if (sel) { sel.value = valor; carregarRelatorio(); }
        } else if (tipo === 'empresa') {
            const inp = document.getElementById('filtroBusca');
            if (inp) { inp.value = valor; carregarRelatorio(); }
        }
    }, 100);
}

/*─────────────────────────────────────────────────
  MODAL DE ATALHOS DE TECLADO
─────────────────────────────────────────────────*/
const _ATALHOS = [
    {
        grupo: "Navegação",
        itens: [
            { teclas: ["Ctrl", "N"],   descricao: "Novo lançamento" },
            { teclas: ["Ctrl", "K"],   descricao: "Busca global" },
            { teclas: ["Escape"],      descricao: "Fechar modal aberto" },
        ]
    },
    {
        grupo: "Lançamentos",
        itens: [
            { teclas: ["Ctrl", "S"],   descricao: "Salvar lançamento (na tela de Lançamentos)" },
        ]
    },
    {
        grupo: "Relatórios",
        itens: [
            { teclas: ["Ctrl", "F"],   descricao: "Focar campo de busca rápida" },
        ]
    },
];

function abrirAtalhos() {
    const overlay = document.getElementById("atalhosModal");
    if (overlay) { overlay.style.display = "flex"; return; }

    // Cria o modal dinamicamente na primeira chamada
    const div = document.createElement("div");
    div.id = "atalhosModal";
    div.className = "modal-overlay";
    div.style.cssText = "display:flex; backdrop-filter:blur(6px);";
    div.onclick = function(e) { if (e.target === div) fecharAtalhos(); };

    const grupos = _ATALHOS.map(g => `
        <div style="margin-bottom:20px;">
            <p style="font-size:0.7rem;font-weight:700;text-transform:uppercase;
                      letter-spacing:0.08em;color:var(--text-muted);margin:0 0 10px;">
                ${g.grupo}
            </p>
            ${g.itens.map(item => `
                <div style="display:flex;align-items:center;justify-content:space-between;
                            padding:7px 0;border-bottom:1px solid var(--border-light, rgba(255,255,255,0.06));">
                    <span style="font-size:0.88rem;color:var(--text);">${item.descricao}</span>
                    <span style="display:flex;gap:4px;flex-shrink:0;margin-left:16px;">
                        ${item.teclas.map(t =>
                            `<kbd style="display:inline-block;padding:3px 7px;border-radius:5px;
                                        background:var(--surface-alt, rgba(255,255,255,0.08));
                                        border:1px solid var(--border);font-size:0.75rem;
                                        font-family:monospace;color:var(--text-muted);
                                        box-shadow:0 1px 0 var(--border);">${t}</kbd>`
                        ).join('<span style="color:var(--text-muted);font-size:0.75rem;align-self:center;">+</span>')}
                    </span>
                </div>
            `).join("")}
        </div>
    `).join("");

    div.innerHTML = `
        <div class="modal" style="max-width:480px;width:92%;max-height:85vh;overflow-y:auto;"
             onclick="event.stopPropagation()">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                <h3 style="margin:0;display:flex;align-items:center;gap:8px;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         style="width:18px;height:18px;color:var(--primary);">
                        <rect x="2" y="4" width="20" height="16" rx="2"/>
                        <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>
                    </svg>
                    Atalhos de Teclado
                </h3>
                <button onclick="fecharAtalhos()"
                        style="background:none;border:none;cursor:pointer;
                               color:var(--text-muted);font-size:1.2rem;padding:4px 8px;
                               border-radius:6px;line-height:1;"
                        title="Fechar">✕</button>
            </div>
            ${grupos}
            <p style="margin-top:16px;font-size:0.78rem;color:var(--text-muted);text-align:center;">
                Mac: substitua <kbd style="padding:2px 6px;border-radius:4px;background:var(--surface-alt);
                border:1px solid var(--border);font-size:0.72rem;">Ctrl</kbd> por
                <kbd style="padding:2px 6px;border-radius:4px;background:var(--surface-alt);
                border:1px solid var(--border);font-size:0.72rem;">⌘ Cmd</kbd>
            </p>
        </div>
    `;

    document.body.appendChild(div);
}

function fecharAtalhos() {
    const overlay = document.getElementById("atalhosModal");
    if (overlay) overlay.style.display = "none";
}

// Fecha com Escape (integrado ao handler global do app.js)
document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        const m = document.getElementById("atalhosModal");
        if (m && m.style.display !== "none") { fecharAtalhos(); }
    }
});

/* ========== INICIALIZAÇÃO ========== */

/* ========== MODAL DE CONFIRMAÇÃO / ALERTA (fmConfirm / fmAlert) ========== */
/**
 * fmConfirm(opcoes) → Promise<boolean>
 * Substitui confirm() nativo com modal no estilo do sistema.
 *
 * Uso:  if (!await fmConfirm({ titulo:'Excluir?', msg:'Não pode ser desfeito.' })) return;
 *
 * Opções:
 *   titulo     string             (default: 'Confirmar')
 *   msg        string             (default: '')
 *   confirmTxt string             (default: 'Confirmar')
 *   cancelTxt  string             (default: 'Cancelar')
 *   tipo       'perigo'|'aviso'|'info'  (default: 'perigo')
 */
/**
 * Substitui `confirm()` nativo com modal estilizado no padrão do sistema.
 * Obrigatório para todas as ações destrutivas (excluir, inativar, fechar mês).
 *
 * Fecha com Esc (cancela) ou Enter (confirma).
 * O botão de confirmação recebe foco automaticamente.
 *
 * @param {Object} [opcoes]
 * @param {string} [opcoes.titulo='Confirmar']   - Título do modal
 * @param {string} [opcoes.msg='']               - Mensagem de detalhe (suporta `\n`)
 * @param {string} [opcoes.confirmTxt='Confirmar'] - Texto do botão de confirmação
 * @param {string} [opcoes.cancelTxt='Cancelar']  - Texto do botão de cancelamento
 * @param {'perigo'|'aviso'|'info'} [opcoes.tipo='perigo'] - Define a cor do botão de confirmação
 * @returns {Promise<boolean>} `true` se confirmado, `false` se cancelado
 *
 * @example
 * if (!await fmConfirm({ titulo: 'Excluir?', msg: 'Esta ação não pode ser desfeita.', confirmTxt: 'Excluir', tipo: 'perigo' })) return;
 */
/**
 * Modal de confirmação. Todo texto recebido é escapado: `titulo` e `msg`
 * carregam nomes de cadastro ("Excluir \"${item.nome}\"?") e não devem
 * interpretar HTML. Se algum dia for preciso destaque visual aqui, use
 * um parâmetro dedicado em vez de aceitar markup cru.
 */
function fmConfirm({ titulo = 'Confirmar', msg = '', confirmTxt = 'Confirmar', cancelTxt = 'Cancelar', tipo = 'perigo' } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'z-index:2000';

        const corMap = { perigo: 'var(--danger)', aviso: 'var(--warning)', info: 'var(--primary)' };
        const cor = corMap[tipo] || corMap.perigo;

        overlay.innerHTML = `
            <div class="modal" style="max-width:420px">
                <h3 style="margin-bottom:${msg ? '12px' : '20px'}">${escapeHtml(titulo)}</h3>
                ${msg ? `<p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.55;margin-bottom:20px;white-space:pre-wrap">${escapeHtml(msg)}</p>` : ''}
                <div class="modal-acoes">
                    <button class="btn-secundario fm-cancel">${escapeHtml(cancelTxt)}</button>
                    <button class="btn-primario fm-ok" style="background:${cor};border-color:${cor}">${escapeHtml(confirmTxt)}</button>
                </div>
            </div>`;

        const fechar = r => { overlay.remove(); resolve(r); };
        overlay.querySelector('.fm-ok').onclick     = () => fechar(true);
        overlay.querySelector('.fm-cancel').onclick = () => fechar(false);
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Escape') fechar(false);
            if (e.key === 'Enter')  { e.preventDefault(); fechar(true); }
        });
        document.body.appendChild(overlay);
        setTimeout(() => overlay.querySelector('.fm-ok').focus(), 40);
    });
}

/**
 * fmAlert(opcoes) → Promise<void>
 * Substitui alert() nativo com modal no estilo do sistema.
 *
 * Uso:  await fmAlert({ titulo:'Erro', msg:'Mensagem', tipo:'erro' });
 *
 * Opções:
 *   titulo  string                          (default: 'Atenção')
 *   msg     string                          (default: '')
 *   tipo    'info'|'aviso'|'erro'|'sucesso' (default: 'info')
 *   btnTxt  string                          (default: 'OK')
 */
function fmAlert({ titulo = 'Atenção', msg = '', tipo = 'info', btnTxt = 'OK' } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'z-index:2000';

        const icones = {
            info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
            aviso:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            erro:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            sucesso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>',
            perigo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        };
        const cores  = { info: 'var(--primary)', aviso: 'var(--warning)', erro: 'var(--danger)', sucesso: 'var(--success)' };
        const icone  = icones[tipo]  || icones.info;
        const cor    = cores[tipo]   || cores.info;

        overlay.innerHTML = `
            <div class="modal" style="max-width:420px">
                <h3 style="display:flex;align-items:center;gap:8px;margin-bottom:${msg ? '12px' : '20px'}">
                    <span style="color:${cor}">${icone}</span>${titulo}
                </h3>
                ${msg ? `<p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.55;margin-bottom:20px;white-space:pre-wrap">${msg}</p>` : ''}
                <div class="modal-acoes">
                    <button class="btn-primario fm-ok">${btnTxt}</button>
                </div>
            </div>`;

        const fechar = () => { overlay.remove(); resolve(); };
        overlay.querySelector('.fm-ok').onclick = fechar;
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); fechar(); }
        });
        document.body.appendChild(overlay);
        setTimeout(() => overlay.querySelector('.fm-ok').focus(), 40);
    });
}

document.addEventListener("DOMContentLoaded", function() {
    marcarNavAtivo("dashboard");
    atualizarTituloHeader("dashboard");

    ["motoristas","veiculos","empresas","combustiveis"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });

    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            abrirBuscaGlobal();
        }
    });

    sincronizarBaseEntrada();
});
