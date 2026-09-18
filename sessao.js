/*=================================================
  SESSAO.JS — Fuel Mind
  Login com Firebase Auth + empresa obrigatória
  Empresa sempre filtrada — sem opção "Todas"
  Perfil escutado durante a sessão, papéis e permissões, empresa ativa e
  troca de empresa.

  Parte do antigo app.js, quebrado em 18/09/2026 (programa 6.5). Os
  arquivos que eram o app.js dividem o mesmo escopo global e carregam
  nesta ordem (index.html): erros, sessao, dados, sincronizacao, tema,
  navegacao, backup. Nada aqui roda na carga além de registrar escutas;
  tudo o que é chamado de outro arquivo é chamado depois de todos
  carregados.
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

/** O olho no campo de senha: mostra e esconde o que foi digitado. */
function alternarVerSenhaLogin(btn) {
    const input = document.getElementById("loginSenha");
    if (!input) return;
    const mostrar = input.type === "password";
    input.type = mostrar ? "text" : "password";
    btn.classList.toggle("ativo", mostrar);
    const rotulo = mostrar ? "Esconder senha" : "Mostrar senha";
    btn.setAttribute("aria-label", rotulo);
    btn.title = rotulo;
    input.focus();
}

document.addEventListener("keydown", e => {
    if (e.key === "Enter") {
        const loginOverlay = document.getElementById("loginOverlay");
        // Enter num botão do login (modo demo, esqueci a senha, olho) já
        // aciona o próprio botão; não dispara o login junto.
        if (loginOverlay?.style.display === "flex" && !e.target?.closest?.("button")) fazerLogin();
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
                ? ' <small class="empresa-ultima">· última usada</small>' : ''}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icone-seta"><polyline points="9,18 15,12 9,6"/></svg>
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
            <span>${escapeHtml(emp)}${emp === empresaFiltroNome ? ' <small class="empresa-ultima">· atual</small>' : ''}</span>
            ${emp === empresaFiltroNome
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="icone-check"><polyline points="20,6 9,17 4,12"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icone-seta"><polyline points="9,18 15,12 9,6"/></svg>'}
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
