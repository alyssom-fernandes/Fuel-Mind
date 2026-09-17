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
                }).catch(() => {});
            } catch(_) {}

            _escutarPerfil(user.uid);
            await _mostrarSelecaoEmpresa(perfil);
        } else {
            _authJaProcessado = false;
            _encerrarSessaoDados();
            window._usuarioAtual = null;
            _mostrarTelaLogin();
        }
    });
});

/* ─── O PRÓPRIO PERFIL, DURANTE A SESSÃO ───
   Inativar alguém ou mudar as empresas dele só valia no próximo login; até
   lá a sessão aberta tentava ler o que não podia mais, em laço. */
function _escutarPerfil(uid) {
    try { _unsubPerfil?.(); } catch (_) {}
    _unsubPerfil = null;
    if (!window._firestore?.usuarioEscutar) return;
    _unsubPerfil = window._firestore.usuarioEscutar(uid,
        perfil => { _aplicarPerfilAtualizado(perfil); },
        () => {});
}

function _derrubarSessao(mensagem) {
    _encerrarSessaoDados();
    window._usuarioAtual = null;
    _authJaProcessado = false;
    try { window._firestore?.authLogout(); } catch (_) {}
    _mostrarTelaLogin(mensagem);
}

/**
 * Aplica um perfil relido do servidor.
 * @returns {boolean} true quando a sessão foi encerrada por causa dele
 */
function _aplicarPerfilAtualizado(perfil) {
    const atual = window._usuarioAtual;
    if (!atual) return true;
    if (!perfil || perfil.ativo === false) {
        _derrubarSessao("Seu acesso foi desativado. Fale com o administrador.");
        return true;
    }
    const mudouAcesso = JSON.stringify(atual.empresaIds || []) !== JSON.stringify(perfil.empresaIds || [])
        || atual.role !== perfil.role;
    window._usuarioAtual = Object.assign(atual, perfil);
    if (!mudouAcesso) return false;

    if (typeof aplicarPermissoesDaTela === 'function') aplicarPermissoesDaTela();
    _garantirListeners();
    const disponiveis = _empresasDisponiveisDoPerfil(perfil);
    // A empresa ativa saiu do perfil: não dá para continuar lançando nela.
    if (empresaFiltroGlobal && !disponiveis.includes(empresaFiltroGlobal)) {
        if (disponiveis.length === 0) {
            _derrubarSessao("Você não tem mais acesso a nenhuma empresa ativa. Fale com o administrador.");
            return true;
        }
        if (typeof limparFormulario === 'function') limparFormulario();
        setEmpresaFiltro(disponiveis[0]);
        mostrarToast(`Seu acesso a uma empresa foi retirado. Empresa ativa agora: ${disponiveis[0]}.`, "aviso", 10000);
    } else {
        mostrarToast("Suas permissões foram alteradas pelo administrador.", "info", 6000);
    }
    return false;
}

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
/**
 * Nomes das empresas ativas que um perfil pode usar, decididos pelos IDS.
 *
 * Antes eram decididos pelo nome gravado no perfil: renomear uma empresa
 * tirava o acesso de todo mundo que não era supremo.
 */
function _empresasDisponiveisDoPerfil(perfil) {
    if (!perfil) return [];
    const ativas = (db.empresas || []).filter(e => e.ativo !== false);
    if (perfil.role === "supremo") return ativas.map(e => e.nome);
    const ids = _idsDoPerfil(perfil);
    return ativas.filter(e => ids.includes(e.id)).map(e => e.nome);
}

/**
 * Tela de escolha da empresa, logo depois do login.
 *
 * O cadastro de empresas é lido ANTES de montar a lista. Antes, numa aba
 * recém-aberta a lista de empresas ainda estava vazia: quem não era supremo
 * era recusado com "sem acesso a nenhuma empresa", e o supremo lia o
 * documento do layout antigo — ou entrava num laço sem fim se ele não
 * existisse.
 */
async function _mostrarSelecaoEmpresa(perfil) {
    document.getElementById("loginOverlay").style.display = "none";
    document.getElementById("appContainer").style.display = "none";

    if (window._firestore && !(typeof demoAtivo === 'function' && demoAtivo())) {
        try {
            const comp = await window._firestore.firestoreCarregarDoc(_NOME_COMPARTILHADO);
            if (comp) {
                db = _mesclarComPadrao(Object.assign({}, comp, { lancamentos: [] }));
            } else if (perfil.role === "supremo") {
                const legado = await window._firestore.firestoreCarregarDoc(_NOME_LEGADO).catch(() => null);
                if (legado) db = _mesclarComPadrao(legado);
            }
        } catch (e) {
            console.error("[login] Cadastro de empresas:", e);
            const local = _lerCopiaLocal();
            if (local) { try { db = _mesclarComPadrao(local); } catch (_) {} }
        }
    }
    if (window._usuarioAtual !== perfil) return;

    let empresasDisponiveis = _empresasDisponiveisDoPerfil(perfil);

    if (empresasDisponiveis.length === 0) {
        if (perfil.role === "supremo") {
            _entrarNoSistema(perfil, "");
            return;
        }
        _derrubarSessao("Você não tem acesso a nenhuma empresa ativa. Contate o administrador.");
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

/* ─── PERMISSÕES NA TELA ───
   Quem vê o quê. A regra do servidor é a barreira de verdade; a tela só
   não oferece o que o servidor vai recusar, e não deixa o operador perto
   do que apaga ou substitui dado de todo mundo.

   Elementos marcados com `data-papel="admin"` aparecem para admin e
   supremo; `data-papel="supremo"`, só para o supremo. */
function papelAtual() {
    return window._usuarioAtual?.role || "";
}
function ehSupremoAtual() {
    return papelAtual() === "supremo";
}
function ehAdminOuSupremoAtual() {
    return papelAtual() === "supremo" || papelAtual() === "admin";
}
function _papelPermite(minimo) {
    if (minimo === "supremo") return ehSupremoAtual();
    if (minimo === "admin")   return ehAdminOuSupremoAtual();
    return true;
}

function aplicarPermissoesDaTela() {
    document.querySelectorAll("[data-papel]").forEach(el => {
        el.classList.toggle("fm-sem-permissao", !_papelPermite(el.dataset.papel));
    });
    document.querySelectorAll(".fm-so-operador").forEach(el => {
        el.classList.toggle("fm-sem-permissao", ehAdminOuSupremoAtual());
    });
    document.querySelectorAll(".fm-so-nao-supremo").forEach(el => {
        el.classList.toggle("fm-sem-permissao", ehSupremoAtual());
    });
    // A aba Backup some para o operador: se ela era a aberta, abre a próxima.
    if (!ehAdminOuSupremoAtual() && typeof sistemaAbaAtiva !== 'undefined' && sistemaAbaAtiva === 'backup'
        && typeof trocarAbaSistema === 'function') {
        const btn = document.querySelector('#sistemaAbas .aba-btn[data-aba="importar"]');
        trocarAbaSistema('importar', btn);
    }
}

/** Recusa uma ação na hora, com o motivo, quando o papel não permite. */
function exigirPapel(minimo, acao) {
    if (_papelPermite(minimo)) return true;
    mostrarToast(`${acao}: ${minimo === "supremo" ? "só o usuário supremo pode fazer isso" : "só administradores podem fazer isso"}.`, "aviso", 6000);
    return false;
}

function confirmarSelecaoEmpresa(empresa) {
    if (!empresa) {
        const opcoes = _empresasDisponiveisDoPerfil(window._usuarioAtual);
        if (opcoes.length === 1) empresa = opcoes[0];
        else return;
    }
    document.getElementById("selecaoEmpresaOverlay").style.display = "none";
    try { localStorage.setItem("ultimaEmpresa", empresa); } catch (_) {}
    _entrarNoSistema(window._usuarioAtual, empresa);
}

function _entrarNoSistema(perfil, empresa) {
    document.getElementById("appContainer").style.display = "block";
    _aplicarEmpresaAtiva(empresa);
    if (typeof aplicarPermissoesDaTela === 'function') aplicarPermissoesDaTela();
    carregarDB();
}

/* ─── LOGOUT ─── */
async function fazerLogout() {
    const pendente = _pendentesSincronizacao && !(typeof demoAtivo === 'function' && demoAtivo());
    if (pendente) {
        // Sair com gravação pendente: fica guardado neste navegador, para
        // ESTE usuário, e sobe no próximo login dele aqui. Quem sai precisa
        // saber disso antes, e poder tentar enviar.
        const sair = await fmConfirm({
            titulo: "Há alterações que ainda não chegaram à nuvem",
            msg: "Elas ficam guardadas neste navegador e sobem no seu próximo login aqui. "
               + "Em outro computador, não aparecem até lá.\n\nPrefere ficar e tentar enviar agora?",
            confirmTxt: "Sair mesmo assim",
            cancelTxt: "Ficar e tentar enviar",
            tipo: "aviso"
        });
        if (!sair) { sincronizarAgora(); return; }
    } else if (!await fmConfirm({ titulo: "Sair do sistema?", msg: "Sua sessão será encerrada.", confirmTxt: "Sair", cancelTxt: "Cancelar", tipo: "aviso" })) {
        return;
    }
    // O rascunho é apagado no logout: a chave é por usuário, mas deixar
    // trabalho de um turno esperando o próximo login não ajuda ninguém.
    if (typeof fmRascunhoApagar === 'function') fmRascunhoApagar();
    // `authLogout` não recarrega a página: sem isto, o próximo login nesta
    // aba — talvez de outra pessoa — herdava o formulário e a lista da
    // sessão do turno anterior.
    if (typeof limparFormulario === 'function') limparFormulario();
    if (typeof _idsSessao !== 'undefined') { _idsSessao = []; if (typeof _sessaoRenderizar === 'function') _sessaoRenderizar(); }
    _encerrarSessaoDados();
    window._usuarioAtual = null;
    await window._firestore.authLogout();
}

/**
 * Desliga tudo o que a sessão deixou rodando: listeners, timers de
 * gravação e de recarga, e a memória do banco. Antes, depois do logout os
 * listeners negados religavam em laço na tela de login, o retry de 30 s
 * seguia tentando gravar, e o próximo usuário da aba via o banco do
 * anterior enquanto o dele não carregava.
 */
function _encerrarSessaoDados() {
    _desligarListeners();
    try { _unsubPerfil?.(); } catch (_) {}
    _unsubPerfil = null;
    clearTimeout(_timerDebounce);
    clearTimeout(_timerRetry);
    clearTimeout(_timerRecarga);
    _cargaOk = false;
    _primeiraCargaFeita = false;
    _layoutNovo = false;
    _base = {};
    _hashPorDoc = {};
    _salvandoDB = 0;
    _gravacoesEmVoo = 0;
    _falhasSeguidas = 0;
    _tentativasRecarga = 0;
    _pendentesSincronizacao = false;
    db = JSON.parse(JSON.stringify(DB_PADRAO));
    empresaFiltroGlobal = null;
    empresaFiltroNome   = "";
    empresaFiltroId     = null;
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

    const empresasDisponiveis = _empresasDisponiveisDoPerfil(perfil);

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
    // Só empresa que existe e que este perfil pode usar. Um nome velho (de
    // antes de um rename) deixava a tela vazia e todo lançamento bloqueado.
    if (window._usuarioAtual && !_empresasDisponiveisDoPerfil(window._usuarioAtual).includes(nome)) {
        mostrarToast(`A empresa "${nome}" não está disponível para você (renomeada, inativa ou fora do seu acesso).`, "aviso", 7000);
        return false;
    }

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
    // Com um modal aberto, o atalho de salvar não age por trás dele: antes,
    // Ctrl+Enter na conferência salvava a nota duas vezes.
    const modalAberto = [...document.querySelectorAll('.modal-overlay')].some(o => getComputedStyle(o).display !== 'none');
    const telaVisivel = id => !modalAberto && document.getElementById(id)?.style.display === 'block';

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
    conjuntosVeiculos: [],
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

// Um unsubscribe por documento escutado: "compartilhado" e cada "lanc__{id}".
let _unsubs = {};
// O listener do próprio perfil, ligado no login.
let _unsubPerfil = null;
let _pendentesSincronizacao = false;

// Só no layout antigo (`dados/principal`): proteção contra o eco do próprio
// save por hash e contador de gravação em andamento.
let _salvandoDB = 0;
let _hashPorDoc = {};

// Timer do debounce — agrupa writes múltiplos em uma gravação só.
let _timerDebounce = null;
const _DEBOUNCE_MS = 600;

// Nome do documento de cadastros compartilhados.
const _NOME_COMPARTILHADO = "compartilhado";
const _NOME_LEGADO        = "principal";

// true quando os dados já estão repartidos por empresa; false enquanto o
// banco ainda estiver no documento único `dados/principal`. Só é decidido
// por uma carga que DEU CERTO — ver `_cargaOk`.
let _layoutNovo = false;

/* ── CARGA CONFIRMADA ───────────────────────────────────────────────
   Nada vai para a nuvem enquanto a carga da nuvem não tiver dado certo.

   Antes, uma falha ao ler um documento virava "documento vazio": a
   empresa cuja leitura falhou ficava sem nota nenhuma em memória, e o
   primeiro salvamento gravava um vetor vazio por cima do histórico dela.
   E uma falha ao ler o compartilhado deixava a sessão gravando no
   documento do layout antigo, com a pílula verde — as notas sumiam no F5
   seguinte. Com a carga falha, o sistema mostra a cópia deste navegador,
   guarda o que for lançado como pendente e tenta carregar de novo. */
let _cargaOk = false;
let _primeiraCargaFeita = false;
let _timerRecarga = null;
let _tentativasRecarga = 0;

/* ── O QUE O SERVIDOR TINHA ─────────────────────────────────────────
   `_base[nome]` é a fotografia do documento na última leitura ou gravação
   confirmada: para cada lista, um mapa id → JSON do item.

   É ela que diz o que ESTE navegador mudou: item que não está na base é
   novo, item com JSON diferente foi editado, item da base que sumiu da
   memória foi removido. A gravação lê o documento atual numa transação e
   aplica só essas mudanças por cima dele — em vez de regravar o vetor
   inteiro da memória, que apagava a nota que um colega tinha acabado de
   salvar. E um snapshot que chega enquanto há mudança local ainda não
   enviada é mesclado do mesmo jeito, em vez de substituir a memória e
   levar a mudança embora. */
let _base = {};

const _LISTAS_COMPARTILHADO  = ['motoristas', 'veiculos', 'empresas', 'combustiveis', 'bases', 'conjuntosVeiculos'];
const _OBJETOS_COMPARTILHADO = ['configRelatorio', 'configAlertas'];

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

// Hash leve para detectar se o Firestore nos devolveu o que acabamos de salvar
// (layout antigo).
function _hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h;
}

/* ═══════════════════════════════════════════════════════════════════════
   REPARTIÇÃO POR EMPRESA

   Os lançamentos vivem em um documento por empresa (`dados/lanc__{id}`) e
   os cadastros num documento comum (`dados/compartilhado`). Em memória o
   `db` continua com a mesma forma de sempre — `db.lancamentos` é um array
   único — só que contendo apenas as empresas que o usuário pode ver.

   É isso que mantém dashboard, analítico, relatórios e fretes intocados:
   eles seguem iterando `db.lancamentos` sem saber da repartição.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Ids das empresas cujos lançamentos o usuário logado pode carregar.
 * Sem usuário logado, nenhuma: antes a ausência de perfil liberava todas.
 */
function _empresaIdsPermitidos() {
    const perfil = window._usuarioAtual;
    if (!perfil) return [];
    const todas  = (db.empresas || []).map(e => e.id);
    if (perfil.role === "supremo") return todas;
    const liberadas = _idsDoPerfil(perfil);
    return todas.filter(id => liberadas.includes(id));
}

/**
 * Ids de empresa do perfil. `empresaIds` é a verdade (é o que as regras do
 * servidor consultam, e não muda num rename); perfis antigos, sem o campo,
 * caem nos nomes.
 */
function _idsDoPerfil(perfil) {
    if (!perfil) return [];
    if (Array.isArray(perfil.empresaIds) && perfil.empresaIds.length) return perfil.empresaIds;
    return (perfil.empresas || [])
        .map(nome => (db.empresas || []).find(e => e.nome === nome)?.id)
        .filter(Boolean);
}

/**
 * Id da empresa de um lançamento.
 *
 * O nome que está na nota decide primeiro — é ele que o operador vê e
 * corrige, e é por ele que uma correção em massa move uma nota. Quando o
 * nome não resolve (um colega renomeou a empresa e esta memória ainda tem
 * o nome velho), vale o `empresaId` gravado na nota. Antes só havia o nome,
 * e uma nota com nome que não batia sumia da nuvem em silêncio.
 */
function _empresaIdDoLancamento(l) {
    const porNome = (db.empresas || []).find(e => e.nome === l.empresa)?.id;
    return porNome || l.empresaId || null;
}

/** Nome do documento de lançamentos de uma empresa. */
function _nomeDocLanc(empresaId) {
    return window._firestore ? window._firestore.docLancamentosNome(empresaId)
                             : "lanc__" + empresaId;
}

function _idDoDocLanc(nome) {
    return String(nome).startsWith("lanc__") ? String(nome).slice(6) : null;
}

/**
 * Deixa as notas de um documento com a empresa dele: carimba o `empresaId`
 * e põe o nome atual do cadastro. É o que faz um rename feito em outra
 * máquina chegar a esta sem ninguém regravar as notas.
 */
function _normalizarLancamentosDoDoc(lista, empresaId) {
    const nome = (db.empresas || []).find(e => e.id === empresaId)?.nome;
    return (lista || []).map(l => {
        const c = Object.assign({}, l, { empresaId });
        if (nome) c.empresa = nome;
        return c;
    });
}

/** Lançamentos em memória agrupados pelo documento de destino. */
function _agruparLancamentos() {
    const grupos = {};
    db.lancamentos.forEach(l => {
        const id = _empresaIdDoLancamento(l);
        if (!id) return;
        if (l.empresaId !== id) l.empresaId = id;
        (grupos[id] = grupos[id] || []).push(l);
    });
    return grupos;
}

/**
 * O documento como a memória o vê agora.
 * @param {string} nome
 * @param {object} [grupos] - resultado de `_agruparLancamentos`, para não
 *   reagrupar a cada documento
 */
function _payloadDoc(nome, grupos) {
    if (nome === _NOME_COMPARTILHADO) {
        const p = {};
        _LISTAS_COMPARTILHADO.forEach(c => { p[c] = db[c] || []; });
        p.configRelatorio = db.configRelatorio || {};
        p.configAlertas   = db.configAlertas   || {};
        return p;
    }
    const id = _idDoDocLanc(nome);
    return { lancamentos: ((grupos || _agruparLancamentos())[id]) || [] };
}

/** Mantido pelo nome antigo: o payload de cada documento permitido. */
function _montarPayloads() {
    const grupos = _agruparLancamentos();
    const payloads = { [_NOME_COMPARTILHADO]: _payloadDoc(_NOME_COMPARTILHADO, grupos) };
    _empresaIdsPermitidos().forEach(id => {
        payloads[_nomeDocLanc(id)] = _payloadDoc(_nomeDocLanc(id), grupos);
    });
    return payloads;
}

function _chaveItem(item) {
    return (item && item.id != null) ? String(item.id) : "json:" + JSON.stringify(item);
}

/** Fotografia de um payload: listas como mapa id → JSON, objetos como JSON. */
function _fotografar(payload) {
    const foto = { listas: {}, objetos: {} };
    Object.keys(payload || {}).forEach(campo => {
        const v = payload[campo];
        if (Array.isArray(v)) {
            const m = new Map();
            v.forEach(item => m.set(_chaveItem(item), JSON.stringify(item)));
            foto.listas[campo] = m;
        } else {
            foto.objetos[campo] = JSON.stringify(v === undefined ? null : v);
        }
    });
    return foto;
}

/**
 * O que a memória mudou em relação à base do documento.
 * @returns {null|{listas: Object, objetos: Object, idsLancamentos: string[]}}
 */
function _mudancasLocais(nome, grupos) {
    const base    = _base[nome] || { listas: {}, objetos: {} };
    const payload = _payloadDoc(nome, grupos);
    const mud     = { listas: {}, objetos: {}, idsLancamentos: [] };
    let alguma    = false;

    Object.keys(payload).forEach(campo => {
        const v = payload[campo];
        if (Array.isArray(v)) {
            const naBase    = base.listas[campo] || new Map();
            const alterados = [];
            const presentes = new Set();
            v.forEach(item => {
                const k = _chaveItem(item);
                presentes.add(k);
                if (naBase.get(k) !== JSON.stringify(item)) alterados.push(item);
            });
            const removidos = [];
            naBase.forEach((_, k) => { if (!presentes.has(k)) removidos.push(k); });
            if (alterados.length || removidos.length) {
                mud.listas[campo] = { alterados, removidos };
                alguma = true;
                if (campo === 'lancamentos') {
                    alterados.forEach(l => l && l.id && mud.idsLancamentos.push(l.id));
                }
            }
        } else if (JSON.stringify(v === undefined ? null : v) !== base.objetos[campo]) {
            mud.objetos[campo] = v === undefined ? null : v;
            alguma = true;
        }
    });
    return alguma ? mud : null;
}

/** Aplica as mudanças locais por cima do documento do servidor. */
function _mesclar(servidor, mud) {
    const resultado = Object.assign({}, servidor || {});
    if (!mud) return resultado;
    Object.keys(mud.listas).forEach(campo => {
        const { alterados, removidos } = mud.listas[campo];
        const tirar = new Set(removidos);
        const lista = (Array.isArray(resultado[campo]) ? resultado[campo] : [])
            .filter(item => !tirar.has(_chaveItem(item)));
        alterados.forEach(item => {
            const k = _chaveItem(item);
            const i = lista.findIndex(x => _chaveItem(x) === k);
            if (i >= 0) lista[i] = item; else lista.push(item);
        });
        resultado[campo] = lista;
    });
    Object.keys(mud.objetos).forEach(campo => { resultado[campo] = mud.objetos[campo]; });
    return resultado;
}

/** O documento do servidor com a mesma normalização que a memória recebe. */
function _normalizarDocServidor(nome, dados) {
    if (nome === _NOME_COMPARTILHADO) {
        const m = _mesclarComPadrao(Object.assign({}, dados || {}, { lancamentos: [] }));
        const p = {};
        _LISTAS_COMPARTILHADO.forEach(c => { p[c] = m[c] || []; });
        p.configRelatorio = m.configRelatorio || {};
        p.configAlertas   = m.configAlertas   || {};
        return p;
    }
    const id = _idDoDocLanc(nome);
    return { lancamentos: _normalizarLancamentosDoDoc((dados && dados.lancamentos) || [], id) };
}

/** Põe na memória o conteúdo de um documento. */
function _aplicarNaMemoria(nome, conteudo) {
    if (nome === _NOME_COMPARTILHADO) {
        _LISTAS_COMPARTILHADO.forEach(c => { db[c] = conteudo[c] || []; });
        db.configRelatorio = conteudo.configRelatorio || {};
        db.configAlertas   = conteudo.configAlertas   || {};
        return;
    }
    const id = _idDoDocLanc(nome);
    const idsNovos = new Set((conteudo.lancamentos || []).map(l => l.id));
    db.lancamentos = db.lancamentos
        .filter(l => _empresaIdDoLancamento(l) !== id && !idsNovos.has(l.id))
        .concat(conteudo.lancamentos || []);
}

/**
 * Recebe um documento do servidor (snapshot ou retorno de gravação) e o
 * junta com o que este navegador mudou e ainda não confirmou.
 * @returns {boolean} se a memória mudou
 */
function _absorverDoc(nome, dados) {
    window._versaoDados = (window._versaoDados || 0) + 1;
    const antes = JSON.stringify(_payloadDoc(nome));
    const mud   = _mudancasLocais(nome);
    const servidor = _normalizarDocServidor(nome, dados);
    const mesclado = _mesclar(servidor, mud);
    _base[nome] = _fotografar(servidor);
    _aplicarNaMemoria(nome, mesclado);
    if (nome === _NOME_COMPARTILHADO) _normalizarNomesDeEmpresa();
    if (_mudancasLocais(nome)) _pendentesSincronizacao = true;
    return JSON.stringify(_payloadDoc(nome)) !== antes;
}

/** Depois de um rename vindo de outra máquina, as notas da memória levam o nome novo. */
function _normalizarNomesDeEmpresa() {
    const nomePorId = new Map((db.empresas || []).map(e => [e.id, e.nome]));
    db.lancamentos.forEach(l => {
        if (!l.empresaId || !nomePorId.has(l.empresaId)) return;
        const porNome = (db.empresas || []).find(e => e.nome === l.empresa);
        if (!porNome && l.empresa !== nomePorId.get(l.empresaId)) {
            l.empresa = nomePorId.get(l.empresaId);
            const base = _base[_nomeDocLanc(l.empresaId)];
            if (base && base.listas.lancamentos && base.listas.lancamentos.has(String(l.id))) {
                // A nota não mudou para quem a gravou: só o nome do cadastro.
                // Atualiza a base junto, para não regravar o documento inteiro.
                base.listas.lancamentos.set(String(l.id), JSON.stringify(l));
            }
        }
    });
}

/* ── O QUE FOI SALVO MAS AINDA NÃO SUBIU ────────────────────────────
   Registro, no `localStorage`, dos lançamentos que mudaram neste navegador
   e cuja gravação na nuvem ainda não foi confirmada. Precisa sobreviver ao
   fechamento da aba.

   Guarda só ids. O conteúdo está na cópia local; na próxima carga, a nota
   pendente da cópia local é aplicada por cima do que veio do servidor —
   inclusive uma exclusão ou uma edição, e não só uma nota nova, como era
   antes da lápide. O preço conhecido: se um colega editou a mesma nota
   nesse meio tempo, a versão deste navegador vence. */
function _chavePendentes() {
    return "fm_pendentes_" + (window._usuarioAtual?.uid || "anon");
}

function _pendentesLer() {
    try { return JSON.parse(localStorage.getItem(_chavePendentes()) || "[]"); }
    catch (_) { return []; }
}

function _pendentesGravar(ids) {
    try {
        if (ids.length) localStorage.setItem(_chavePendentes(), JSON.stringify(ids));
        else localStorage.removeItem(_chavePendentes());
    } catch (_) {}
}

function _pendenteMarcar(id) {
    if (!id) return;
    const ids = _pendentesLer();
    if (!ids.includes(id)) { ids.push(id); _pendentesGravar(ids); }
}

/** Tira do registro só os ids cuja gravação foi confirmada com o conteúdo atual. */
function _pendentesConfirmar(ids) {
    if (!ids || !ids.length) return;
    const confirmados = new Set(ids);
    _pendentesGravar(_pendentesLer().filter(id => !confirmados.has(id)));
}

function _pendentesLimpar() {
    _pendentesGravar([]);
}

/* A cópia local é a rede de segurança de tudo: é ela que sobrevive ao F5 e
   à queda de conexão. Ela é POR USUÁRIO: antes era uma chave só, e quem
   entrava depois no mesmo computador gravava a própria cópia por cima das
   notas não enviadas de quem saiu.

   Falhar aqui em silêncio deixava o operador achando que estava protegido.
   O caminho da falha na prática é a quota do navegador. Avisa uma vez por
   sessão, para não virar um toast a cada salvamento. */
let _avisouQuotaLocal = false;

function _chaveCopiaLocal() {
    const uid = window._usuarioAtual?.uid;
    return uid ? "db_backup_" + uid : null;
}

function _lerCopiaLocal() {
    const chave = _chaveCopiaLocal();
    if (!chave) return null;
    try { return JSON.parse(localStorage.getItem(chave) || "null"); }
    catch (_) { return null; }
}

function _gravarCopiaLocal() {
    const chave = _chaveCopiaLocal();
    if (!chave) return;
    try {
        localStorage.setItem(chave, JSON.stringify(db));
        // A chave antiga, de antes da cópia por usuário, não tem dono.
        localStorage.removeItem("db_backup");
        _avisouQuotaLocal = false;
    } catch (e) {
        console.warn("[copia local] Falhou:", e.message);
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

/** Marca como pendentes os lançamentos que mudaram em relação ao servidor. */
function _marcarPendentesDasMudancas() {
    if (!_layoutNovo && _cargaOk) return;
    const grupos = _agruparLancamentos();
    const ids = new Set(_pendentesLer());
    let mudou = false;
    Object.keys(grupos).forEach(id => {
        const mud = _mudancasLocais(_nomeDocLanc(id), grupos);
        (mud?.idsLancamentos || []).forEach(x => { if (!ids.has(x)) { ids.add(x); mudou = true; } });
    });
    if (mudou) _pendentesGravar([...ids]);
}

/**
 * Persiste o `db`: cópia local na hora, nuvem em seguida.
 *
 * O debounce de 600ms agrupa chamadas em rápida sucessão — por exemplo,
 * edições consecutivas em cadastros — numa gravação só. `imediato` existe
 * para o salvamento fiscal: quem clica em "Salvar" e fecha a aba meio
 * segundo depois precisa ter tido a tentativa.
 */
function salvarDB(opcoes) {
    // Toda gravação muda a versão dos dados (o cache da busca do relatório a usa).
    window._versaoDados = (window._versaoDados || 0) + 1;
    // Modo demonstração: nada sai da máquina. Esta é a trava — se ela
    // falhar, dados fictícios acabam na base real. Vem antes de tudo.
    if (typeof demoAtivo === 'function' && demoAtivo()) {
        demoSalvar();
        return;
    }
    // Sem usuário logado não há o que salvar nem onde. Antes, uma chamada
    // na carga da página (os conjuntos iniciais) gravava um banco quase
    // vazio por cima da cópia local.
    if (!window._usuarioAtual) return;

    _gravarCopiaLocal();
    _marcarPendentesDasMudancas();
    _pendentesSincronizacao = true;

    if (!window._firestore) {
        _setStatusConexao("offline");
        return;
    }

    clearTimeout(_timerDebounce);
    if (!_cargaOk) {
        // A carga da nuvem falhou: fica guardado aqui e sobe quando ela der certo.
        _setStatusConexao("pendente");
        return;
    }
    _setStatusConexao("salvando");

    if (opcoes && opcoes.imediato) return _executarSave();
    _timerDebounce = setTimeout(() => _executarSave(), _DEBOUNCE_MS);
}

let _gravacoesEmVoo = 0;
let _timerRetry = null;
let _falhasSeguidas = 0;

/**
 * Grava na nuvem os documentos que este navegador mudou.
 *
 * Cada documento é gravado numa transação que lê o que está no servidor e
 * aplica por cima só as mudanças locais (`_mesclar`). Documento sem mudança
 * local não é tocado.
 */
function _executarSave() {
    if (!window._firestore || !_cargaOk) return Promise.resolve();
    if (!_layoutNovo) return _executarSaveLegado();

    clearTimeout(_timerRetry);
    const grupos   = _agruparLancamentos();
    const permitidos = new Set(_empresaIdsPermitidos());
    const nomes    = [_NOME_COMPARTILHADO, ...[...permitidos].map(_nomeDocLanc)];
    // Notas de empresa que o usuário não acessa ficariam só na memória.
    Object.keys(grupos).forEach(id => {
        if (!permitidos.has(id)) {
            console.warn("[save] Lançamentos de empresa sem permissão ficaram de fora:", id);
        }
    });

    const trabalhos = nomes
        .map(nome => ({ nome, mud: _mudancasLocais(nome, grupos) }))
        .filter(t => t.mud);

    if (trabalhos.length === 0) {
        if (_gravacoesEmVoo === 0) {
            // Nada difere do servidor: o que estava pendente já está lá.
            _pendentesLimpar();
            _pendentesSincronizacao = false;
            _setStatusConexao("sincronizado");
            _esconderStatusDepois();
        }
        return Promise.resolve();
    }

    _gravacoesEmVoo++;
    const gravacoes = trabalhos.map(({ nome, mud }) =>
        window._firestore.firestoreGravarMesclando(nome,
            atual => _mesclar(_normalizarDocServidor(nome, atual), mud))
            .then(gravado => {
                _absorverDoc(nome, gravado);
                // Pendente só sai quando o que subiu é o que está na memória.
                const naMemoria = new Map((_payloadDoc(nome).lancamentos || []).map(l => [l.id, JSON.stringify(l)]));
                const gravadoPorId = new Map((gravado.lancamentos || []).map(l => [l.id, JSON.stringify(l)]));
                _pendentesConfirmar(mud.idsLancamentos.filter(id =>
                    gravadoPorId.has(id) && gravadoPorId.get(id) === naMemoria.get(id)));
                return { nome, ok: true };
            })
            .catch(erro => ({ nome, ok: false, erro })));

    return Promise.all(gravacoes).then(resultados => {
        _gravacoesEmVoo = Math.max(0, _gravacoesEmVoo - 1);
        const falhas = resultados.filter(r => !r.ok);

        if (falhas.length === 0) {
            _falhasSeguidas = 0;
            _gravarCopiaLocal();
            _rerenderTelaAtual();
            // Algo mudou enquanto gravava: grava de novo.
            const restante = nomes.some(n => _mudancasLocais(n));
            if (restante) { _timerDebounce = setTimeout(() => _executarSave(), _DEBOUNCE_MS); return; }
            if (_gravacoesEmVoo === 0) {
                _pendentesSincronizacao = false;
                _setStatusConexao("sincronizado");
                _esconderStatusDepois();
            }
            return;
        }

        _pendentesSincronizacao = true;
        _falhasSeguidas++;
        const negada = falhas.find(f => f.erro?.code === 'permission-denied');
        if (negada && negada.nome === _NOME_COMPARTILHADO) {
            // O servidor recusou uma mudança de cadastro que este perfil não
            // pode fazer. Repetir para sempre travava o documento inteiro: os
            // cadastros novos paravam de subir. A mudança é desfeita.
            _desfazerMudancasLocais(_NOME_COMPARTILHADO);
            mostrarToast("A nuvem recusou a alteração nos cadastros: seu perfil não tem permissão para ela. A alteração foi desfeita.", "erro", 9000);
            _rerenderTelaAtual();
        }
        const semRede = !navigator.onLine || falhas.some(f =>
            ['unavailable', 'failed-precondition', 'deadline-exceeded'].includes(f.erro?.code));
        _setStatusConexao(semRede ? "offline" : "erro");
        if (_falhasSeguidas === 1) {
            mostrarToast(semRede
                ? "Sem conexão com a nuvem. O que foi salvo está guardado neste navegador e sobe quando a conexão voltar."
                : "Erro ao salvar na nuvem. O que foi salvo está guardado neste navegador; tentando de novo.",
                semRede ? "aviso" : "erro", 7000);
        }
        console.error("[save] Falhas:", falhas.map(f => `${f.nome}: ${f.erro?.code || f.erro?.message}`));
        const espera = Math.min(30000 * Math.pow(2, _falhasSeguidas - 1), 300000);
        _timerRetry = setTimeout(() => { if (_pendentesSincronizacao) _executarSave(); }, espera);
    });
}

/** Volta a memória de um documento ao que o servidor tem. */
function _desfazerMudancasLocais(nome) {
    const base = _base[nome];
    if (!base) return;
    const conteudo = {};
    Object.keys(base.listas).forEach(c => { conteudo[c] = [...base.listas[c].values()].map(j => JSON.parse(j)); });
    Object.keys(base.objetos).forEach(c => { conteudo[c] = JSON.parse(base.objetos[c]); });
    _aplicarNaMemoria(nome, conteudo);
}

function _esconderStatusDepois() {
    setTimeout(() => {
        const el = document.getElementById("_statusConexao");
        if (el && !_pendentesSincronizacao) el.style.display = "none";
    }, 3000);
}

/** Layout antigo (`dados/principal`), antes da migração: grava o db inteiro. */
function _executarSaveLegado() {
    _salvandoDB++;
    const payload = JSON.parse(JSON.stringify(db));
    const hash = _hashStr(JSON.stringify(payload));
    if (hash === _hashPorDoc[_NOME_LEGADO]) {
        _salvandoDB = Math.max(0, _salvandoDB - 1);
        _pendentesSincronizacao = false;
        _pendentesLimpar();
        _setStatusConexao("sincronizado");
        return Promise.resolve();
    }
    _hashPorDoc[_NOME_LEGADO] = hash;
    return window._firestore.firestoreSalvarDoc(_NOME_LEGADO, payload)
        .then(() => {
            _salvandoDB = Math.max(0, _salvandoDB - 1);
            _pendentesSincronizacao = false;
            _pendentesLimpar();
            _setStatusConexao("sincronizado");
            _esconderStatusDepois();
        })
        .catch(() => {
            delete _hashPorDoc[_NOME_LEGADO];
            _salvandoDB = Math.max(0, _salvandoDB - 1);
            _pendentesSincronizacao = true;
            _setStatusConexao("erro");
            clearTimeout(_timerRetry);
            _timerRetry = setTimeout(() => { if (_pendentesSincronizacao) salvarDB(); }, 30000);
            mostrarToast("Erro ao salvar na nuvem. Tentando novamente em 30s…", "erro", 6000);
        });
}

function sincronizarAgora() {
    if (!window._firestore) {
        mostrarToast("Sem conexão com a nuvem.", "aviso", 3000);
        return;
    }
    if (!_cargaOk) {
        mostrarToast("Tentando carregar da nuvem de novo…", "info", 3000);
        carregarDB();
        return;
    }
    if (_pendentesSincronizacao) {
        mostrarToast("Sincronizando…", "info", 2000);
        _falhasSeguidas = 0;
        _executarSave();
    } else {
        mostrarToast("Dados já estão sincronizados.", "sucesso", 2000);
    }
}

/**
 * Aplica, por cima do que veio do servidor, as notas pendentes da cópia
 * local: as que foram salvas, editadas, excluídas ou restauradas neste
 * navegador e não tiveram confirmação.
 *
 * A empresa da nota precisa estar entre as permitidas: reviver lançamento
 * de uma empresa que o usuário deixou de acessar poluiria os relatórios.
 * @returns {number} quantas notas foram reaplicadas
 */
function _reaplicarPendentesDaCopiaLocal() {
    const ids = _pendentesLer();
    if (!ids.length) return 0;
    const local = _lerCopiaLocal();
    if (!local || !Array.isArray(local.lancamentos)) return 0;

    const permitidos = new Set(_empresaIdsPermitidos());
    const pendentes  = new Set(ids);
    let n = 0;
    local.lancamentos.forEach(l => {
        if (!pendentes.has(l.id)) return;
        const id = _empresaIdDoLancamento(l);
        if (!id || !permitidos.has(id)) return;
        const i = db.lancamentos.findIndex(x => x.id === l.id);
        if (i >= 0) {
            if (JSON.stringify(db.lancamentos[i]) === JSON.stringify(l)) return;
            db.lancamentos[i] = l;
        } else {
            db.lancamentos.push(l);
        }
        n++;
    });
    return n;
}

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
 *
 * Qualquer falha de leitura invalida a carga inteira: nada é gravado na
 * nuvem e a carga é tentada de novo, com espera crescente.
 */
async function carregarDB() {
    // Em demo os dados já foram postos em memória por entrarModoDemo().
    if (typeof demoAtivo === 'function' && demoAtivo()) return;
    if (!window._usuarioAtual) return;

    clearTimeout(_timerRecarga);
    if (!_primeiraCargaFeita) _mostrarLoading(true);
    let reaplicadas = 0;
    try {
        if (!window._firestore) throw new Error("Firebase indisponível");

        const compartilhado = await window._firestore.firestoreCarregarDoc(_NOME_COMPARTILHADO);

        if (compartilhado) {
            const perfil = window._usuarioAtual;
            const antesDeCarregar = db;
            db = _mesclarComPadrao(Object.assign({}, compartilhado, { lancamentos: [] }));
            const ids = _empresaIdsPermitidos();
            let docs;
            try {
                docs = await Promise.all(ids.map(id =>
                    window._firestore.firestoreCarregarDoc(_nomeDocLanc(id)).then(d => ({ id, d }))));
            } catch (e) {
                db = antesDeCarregar;
                throw e;
            }
            if (window._usuarioAtual !== perfil) return;   // saiu no meio da carga

            _layoutNovo = true;
            _base = {};
            _base[_NOME_COMPARTILHADO] = _fotografar(_normalizarDocServidor(_NOME_COMPARTILHADO, compartilhado));
            db.lancamentos = [];
            docs.forEach(({ id, d }) => {
                const nome  = _nomeDocLanc(id);
                const lista = _normalizarLancamentosDoDoc((d && d.lancamentos) || [], id);
                _base[nome] = _fotografar({ lancamentos: lista });
                db.lancamentos = db.lancamentos.concat(lista);
            });
            reaplicadas = _reaplicarPendentesDaCopiaLocal();
        } else {
            // ── Layout antigo, ainda não migrado ──
            _layoutNovo = false;
            const dados = await window._firestore.firestoreCarregarDoc(_NOME_LEGADO);
            if (dados) db = _mesclarComPadrao(dados);
            _hashPorDoc = {};
        }

        _cargaOk = true;
        _tentativasRecarga = 0;
        _pendentesSincronizacao = reaplicadas > 0;

        // A cópia local é gravada DEPOIS de reaplicar as pendentes: era a
        // gravação antecipada que apagava a última prova da nota não enviada.
        _gravarCopiaLocal();

        if (reaplicadas) {
            mostrarToast(
                `${reaplicadas} lançamento(s) alterado(s) neste navegador não tinham `
                + `chegado à nuvem. Enviando agora.`, "aviso", 7000);
        }
        _ligarListenerTempoReal();
        if (reaplicadas || _layoutNovo) _executarSave();

    } catch(e) {
        console.error("[carregarDB]", e);
        _cargaOk = false;
        const local = _lerCopiaLocal();
        if (local && !_primeiraCargaFeita) {
            try { db = _mesclarComPadrao(local); } catch(_) {}
        }
        // A base passa a ser o que a cópia local mostrou: só o que for
        // lançado DEPOIS disto fica marcado como pendente.
        _base = {};
        _base[_NOME_COMPARTILHADO] = _fotografar(_payloadDoc(_NOME_COMPARTILHADO));
        const grupos = _agruparLancamentos();
        Object.keys(grupos).forEach(id => {
            _base[_nomeDocLanc(id)] = _fotografar({ lancamentos: grupos[id] });
        });
        _pendentesSincronizacao = true;
        _tentativasRecarga++;
        const espera = Math.min(15000 * Math.pow(2, _tentativasRecarga - 1), 120000);
        if (_tentativasRecarga === 1) {
            mostrarToast(
                "Não consegui carregar os dados da nuvem. Mostrando a cópia deste navegador; "
                + "o que for lançado fica guardado aqui e sobe quando a carga der certo.",
                "aviso", 9000);
        }
        _timerRecarga = setTimeout(() => { if (window._usuarioAtual) carregarDB(); }, espera);
    } finally {
        _mostrarLoading(false);
        _criarIndicadorConexao();
        _setStatusConexao(!window._firestore ? "offline"
            : !_cargaOk ? "pendente"
            : (_pendentesSincronizacao ? "pendente" : "sincronizado"));
        if (!_primeiraCargaFeita) {
            _primeiraCargaFeita = true;
            migrarDados();
            atualizarListas();
            _reconciliarEmpresaAtiva();
            verificarBackupAutomatico();
            setTimeout(() => {
                mostrarTela("dashboard");
                carregarDashboard();
            }, 0);
        } else {
            atualizarListas();
            _reconciliarEmpresaAtiva();
            _rerenderTelaAtual();
        }
    }
}

/* ── LISTENERS DE TEMPO REAL ─────────────────────────────────────────
   Um no documento compartilhado e um em cada documento de lançamentos
   permitido. `_garantirListeners` acrescenta e retira conforme a lista de
   empresas muda — uma empresa criada durante a sessão ganha listener na
   hora, em vez de ficar surda às notas dos colegas até o próximo F5. */
let _tentativasListener = {};
let _timerListener = {};

function _ligarListenerTempoReal() {
    _desligarListeners();
    if (!window._firestore || !window._usuarioAtual) return;

    if (!_layoutNovo) {
        _unsubs[_NOME_LEGADO] = window._firestore.firestoreEscutar(
            dados => _aoReceberDoc(_NOME_LEGADO, dados),
            erro => _aoFalharListener(_NOME_LEGADO, erro));
        return;
    }
    _garantirListeners();
}

function _garantirListeners() {
    if (!window._firestore || !window._usuarioAtual || !_layoutNovo || !_cargaOk) return;
    const desejados = new Set([_NOME_COMPARTILHADO, ..._empresaIdsPermitidos().map(_nomeDocLanc)]);

    Object.keys(_unsubs).forEach(nome => {
        if (!desejados.has(nome)) {
            try { _unsubs[nome](); } catch (_) {}
            delete _unsubs[nome];
        }
    });
    desejados.forEach(nome => {
        if (_unsubs[nome] || _timerListener[nome]) return;
        _unsubs[nome] = window._firestore.firestoreEscutarDoc(
            nome,
            dados => { _tentativasListener[nome] = 0; _aoReceberDoc(nome, dados); },
            erro => _aoFalharListener(nome, erro));
    });

    // Notas de empresa que deixou de ser permitida saem da memória.
    const permitidos = new Set(_empresaIdsPermitidos());
    const antes = db.lancamentos.length;
    db.lancamentos = db.lancamentos.filter(l => {
        const id = _empresaIdDoLancamento(l);
        return !id || permitidos.has(id);
    });
    if (db.lancamentos.length !== antes) _rerenderTelaAtual();
}

function _desligarListeners() {
    Object.values(_unsubs).forEach(fn => { try { fn(); } catch(_) {} });
    _unsubs = {};
    Object.values(_timerListener).forEach(t => clearTimeout(t));
    _timerListener = {};
    _tentativasListener = {};
}

/**
 * Trata a chegada de um snapshot, seja do documento compartilhado, de um
 * documento de lançamentos ou do documento único antigo.
 */
function _aoReceberDoc(nome, dados) {
    if (nome === _NOME_LEGADO) {
        if (_salvandoDB > 0 || !dados) return;
        const h = _hashStr(JSON.stringify(dados));
        if (_hashPorDoc[_NOME_LEGADO] && h === _hashPorDoc[_NOME_LEGADO]) return;
        db = _mesclarComPadrao(dados);
        _rerenderTelaAtual();
        return;
    }
    if (!_cargaOk) return;

    const mudou = _absorverDoc(nome, dados);
    if (nome === _NOME_COMPARTILHADO) {
        // Um colega pode ter renomeado ou inativado a empresa ativa daqui,
        // ou criado uma empresa nova.
        _reconciliarEmpresaAtiva();
        _garantirListeners();
    }
    // Mudança local que o snapshot não trouxe: sobe junto.
    if (_pendentesSincronizacao && _gravacoesEmVoo === 0) {
        clearTimeout(_timerDebounce);
        _timerDebounce = setTimeout(() => _executarSave(), _DEBOUNCE_MS);
    }
    if (mudou) {
        _gravarCopiaLocal();
        _rerenderTelaAtual();
    }
}

/**
 * Falha de um listener.
 *
 * Antes, `permission-denied` religava TODOS os listeners a cada 2 s, para
 * sempre — com o perfil alterado no meio da sessão, eram dezenas de
 * leituras por minuto até a cota do dia. Agora: permissão negada relê o
 * perfil e religa só o que ainda é permitido, com poucas tentativas; cota
 * estourada não religa; queda de rede religa com espera crescente.
 */
async function _aoFalharListener(nome, erro) {
    try { _unsubs[nome]?.(); } catch (_) {}
    delete _unsubs[nome];
    const n = (_tentativasListener[nome] || 0) + 1;
    _tentativasListener[nome] = n;
    console.warn("[listener]", nome, erro?.code || erro);

    if (erro?.code === 'resource-exhausted') {
        _setStatusConexao("erro");
        if (n === 1) mostrarToast("A cota diária da nuvem foi atingida. Os dados podem ficar desatualizados até amanhã.", "erro", 10000);
        return;
    }
    if (erro?.code === 'permission-denied') {
        if (window._usuarioAtual && window._firestore) {
            const perfil = await window._firestore.usuarioBuscar(window._usuarioAtual.uid);
            if (_aplicarPerfilAtualizado(perfil)) return;
        }
        if (n > 3) { _setStatusConexao("erro"); return; }
    }
    const espera = Math.min(2000 * Math.pow(2, n - 1), 300000);
    clearTimeout(_timerListener[nome]);
    _timerListener[nome] = setTimeout(() => {
        delete _timerListener[nome];
        _garantirListeners();
    }, espera);
}

function _rerenderTelaAtual() {
    const telaAtual = document.querySelector(".tela[style*='block']");
    if (!telaAtual) return;
    const id = telaAtual.id;
    if (id === "dashboard")  carregarDashboard();
    if (id === "relatorios") { if (typeof recarregarRelatorioSemZerarFiltros === 'function') recarregarRelatorioSemZerarFiltros(); else carregarRelatorio(); }
    if (id === "analitico")  { if (typeof carregarAnalitico === 'function') carregarAnalitico(); }
    if (id === "fretes")     carregarFretes();
    if (id === "lancamentos" && typeof _sessaoRenderizar === 'function') _sessaoRenderizar();
    if (id === "sistema" && typeof atualizarInfoSistema === 'function') atualizarInfoSistema();
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
    // documento compartilhado, e enquanto ele faltava nesta lista a carga
    // devolvia a lista padrão: toda edição de conjunto era revertida em
    // silêncio (e, quando ainda havia conjuntos semeados no código, os ids
    // mudavam e quebravam o histórico de vigência).
    ['motoristas','veiculos','empresas','combustiveis','lancamentos','bases',
     'conjuntosVeiculos'].forEach(campo => {
        if (Array.isArray(dados[campo])) resultado[campo] = dados[campo];
    });

    if (dados.configRelatorio && typeof dados.configRelatorio === 'object') {
        resultado.configRelatorio = Object.assign({}, DB_PADRAO.configRelatorio, dados.configRelatorio);
    }

    // Vazio até alguém salvar a configuração; `configAlertas()` completa com
    // os padrões na leitura. Depois do primeiro "Salvar", a configuração
    // inteira fica gravada — mudar um padrão no código só vale para quem
    // nunca salvou.
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

/* Os backups automáticos são POR USUÁRIO. Antes eram uma lista só no
   navegador, com o banco de quem estava logado: o operador que entrava
   depois do supremo no mesmo computador podia restaurar o backup dele e
   passar a ver as notas de todas as empresas. */
function _prefixoBackupAuto() {
    const uid = window._usuarioAtual?.uid;
    return uid ? `backupAuto_${uid}_` : null;
}

function verificarBackupAutomatico() {
    const uid = window._usuarioAtual?.uid;
    if (!uid) return;
    const ultimo = localStorage.getItem("backupAutoData_" + uid);
    const dias = ultimo ? (Date.now() - parseInt(ultimo)) / 86400000 : Infinity;
    if (dias >= BACKUP_AUTO_INTERVALO_DIAS) fazerBackupAutomatico();
}

/**
 * Grava a cópia periódica do banco no `localStorage`.
 *
 * A falha aqui não pode ser silenciosa. O caminho que ela toma na prática
 * é a quota do navegador: são quatro cópias do banco vivendo lá dentro
 * (a cópia local a cada salvamento, mais até três backups automáticos), e
 * a ~440 bytes por lançamento os ~5 MB acabam em torno de três mil notas
 * somando todas as empresas.
 *
 * A tentativa de liberar espaço apagando a cópia mais antiga vem antes do
 * aviso: na maior parte das vezes ela resolve.
 */
function fazerBackupAutomatico() {
    const prefixo = _prefixoBackupAuto();
    if (!prefixo) return;
    const uid   = window._usuarioAtual.uid;
    const chave = prefixo + _hojeISO();
    const dados = JSON.stringify(db);

    // Backups do formato antigo, sem dono, só ocupavam espaço.
    Object.keys(localStorage)
        .filter(k => /^backupAuto_\d{4}-\d{2}-\d{2}$/.test(k))
        .forEach(k => localStorage.removeItem(k));

    const gravar = () => {
        const chaves = Object.keys(localStorage).filter(k => k.startsWith(prefixo)).sort();
        while (chaves.length >= BACKUP_AUTO_MAX) localStorage.removeItem(chaves.shift());
        localStorage.setItem(chave, dados);
        localStorage.setItem("backupAutoData_" + uid, Date.now().toString());
    };

    try {
        gravar();
        return;
    } catch (e) {
        console.warn("[Backup automático] Primeira tentativa falhou:", e.message);
    }

    try {
        const antigas = Object.keys(localStorage).filter(k => k.startsWith(prefixo)).sort();
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
    const prefixo = _prefixoBackupAuto();
    if (!prefixo) return [];
    return Object.keys(localStorage)
        .filter(k => k.startsWith(prefixo)).sort().reverse()
        .map(chave => ({ chave, data: chave.slice(prefixo.length), tamanhoKB: (localStorage.getItem(chave).length/1024).toFixed(1) }));
}

/* ── RESTAURAR UM BACKUP ─────────────────────────────────────────────
   Antes a restauração trocava o `db` inteiro pelo arquivo. Três defeitos
   vinham disso: um backup que só tinha as notas de algumas empresas
   gravava as outras vazias; os cadastros criados depois do backup sumiam;
   e o listener religado antes da gravação desfazia a restauração, com a
   tela dizendo que tinha dado certo.

   Agora: os lançamentos são substituídos só nas empresas que o arquivo
   cobre (e que este usuário acessa); os cadastros do arquivo entram por
   cima dos atuais, sem apagar os que só existem hoje; e a mensagem de
   sucesso só aparece depois de a nuvem confirmar. */

/** Id, no cadastro atual, da empresa de uma nota do arquivo. */
function _idEmpresaNoBackup(dados, l) {
    const nome = (dados.empresas || []).find(e => e.id === l.empresaId)?.nome || l.empresa;
    const porId = l.empresaId && (db.empresas || []).some(e => e.id === l.empresaId) ? l.empresaId : null;
    const noArquivo = (dados.empresas || []).find(e => e.nome === l.empresa)?.id;
    return porId || noArquivo || (db.empresas || []).find(e => e.nome === nome)?.id || null;
}

/** Texto do que a restauração vai fazer, empresa por empresa. */
function _resumoRestauracao(dados) {
    const permitidos = new Set(_empresaIdsPermitidos());
    const noArquivo = {};
    let fora = 0;
    (dados.lancamentos || []).forEach(l => {
        const id = _idEmpresaNoBackup(dados, l);
        if (!id || !permitidos.has(id)) { fora++; return; }
        noArquivo[id] = (noArquivo[id] || 0) + 1;
    });
    const hoje = {};
    db.lancamentos.forEach(l => { const id = _empresaIdDoLancamento(l); if (id) hoje[id] = (hoje[id] || 0) + 1; });

    const nomeDe = id => (db.empresas || []).find(e => e.id === id)?.nome
        || (dados.empresas || []).find(e => e.id === id)?.nome || id;
    const linhas = Object.keys(noArquivo).map(id =>
        `• ${nomeDe(id)}: hoje ${hoje[id] || 0} → depois ${noArquivo[id]} lançamento(s)`);
    const intocadas = [...permitidos].filter(id => !noArquivo[id] && hoje[id])
        .map(id => `• ${nomeDe(id)}: fica como está (${hoje[id]} lançamento(s)) — o arquivo não tem notas dela`);
    return [
        linhas.length ? linhas.join("\n") : "O arquivo não tem lançamentos de empresas que você acessa.",
        intocadas.length ? "\n" + intocadas.join("\n") : "",
        fora ? `\n${fora} lançamento(s) do arquivo são de empresas fora do cadastro ou do seu acesso e ficam de fora.` : "",
        "\nOs cadastros do arquivo entram por cima dos atuais; os que só existem hoje continuam."
    ].join("\n");
}

function _aplicarBackupNaMemoria(dados) {
    _LISTAS_COMPARTILHADO.forEach(campo => {
        const doBackup = Array.isArray(dados[campo]) ? dados[campo] : [];
        const chaves   = new Set(doBackup.map(_chaveItem));
        db[campo] = doBackup.concat((db[campo] || []).filter(i => !chaves.has(_chaveItem(i))));
    });
    if (dados.configRelatorio && typeof dados.configRelatorio === 'object') db.configRelatorio = dados.configRelatorio;
    if (dados.configAlertas && typeof dados.configAlertas === 'object')     db.configAlertas   = dados.configAlertas;

    const permitidos = new Set(_empresaIdsPermitidos());
    const cobertas = new Set();
    const notas = [];
    (dados.lancamentos || []).forEach(l => {
        const id = _idEmpresaNoBackup(dados, l);
        if (!id || !permitidos.has(id)) return;
        cobertas.add(id);
        const nome = (db.empresas || []).find(e => e.id === id)?.nome;
        notas.push(Object.assign({}, l, { empresaId: id }, nome ? { empresa: nome } : {}));
    });
    db.lancamentos = db.lancamentos
        .filter(l => !cobertas.has(_empresaIdDoLancamento(l)))
        .concat(notas);
}

/** Grava já e diz a verdade sobre o resultado. */
async function _salvarEConfirmar(rotulo) {
    if (typeof demoAtivo === 'function' && demoAtivo()) {
        salvarDB();
        mostrarToast(`${rotulo}.`, "sucesso", 5000);
        return true;
    }
    await salvarDB({ imediato: true });
    if (_cargaOk && !_pendentesSincronizacao) {
        mostrarToast(`${rotulo} e gravado na nuvem.`, "sucesso", 5000);
        return true;
    }
    mostrarToast(`${rotulo} neste navegador, mas a nuvem ainda não confirmou. `
        + `Não feche a aba até a pílula de sincronização sumir.`, "aviso", 10000);
    return false;
}

async function restaurarBackupAutomatico(chave) {
    if (!exigirPapel("supremo", "Restaurar backup")) return;
    const prefixo = _prefixoBackupAuto();
    if (!prefixo || !String(chave).startsWith(prefixo)) return mostrarToast("Backup não encontrado.", "erro", 4000);
    const bruto = localStorage.getItem(chave);
    if (!bruto) return mostrarToast("Backup não encontrado.", "erro", 4000);
    let dados;
    try { dados = JSON.parse(bruto); } catch (e) { return mostrarToast("Backup corrompido: " + e.message, "erro", 5000); }
    if (!await fmConfirm({
        titulo: "Restaurar backup?",
        msg: `Data: ${chave.slice(prefixo.length)}\n\n${_resumoRestauracao(dados)}`,
        confirmTxt: "Restaurar", cancelTxt: "Cancelar", tipo: "perigo" })) return;
    try {
        _aplicarBackupNaMemoria(_mesclarComPadrao(dados));
        migrarDados();
        atualizarListas();
        _reconciliarEmpresaAtiva();
        atualizarInfoSistema();
        _rerenderTelaAtual();
        await _salvarEConfirmar("Backup restaurado");
    } catch(e) { mostrarToast("Erro ao restaurar: " + e.message, "erro", 5000); }
}


/* ── ERRO QUE DEIXA RASTRO ──────────────────────────────────────────
   Até 17/09/2026 um erro de JavaScript na máquina do operador só existia
   no console dele: 16 `console.error` que ninguém abre. O defeito do
   Analítico (período sem nota antes de um com nota) viveu meses assim.

   Agora toda falha não tratada fica gravada no próprio navegador, com
   tela, usuário e hora, e aparece em Sistema › Informações do Sistema.
   Sem servidor, sem serviço pago, sem sair da máquina: é o operador que
   lê o texto no telefone quando pergunto "o que apareceu aí?".

   Nada aqui pode lançar erro por sua vez — daí o try/catch em volta de
   tudo e o limite de 20 registros. */
const _ERROS_CHAVE = "fm_erros";
const _ERROS_MAX   = 20;
let _erroAvisado   = false;

function errosRegistrados() {
    try { return JSON.parse(localStorage.getItem(_ERROS_CHAVE) || "[]"); }
    catch (_) { return []; }
}

function errosLimpar() {
    try { localStorage.removeItem(_ERROS_CHAVE); } catch (_) {}
    if (typeof atualizarInfoSistema === "function") atualizarInfoSistema();
    mostrarToast("Registro de erros apagado.", "sucesso", 2500);
}

function _registrarErro(tipo, msg, detalhe) {
    try {
        const lista = errosRegistrados();
        lista.unshift({
            ts: new Date().toISOString(),
            tipo,
            msg: String(msg || "").slice(0, 300),
            detalhe: String(detalhe || "").slice(0, 600),
            tela: document.querySelector(".tela[style*='block']")?.id || "—",
            usuario: window._usuarioAtual?.nome || window._usuarioAtual?.email || "—",
            demo: typeof demoAtivo === "function" && demoAtivo()
        });
        localStorage.setItem(_ERROS_CHAVE, JSON.stringify(lista.slice(0, _ERROS_MAX)));
        if (typeof atualizarInfoSistema === "function") atualizarInfoSistema();
        // Um aviso por sessão: o operador precisa saber que algo falhou,
        // mas um toast por erro em laço deixaria a tela inutilizável.
        if (!_erroAvisado) {
            _erroAvisado = true;
            mostrarToast("Algo falhou nesta tela e ficou registrado em Sistema › Informações do Sistema. "
                       + "Se um número parecer errado, recarregue a página (F5).", "erro", 9000);
        }
    } catch (_) { /* localStorage cheio ou bloqueado: não há o que fazer aqui */ }
}

window.addEventListener("error", e => {
    const onde = e.filename ? `${e.filename.split("/").pop()}:${e.lineno}:${e.colno}` : "";
    _registrarErro("erro", e.message, [onde, e.error && e.error.stack].filter(Boolean).join("\n"));
});

window.addEventListener("unhandledrejection", e => {
    const r = e.reason;
    _registrarErro("promessa", (r && (r.message || r.code)) || String(r), r && r.stack);
});

// filtroRapido — função canônica em relatorios.js
// (removida daqui para evitar duplicata e conflito de versões)
