/*=================================================
  APP.JS — Fuel Mind
  Login com Firebase Auth + empresa obrigatória
  Empresa sempre filtrada — sem opção "Todas"
=================================================*/

/* ─── ESTADO DO USUÁRIO LOGADO ─── */
window._usuarioAtual = null; // { uid, nome, email, role, empresas[] }
let empresaFiltroGlobal = null;
let empresaFiltroNome   = "";

/* ─── INICIALIZAÇÃO DO AUTH ─── */
let _authJaProcessado = false;

window.addEventListener("firebaseReady", () => {
    window._firestore.authEscutar(async (user) => {
        if (user) {
            if (_authJaProcessado && window._usuarioAtual?.uid === user.uid) return;
            _authJaProcessado = true;

            const perfil = await window._firestore.usuarioBuscar(user.uid);
            if (!perfil || perfil.ativo === false) {
                _authJaProcessado = false;
                await window._firestore.authLogout();
                _mostrarTelaLogin("Acesso negado. Usuário inativo ou sem permissão.");
                return;
            }
            window._usuarioAtual = perfil;

            try {
                window._firestore.usuarioSalvar(user.uid, {
                    ultimoAcesso: new Date().toISOString()
                });
            } catch(_) {}

            _mostrarSelecaoEmpresa(perfil);
        } else {
            _authJaProcessado = false;
            window._usuarioAtual = null;
            _mostrarTelaLogin();
        }
    });
});

/* ─── TELA DE LOGIN ─── */
function _mostrarTelaLogin(erroMsg) {
    document.getElementById("appContainer").style.display = "none";
    const overlay = document.getElementById("loginOverlay");
    overlay.style.display = "flex";
    const emailInput = document.getElementById("loginEmail");
    const senhaInput = document.getElementById("loginSenha");
    // Preenche com o último identificador usado (username ou email)
    const ultimoId = localStorage.getItem("ultimoIdentificador") || localStorage.getItem("ultimoEmail");
    if (emailInput) emailInput.value = ultimoId || "";
    if (senhaInput) senhaInput.value = "";
    const erroEl = document.getElementById("loginErro");
    if (erroEl) {
        erroEl.textContent = erroMsg || "";
        erroEl.style.display = erroMsg ? "block" : "none";
    }
    setTimeout(() => {
        if (emailInput?.value) document.getElementById("loginSenha")?.focus();
        else emailInput?.focus();
    }, 100);
}

async function fazerLogin() {
    const identificador = document.getElementById("loginEmail")?.value.trim();
    const senha  = document.getElementById("loginSenha")?.value;
    const erroEl = document.getElementById("loginErro");

    if (!identificador || !senha) {
        erroEl.textContent = "Preencha o e-mail (ou usuário) e a senha.";
        erroEl.style.display = "block";
        return;
    }

    const btn = document.getElementById("btnLogin");
    if (btn) mostrarSpinner(btn, "Entrar");
    erroEl.style.display = "none";

    try {
        let emailParaLogin = identificador;

        // Detecta se é username: não contém "@" OU começa com "@"
        // Ex: "fulano", "@fulano" → username | "fulano@email.com" → email
        const ehUsername = !identificador.includes("@") || identificador.startsWith("@");
        if (ehUsername) {
            const usernameNormalizado = identificador.replace(/^@/, "").toLowerCase().trim();
            if (!usernameNormalizado) {
                if (btn) esconderSpinner(btn);
                erroEl.textContent = "Informe um usuário ou e-mail válido.";
                erroEl.style.display = "block";
                return;
            }
            const perfil = await window._firestore.usuarioBuscarPorUsername(usernameNormalizado);
            if (!perfil?.email) {
                if (btn) esconderSpinner(btn);
                erroEl.textContent = "Usuário '@" + usernameNormalizado + "' não encontrado.";
                erroEl.style.display = "block";
                return;
            }
            emailParaLogin = perfil.email;
        }

        await window._firestore.authLogin(emailParaLogin, senha);
        // Salva o identificador exatamente como digitado para repreencher na próxima vez
        localStorage.setItem("ultimoIdentificador", identificador);
        // Se logou por username, não salva o email como "ultimoEmail" para não confundir autocomplete
        if (!ehUsername) {
            localStorage.setItem("ultimoEmail", emailParaLogin);
        }
    } catch (e) {
        if (btn) esconderSpinner(btn);
        const msgs = {
            "auth/user-not-found":     "Usuário não encontrado.",
            "auth/wrong-password":     "Senha incorreta.",
            "auth/invalid-email":      "E-mail inválido.",
            "auth/too-many-requests":  "Muitas tentativas. Aguarde e tente novamente.",
            "auth/invalid-credential": "E-mail/usuário ou senha incorretos.",
        };
        erroEl.textContent = msgs[e.code] || "Erro ao entrar: " + e.message;
        erroEl.style.display = "block";
    }
}


document.addEventListener("keydown", e => {
    if (e.key === "Enter") {
        const loginOverlay = document.getElementById("loginOverlay");
        if (loginOverlay?.style.display === "flex") fazerLogin();
        const selOverlay = document.getElementById("selecaoEmpresaOverlay");
        if (selOverlay?.style.display === "flex") confirmarSelecaoEmpresa();
    }
});

/* ─── SELEÇÃO DE EMPRESA PÓS-LOGIN ─── */
function _mostrarSelecaoEmpresa(perfil) {
    document.getElementById("loginOverlay").style.display = "none";
    document.getElementById("appContainer").style.display = "none";

    let empresasDisponiveis;
    if (perfil.role === "supremo") {
        empresasDisponiveis = db.empresas?.filter(e => e.ativo !== false).map(e => e.nome) || [];
        if (empresasDisponiveis.length === 0) {
            _carregarDBParaLogin(perfil);
            return;
        }
    } else {
        empresasDisponiveis = (perfil.empresas || []).filter(nome =>
            db.empresas?.some(e => e.nome === nome && e.ativo !== false)
        );
    }

    if (empresasDisponiveis.length === 0) {
        if (perfil.role === "supremo") {
            _entrarNoSistema(perfil, "");
            return;
        }
        _mostrarTelaLogin("Você não tem acesso a nenhuma empresa ativa. Contate o administrador.");
        window._firestore.authLogout();
        return;
    }

    if (empresasDisponiveis.length === 1) {
        _entrarNoSistema(perfil, empresasDisponiveis[0]);
        return;
    }

    const overlay = document.getElementById("selecaoEmpresaOverlay");
    const lista   = document.getElementById("selecaoEmpresaLista");
    const nomeEl  = document.getElementById("selecaoEmpresaNome");
    if (nomeEl) nomeEl.textContent = (perfil.nome || '').split(" ")[0];

    lista.innerHTML = empresasDisponiveis.map(emp => `
        <button class="btn-empresa-troca" onclick="confirmarSelecaoEmpresa('${escapeJsAttr(emp)}')">
            <span>${escapeHtml(emp)}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;opacity:0.5"><polyline points="9,18 15,12 9,6"/></svg>
        </button>`).join("");

    overlay.style.display = "flex";
}

async function _carregarDBParaLogin(perfil) {
    if (window._firestore) {
        const dados = await window._firestore.firestoreCarregar();
        if (dados) db = _mesclarComPadrao(dados);
    }
    _mostrarSelecaoEmpresa(perfil);
}

function confirmarSelecaoEmpresa(empresa) {
    if (!empresa) {
        const btns = document.querySelectorAll("#selecaoEmpresaLista .btn-empresa-troca");
        if (btns.length === 1) empresa = btns[0].querySelector("span").textContent;
        else return;
    }
    document.getElementById("selecaoEmpresaOverlay").style.display = "none";
    _entrarNoSistema(window._usuarioAtual, empresa);
}

function _entrarNoSistema(perfil, empresa) {
    document.getElementById("appContainer").style.display = "block";
    _aplicarEmpresaAtiva(empresa);
    carregarDB();
}

/* ─── LOGOUT ─── */
async function fazerLogout() {
    if (!await fmConfirm({ titulo: "Sair do sistema?", msg: "Sua sessão será encerrada.", confirmTxt: "Sair", cancelTxt: "Cancelar", tipo: "aviso" })) return;
    empresaFiltroGlobal = null;
    empresaFiltroNome   = "";
    window._usuarioAtual = null;
    await window._firestore.authLogout();
}


/* ─── EMPRESA ATIVA ─── */
function _aplicarEmpresaAtiva(nome) {
    empresaFiltroGlobal = nome || null;
    empresaFiltroNome   = nome || "";

    const label = document.getElementById("empresaAtivaLabel");
    if (label) label.textContent = nome || "—";

    const nomeUsuario = document.getElementById("headerNomeUsuario");
    if (nomeUsuario && window._usuarioAtual) {
        nomeUsuario.textContent = (window._usuarioAtual.nome || '').split(" ")[0];
    }

    const telaAtualId = document.querySelector(".tela[style*='block']")?.id || "dashboard";
    if (typeof atualizarTituloHeader === "function") atualizarTituloHeader(telaAtualId);

    const ei = document.getElementById("empresaInput");
    if (ei) { ei.value = nome || ""; ei.disabled = !!nome; }
    const es = document.getElementById("empresaSelect");
    if (es && nome) es.value = nome;
}

/**
 * Define a empresa ativa na sessão e rerenderiza a tela atual.
 *
 * Persiste a escolha em `localStorage` para restaurar na próxima sessão.
 * Atualiza `empresaFiltroGlobal` e `empresaFiltroNome` via `_aplicarEmpresaAtiva`.
 *
 * @param {string} nome - Nome da empresa (deve existir em `db.empresas`)
 */
function setEmpresaFiltro(nome) {
    _aplicarEmpresaAtiva(nome);
    localStorage.setItem("ultimaEmpresa", nome);
    const telaAtualId = document.querySelector(".tela[style*='block']")?.id;
    if (telaAtualId) {
        switch (telaAtualId) {
            case "dashboard":   carregarDashboard(); break;
            case "relatorios":  carregarRelatorio(); break;
            case "analitico":   if (typeof carregarAnalitico === 'function') carregarAnalitico(); break;
            case "fretes":      carregarFretes();    break;
            case "historico":   carregarHistorico(); break;
        }
    }
}

/* ─── TROCA DE EMPRESA (header) ─── */
function abrirTrocarEmpresa() {
    const perfil = window._usuarioAtual;
    if (!perfil) return;

    let empresasDisponiveis;
    if (perfil.role === "supremo") {
        empresasDisponiveis = db.empresas.filter(e => e.ativo !== false).map(e => e.nome);
    } else {
        empresasDisponiveis = (perfil.empresas || []).filter(nome =>
            db.empresas.some(e => e.nome === nome && e.ativo !== false)
        );
    }

    if (empresasDisponiveis.length <= 1) {
        mostrarToast("Você só tem acesso a uma empresa.", "info");
        return;
    }

    const modal = document.getElementById("trocarEmpresaModal");
    const lista = document.getElementById("trocarEmpresaLista");
    if (!modal || !lista) return;

    lista.innerHTML = empresasDisponiveis.map(emp => `
        <button class="btn-empresa-troca ${emp === empresaFiltroNome ? 'ativa' : ''}"
                onclick="selecionarEmpresaModal('${escapeJsAttr(emp)}')">
            <span>${escapeHtml(emp)}</span>
            ${emp === empresaFiltroNome
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><polyline points="20,6 9,17 4,12"/></svg>'
                : ''}
        </button>`).join("");
    modal.style.display = "flex";
}

function selecionarEmpresaModal(nome) {
    fecharTrocarEmpresa();
    setEmpresaFiltro(nome);
}

function fecharTrocarEmpresa() {
    const modal = document.getElementById("trocarEmpresaModal");
    if (modal) modal.style.display = "none";
}

document.addEventListener("click", e => {
    const modal = document.getElementById("trocarEmpresaModal");
    if (modal && e.target === modal) fecharTrocarEmpresa();
});

function atualizarFiltroEmpresaGlobal() {
    const label = document.getElementById("empresaAtivaLabel");
    if (label && empresaFiltroNome) label.textContent = empresaFiltroNome;
}

function atualizarTitulosInternos() {
    document.querySelectorAll(".tela h2[id^='titulo']").forEach(h2 => {
        h2.style.display = "none";
    });
}

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (document.getElementById('lancamentos').style.display === 'block') {
            document.getElementById('btnSalvarLancamento')?.click();
        }
    }
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        if (document.getElementById('relatorios').style.display === 'block') {
            document.getElementById('filtroBusca')?.focus();
        } else if (document.getElementById('historico').style.display === 'block') {
            document.getElementById('historicoBusca')?.focus();
        }
    }
    if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        limparFormulario();
        mostrarTela('lancamentos');
    }
    if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        toggleModoEscuro();
    }
    if (e.key === 'Escape') {
        const modal = document.getElementById('modalOverlay');
        if (modal && modal.style.display === 'flex') fecharModal();
        const buscaModal = document.getElementById('buscaGlobalModal');
        if (buscaModal && buscaModal.style.display === 'flex') fecharBuscaGlobal();
    }
});

// ========== TEMA AUTOMÁTICO ==========
function aplicarTemaInicial() {
    const temaSalvo = localStorage.getItem("tema");
    if (temaSalvo) {
        document.documentElement.setAttribute("data-theme", temaSalvo);
    } else {
        const prefereEscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const tema = prefereEscuro ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", tema);
        localStorage.setItem("tema", tema);
    }
    const icone = document.getElementById("iconeTema");
    if (icone) icone.innerHTML = document.documentElement.getAttribute("data-theme") === "dark"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}
aplicarTemaInicial();

// ========== BANCO DE DADOS ==========
const DB_PADRAO = {
    motoristas:    [],
    veiculos:      [],
    empresas:      [],
    combustiveis:  [],
    lancamentos:   [],
    bases:         [],
    configRelatorio: {
        titulo: "Controle de Entradas de Combustível",
        mostrarBase: true,
        mostrarEmpresa: true,
        mostrarMotorista: true,
        mostrarPlaca: true,
        orientacao: "landscape"
    }
};

let db = JSON.parse(JSON.stringify(DB_PADRAO));

// _salvandoDB é um contador: >0 significa que há um save em andamento.
let _salvandoDB = 0;
// Um unsubscribe por documento escutado: "compartilhado" e cada "lanc__{id}".
let _unsubs = {};
let _pendentesSincronizacao = false;

// Hash do último payload que NÓS gravamos, por documento. O Firestore
// devolve o snapshot logo após o setDoc; sem isso esse eco recarregaria a
// memória e dispararia render em cadeia. Com N documentos, o token precisa
// ser por documento — um eco de um doc não pode consumir o token de outro.
let _hashPorDoc = {};

// Timer do debounce — agrupa writes múltiplos em um único setDoc.
let _timerDebounce = null;
const _DEBOUNCE_MS = 600;

// Nome do documento de cadastros compartilhados.
const _NOME_COMPARTILHADO = "compartilhado";
const _NOME_LEGADO        = "principal";

// true quando os dados já estão repartidos por empresa; false enquanto o
// banco ainda estiver no documento único `dados/principal`. Definido na
// carga e consultado pelos listeners — inferir isso pela presença de uma
// chave em _hashPorDoc funcionava, mas era frágil demais para o que decide.
let _layoutNovo = false;

// ========== GERADOR DE ID ÚNICO ==========
/**
 * Gera um ID único no formato `"timestamp-hash"` (ex: `"1748392847362-abc1234"`).
 *
 * IDs são sempre strings — nunca usar `+id` ou `parseInt(id)`.
 * Em atributos `onclick` de templates HTML, sempre envolver em aspas simples:
 * `onclick="editarLancamento('${l.id}')"`.
 *
 * @returns {string} ID único baseado em timestamp + sufixo aleatório base36
 */
function gerarId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Hash leve para detectar se o Firestore nos devolveu o que acabamos de salvar.
function _hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h;
}

/**
 * Persiste o estado atual de `db` no localStorage (backup imediato) e
 * agenda um save debounced para o Firestore.
 *
 * O debounce de 600ms agrupa chamadas em rápida sucessão — por exemplo,
 * edições consecutivas em cadastros — em um único `setDoc`, evitando
 * writes excessivos no Firestore.
 *
 * Se o Firebase não estiver disponível, marca `_pendentesSincronizacao`
 * para tentar novamente quando a conexão for restabelecida.
 */
/* ═══════════════════════════════════════════════════════════════════════
   REPARTIÇÃO POR EMPRESA

   Os lançamentos vivem em um documento por empresa (`dados/lanc__{id}`) e
   os cadastros num documento comum (`dados/compartilhado`). Em memória o
   `db` continua com a mesma forma de sempre — `db.lancamentos` é um array
   único — só que contendo apenas as empresas que o usuário pode ver.

   É isso que mantém dashboard, analítico, relatórios e fretes intocados:
   eles seguem iterando `db.lancamentos` sem saber da repartição.
   ═══════════════════════════════════════════════════════════════════════ */

/** Ids das empresas cujos lançamentos o usuário logado pode carregar. */
function _empresaIdsPermitidos() {
    const perfil = window._usuarioAtual;
    const todas  = (db.empresas || []).map(e => e.id);
    if (!perfil || perfil.role === "supremo") return todas;
    const liberadas = perfil.empresaIds || [];
    return todas.filter(id => liberadas.includes(id));
}

/**
 * Id da empresa de um lançamento. O lançamento guarda o NOME da empresa;
 * o documento é nomeado pelo id. Esta é a única ponte entre os dois.
 */
function _empresaIdDoLancamento(l) {
    return (db.empresas || []).find(e => e.nome === l.empresa)?.id || null;
}

/** Nome do documento de lançamentos de uma empresa. */
function _nomeDocLanc(empresaId) {
    return window._firestore ? window._firestore.docLancamentosNome(empresaId)
                             : "lanc__" + empresaId;
}

/**
 * Reparte o `db` em um payload por documento.
 *
 * Só entram documentos das empresas permitidas: um usuário que carregou
 * duas empresas não pode, ao salvar, apagar o documento de uma terceira
 * que ele nunca leu.
 */
function _montarPayloads() {
    const payloads = {};

    payloads[_NOME_COMPARTILHADO] = {
        motoristas:        db.motoristas,
        veiculos:          db.veiculos,
        empresas:          db.empresas,
        combustiveis:      db.combustiveis,
        bases:             db.bases,
        conjuntosVeiculos: db.conjuntosVeiculos || [],
        configRelatorio:   db.configRelatorio
    };

    const permitidos = _empresaIdsPermitidos();
    permitidos.forEach(id => { payloads[_nomeDocLanc(id)] = { lancamentos: [] }; });

    db.lancamentos.forEach(l => {
        const id = _empresaIdDoLancamento(l);
        if (!id || !permitidos.includes(id)) return;
        payloads[_nomeDocLanc(id)].lancamentos.push(l);
    });

    return payloads;
}

/** Absorve o retorno de um documento de lançamentos na memória. */
function _absorverLancamentos(empresaId, lista) {
    const nomeEmpresa = (db.empresas || []).find(e => e.id === empresaId)?.nome;
    if (!nomeEmpresa) return;
    db.lancamentos = db.lancamentos.filter(l => l.empresa !== nomeEmpresa)
                                   .concat(lista || []);
}

function salvarDB() {
    try { localStorage.setItem("db_backup", JSON.stringify(db)); } catch(_) {}

    if (!window._firestore) {
        _setStatusConexao("offline");
        _pendentesSincronizacao = true;
        return;
    }

    // Debounce: chamadas rápidas em sequência resultam em um único setDoc.
    clearTimeout(_timerDebounce);
    _setStatusConexao("salvando");
    _timerDebounce = setTimeout(() => _executarSave(), _DEBOUNCE_MS);
}

/**
 * Executa o save efetivo para o Firestore após o debounce de `salvarDB`.
 *
 * Incrementa `_salvandoDB` durante a operação — o listener de tempo real
 * verifica esse contador e ignora snapshots enquanto ele for > 0, evitando
 * que o Firestore devolva o echo do próprio save e sobrescreva o `db`.
 *
 * Em caso de falha, agenda retry automático em 30s via `_pendentesSincronizacao`.
 * Não cancela nem recria o listener — ele continua ativo durante o save.
 */
/**
 * Grava no Firestore apenas os documentos que mudaram.
 *
 * Antes era um `setDoc` do `db` inteiro. Agora o `db` é repartido e cada
 * documento só é enviado se seu conteúdo diferir do último que gravamos —
 * editar um lançamento da Empresa A não reescreve o documento da B.
 *
 * Em caso de falha, agenda retry automático em 30s via `_pendentesSincronizacao`.
 */
function _executarSave() {
    _salvandoDB++;

    const payloads = _layoutNovo
        ? _montarPayloads()
        : { [_NOME_LEGADO]: JSON.parse(JSON.stringify(db)) };
    const mudaram  = Object.keys(payloads).filter(nome =>
        _hashStr(JSON.stringify(payloads[nome])) !== _hashPorDoc[nome]);

    if (mudaram.length === 0) {
        _salvandoDB = Math.max(0, _salvandoDB - 1);
        _pendentesSincronizacao = false;
        _setStatusConexao("sincronizado");
        return;
    }

    // O hash é marcado ANTES da gravação: o eco do snapshot pode chegar
    // antes da promise resolver, e sem o token ele recarregaria a memória.
    // Se a gravação falhar, o token é descartado para o retry reenviar.
    const gravacoes = mudaram.map(nome => {
        const payload = JSON.parse(JSON.stringify(payloads[nome]));
        _hashPorDoc[nome] = _hashStr(JSON.stringify(payload));
        return window._firestore.firestoreSalvarDoc(nome, payload)
            .catch(err => { delete _hashPorDoc[nome]; throw err; });
    });

    Promise.all(gravacoes)
        .then(() => {
            _salvandoDB = Math.max(0, _salvandoDB - 1);
            _pendentesSincronizacao = false;
            _setStatusConexao("sincronizado");
            setTimeout(() => {
                const el = document.getElementById("_statusConexao");
                if (el) el.style.display = "none";
            }, 3000);
        })
        .catch(() => {
            _salvandoDB = Math.max(0, _salvandoDB - 1);
            _pendentesSincronizacao = true;
            _setStatusConexao("erro");
            setTimeout(() => { if (_pendentesSincronizacao) salvarDB(); }, 30000);
            mostrarToast("Erro ao salvar na nuvem. Tentando novamente em 30s…", "erro", 6000);
        });
}

function sincronizarAgora() {
    if (!window._firestore) {
        mostrarToast("Sem conexão com a nuvem.", "aviso", 3000);
        return;
    }
    if (_pendentesSincronizacao) {
        mostrarToast("Sincronizando…", "info", 2000);
        salvarDB();
    } else {
        mostrarToast("Dados já estão sincronizados.", "sucesso", 2000);
    }
}

/**
 * Carrega o banco de dados do Firestore (ou localStorage como fallback)
 * e inicia o listener de tempo real.
 *
 * Fluxo:
 * 1. Tenta carregar do Firestore via `getDoc`
 * 2. Se o documento não existir e houver backup local, migra os dados locais para o Firestore
 * 3. Liga o listener `onSnapshot` para sincronização contínua
 * 4. Em caso de falha total, usa o backup do localStorage
 *
 * @returns {Promise<void>}
 */
/**
 * Carrega o banco do Firestore e liga os listeners de tempo real.
 *
 * Ordem obrigatória: o documento compartilhado vem primeiro porque é ele
 * que traz `db.empresas` — sem a lista de empresas não há como resolver
 * quais documentos de lançamento o usuário pode ler.
 *
 * Se `dados/compartilhado` não existir, o banco ainda está no layout
 * antigo (documento único `dados/principal`); nesse caso ele é carregado
 * como sempre foi, e a tela de Sistema oferece a migração.
 */
async function carregarDB() {
    _mostrarLoading(true);
    try {
        if (!window._firestore) {
            const local = localStorage.getItem("db_backup") || localStorage.getItem("db");
            if (local) db = _mesclarComPadrao(JSON.parse(local));
            _pendentesSincronizacao = true;
            return;
        }

        const compartilhado = await window._firestore.firestoreCarregarDoc(_NOME_COMPARTILHADO);

        if (compartilhado) {
            _layoutNovo = true;
            db = _mesclarComPadrao(Object.assign({}, compartilhado, { lancamentos: [] }));

            const ids = _empresaIdsPermitidos();
            const docs = await Promise.all(ids.map(id =>
                window._firestore.firestoreCarregarDoc(_nomeDocLanc(id)).catch(() => null)));

            db.lancamentos = docs.flatMap(d => (d && d.lancamentos) || []);
            _pendentesSincronizacao = false;
        } else {
            // ── Layout antigo, ainda não migrado ──
            _layoutNovo = false;
            const dados = await window._firestore.firestoreCarregar();
            if (dados) {
                db = _mesclarComPadrao(dados);
                _pendentesSincronizacao = false;
            } else {
                const local = localStorage.getItem("db_backup") || localStorage.getItem("db");
                if (local) db = _mesclarComPadrao(JSON.parse(local));
                _pendentesSincronizacao = false;
            }
        }

        try { localStorage.setItem("db_backup", JSON.stringify(db)); } catch(_) {}
        _ligarListenerTempoReal();

    } catch(e) {
        console.error("[carregarDB]", e);
        const local = localStorage.getItem("db_backup") || localStorage.getItem("db");
        if (local) { try { db = _mesclarComPadrao(JSON.parse(local)); } catch(_) {} }
        _pendentesSincronizacao = true;
        mostrarToast("Usando dados locais (sem conexão com a nuvem).", "aviso", 5000);
    } finally {
        _mostrarLoading(false);
        _criarIndicadorConexao();
        _setStatusConexao(window._firestore ? (_pendentesSincronizacao ? "pendente" : "sincronizado") : "offline");
        migrarDados();
        atualizarListas();
        if (empresaFiltroGlobal) _aplicarEmpresaAtiva(empresaFiltroGlobal);
        verificarBackupAutomatico();
        setTimeout(() => {
            mostrarTela("dashboard");
            carregarDashboard();
        }, 0);
    }
}

// Flag que previne criação de múltiplos listeners simultâneos.
// _ligarListenerTempoReal pode ser chamada de vários pontos; sem essa
// proteção, chamadas em rápida sucessão enquanto `_unsubs` ainda está
// vazio gerariam listeners orphans que nunca seriam cancelados,
// acumulando onSnapshot ativos e causando loop de writes + vazamento de RAM.
let _listenerCriando = false;

/**
 * Registra os listeners `onSnapshot` de sincronização em tempo real: um no
 * documento compartilhado e um em cada documento de lançamentos permitido.
 * No layout antigo, um único listener em `dados/principal`.
 *
 * Cancela todos os listeners anteriores antes de criar novos (garante que
 * nunca existam dois `onSnapshot` simultâneos no mesmo documento).
 *
 * A flag `_listenerCriando` previne reentrada — se duas chamadas chegarem
 * antes dos listeners serem registrados, apenas a primeira os cria.
 *
 * O handler ignora atualizações enquanto `_salvandoDB > 0` (proteção
 * anti-regressão durante saves) e descarta o echo do próprio save
 * comparando o hash por documento (`_hashPorDoc`).
 *
 * O handler de erro religa automaticamente após 2s em caso de
 * `permission-denied` transitório (ocorre nos primeiros instantes após login).
 */
function _ligarListenerTempoReal() {
    Object.values(_unsubs).forEach(fn => { try { fn(); } catch(_) {} });
    _unsubs = {};

    if (_listenerCriando) return;
    _listenerCriando = true;

    // Layout antigo: um listener no documento único, como antes.
    if (!_layoutNovo) {
        _unsubs[_NOME_LEGADO] = window._firestore.firestoreEscutar(
            dados => _aoReceberDoc(_NOME_LEGADO, dados),
            _aoFalharListener);
        _listenerCriando = false;
        return;
    }

    _unsubs[_NOME_COMPARTILHADO] = window._firestore.firestoreEscutarDoc(
        _NOME_COMPARTILHADO,
        dados => _aoReceberDoc(_NOME_COMPARTILHADO, dados),
        _aoFalharListener);

    _empresaIdsPermitidos().forEach(id => {
        const nome = _nomeDocLanc(id);
        _unsubs[nome] = window._firestore.firestoreEscutarDoc(
            nome,
            dados => _aoReceberDoc(nome, dados, id),
            _aoFalharListener);
    });

    _listenerCriando = false;
}

/**
 * Trata a chegada de um snapshot, seja do documento compartilhado, de um
 * documento de lançamentos ou do documento único antigo.
 */
function _aoReceberDoc(nome, dados, empresaId) {
    if (_salvandoDB > 0) return;

    // Eco do nosso próprio save: consome o token e ignora.
    if (_hashPorDoc[nome]) {
        if (_hashStr(JSON.stringify(dados)) === _hashPorDoc[nome]) {
            _hashPorDoc[nome] = null;
            return;
        }
        _hashPorDoc[nome] = null;
    }

    if (nome === _NOME_LEGADO) {
        db = _mesclarComPadrao(dados);
    } else if (nome === _NOME_COMPARTILHADO) {
        const lancamentos = db.lancamentos;
        db = _mesclarComPadrao(Object.assign({}, dados, { lancamentos }));
    } else {
        _absorverLancamentos(empresaId, dados.lancamentos);
    }

    _pendentesSincronizacao = false;
    _rerenderTelaAtual();
}

function _aoFalharListener(erro) {
    _listenerCriando = false;
    // Permissão negada logo após o login é transitório: o token do Auth
    // ainda não propagou para o Firestore. Religa tudo após 2s.
    if (erro?.code === 'permission-denied' || erro?.code === 'resource-exhausted') {
        setTimeout(_ligarListenerTempoReal, 2000);
    } else {
        console.error("[Firestore] Erro listener:", erro);
        _setStatusConexao("erro");
    }
}

function _rerenderTelaAtual() {
    const telaAtual = document.querySelector(".tela[style*='block']");
    if (!telaAtual) return;
    const id = telaAtual.id;
    if (id === "dashboard")  carregarDashboard();
    if (id === "relatorios") carregarRelatorio();
    if (id === "analitico")  { if (typeof carregarAnalitico === 'function') carregarAnalitico(); }
    if (id === "fretes")     carregarFretes();
    if (["motoristas","veiculos","empresas","combustiveis","cadastros"].includes(id)) atualizarListas();
}

/**
 * Mescla dados vindos do Firestore (ou localStorage) com a estrutura padrão
 * `DB_PADRAO`, garantindo que todos os campos obrigatórios existam e tenham
 * o tipo correto — mesmo que o documento salvo esteja desatualizado.
 *
 * Regras de mesclagem por tipo de campo:
 * - Arrays (`motoristas`, `veiculos`, `empresas`, `combustiveis`, `lancamentos`,
 *   `bases`): substituídos integralmente se `dados` tiver array
 *   válido; senão mantém array vazio do padrão.
 * - `configRelatorio`: merge superficial (`Object.assign`) com o padrão,
 *   preservando configurações parcialmente salvas.
 *
 * É o ponto central de hidratação do `db` — novos campos adicionados ao
 * `DB_PADRAO` ficam disponíveis automaticamente em instalações existentes
 * sem scripts de migração adicionais.
 *
 * @param {object|null} dados - Dados brutos do Firestore ou localStorage.
 *                              Pode ser `null` ou objeto parcial/desatualizado.
 * @returns {object} Cópia profunda mesclada com `DB_PADRAO`, pronta para
 *                   atribuir diretamente a `db`
 */
function _mesclarComPadrao(dados) {
    const resultado = JSON.parse(JSON.stringify(DB_PADRAO));
    if (!dados || typeof dados !== 'object') return resultado;

    ['motoristas','veiculos','empresas','combustiveis','lancamentos','bases'].forEach(campo => {
        if (Array.isArray(dados[campo])) resultado[campo] = dados[campo];
    });

    if (dados.configRelatorio && typeof dados.configRelatorio === 'object') {
        resultado.configRelatorio = Object.assign({}, DB_PADRAO.configRelatorio, dados.configRelatorio);
    }

    return resultado;
}

function _garantirCampos() {
    db = _mesclarComPadrao(db);
}

function _mostrarLoading(visivel) {
    let el = document.getElementById("_loadingOverlay");
    if (visivel) {
        if (el) return;
        el = document.createElement("div");
        el.id = "_loadingOverlay";
        el.innerHTML = `
            <div style="position:fixed;inset:0;background:var(--bg,#18181b);
                display:flex;flex-direction:column;align-items:center;
                justify-content:center;z-index:9999;gap:16px;">
                <div style="width:40px;height:40px;border:3px solid var(--border,#3f3f46);
                    border-top-color:var(--primary,#7c1d2e);border-radius:50%;
                    animation:_spin 0.8s linear infinite;"></div>
                <span style="color:var(--text-muted,#a1a1aa);font-size:0.9rem;font-family:DM Sans,sans-serif">
                    Carregando dados da nuvem…
                </span>
            </div>
            <style>@keyframes _spin{to{transform:rotate(360deg)}}</style>`;
        document.body.appendChild(el);
    } else {
        if (el) el.remove();
    }
}

function _criarIndicadorConexao() {
    if (document.getElementById("_statusConexao")) return;
    const el = document.createElement("div");
    el.id = "_statusConexao";
    el.style.cssText = `
        position:fixed; bottom:16px; right:16px;
        display:none; align-items:center; gap:6px;
        background:var(--surface); border:1px solid var(--border-light);
        border-radius:20px; padding:5px 10px;
        font-size:0.72rem; color:var(--text-muted);
        font-family:DM Sans,sans-serif; z-index:900;
        transition:opacity 0.2s; opacity:1; cursor:pointer;
        box-shadow:0 2px 8px rgba(0,0,0,0.15);
    `;
    el.onmouseenter = () => el.style.opacity = "1";
    el.onmouseleave = () => el.style.opacity = "0.85";
    el.onclick = () => sincronizarAgora();
    document.body.appendChild(el);
    _setStatusConexao("conectando");
}

function _setStatusConexao(status) {
    const el = document.getElementById("_statusConexao");
    if (!el) return;
    const cfg = {
        conectando:   { cor:"#a1a1aa", icone:"○", texto:"Conectando…"   },
        sincronizado: { cor:"#22c55e", icone:"●", texto:"Sincronizado"  },
        salvando:     { cor:"#f59e0b", icone:"●", texto:"Salvando…"     },
        offline:      { cor:"#ef4444", icone:"●", texto:"Offline"       },
        pendente:     { cor:"#f97316", icone:"▲", texto:"Pendente"      },
        erro:         { cor:"#ef4444", icone:"●", texto:"Erro na nuvem" },
    };
    const c = cfg[status] || cfg.conectando;
    el.innerHTML = `<span style="color:${c.cor};font-size:8px">${c.icone}</span>${c.texto}`;

    // Visível apenas quando há algo relevante a comunicar;
    // quando sincronizado, some completamente (sem área clicável invisível)
    if (['offline','pendente','erro','salvando','conectando'].includes(status)) {
        el.style.display = "flex";
        el.style.opacity = "1";
    }
    // 'sincronizado' → display:none aplicado pelo setTimeout em _executarSave
}

function migrarDados() {
    let alterou = false;
    if (db.motoristas.length > 0 && typeof db.motoristas[0] === "string") {
        db.motoristas = db.motoristas.map(n => ({ id: gerarId(), nome: n, ativo: true }));
        alterou = true;
    }
    if (db.veiculos.length > 0 && typeof db.veiculos[0] === "string") {
        db.veiculos = db.veiculos.map(p => ({ id: gerarId(), nome: p, ativo: true }));
        alterou = true;
    }
    if (db.combustiveis.length > 0 && typeof db.combustiveis[0] === "string") {
        db.combustiveis = db.combustiveis.map(n => ({ id: gerarId(), nome: n, perda: 0 }));
        alterou = true;
    }
    if (alterou) salvarDB();
}

function toggleModoEscuro() {
    const html = document.documentElement;
    const novo = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", novo);
    const icone = document.getElementById("iconeTema");
    if (icone) icone.innerHTML = novo === "dark"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    localStorage.setItem("tema", novo);
}

function _hexParaRGB(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function _escurecerHex(hex, fator) {
    const { r, g, b } = _hexParaRGB(hex);
    const esc = v => Math.max(0, Math.round(v * (1 - fator)));
    return '#' + [esc(r), esc(g), esc(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function _clarearHex(hex, fator) {
    const { r, g, b } = _hexParaRGB(hex);
    const cl = v => Math.min(255, Math.round(v + (255 - v) * fator));
    return '#' + [cl(r), cl(g), cl(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function aplicarCorPersonalizada(cor) {
    const root = document.documentElement;
    const { r, g, b } = _hexParaRGB(cor);
    root.style.setProperty('--primary',         cor);
    root.style.setProperty('--primary-hover',   _escurecerHex(cor, 0.12));
    root.style.setProperty('--primary-mid',     _clarearHex(cor, 0.35));
    root.style.setProperty('--primary-light',   `rgba(${r},${g},${b},0.2)`);
    root.style.setProperty('--primary-glow',    `rgba(${r},${g},${b},0.4)`);
    root.style.setProperty('--shadow-glow',     `0 0 24px rgba(${r},${g},${b},0.3)`);
    root.style.setProperty('--primary-subtle',  `rgba(${r},${g},${b},0.10)`);
    root.style.setProperty('--primary-subtle2', `rgba(${r},${g},${b},0.08)`);
    root.style.setProperty('--primary-subtle3', `rgba(${r},${g},${b},0.15)`);
    root.style.setProperty('--primary-subtle4', `rgba(${r},${g},${b},0.18)`);
    localStorage.setItem('corPrimaria', cor);
}

function resetarCorPadrao() {
    const padrao = '#a02828';
    aplicarCorPersonalizada(padrao);
    const inputCor = document.getElementById('corPrimaria');
    if (inputCor) inputCor.value = padrao;
}

const corSalva = localStorage.getItem('corPrimaria');
if (corSalva) {
    aplicarCorPersonalizada(corSalva); // aplica todas as variáveis derivadas desde o início
    const inputCor = document.getElementById('corPrimaria');
    if (inputCor) inputCor.value = corSalva;
}

/**
 * Exibe uma notificação temporária (toast) no canto da tela.
 *
 * Remove qualquer toast anterior antes de exibir o novo — nunca empilha.
 *
 * @param {string} mensagem  - Texto a exibir
 * @param {'sucesso'|'erro'|'aviso'|'info'} [tipo='sucesso'] - Define cor e ícone
 * @param {number} [duracao=3000] - Duração em ms antes de sumir.
 *   Usar 4000ms para validações de formulário, 6000-8000ms para erros graves.
 */
function mostrarToast(mensagem, tipo = "sucesso", duracao = 3000) {
    const anterior = document.getElementById("toastSistema");
    if (anterior) anterior.remove();
    const toast = document.createElement("div");
    toast.id = "toastSistema";
    toast.className = `toast toast-${tipo}`;
    const icones = { sucesso: "✓", erro: "✕", aviso: "⚠", info: "i" };
    // `mensagem` é escapada: praticamente toda chamada interpola nome de
    // cadastro, número de nota ou nome de arquivo. Nenhum chamador passa HTML.
    toast.innerHTML = `<span class="toast-icone">${icones[tipo] || "i"}</span><span class="toast-msg">${escapeHtml(mensagem)}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("toast-visivel")));
    setTimeout(() => {
        toast.classList.remove("toast-visivel");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, duracao);
}

let _formularioSujo = false;

function marcarFormularioSujo() {
    _formularioSujo = true;
    const titulo = document.getElementById("tituloLancamento");
    if (titulo && !titulo.textContent.includes("●")) titulo.textContent = "● " + titulo.textContent;
}

function limparFormularioSujo() {
    _formularioSujo = false;
    const titulo = document.getElementById("tituloLancamento");
    if (titulo) titulo.textContent = titulo.textContent.replace("● ", "");
}

async function confirmarSaidaFormulario() {
    if (!_formularioSujo) return true;
    return await fmConfirm({ titulo: "Dados não salvos", msg: "Sair agora vai descartar tudo que foi preenchido.\n\nDeseja continuar?", confirmTxt: "Descartar e sair", cancelTxt: "Ficar", tipo: "aviso" });
}

/**
 * Navega para uma tela do sistema, ocultando todas as demais.
 *
 * Efeitos colaterais importantes:
 * - Ao navegar para `"lancamentos"`, sobrescreve o campo empresa com
 *   `empresaFiltroGlobal`. Se precisar preencher campos após navegar,
 *   fazê-lo dentro de `setTimeout(0)`.
 * - Atualiza o highlight da sidebar removendo `.ativa` de todos os
 *   `sidebar-item` e adicionando em `nav-{id}`.
 * - Chama a função de inicialização correspondente à tela (ex:
 *   `carregarDashboard`, `carregarAnalitico`).
 *
 * @param {string} id - ID do elemento HTML da tela destino
 * @returns {Promise<void>}
 */
async function mostrarTela(id) {
    const telaAtual = document.querySelector(".tela[style*='block']");
    if (telaAtual?.id === "lancamentos" && id !== "lancamentos") {
        if (!await confirmarSaidaFormulario()) return;
    }
    document.querySelectorAll(".tela").forEach(t => t.style.display = "none");
    const el = document.getElementById(id);
    if (el) el.style.display = "block";

    if (["motoristas","veiculos","empresas","combustiveis","cadastros"].includes(id)) atualizarListas();
    if (id === "historico")    preencherSelectsHistorico();
    if (id === "analitico")    { if (typeof carregarAnalitico === 'function') carregarAnalitico(); }
    if (id === "sistema")      atualizarInfoSistema();
    if (id === "usuarios")     { if (typeof carregarUsuarios === 'function') carregarUsuarios(); }
    if (id === "dashboard")    carregarDashboard();
    if (id === "relatorios")   carregarRelatorio();
    if (id === "fretes")       carregarFretes();
    if (id === "conferencia")  { if (typeof _conferenciaInicializar === "function") _conferenciaInicializar(); }
    if (id === "lancamentos") {
        limparFormularioSujo();
        const empresaInput = document.getElementById('empresaInput');
        if (empresaInput) {
            empresaInput.disabled = (empresaFiltroGlobal !== null);
            if (empresaFiltroGlobal) {
                empresaInput.value = empresaFiltroGlobal;
                document.getElementById('empresaSelect').value = empresaFiltroGlobal;
            }
        }
    }

    // Atualiza highlight da sidebar
    document.querySelectorAll(".sidebar-item").forEach(b => b.classList.remove("ativa"));
    const navBtn = document.getElementById("nav-" + id);
    if (navBtn) navBtn.classList.add("ativa");

    if (typeof window._uiNavHook === 'function') window._uiNavHook(id);
    if (typeof atualizarTitulosInternos === 'function') atualizarTitulosInternos();
}

const BACKUP_AUTO_INTERVALO_DIAS = 3;
const BACKUP_AUTO_MAX = 3;

function verificarBackupAutomatico() {
    const ultimo = localStorage.getItem("backupAutoData");
    const dias = ultimo ? (Date.now() - parseInt(ultimo)) / 86400000 : Infinity;
    if (dias >= BACKUP_AUTO_INTERVALO_DIAS) fazerBackupAutomatico();
}

function fazerBackupAutomatico() {
    try {
        const chave = `backupAuto_${new Date().toISOString().slice(0,10)}`;
        const dados = JSON.stringify(db);
        const chaves = Object.keys(localStorage).filter(k => k.startsWith("backupAuto_")).sort();
        while (chaves.length >= BACKUP_AUTO_MAX) localStorage.removeItem(chaves.shift());
        localStorage.setItem(chave, dados);
        localStorage.setItem("backupAutoData", Date.now().toString());
    } catch(e) { console.warn("[Backup automático] Falhou:", e.message); }
}

function listarBackupsAutomaticos() {
    return Object.keys(localStorage)
        .filter(k => k.startsWith("backupAuto_")).sort().reverse()
        .map(chave => ({ chave, data: chave.replace("backupAuto_",""), tamanhoKB: (localStorage.getItem(chave).length/1024).toFixed(1) }));
}

async function restaurarBackupAutomatico(chave) {
    const dados = localStorage.getItem(chave);
    if (!dados) return mostrarToast("Backup não encontrado.", "erro", 4000);
    if (!await fmConfirm({ titulo: "Restaurar backup?", msg: `Data: ${chave.replace("backupAuto_","")}\n\nOs dados atuais serão substituídos por esta versão.`, confirmTxt: "Restaurar", tipo: "perigo" })) return;
    try {
        Object.values(_unsubs).forEach(fn => { try { fn(); } catch(_) {} });
        _unsubs = {};
        db = _mesclarComPadrao(JSON.parse(dados));
        salvarDB();
        migrarDados();
        atualizarListas();
        atualizarInfoSistema();
        if (window._firestore) _ligarListenerTempoReal();
        mostrarToast("Backup restaurado e sincronizado com a nuvem!", "sucesso");
    } catch(e) { mostrarToast("Erro ao restaurar: " + e.message, "erro", 5000); }
}

// filtroRapido — função canônica em relatorios.js
// (removida daqui para evitar duplicata e conflito de versões)
