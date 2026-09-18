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
    // Na tela de lançamento, o título do cabeçalho carrega o marcador de
    // formulário sujo: é o único título visível da tela.
    const sujo = telaId === "lancamentos" && typeof _formularioSujo !== "undefined" && _formularioSujo;
    if (el) el.textContent = sujo ? "● " + titulo : titulo;
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

    if (telaId === "lancamentos" && typeof _demoDicaLancamento === 'function') {
        _demoDicaLancamento();
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

/* ── COMANDOS NO Ctrl+K (18/09/2026) ────────────────────────────────
   O Ctrl+K já estava na cabeça de quem usa o sistema. Linear, Slack,
   Raycast e Superhuman fazem do mesmo atalho o lugar para ir quando não se
   sabe onde clicar: busca e ação na mesma caixa. Aqui, digitar "fretes",
   "novo", "grupo" ou o nome de uma empresa já oferece o comando, antes
   dos resultados de busca. Os comandos respeitam o papel (`data-papel`
   do botão da sidebar) e a troca de empresa passa pela porta única. */
function _comandosPaleta() {
    const irPara = (id, rotulo, palavras) => ({
        rotulo, palavras, acao: `mostrarTela('${id}')`,
        disponivel: () => {
            const nav = document.getElementById("nav-" + id);
            return !nav || !nav.classList.contains("fm-sem-permissao");
        }
    });
    const cmds = [
        { rotulo: "Novo lançamento", palavras: "novo lancar lancamento nota entrada",
          acao: "mostrarTela('lancamentos')", disponivel: () => true },
        irPara("dashboard", "Ir para o Dashboard", "dashboard inicio visao geral painel"),
        irPara("relatorios", "Ir para Relatórios", "relatorio relatorios notas lista"),
        irPara("analitico", "Ir para o Analítico", "analitico graficos analise"),
        irPara("fretes", "Ir para Fretes", "frete fretes transportador"),
        irPara("grupo", "Comparar as empresas do grupo", "grupo empresas comparar consolidado"),
        irPara("conferencia", "Ir para Conferências", "conferencia autosystem conferir"),
        irPara("cadastros", "Ir para Cadastros", "cadastro cadastros motorista placa combustivel base conjunto"),
        irPara("usuarios", "Ir para Usuários", "usuario usuarios permissao"),
        irPara("sistema", "Ir para Sistema", "sistema backup importar configuracao"),
        { rotulo: "Fechamento do mês de fretes (Excel)", palavras: "fechamento fechar mes pacote contador",
          acao: "mostrarTela('fretes').then(() => exportarFechamentoDoMes())", disponivel: () => true },
        { rotulo: "Alternar tema claro/escuro", palavras: "tema escuro claro modo",
          acao: "toggleModoEscuro()", disponivel: () => true },
        { rotulo: "Ver os atalhos de teclado", palavras: "atalho atalhos teclado ajuda",
          acao: "abrirAtalhos()", disponivel: () => true }
    ];
    // Trocar de empresa, uma entrada por empresa que o perfil acessa.
    const permitidos = typeof _empresaIdsPermitidos === "function" ? _empresaIdsPermitidos() : null;
    (db.empresas || []).filter(e => e.ativo !== false && (!permitidos || permitidos.includes(e.id))
        && e.nome !== empresaFiltroGlobal).forEach(e => {
        cmds.push({ rotulo: `Trocar para ${e.nome}`, palavras: "trocar empresa " + normalizarTexto(e.nome),
            acao: `trocarEmpresaAtiva('${escapeJsAttr(e.nome)}')`, disponivel: () => true });
    });
    return cmds;
}

function _comandosQueCasam(termo) {
    if (!termo) return [];
    const partes = termo.split(/\s+/).filter(Boolean);
    return _comandosPaleta()
        .filter(c => c.disponivel())
        .filter(c => {
            const alvo = normalizarTexto(c.rotulo + " " + c.palavras);
            return partes.every(p => alvo.includes(p));
        })
        .slice(0, 6);
}

function _realizarBusca() {
    // normalizarTexto no termo e no conteúdo: até aqui a busca era
    // accent-sensitive e procurar "jose" não encontrava "José", enquanto os
    // datalists do formulário já dobravam acento. Os dois agora combinam.
    const termo = normalizarTexto(document.getElementById("buscaGlobalInput").value);
    const resultadosDiv = document.getElementById("buscaGlobalResultados");

    if (termo.length < 2) {
        resultadosDiv.innerHTML = "<p class='dica'>Digite pelo menos 2 caracteres...</p>";
        return;
    }

    // ── Lançamentos ──
    // A busca acha tudo, inclusive o que não vale mais — ela existe para
    // responder "onde está aquela nota?", e a resposta "não existe" seria
    // falsa. O que muda é que o resultado diz o estado, para ninguém sair
    // daqui achando que encontrou um lançamento que conta.
    const lancamentos = db.lancamentos.filter(l => {
        const s = normalizarTexto(`${l.numeroNota} ${l.empresa || ''} ${l.motorista || ''} ${l.placa || ''} ${l.base || ''} ${l.observacoes || ''}`);
        return s.includes(termo);
    }).slice(0, 20);

    // ── Motoristas ──
    const motoristas = (db.motoristas || []).filter(m =>
        m.nome && normalizarTexto(m.nome).includes(termo)
    ).slice(0, 5);

    // ── Placas/Veículos ──
    const placas = (db.veiculos || []).filter(v =>
        v.nome && normalizarTexto(v.nome).includes(termo)
    ).slice(0, 5);

    // ── Empresas ──
    const empresas = (db.empresas || []).filter(e =>
        e.nome && normalizarTexto(e.nome).includes(termo)
    ).slice(0, 3);

    const comandos = _comandosQueCasam(termo);

    if (!comandos.length && !lancamentos.length && !motoristas.length && !placas.length && !empresas.length) {
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

    // Comandos primeiro: quem digita "fretes" quer ir para Fretes.
    if (comandos.length) {
        html += `<div style="${secStyle}">
            <span style="${labelStyle}">Comandos</span>
            ${comandos.map(c => `
                <div style="${itemStyle}"
                    onmouseenter="this.style.background='var(--surface-raised)'"
                    onmouseleave="this.style.background='var(--surface-alt)'"
                    onclick="fecharBuscaGlobal(); ${escapeHtml(c.acao)};">
                    <span style="font-size:0.85rem;color:var(--text)">${escapeHtml(c.rotulo)}</span>
                    <span style="font-size:0.72rem;color:var(--primary)">Enter ↵</span>
                </div>`).join('')}
        </div>`;
    }

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
                            ${lancamentoAtivo(l) ? '' : `<span class="badge-inativo-user" style="margin-left:6px">${l.estado === 'cancelado' ? 'cancelada' : 'excluída'}</span>`}
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
    _buscaIndiceAtivo = -1;
}

/**
 * Abre Relatórios pré-filtrado por motorista, placa ou empresa.
 */
async function _buscaAbrirFiltrado(tipo, valor) {
    // Empresa é a empresa ativa, não um texto de busca: o relatório sempre
    // filtra pela ativa, e "Ver relatório" de outra empresa abria vazio.
    if (tipo === 'empresa') {
        if (!await trocarEmpresaAtiva(valor)) return;
        await mostrarTela('relatorios');
        if (document.getElementById('relatorios')?.style.display === 'block') limparFiltros('relatorio');
        return;
    }
    await mostrarTela('relatorios');
    // Se a pergunta de saída do lançamento cancelou a troca, não mexe nos filtros.
    if (document.getElementById('relatorios')?.style.display !== 'block') return;
    if (tipo === 'motorista') {
        const sel = document.getElementById('filtroMotorista');
        if (sel) { sel.value = valor; carregarRelatorio(); }
    } else if (tipo === 'placa') {
        const sel = document.getElementById('filtroPlaca');
        if (sel) { sel.value = valor; carregarRelatorio(); }
    }
}

/* Navegação por teclado nos resultados da busca global: o rodapé do modal
   prometia ↑ ↓ e Enter, e nada acontecia. */
let _buscaIndiceAtivo = -1;
function _buscaItens() {
    return [...document.querySelectorAll('#buscaGlobalResultados [onclick]')];
}
function _buscaDestacar(idx) {
    const itens = _buscaItens();
    itens.forEach((el, i) => {
        const ativo = i === idx;
        el.classList.toggle('busca-item-ativo', ativo);
        el.setAttribute('aria-selected', ativo ? 'true' : 'false');
        if (ativo) el.scrollIntoView({ block: 'nearest' });
    });
    _buscaIndiceAtivo = idx;
}
document.addEventListener('keydown', e => {
    if (e.target?.id !== 'buscaGlobalInput') return;
    const itens = _buscaItens();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!itens.length) return;
        e.preventDefault();
        const passo = e.key === 'ArrowDown' ? 1 : -1;
        const prox = _buscaIndiceAtivo < 0
            ? (passo > 0 ? 0 : itens.length - 1)
            : (_buscaIndiceAtivo + passo + itens.length) % itens.length;
        _buscaDestacar(prox);
    } else if (e.key === 'Enter') {
        const alvo = itens[_buscaIndiceAtivo] || (itens.length === 1 ? itens[0] : null);
        if (alvo) { e.preventDefault(); alvo.click(); }
    }
});

/*─────────────────────────────────────────────────
  MODAL DE ATALHOS DE TECLADO
─────────────────────────────────────────────────*/
const _ATALHOS = [
    {
        grupo: "Navegação",
        itens: [
            { teclas: ["Ctrl", "K"],   descricao: "Busca global" },
            { teclas: ["Escape"],      descricao: "Fechar modal aberto" },
        ]
    },
    {
        grupo: "Lançamentos",
        itens: [
            { teclas: ["Ctrl", "Enter"], descricao: "Salvar e lançar a próxima nota" },
            { teclas: ["Ctrl", "S"],     descricao: "Salvar (mesma ação do botão principal)" },
            { teclas: ["↓", "↑"],        descricao: "Percorrer sugestões de motorista, placa e base" },
            { teclas: ["Enter"],         descricao: "Escolher a sugestão destacada" },
            { teclas: ["Escape"],        descricao: "Fechar a lista de sugestões" },
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
                    <span style="color:${cor}">${icone}</span>${escapeHtml(titulo)}
                </h3>
                ${msg ? `<p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.55;margin-bottom:20px;white-space:pre-wrap">${escapeHtml(msg)}</p>` : ''}
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

/**
 * fmPrompt(opcoes) → Promise<string|null>
 *
 * O terceiro modal da família, ao lado de `fmConfirm` e `fmAlert`: pede
 * um texto obrigatório antes de deixar seguir. Nasceu para o motivo do
 * cancelamento na origem, que é uma afirmação sobre um fato de fora do
 * sistema e não pode ser feita sem autor e sem razão.
 *
 * Devolve o texto, ou `null` se o operador desistiu — e desistir é sempre
 * possível, pelo botão, pelo Escape ou pelo clique fora. Isso não é
 * detalhe: um diálogo em que as duas saídas fazem alguma coisa é um
 * diálogo do qual não se sai.
 *
 * Opções: `titulo`, `msg`, `label`, `minimo` (caracteres, padrão 1),
 * `placeholder`, `confirmTxt`, `cancelTxt`, `tipo` ('perigo'|'aviso'|'info').
 */
function fmPrompt({ titulo = 'Confirmar', msg = '', label = '', minimo = 1,
                    placeholder = '', confirmTxt = 'Confirmar',
                    cancelTxt = 'Cancelar', tipo = 'perigo' } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'z-index:2000';

        const corMap = { perigo: 'var(--danger)', aviso: 'var(--warning)', info: 'var(--primary)' };
        const cor = corMap[tipo] || corMap.perigo;

        overlay.innerHTML = `
            <div class="modal" style="max-width:460px">
                <h3 style="margin-bottom:${msg ? '12px' : '20px'}">${escapeHtml(titulo)}</h3>
                ${msg ? `<p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.55;margin-bottom:16px;white-space:pre-wrap">${escapeHtml(msg)}</p>` : ''}
                <label class="fm-prompt-label" style="display:block;font-size:0.85rem;margin-bottom:6px">${escapeHtml(label)}</label>
                <textarea class="fm-prompt-input" rows="2" placeholder="${escapeHtml(placeholder)}"
                          style="width:100%;box-sizing:border-box;resize:vertical"></textarea>
                <div class="fm-prompt-erro" style="display:none;color:var(--danger);font-size:0.8rem;margin-top:6px"></div>
                <div class="modal-acoes" style="margin-top:16px">
                    <button class="btn-secundario fm-cancel">${escapeHtml(cancelTxt)}</button>
                    <button class="btn-primario fm-ok" style="background:${cor};border-color:${cor}">${escapeHtml(confirmTxt)}</button>
                </div>
            </div>`;

        const campo = overlay.querySelector('.fm-prompt-input');
        const erro  = overlay.querySelector('.fm-prompt-erro');
        const fechar = r => { overlay.remove(); resolve(r); };

        const confirmar = () => {
            const txt = campo.value.trim();
            if (txt.length < minimo) {
                // Mensagem junto do campo, não toast: desde o tema 04, o
                // que impede de seguir tem de ficar onde se conserta.
                erro.textContent = minimo > 1
                    ? `Escreva pelo menos ${minimo} caracteres — faltam ${minimo - txt.length}.`
                    : 'Este campo não pode ficar vazio.';
                erro.style.display = 'block';
                campo.focus();
                return;
            }
            fechar(txt);
        };

        campo.addEventListener('input', () => { erro.style.display = 'none'; });
        overlay.querySelector('.fm-ok').onclick     = confirmar;
        overlay.querySelector('.fm-cancel').onclick = () => fechar(null);
        overlay.addEventListener('click', e => { if (e.target === overlay) fechar(null); });
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); fechar(null); }
            // Enter confirma; Shift+Enter continua quebrando linha, porque
            // o motivo é texto livre e pode ter mais de uma frase.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmar(); }
        });

        document.body.appendChild(overlay);
        setTimeout(() => campo.focus(), 40);
    });
}

document.addEventListener("DOMContentLoaded", function() {
    marcarNavAtivo("dashboard");
    atualizarTituloHeader("dashboard");

    ["motoristas","veiculos","empresas","combustiveis"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });

    // Único registro do Ctrl+K no projeto — havia um segundo, inline no fim do
    // index.html, junto de um Escape que o app.js já tratava.
    // `toLowerCase` porque `e.key` vem 'K' com Caps Lock ou Shift.
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 'k') {
            e.preventDefault();
            abrirBuscaGlobal();
        }
    });

    sincronizarBaseEntrada();
});

/* ── A AÇÃO RESPONDE ONDE ACONTECEU (programa 3.5, 3.6 e 3.7 — 18/09/2026) ──
   O toast fala no canto e some em 3 segundos. Três coisas passam a ficar no
   lugar da ação:
   - confirmação: o botão que o operador clicou pisca em verde com um ✓;
   - erro: fica escrito no alto da tela (ou do modal) onde falhou, com a
     hora, até ser fechado ou até a próxima ação dar certo ali;
   - recálculo: ao mudar um filtro, os números da tela esmaecem e aparece
     "Recalculando…" — só se a conta passar de um décimo de segundo. */

let _acaoBotao = null;
let _acaoBotaoEm = 0;
document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button');
    if (b) { _acaoBotao = b; _acaoBotaoEm = performance.now(); }
}, true);
// Tecla fora de botão (Ctrl+Enter, digitar a próxima nota) encerra a ação do
// clique: o ✓ não pode cair num botão que não foi o que salvou.
document.addEventListener('keydown', e => {
    const b = e.target.closest && e.target.closest('button');
    if (b && (e.key === 'Enter' || e.key === ' ')) { _acaoBotao = b; _acaoBotaoEm = performance.now(); }
    else if (!['Shift', 'Tab'].includes(e.key)) _acaoBotao = null;
}, true);

/** O botão da última ação, se ainda estiver na tela e tiver sido clicado há pouco. */
function _botaoDaAcao() {
    const b = _acaoBotao;
    if (!b || !b.isConnected || !b.offsetParent) return null;
    return performance.now() - _acaoBotaoEm < 8000 ? b : null;
}

/** Pisca um elemento em verde, com ✓ — botão, linha de tabela, item de lista. */
function confirmarNoLocal(el) {
    if (!el || !el.isConnected) return;
    // Deu certo aqui: o erro que estava escrito neste lugar deixou de valer.
    limparErrosNoLocal();
    el.classList.remove('confirmado-local');
    void el.offsetWidth;   // reinicia a animação se o mesmo botão for clicado de novo
    el.classList.add('confirmado-local');
    clearTimeout(el._confirmadoTimer);
    el._confirmadoTimer = setTimeout(() => el.classList.remove('confirmado-local'), 1800);
}

/** O modal aberto por cima de tudo, se houver. */
function _modalAberto() {
    const modais = [...document.querySelectorAll('.modal-overlay')]
        .filter(m => m.style.display !== 'none' && getComputedStyle(m).display !== 'none');
    const overlay = modais[modais.length - 1];
    if (!overlay) return null;
    // Erro de modal não sobrevive ao modal: ao fechar, sai junto, para
    // não reaparecer velho na próxima abertura.
    if (!overlay._vigiaErro) {
        overlay._vigiaErro = new MutationObserver(() => {
            if (getComputedStyle(overlay).display === 'none') {
                overlay.querySelectorAll('.erros-locais').forEach(c => c.remove());
            }
        });
        overlay._vigiaErro.observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    return overlay.querySelector('.modal') || overlay.firstElementChild || overlay;
}

/**
 * Onde a ação aconteceu. No modal: no alto dele. Na tela: logo abaixo da
 * linha do botão clicado — o erro aparece onde o olho está, não no alto de
 * uma página rolada. Sem botão (atalho de teclado): no alto da tela.
 */
function _lugarDaAcao() {
    const modal = _modalAberto();
    if (modal) return { pai: modal };
    const tela = document.querySelector(".tela[style*='block']");
    const b = _botaoDaAcao();
    if (b && tela && tela.contains(b)) {
        // Numa tabela o erro não cabe entre as linhas: vai para baixo dela.
        const ancora = b.closest('.tabela-container') || b.closest('li') || b.parentElement;
        return { ancora };
    }
    return tela ? { pai: tela } : null;
}

function _caixaDeErros(lugar, criar) {
    const nova = () => {
        const c = document.createElement('div');
        c.className = 'erros-locais';
        c.setAttribute('role', 'alert');
        return c;
    };
    if (lugar.ancora) {
        const prox = lugar.ancora.nextElementSibling;
        if (prox && prox.classList.contains('erros-locais')) return prox;
        if (!criar) return null;
        const c = nova();
        lugar.ancora.after(c);
        return c;
    }
    const existente = lugar.pai.querySelector(':scope > .erros-locais');
    if (existente || !criar) return existente;
    const c = nova();
    lugar.pai.prepend(c);
    return c;
}

/** Fixa um erro no lugar onde a ação falhou. */
function fixarErroNoLocal(msg) {
    const lugar = _lugarDaAcao();
    if (!lugar) return;
    const caixa = _caixaDeErros(lugar, true);
    // A mesma mensagem não empilha: sobe para o topo com a hora nova.
    [...caixa.children].forEach(c => { if (c.dataset.msg === msg) c.remove(); });
    while (caixa.children.length >= 3) caixa.lastElementChild.remove();

    const item = document.createElement('div');
    item.className = 'erro-local';
    item.dataset.msg = msg;
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    item.innerHTML = `<span class="erro-local-icone" aria-hidden="true">✕</span>`
        + `<span class="erro-local-msg">${escapeHtml(msg)}</span>`
        + `<span class="erro-local-hora">${hora}</span>`
        + `<button type="button" class="erro-local-fechar" title="Fechar" aria-label="Fechar este erro">×</button>`;
    item.querySelector('button').onclick = () => {
        item.remove();
        if (!caixa.children.length) caixa.remove();
    };
    caixa.prepend(item);
    caixa.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** A ação deu certo: o erro que estava escrito naquele lugar deixa de valer. */
function limparErrosNoLocal() {
    const lugar = _lugarDaAcao();
    const caixa = lugar && _caixaDeErros(lugar, false);
    if (caixa) caixa.remove();
}

/**
 * Recalcula uma tela deixando o sinal à vista. A conta continua a mesma e
 * síncrona; a diferença é esperar um quadro para o navegador pintar o
 * esmaecido antes. Pedidos seguidos (duas datas trocadas de uma vez) viram
 * uma conta só, que lê os filtros no momento em que roda.
 */
function recalcularTela(telaId, fn) {
    const tela = document.getElementById(telaId);
    if (!tela) return fn();
    if (tela._recalculoPendente) return;
    tela._recalculoPendente = true;
    tela.classList.add('recalculando');
    tela.setAttribute('aria-busy', 'true');
    let feito = false;
    const rodar = () => {
        if (feito) return;
        feito = true;
        try { fn(); }
        finally {
            tela._recalculoPendente = false;
            tela.classList.remove('recalculando');
            tela.removeAttribute('aria-busy');
        }
    };
    requestAnimationFrame(() => setTimeout(rodar, 0));
    // Com a aba escondida o navegador não entrega quadro nenhum; a conta não
    // pode ficar esperando por isso.
    setTimeout(rodar, 50);
}
