/*=================================================
  APP.JS — Fuel Mind
  Login com Firebase Auth + empresa obrigatória
  Empresa sempre filtrada — sem opção "Todas"
=================================================*/

/* ─── ESTADO DO USUÁRIO LOGADO ─── */
window._usuarioAtual = null; // { uid, nome, email, role, empresas[] }
let empresaFiltroGlobal = null;
let empresaFiltroNome   = "";
// O id da empresa ativa, ao lado do nome. As duas globais acima guardam o
// NOME, e o nome muda num rename; o id não. É ele que permite reconhecer a
// empresa ativa depois de um rename feito aqui ou por um colega — ver
// `_reconciliarEmpresaAtiva`.
let empresaFiltroId     = null;

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


/**
 * Envia o e-mail de redefinição de senha.
 *
 * `authEnviarResetSenha` existia em `firebase.js`, estava exportada e não
 * era chamada por ninguém: quem esquecia a senha dependia do supremo, e o
 * supremo não tinha botão nenhum — a única saída dele era o Console do
 * Firebase. Esta função é só a ligação que faltava.
 *
 * Aceita e-mail ou @usuario, porque o login aceita os dois. E a mensagem de
 * sucesso é a mesma quando o usuário não existe: dizer "esse e-mail não
 * está cadastrado" numa tela pública entrega quem tem conta.
 */
async function esqueciMinhaSenha() {
    const identificador = document.getElementById("loginEmail")?.value.trim();
    const erroEl  = document.getElementById("loginErro");
    const avisoEl = document.getElementById("loginAviso");
    if (erroEl)  erroEl.style.display  = "none";
    if (avisoEl) avisoEl.style.display = "none";

    if (!identificador) {
        if (erroEl) {
            erroEl.textContent = "Escreva seu e-mail ou usuário acima e clique de novo.";
            erroEl.style.display = "block";
        }
        document.getElementById("loginEmail")?.focus();
        return;
    }
    if (!window._firestore) {
        if (erroEl) {
            erroEl.textContent = "Sem conexão com a nuvem. Tente de novo em instantes.";
            erroEl.style.display = "block";
        }
        return;
    }

    const sucesso = () => {
        if (!avisoEl) return;
        avisoEl.textContent = "Se houver conta com esse cadastro, o e-mail de "
            + "redefinição já foi enviado. Confira a caixa de entrada e o spam.";
        avisoEl.style.display = "block";
    };

    try {
        let email = identificador;
        const ehUsername = !identificador.includes("@") || identificador.startsWith("@");
        if (ehUsername) {
            const perfil = await window._firestore.usuarioBuscarPorUsername(
                identificador.replace(/^@/, "").toLowerCase().trim());
            if (!perfil?.email) return sucesso();   // não revela se existe
            email = perfil.email;
        }
        await window._firestore.authEnviarResetSenha(email);
        sucesso();
    } catch (e) {
        // `user-not-found` e `invalid-email` também respondem sucesso, pelo
        // mesmo motivo. Só falha de verdade aparece como falha.
        if (e?.code === "auth/user-not-found" || e?.code === "auth/invalid-email") return sucesso();
        if (erroEl) {
            erroEl.textContent = "Não consegui enviar o e-mail: " + (e?.message || e);
            erroEl.style.display = "block";
        }
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

    // `setEmpresaFiltro` grava `ultimaEmpresa` desde sempre, com um
    // comentário prometendo restaurar a escolha na sessão seguinte — e
    // ninguém lia a chave. Quem trabalha o dia inteiro na mesma empresa
    // reescolhia a mesma opção todo login. A escolha continua sendo do
    // operador: a última só sobe para o topo, marcada.
    const ultima = localStorage.getItem("ultimaEmpresa");
    if (ultima && empresasDisponiveis.includes(ultima)) {
        empresasDisponiveis = [ultima, ...empresasDisponiveis.filter(e => e !== ultima)];
    }

    lista.innerHTML = empresasDisponiveis.map(emp => `
        <button class="btn-empresa-troca" onclick="confirmarSelecaoEmpresa('${escapeJsAttr(emp)}')">
            <span>${escapeHtml(emp)}${emp === ultima
                ? ' <small style="opacity:0.6;font-weight:400">· última usada</small>' : ''}</span>
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
    // O rascunho é apagado no logout: a chave é por usuário, mas deixar
    // trabalho de um turno esperando o próximo login não ajuda ninguém.
    if (typeof fmRascunhoApagar === 'function') fmRascunhoApagar();
    // `authLogout` não recarrega a página: sem isto, o próximo login nesta
    // aba — talvez de outra pessoa — herdava o formulário e a lista da
    // sessão do turno anterior.
    if (typeof limparFormulario === 'function') limparFormulario();
    if (typeof _idsSessao !== 'undefined') { _idsSessao = []; if (typeof _sessaoRenderizar === 'function') _sessaoRenderizar(); }
    empresaFiltroGlobal = null;
    empresaFiltroNome   = "";
    empresaFiltroId     = null;
    window._usuarioAtual = null;
    await window._firestore.authLogout();
}


/* ─── EMPRESA ATIVA ─── */
function _aplicarEmpresaAtiva(nome) {
    empresaFiltroGlobal = nome || null;
    empresaFiltroNome   = nome || "";
    empresaFiltroId     = nome ? ((db.empresas || []).find(e => e.nome === nome)?.id || null) : null;

    const label = document.getElementById("empresaAtivaLabel");
    if (label) label.textContent = nome || "—";

    const nomeUsuario = document.getElementById("headerNomeUsuario");
    if (nomeUsuario && window._usuarioAtual) {
        nomeUsuario.textContent = (window._usuarioAtual.nome || '').split(" ")[0];
    }

    const telaAtualId = document.querySelector(".tela[style*='block']")?.id || "dashboard";
    if (typeof atualizarTituloHeader === "function") atualizarTituloHeader(telaAtualId);

    const ei = document.getElementById("empresaInput");
    if (ei) {
        ei.value = nome || ""; ei.disabled = !!nome;
        ei.title = nome ? "Definida pela empresa ativa, no cabeçalho" : "";
    }
    const es = document.getElementById("empresaSelect");
    if (es && nome) es.value = nome;
}

/**
 * Reconcilia a empresa ativa com o cadastro, depois de qualquer coisa que
 * possa ter mudado o cadastro: rename, inativação, exclusão, snapshot de um
 * colega, restauração de backup.
 *
 * A empresa ativa é guardada pelo NOME, e as notas também. Um rename
 * propagava o nome novo para todas as notas e deixava a global com o velho:
 * os relatórios ficavam vazios, e uma nota lançada nesse estado não entrava
 * em documento nenhum — sumia no carregamento seguinte com a pílula dizendo
 * sincronizado. Testado na rodada 10. O id é o que não muda.
 */
let _avisouEmpresaAtivaInativa = false;

function _reconciliarEmpresaAtiva() {
    if (!empresaFiltroGlobal) return;
    const empresas = db.empresas || [];
    const emp = (empresaFiltroId && empresas.find(e => e.id === empresaFiltroId))
             || empresas.find(e => e.nome === empresaFiltroGlobal);

    if (!emp) {
        mostrarToast(`A empresa ativa, ${empresaFiltroGlobal}, não existe mais no cadastro. `
            + `Escolha outra no cabeçalho antes de lançar.`, "erro", 10000);
        return;
    }

    if (emp.nome !== empresaFiltroGlobal) {
        const antigo = empresaFiltroGlobal;
        // O rascunho guardado com o nome velho continuaria preso a uma
        // empresa que não existe mais, e só poderia ser descartado.
        try {
            const chave = typeof _fmChaveRascunho === "function" ? _fmChaveRascunho() : null;
            const bruto = chave && localStorage.getItem(chave);
            if (bruto) {
                const r = JSON.parse(bruto);
                if (r.empresaAtiva === antigo) {
                    r.empresaAtiva = emp.nome;
                    if (r.campos && r.campos.empresa === antigo) r.campos.empresa = emp.nome;
                    localStorage.setItem(chave, JSON.stringify(r));
                }
            }
        } catch (_) {}
        setEmpresaFiltro(emp.nome);
        mostrarToast(`A empresa ativa foi renomeada: ${antigo} agora se chama ${emp.nome}.`, "info", 6000);
    } else {
        empresaFiltroId = emp.id;
    }

    if (emp.ativo === false) {
        if (!_avisouEmpresaAtivaInativa) {
            _avisouEmpresaAtivaInativa = true;
            mostrarToast(`A empresa ativa, ${emp.nome}, foi inativada no cadastro.`, "aviso", 8000);
        }
    } else {
        _avisouEmpresaAtivaInativa = false;
    }
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
    try { localStorage.setItem("ultimaEmpresa", nome); } catch (_) {}
    if (typeof _sessaoRenderizar === 'function') _sessaoRenderizar();
    const telaAtualId = document.querySelector(".tela[style*='block']")?.id;
    if (telaAtualId) {
        switch (telaAtualId) {
            case "dashboard":   carregarDashboard(); break;
            case "relatorios":  carregarRelatorio(); break;
            case "analitico":   if (typeof carregarAnalitico === 'function') carregarAnalitico(); break;
            case "fretes":      carregarFretes();    break;
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
    trocarEmpresaAtiva(nome);
}

/* ─── A PORTA ÚNICA DA TROCA DE EMPRESA (rodada 10) ───
   A empresa ativa é o contexto, e o formulário pertence a ela. Quando o
   contexto muda, o que estava na tela para a empresa anterior sai: com
   pergunta se havia trabalho, em silêncio se era só a herança do lote.

   Antes a troca não perguntava nada, reescrevia o campo Empresa e deixava
   o resto — e uma nota em EDIÇÃO mudava de empresa e de documento ao ser
   salva, sem modal nenhum. Testado na rodada 10.

   Não é (c), guardar como rascunho da empresa anterior: o rascunho tem uma
   chave por usuário e grava a empresa ativa no momento da gravação, então
   o que (c) prometesse guardar seria reetiquetado ou sobrescrito meio
   segundo depois. */

/** Há trabalho na tela além do que "Salvar e lançar próxima" deixa? */
function _formularioTemAlemDaHeranca() {
    if (typeof _fmRascunhoCapturar !== 'function') return false;
    const r = _fmRascunhoCapturar();
    const c = r.campos || {};
    if (c.dataNota || c.numeroNota || c.motorista || c.placa || c.observacoes) return true;
    return (r.itens || []).some(i => i.tipo || i.qtd || i.qtdDescargada || i.valor);
}

async function trocarEmpresaAtiva(nome) {
    if (!nome) return false;
    if (nome === empresaFiltroGlobal) return true;

    // O marcador de sujo não basta: edição, clone e XML preenchem por script
    // e só marcam quando criam uma linha de combustível. Base e Data da
    // Descarga sozinhas não contam — são a herança do lote, e saem sem
    // pergunta.
    const clonando  = typeof isClonando !== 'undefined' && isClonando;
    const editando  = typeof lancamentoEditandoId !== 'undefined' && !!lancamentoEditandoId && !clonando;
    const perguntar = _formularioSujo || editando || clonando || _formularioTemAlemDaHeranca();
    const atual     = empresaFiltroGlobal || 'a empresa atual';

    if (perguntar) {
        const nota = (document.getElementById('numeroNota')?.value || '').trim();
        const msg = editando
            ? `Você está editando a nota ${nota || 'sem número'} de ${atual}.\n\n`
              + `Trocar para ${nome} abandona a edição. A nota continua gravada como estava.`
            : `Há um lançamento preenchido para ${atual}.\n\n`
              + `Trocar para ${nome} descarta o que está na tela.`;
        // Cancelar não muda nada: nem a empresa, nem o campo, nem o rascunho.
        if (!await fmConfirm({
            titulo: 'Trocar de empresa?',
            msg,
            confirmTxt: 'Descartar e trocar',
            cancelTxt: `Continuar em ${atual}`,
            tipo: 'perigo'
        })) return false;
    }

    // Limpeza completa e sem segundo modal. Não é `descartarFormulario`, que
    // abre a própria pergunta, nem `limparFormularioParcial`, que mantém a
    // Base e a Data da Descarga da empresa anterior.
    if (typeof limparFormulario === 'function') {
        limparFormulario({ preservarRascunhoPendente: !perguntar });
    }
    if (typeof _limparConferenciaCarregada === 'function') _limparConferenciaCarregada();

    setEmpresaFiltro(nome);

    const tela = document.querySelector(".tela[style*='block']")?.id;
    if (tela === 'lancamentos' && typeof fmRascunhoVerificar === 'function') fmRascunhoVerificar();
    mostrarToast(`Empresa ativa: ${nome}`, 'info', 3000);
    return true;
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
    // Normaliza a tecla: `e.key` vem em maiúscula com Caps Lock ou Shift, e a
    // comparação direta com 's' fazia todos os atalhos pararem justamente no
    // estado de teclado de quem digita placa. `metaKey` cobre o Mac.
    const comando = e.ctrlKey || e.metaKey;
    const tecla   = (e.key || '').toLowerCase();
    const telaVisivel = id => document.getElementById(id)?.style.display === 'block';

    // O `preventDefault` fica DENTRO da checagem de tela, como no Ctrl+F
    // logo abaixo. Solto lá fora, ele engolia o "salvar página" do
    // navegador em todas as outras oito telas sem colocar nada no lugar.
    if (comando && tecla === 's' && telaVisivel('lancamentos')) {
        e.preventDefault();
        document.getElementById('btnSalvarLancamento')?.click();
    }
    // Ctrl+Enter é o atalho do botão primário — "salvar e lançar próxima" numa
    // nota nova, "salvar" numa correção. É o que permite atravessar um bolo de
    // notas sem tocar no mouse. Ctrl+S faz o mesmo, porque nesta tela o
    // primário sempre é a ação de salvar.
    if (comando && (e.key === 'Enter' || tecla === 'enter')) {
        if (telaVisivel('lancamentos')) {
            e.preventDefault();
            document.getElementById('btnSalvarLancamento')?.click();
        }
    }
    // O preventDefault só acontece quando o atalho tem o que fazer. Antes ele
    // vinha primeiro e engolia o Ctrl+F do navegador em todas as outras telas,
    // sem colocar nada no lugar.
    if (comando && tecla === 'f' && telaVisivel('relatorios')) {
        e.preventDefault();
        document.getElementById('filtroBusca')?.focus();
    }
    // Ctrl+N e Ctrl+T eram reservados pelo Chrome: o navegador abria janela ou
    // aba de qualquer jeito E o handler ainda rodava. No caso do Ctrl+N,
    // limparFormulario() apagava um lançamento preenchido enquanto uma janela
    // nova roubava a atenção — perda total e silenciosa. Removidos.
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
    },
    configAlertas: {}
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

/* ── O QUE FOI SALVO MAS AINDA NÃO SUBIU ────────────────────────────
   Registro dos lançamentos que entraram na memória e cuja gravação na
   nuvem ainda não foi confirmada. Vive no `localStorage`, e é por isso
   que existe: precisa sobreviver ao fechamento da aba.

   Sem ele, a nota salva e perdida na janela entre o clique e a resposta
   do Firestore era DESTRUÍDA, não apenas atrasada. A sequência era esta:
   `salvarDB` gravava a cópia local e agendava a nuvem; fechar a aba antes
   matava o agendamento; na sessão seguinte `carregarDB` trocava a memória
   pelo que veio do servidor e logo depois gravava isso por cima do
   `db_backup`. A nota sumia dos dois lugares, e a pílula dizia
   "sincronizado".

   Este registro guarda só ids. O lançamento em si continua no
   `db_backup`; é o cruzamento dos dois, em `_reconciliarNaoEnviados`, que
   traz a nota de volta. Guardar ids e não o objeto evita ter duas versões
   do mesmo lançamento em lugares diferentes.

   Exclusões não entram aqui de propósito: quem apaga uma nota também a
   tira do `db_backup`, então ela não é candidata a voltar. O preço é que
   uma exclusão perdida na mesma janela é desfeita pelo servidor — e
   ressuscitar dado é muito menos grave do que destruí-lo. */
function _chavePendentes() {
    return "fm_pendentes_" + (window._usuarioAtual?.uid || "anon");
}

function _pendentesLer() {
    try { return JSON.parse(localStorage.getItem(_chavePendentes()) || "[]"); }
    catch (_) { return []; }
}

function _pendenteMarcar(id) {
    if (!id) return;
    try {
        const ids = _pendentesLer();
        if (!ids.includes(id)) {
            ids.push(id);
            localStorage.setItem(_chavePendentes(), JSON.stringify(ids));
        }
    } catch (_) {}
}

/* Chamado só quando TODAS as gravações da rodada deram certo. Aí tudo o
   que está em memória está no servidor, porque `_montarPayloads` sempre
   monta o vetor inteiro de cada empresa permitida. */
function _pendentesLimpar() {
    try { localStorage.removeItem(_chavePendentes()); } catch (_) {}
}

/* A cópia local é a rede de segurança de tudo: é ela que sobrevive ao F5 e
   à queda de conexão. Falhar aqui em silêncio — como acontecia, num
   `catch(_) {}` mudo — deixava o operador achando que estava protegido.
   O caminho da falha na prática é a quota do navegador: são quatro cópias
   do banco vivendo lá (esta, mais até três `backupAuto_*`), e a ~440 bytes
   por lançamento os ~5 MB acabam em torno de três mil notas somando todas
   as empresas. Avisa uma vez por sessão, para não virar um toast a cada
   salvamento. */
let _avisouQuotaLocal = false;

function _gravarCopiaLocal() {
    try {
        localStorage.setItem("db_backup", JSON.stringify(db));
        _avisouQuotaLocal = false;
    } catch (e) {
        console.warn("[db_backup] Falhou:", e.message);
        if (!_avisouQuotaLocal) {
            _avisouQuotaLocal = true;
            mostrarToast(
                "Não consegui guardar a cópia local: o armazenamento do navegador está cheio. "
                + "Os lançamentos continuam indo para a nuvem, mas a proteção contra F5 parou. "
                + "Baixe um backup em Sistema › Backup.",
                "erro", 10000);
        }
    }
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
        configRelatorio:   db.configRelatorio,
        // Vazio quando ninguém ajustou: os padrões ficam no código
        // (ALERTAS_CONFIG_PADRAO), e `undefined` o Firestore recusaria.
        configAlertas:     db.configAlertas || {}
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

function salvarDB(opcoes) {
    // Modo demonstração: nada sai da máquina. Esta é a trava — se ela
    // falhar, dados fictícios acabam na base real. Vem antes de tudo.
    if (typeof demoAtivo === 'function' && demoAtivo()) {
        demoSalvar();
        return;
    }

    _gravarCopiaLocal();

    if (!window._firestore) {
        _setStatusConexao("offline");
        _pendentesSincronizacao = true;
        return;
    }

    clearTimeout(_timerDebounce);
    _setStatusConexao("salvando");

    // `imediato` existe para o salvamento fiscal. O debounce agrupa
    // chamadas seguidas num `setDoc` só, o que é ótimo para cadastro e
    // configuração — e péssimo para uma nota: quem clica em "Salvar" e
    // fecha a aba meio segundo depois nunca chegou a tentar. O clique
    // explícito do operador merece uma tentativa explícita imediata.
    if (opcoes && opcoes.imediato) return _executarSave();

    // Debounce: chamadas rápidas em sequência resultam em um único setDoc.
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
        // Nada mudou porque os payloads são idênticos aos últimos gravados
        // com sucesso: o servidor já tem tudo.
        _pendentesLimpar();
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

    return Promise.all(gravacoes)
        .then(() => {
            _salvandoDB = Math.max(0, _salvandoDB - 1);
            _pendentesSincronizacao = false;
            // Tudo o que está em memória está no servidor: `_montarPayloads`
            // monta o vetor inteiro de cada empresa permitida, e os
            // documentos que não foram enviados são os que já estavam
            // idênticos lá.
            _pendentesLimpar();
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
/**
 * Devolve os lançamentos que ficaram só no navegador, para voltarem à
 * memória antes que a cópia local seja sobrescrita.
 *
 * Uma nota entra aqui quando as três coisas valem ao mesmo tempo:
 *   1. o id está na lista de pendentes (foi salvo e não teve confirmação);
 *   2. a nota existe na cópia local (`db_backup`);
 *   3. a nota NÃO existe no que o servidor devolveu agora.
 *
 * As três juntas é que dão certeza. Só o item 3 acusaria como "não
 * enviada" qualquer nota que um colega apagou legitimamente enquanto esta
 * máquina estava fechada — e o sistema a ressuscitaria. Só o item 1 não
 * basta porque o envio pode ter dado certo com a aba morrendo antes do
 * `.then()`.
 *
 * A empresa da nota precisa estar entre as permitidas: reviver lançamento
 * de uma empresa que o usuário deixou de acessar poluiria os relatórios e
 * seria descartado por `_montarPayloads` de qualquer forma.
 */
function _reconciliarNaoEnviados(doServidor) {
    const ids = _pendentesLer();
    if (!ids.length) return [];

    let local = null;
    try { local = JSON.parse(localStorage.getItem("db_backup") || "null"); }
    catch (_) { return []; }
    if (!local || !Array.isArray(local.lancamentos)) return [];

    const noServidor = new Set(doServidor.map(l => l.id));
    const permitidos = _empresaIdsPermitidos();

    return local.lancamentos.filter(l =>
        ids.includes(l.id) &&
        !noServidor.has(l.id) &&
        permitidos.includes(_empresaIdDoLancamento(l))
    );
}

async function carregarDB() {
    // Em demo os dados já foram postos em memória por entrarModoDemo().
    if (typeof demoAtivo === 'function' && demoAtivo()) return;

    _mostrarLoading(true);
    let naoEnviados = [];
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

            const doServidor = docs.flatMap(d => (d && d.lancamentos) || []);
            naoEnviados = _reconciliarNaoEnviados(doServidor);
            db.lancamentos = doServidor.concat(naoEnviados);
            _pendentesSincronizacao = naoEnviados.length > 0;
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

        // A cópia local é gravada DEPOIS da reconciliação. Antes, ela era
        // escrita logo em seguida ao `db.lancamentos = …` do servidor, e
        // era essa linha que apagava a última prova de que a nota não
        // enviada existiu.
        _gravarCopiaLocal();

        // O reenvio acontece ANTES de ligar o listener. Se o listener
        // subisse primeiro, o snapshot inicial traria o estado do servidor
        // — sem estas notas — e `_absorverLancamentos` as tiraria da
        // memória de novo, desfazendo a reconciliação.
        if (naoEnviados.length) {
            mostrarToast(
                `${naoEnviados.length} lançamento(s) do último acesso não tinham `
                + `chegado à nuvem. Enviando agora.`, "aviso", 7000);
            try { await salvarDB({ imediato: true }); } catch (_) {}
        }

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
        // Um colega pode ter renomeado ou inativado a empresa ativa daqui.
        _reconciliarEmpresaAtiva();
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

    // `conjuntosVeiculos` PRECISA estar aqui. _montarPayloads o grava no
    // documento compartilhado, mas enquanto ele faltava nesta lista a carga
    // devolvia undefined, garantirConjuntos() ressemeava os 34 conjuntos do
    // CONJUNTOS_INICIAIS com ids novos, e o save seguinte gravava isso por
    // cima — toda edição de conjunto era revertida em silêncio, e os ids
    // mudando quebravam o histórico de vigência.
    ['motoristas','veiculos','empresas','combustiveis','lancamentos','bases',
     'conjuntosVeiculos'].forEach(campo => {
        if (Array.isArray(dados[campo])) resultado[campo] = dados[campo];
    });

    if (dados.configRelatorio && typeof dados.configRelatorio === 'object') {
        resultado.configRelatorio = Object.assign({}, DB_PADRAO.configRelatorio, dados.configRelatorio);
    }

    // Guarda só o que foi ajustado; `configAlertas()` completa com os padrões
    // na leitura, para que mudar um padrão no código valha para quem nunca
    // ajustou nada.
    if (dados.configAlertas && typeof dados.configAlertas === 'object') {
        resultado.configAlertas = dados.configAlertas;
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
/**
 * Exibe uma mensagem efêmera.
 *
 * As mensagens se EMPILHAM. Antes, cada chamada removia a anterior — e como há
 * caminhos que emitem duas em sequência (o salvamento e o erro de nuvem, por
 * exemplo), a primeira era destruída antes de poder ser lida.
 *
 * O contêiner declara `role="status"` e `aria-live="polite"`: o projeto não
 * tinha nenhuma região viva, então nada do que o sistema comunicava por toast
 * chegava a leitor de tela.
 */
function mostrarToast(mensagem, tipo = "sucesso", duracao = 3000) {
    let pilha = document.getElementById("toastPilha");
    if (!pilha) {
        pilha = document.createElement("div");
        pilha.id = "toastPilha";
        pilha.setAttribute("role", "status");
        pilha.setAttribute("aria-live", "polite");
        document.body.appendChild(pilha);
    }
    // Teto de 3: além disso a pilha vira ruído e cobre a tela.
    while (pilha.children.length >= 3) pilha.firstElementChild.remove();

    const toast = document.createElement("div");
    toast.className = `toast toast-${tipo}`;
    const icones = { sucesso: "✓", erro: "✕", aviso: "⚠", info: "i" };
    // `mensagem` é escapada: praticamente toda chamada interpola nome de
    // cadastro, número de nota ou nome de arquivo. Nenhum chamador passa HTML.
    toast.innerHTML = `<span class="toast-icone">${icones[tipo] || "i"}</span><span class="toast-msg">${escapeHtml(mensagem)}</span>`;
    pilha.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("toast-visivel")));
    setTimeout(() => {
        toast.classList.remove("toast-visivel");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, duracao);
}

let _formularioSujo = false;

/**
 * Escreve (ou apaga) o marcador `●` no título da tela de lançamento,
 * conforme `_formularioSujo`.
 *
 * O id certo é `tituloLancamentos`, com S. As duas funções abaixo
 * procuravam `tituloLancamento` — uma letra a menos — e por isso o marcador
 * nunca apareceu desde que foi escrito. Derivar do estado, em vez de
 * empilhar e remover prefixo, deixa a função idempotente e permite
 * reaplicar o marcador depois de trocar o texto do título.
 */
function _aplicarMarcadorSujo() {
    const titulo = document.getElementById("tituloLancamentos");
    if (titulo) {
        const base = titulo.textContent.replace(/^●\s*/, "");
        titulo.textContent = _formularioSujo ? "● " + base : base;
    }
    // O `h2` da tela fica oculto de propósito — `atualizarTitulosInternos`
    // esconde todos, porque o título mora no cabeçalho. Por isso o `●` que
    // o conserto de 03/09 "fez aparecer" nunca foi visto: ele era escrito
    // num elemento com display:none. O marcador vai para onde se vê.
    const telaAtual = document.querySelector(".tela[style*='block']")?.id;
    if (telaAtual === "lancamentos" && typeof atualizarTituloHeader === "function") {
        atualizarTituloHeader("lancamentos");
    }
}

function marcarFormularioSujo() {
    _formularioSujo = true;
    _aplicarMarcadorSujo();
    // Todo campo do formulário já chamava esta função, então ela é o gancho
    // natural do rascunho: não foi preciso espalhar ouvintes pela tela.
    if (typeof fmRascunhoAgendar === 'function') fmRascunhoAgendar();
}

function limparFormularioSujo() {
    _formularioSujo = false;
    _aplicarMarcadorSujo();
}

/**
 * Avisa que há um lançamento em andamento antes de trocar de tela.
 *
 * O texto anterior dizia "Sair agora vai descartar tudo que foi preenchido"
 * e o botão era "Descartar e sair" — o que era FALSO: `mostrarTela` só troca
 * `display`, nada limpa os campos, e os dados continuam lá na volta. O efeito
 * prático era caro: quem precisava conferir uma nota no relatório ou cadastrar
 * um motorista acreditava que o preço era perder tudo — então ou não conferia,
 * e errava, ou conferia e redigitava.
 */
async function confirmarSaidaFormulario() {
    if (!_formularioSujo) return true;
    return await fmConfirm({
        titulo: "Lançamento em andamento",
        msg: "Você tem um lançamento preenchido e ainda não salvo.\n\nOs dados continuam aqui quando você voltar a esta tela.",
        confirmTxt: "Sair mesmo assim",
        cancelTxt: "Continuar preenchendo",
        tipo: "aviso"
    });
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
    if (id === "analitico")    { if (typeof carregarAnalitico === 'function') carregarAnalitico(); }
    if (id === "sistema")      atualizarInfoSistema();
    if (id === "usuarios")     { if (typeof carregarUsuarios === 'function') carregarUsuarios(); }
    if (id === "dashboard")    carregarDashboard();
    if (id === "relatorios")   carregarRelatorio();
    if (id === "fretes")       carregarFretes();
    if (id === "conferencia")  { if (typeof _conferenciaInicializar === "function") _conferenciaInicializar(); }
    if (id === "lancamentos") {
        // Não limpar o marcador ao ENTRAR na tela. Ele era zerado aqui, então
        // quem preenchia a nota, saía para conferir o relatório e voltava
        // perdia a flag: na segunda saída o aviso de lançamento em andamento
        // não aparecia mais. Quem zera é `limparFormulario`, ao descartar ou
        // depois de salvar.
        const empresaInput = document.getElementById('empresaInput');
        if (empresaInput) {
            empresaInput.disabled = (empresaFiltroGlobal !== null);
            if (empresaFiltroGlobal) {
                empresaInput.value = empresaFiltroGlobal;
                document.getElementById('empresaSelect').value = empresaFiltroGlobal;
            }
        }
        // Oferece o rascunho, se houver, sem tocar em campo nenhum, e refaz a
        // lista de notas já lançadas nesta sessão.
        if (typeof fmRascunhoVerificar === 'function') fmRascunhoVerificar();
        if (typeof _sessaoRenderizar === 'function') _sessaoRenderizar();
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

/**
 * Grava a cópia periódica do banco no `localStorage`.
 *
 * A falha aqui não pode ser silenciosa. O caminho que ela toma na prática
 * é a quota do navegador: são quatro cópias do banco vivendo lá dentro
 * (`db_backup` a cada salvamento, mais até três `backupAuto_*`), e a
 * ~440 bytes por lançamento os ~5 MB acabam em torno de três mil notas
 * somando todas as empresas. Quando isso acontecer, o backup para —
 * enquanto a tela de Sistema continua prometendo uma cópia a cada três
 * dias. Um `console.warn` não avisa ninguém.
 *
 * A tentativa de liberar espaço apagando a cópia mais antiga vem antes do
 * aviso: na maior parte das vezes ela resolve, e o operador não precisa
 * saber de nada.
 */
function fazerBackupAutomatico() {
    const chave = `backupAuto_${_hojeISO()}`;
    const dados = JSON.stringify(db);

    const gravar = () => {
        const chaves = Object.keys(localStorage).filter(k => k.startsWith("backupAuto_")).sort();
        while (chaves.length >= BACKUP_AUTO_MAX) localStorage.removeItem(chaves.shift());
        localStorage.setItem(chave, dados);
        localStorage.setItem("backupAutoData", Date.now().toString());
    };

    try {
        gravar();
        return;
    } catch (e) {
        console.warn("[Backup automático] Primeira tentativa falhou:", e.message);
    }

    // Segunda tentativa, com uma cópia a menos.
    try {
        const antigas = Object.keys(localStorage).filter(k => k.startsWith("backupAuto_")).sort();
        if (antigas.length) localStorage.removeItem(antigas[0]);
        gravar();
        return;
    } catch (e) {
        console.warn("[Backup automático] Falhou mesmo após liberar espaço:", e.message);
    }

    mostrarToast(
        "Não consegui gravar o backup automático: o armazenamento do navegador está cheio. "
        + "Baixe um backup em Sistema › Backup e avise o responsável.",
        "erro", 10000);
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
        _reconciliarEmpresaAtiva();
        atualizarInfoSistema();
        if (window._firestore) _ligarListenerTempoReal();
        mostrarToast("Backup restaurado e sincronizado com a nuvem!", "sucesso");
    } catch(e) { mostrarToast("Erro ao restaurar: " + e.message, "erro", 5000); }
}

// filtroRapido — função canônica em relatorios.js
// (removida daqui para evitar duplicata e conflito de versões)
