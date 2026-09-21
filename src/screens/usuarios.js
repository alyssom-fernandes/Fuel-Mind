/*=================================================
  USUARIOS.JS: Gerenciamento de Usuários e Permissões
  A lista e a gestão são de supremo e admin (o admin, só das empresas
  dele). O operador vê aqui apenas o próprio perfil e a troca de senha.
=================================================*/

/* ─── ESTADO ─── */
let _usuariosCache = [];

/**
 * Senha temporária sorteada para um usuário novo.
 *
 * O campo vinha pré-preenchido com o literal `123456`, e a troca era
 * voluntária, então toda conta criada nascia com a mesma senha conhecida,
 * e continuava com ela até alguém se lembrar de mudar. Sortear não resolve
 * o problema inteiro (a troca continua voluntária, e isso é assunto de uma
 * rodada própria), mas acaba com a senha única e previsível.
 *
 * Sem `l`, `I`, `O`, `0` e `1`: a senha vai ser lida em voz alta ou copiada
 * à mão, e esses cinco são os que se confundem.
 */
function _senhaTemporaria() {
    const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const bytes = new Uint32Array(10);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => alfabeto[b % alfabeto.length]).join("");
}

/* ─── ROLES ─── */
/* O papel operacional é gravado como 'usuario' (nome interno, que as regras
   do servidor e os perfis existentes usam) e se chama "Operador" na tela:
   admin e supremo também são usuários. */
const ROLES = {
    supremo: { label: "Supremo",  desc: "Acesso total a todas as empresas, usuários e configurações" },
    admin:   { label: "Admin",    desc: "Empresas permitidas; gerencia os usuários delas e as configurações" },
    usuario: { label: "Operador", desc: "Lança e consulta nas empresas permitidas" },
};

function _rotuloPapel(role) {
    return ROLES[role]?.label || String(role || "—");
}

/** Na demonstração não existe conta de verdade: nada é criado nem alterado. */
function _bloqueioDemoUsuarios() {
    if (typeof demoAtivo === 'function' && demoAtivo()) {
        mostrarToast("No modo demonstração a tela de usuários só mostra: nenhuma conta é criada ou alterada.", "info", 6000);
        return true;
    }
    return false;
}

/**
 * Converte nomes de empresa nos ids correspondentes.
 *
 * O perfil guarda os dois: `empresas` com nomes, que é o que a interface
 * exibe e o que os filtros comparam, e `empresaIds` com os ids, que é o
 * que as regras de segurança usam para liberar `dados/lanc__{id}`.
 *
 * Manter os dois evita reescrever os 33 pontos que comparam empresa por
 * nome, e evita que renomear uma empresa invalide permissões.
 */
function _idsDasEmpresas(nomes) {
    return (nomes || [])
        .map(nome => db.empresas.find(e => e.nome === nome)?.id)
        .filter(Boolean);
}

/** Nomes atuais das empresas de um perfil, pelos ids (renomear não tira acesso). */
function _nomesDasEmpresasDoPerfil(u) {
    return _idsDoPerfil(u).map(id => db.empresas.find(e => e.id === id)?.nome).filter(Boolean);
}

/**
 * Mantém o índice público `usernames/{username}` em sincronia com o perfil.
 * Remove a entrada antiga quando o username muda ou é apagado, para não
 * deixar apontamento órfão permitindo login por um @ que não existe mais.
 */
async function _sincronizarIndiceUsername(usernameAntigo, usernameNovo, email, uid) {
    const antigo = usernameAntigo || null;
    const novo   = usernameNovo   || null;
    if (antigo === novo) return;
    if (antigo) await window._firestore.usernameMapaRemover(antigo);
    if (novo)   await window._firestore.usernameMapaDefinir(novo, email, uid);
}

/* ─── VERIFICAÇÃO DE PERMISSÃO ─── */
function podeGerenciarUsuarios() {
    return window._usuarioAtual?.role === "supremo" || window._usuarioAtual?.role === "admin";
}

function podeAlterarRoles() {
    return window._usuarioAtual?.role === "supremo";
}

/**
 * Empresas que o usuário logado pode gerenciar na tela de Usuários.
 * Supremo enxerga todas as empresas ativas; admin só as suas próprias
 * (evita que um admin veja/gerencie usuários ou conceda acesso a
 * empresas fora do seu escopo).
 */
function _empresasGerenciaveis() {
    const perfil = window._usuarioAtual;
    if (!perfil) return [];
    const ativas = db.empresas.filter(e => e.ativo !== false);
    if (perfil.role === "supremo") return ativas.map(e => e.nome);
    const meus = _idsDoPerfil(perfil);
    return ativas.filter(e => meus.includes(e.id)).map(e => e.nome);
}

/**
 * Regrava o índice público `usernames/{username}` para todos os usuários
 * que já têm username cadastrado.
 *
 * Necessária uma única vez, na virada para o índice: antes dela o login
 * por @usuario dependia de a coleção `usuarios` ser legível sem
 * autenticação. Idempotente: pode ser rodada quantas vezes for preciso.
 */
async function migrarIndiceUsernames() {
    if (window._usuarioAtual?.role !== "supremo") {
        return mostrarToast("Apenas o usuário supremo pode reconstruir o índice.", "aviso");
    }
    const comUsername = _usuariosCache.filter(u => u.username && u.email);
    if (comUsername.length === 0) return mostrarToast("Nenhum usuário com @ cadastrado.", "info");

    if (!await fmConfirm({
        titulo: "Reconstruir índice de @usuarios?",
        msg: `${comUsername.length} usuário(s) serão regravados no índice público de login.

O índice guarda apenas o e-mail associado a cada @, e é o que permite entrar sem digitar o e-mail completo.`,
        confirmTxt: "Reconstruir",
        tipo: "info"
    })) return;

    let ok = 0, falhas = 0, conflitos = 0;
    for (const u of comUsername) {
        try {
            // Um @ que no índice já aponta para OUTRA conta não é regravado:
            // o perfil pode ter sido alterado à mão, e regravar entregaria o @
            // de uma pessoa para a conta de outra.
            const atual = await window._firestore.usuarioBuscarPorUsername(u.username);
            if (atual && atual.uid && atual.uid !== u.uid) { conflitos++; continue; }
            await window._firestore.usernameMapaDefinir(u.username, u.email, u.uid);
            ok++;
        } catch (e) {
            falhas++;
            console.error("[Usernames] Falha em @" + u.username + ":", e);
        }
    }
    mostrarToast(
        (falhas === 0 && conflitos === 0)
            ? `Índice reconstruído: ${ok} usuário(s).`
            : `Índice reconstruído: ${ok} ok, ${falhas} falha(s), ${conflitos} @ que já pertencem a outra conta e ficaram como estavam.`,
        (falhas === 0 && conflitos === 0) ? "sucesso" : "aviso",
        8000
    );
}

/* ─── CARREGAR TELA ─── */
async function carregarUsuarios() {
    const container = document.getElementById("usuariosConteudo");
    if (!container) return;

    // Aguarda até 3s pelo _usuarioAtual caso ainda não tenha carregado
    if (!window._usuarioAtual) {
        let tentativas = 0;
        await new Promise(resolve => {
            const intervalo = setInterval(() => {
                tentativas++;
                if (window._usuarioAtual || tentativas > 30) {
                    clearInterval(intervalo);
                    resolve();
                }
            }, 100);
        });
    }

    if (!podeGerenciarUsuarios()) {
        // O operador não gerencia ninguém, mas precisa trocar a própria
        // senha, a senha temporária manda fazer isso aqui.
        const u = window._usuarioAtual || {};
        container.innerHTML =
            `<div class="card card--perfil">
                <h3 class="mt-0 mb-2">Meu perfil</h3>
                <p class="mb-1"><strong>${escapeHtml(u.nome || '')}</strong></p>
                <p class="dica mb-1">${escapeHtml(u.email || '')}${u.username ? ` · @${escapeHtml(u.username)}` : ''}</p>
                <p class="dica mb-4">Nível: ${escapeHtml(_rotuloPapel(u.role))} · Empresas: ${escapeHtml(_nomesDasEmpresasDoPerfil(u).join(', ') || '—')}</p>
                <div class="linha-acoes linha-acoes--apertada">
                    <button class="btn-editar" onclick="abrirModalEditarProprioPerfil()">Editar perfil</button>
                    <button class="btn-secundario" onclick="abrirModalAlterarSenha()">Alterar senha</button>
                </div>
                <p class="dica mt-4">A lista de usuários é de administradores.</p>
             </div>`;
        return;
    }
    await _recarregarListaUsuarios();
}

async function _recarregarListaUsuarios() {
    const container = document.getElementById("usuariosConteudo");
    if (!container) return;
    container.innerHTML = `<p class="dica">Carregando usuários...</p>`;

    try {
        const emDemo = typeof demoAtivo === 'function' && demoAtivo();
        if (!emDemo && !window._firestore?.usuariosListar) {
            throw new Error("Firebase não inicializado ainda.");
        }
        // Em demonstração a lista vem dos perfis fictícios: não há sessão
        // autenticada, e chamar o Firestore aqui só produz permission-denied.
        const todos = (typeof demoAtivo === 'function' && demoAtivo())
            ? JSON.parse(JSON.stringify(DEMO_USUARIOS))
            : await window._firestore.usuariosListar();
        if (window._usuarioAtual?.role === "supremo") {
            _usuariosCache = todos;
        } else {
            // Admin só enxerga a si mesmo e usuários que compartilhem ao menos
            // uma empresa com ele, pelos ids, que não mudam num rename.
            const minhas = _idsDoPerfil(window._usuarioAtual);
            _usuariosCache = todos.filter(u =>
                u.uid === window._usuarioAtual?.uid ||
                _idsDoPerfil(u).some(id => minhas.includes(id))
            );
        }
        _renderUsuarios();
    } catch (e) {
        console.error("[Usuarios] Erro:", e);
        container.innerHTML = `
            <div class="caixa-erro-carga">
                <p class="texto-perigo mb-2">Erro ao carregar usuários:</p>
                <code class="codigo-pequeno rotulo-suave">${escapeHtml(e.message)}</code>
                <br><br>
                <button class="btn-secundario" onclick="_recarregarListaUsuarios()">Tentar novamente</button>
            </div>`;
    }
}

const _ICONE_USUARIO = {
    editar:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    senha:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m16 7 3 3"/><path d="m19 4 2 2"/></svg>',
    inativar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
    reativar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    excluir:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
};

function _renderUsuarios() {
    const container = document.getElementById("usuariosConteudo");
    if (!container) return;

    const supremoAtual = window._usuarioAtual?.role === "supremo";

    const linhas = _usuariosCache.map(u => {
        const isSelf     = u.uid === window._usuarioAtual?.uid;
        const nomesEmp   = _nomesDasEmpresasDoPerfil(u);
        const empresasStr = u.role === "supremo"
            ? "<em class='rotulo-suave'>Todas</em>"
            : (nomesEmp.length
                ? nomesEmp.map(e => `<span class="badge-empresa-tag">${escapeHtml(e)}</span>`).join(" ")
                : "<em class='rotulo-suave'>Nenhuma</em>");

        const ultimoAcesso = u.ultimoAcesso
            ? new Date(u.ultimoAcesso).toLocaleString("pt-BR")
            : "Nunca";

        // O papel vem do banco: escapado, e a classe só com papel conhecido.
        const classePapel = ROLES[u.role] ? u.role : "desconhecido";
        const badges = `<span class="badge-role badge-role-${classePapel}">${escapeHtml(_rotuloPapel(u.role))}</span>
                        ${u.ativo === false ? '<span class="badge-inativo-user">Inativo</span>' : ''}
                        ${isSelf ? '<span class="badge-voce">Você</span>' : ''}`;

        // ── Ações: usuário próprio pode editar perfil (nome + senha) ──
        // Admin não pode editar, inativar ou excluir usuários supremo
        const editorRole   = window._usuarioAtual?.role;
        const alvoBloqueado = u.role === "supremo" && editorRole === "admin";

        // Ações em ícones, lado a lado, o mesmo desenho do Relatório e de
        // Cadastros (18/09/2026). O nome da ação fica no `title`.
        const uidJs = escapeJsAttr(u.uid);
        const nomeAttr = escapeHtml(u.nome || u.email || "");
        const acoes = isSelf
            ? `<button class="btn-icone btn-icone--editar" title="Editar meu perfil" aria-label="Editar meu perfil" onclick="abrirModalEditarProprioPerfil()">${_ICONE_USUARIO.editar}</button>
               <button class="btn-icone" title="Alterar minha senha" aria-label="Alterar minha senha" onclick="abrirModalAlterarSenha()">${_ICONE_USUARIO.senha}</button>`
            : alvoBloqueado
            ? `<span class="celula-fraca celula-fraca--italico">Sem permissão</span>`
            : `<button class="btn-icone btn-icone--editar" title="Editar" aria-label="Editar ${nomeAttr}" onclick="abrirModalEditarUsuario('${uidJs}')">${_ICONE_USUARIO.editar}</button>
               ${u.ativo !== false
                   ? `<button class="btn-icone btn-icone--inativar" title="Inativar: a pessoa não entra mais" aria-label="Inativar ${nomeAttr}" onclick="toggleAtivoUsuario('${uidJs}')">${_ICONE_USUARIO.inativar}</button>`
                   : `<button class="btn-icone btn-icone--editar" title="Reativar" aria-label="Reativar ${nomeAttr}" onclick="toggleAtivoUsuario('${uidJs}')">${_ICONE_USUARIO.reativar}</button>`
               }
               ${supremoAtual && u.role !== "supremo"
                   ? `<button class="btn-icone btn-icone--excluir" title="Excluir" aria-label="Excluir ${nomeAttr}" onclick="excluirUsuario('${uidJs}')">${_ICONE_USUARIO.excluir}</button>`
                   : ""}`;

        return `<tr class="${u.ativo === false ? 'linha-inativo' : ''}">
            <td><strong>${escapeHtml(u.nome)}</strong><br><small class="rotulo-suave">${escapeHtml(u.email)}</small>${u.username ? `<br><small class="usuario-arroba">@${escapeHtml(u.username)}</small>` : ''}</td>
            <td>${badges}</td>
            <td>${empresasStr}</td>
            <td class="celula-fraca">${escapeHtml(ultimoAcesso)}</td>
            <td class="no-print celula-acoes"><div class="acoes-celula acoes-celula--icones">${acoes}</div></td>
        </tr>`;
    }).join("");

    /* O botão de reconstruir o índice de @usuarios saiu daqui em 21/09/2026:
       é conserto raro e estava competindo com a ação do dia a dia. Agora vive
       em Sistema > Configurações, junto das outras manutenções. */
    container.innerHTML = `
        <div class="usuarios-topo">
            <button class="btn-primario" onclick="abrirModalNovoUsuario()">+ Novo usuário</button>
        </div>
        <div class="tabela-container">
            <table>
                <thead><tr>
                    <th>Nome / E-mail</th>
                    <th>Nível</th>
                    <th>Empresas com acesso</th>
                    <th>Último acesso</th>
                    <th class="no-print"><span class="sr-only">Ações</span></th>
                </tr></thead>
                <tbody>${linhas || '<tr><td colspan="5" class="td-vazio">Nenhum usuário cadastrado.</td></tr>'}</tbody>
            </table>
        </div>`;
}

/* ─── MODAL EDITAR PRÓPRIO PERFIL (nome) ─── */
function abrirModalEditarProprioPerfil() {
    const u = window._usuarioAtual;
    if (!u) return;

    const overlay = document.getElementById("usuarioModalOverlay");
    overlay.innerHTML = `
    <div class="modal modal--medio">
        <div class="modal-cabecalho"><h3>Editar meu perfil</h3><button class="modal-fechar" onclick="fecharUsuarioModal()" aria-label="Fechar" title="Fechar">✕</button></div>
        <div class="modal-corpo modal-corpo--pilha">
            <div class="campo">
                <label for="perfilNomeInput">Nome completo *</label>
                <input type="text" id="perfilNomeInput" value="${escapeHtml(u.nome || '')}" placeholder="Seu nome completo">
            </div>
            <div class="campo">
                <label for="perfilUsernameInput">Usuário <span class="rotulo-nota">(opcional)</span></label>
                <div class="campo-arroba">
                    <span class="campo-arroba-sinal">@</span>
                    <input type="text" id="perfilUsernameInput" value="${escapeHtml(u.username || '')}"
                        placeholder="seunome"
                        oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9._-]/g,'')">
                </div>
                <p class="dica mt-1">Para entrar sem o e-mail. Letras minúsculas, números, ponto, traço e sublinhado.</p>
            </div>
            <div class="campo">
                <label for="perfilEmailInput">E-mail</label>
                <input type="text" id="perfilEmailInput" value="${escapeHtml(u.email || '')}" disabled>
                <p class="dica mt-1">O e-mail não pode ser alterado.</p>
            </div>
        </div>
        <div class="modal-acoes">
            <button class="btn-primario" onclick="confirmarEditarProprioPerfil()">Salvar</button>
            <button class="btn-cancelar" onclick="fecharUsuarioModal()">Cancelar</button>
        </div>
    </div>`;
    overlay.style.display = "flex";
    document.getElementById("perfilNomeInput")?.focus();
}

async function confirmarEditarProprioPerfil() {
    if (_bloqueioDemoUsuarios()) return;
    const nome     = document.getElementById("perfilNomeInput")?.value.trim();
    const username = document.getElementById("perfilUsernameInput")?.value.trim().toLowerCase();

    if (!nome) return mostrarToast("Informe seu nome.", "aviso");

    if (username && username.length < 3)
        return mostrarToast("O usuário deve ter ao menos 3 caracteres.", "aviso");

    const btn = document.querySelector("#usuarioModalOverlay .btn-primario");
    if (btn) mostrarSpinner(btn, "Salvar");

    try {
        // Verifica unicidade do username (ignora o próprio usuário)
        if (username) {
            const disponivel = await window._firestore.usuarioUsernameDisponivel(username, window._usuarioAtual.uid);
            if (!disponivel) {
                if (btn) esconderSpinner(btn);
                return mostrarToast("Este usuário já está em uso. Escolha outro.", "aviso", 5000);
            }
        }

        const dados = { nome };
        if (username) dados.username = username;
        else dados.username = null; // limpa se vazio

        const usernameAntigo = window._usuarioAtual.username || null;
        await window._firestore.usuarioSalvar(window._usuarioAtual.uid, dados);
        await _sincronizarIndiceUsername(usernameAntigo, username, window._usuarioAtual.email, window._usuarioAtual.uid);
        window._usuarioAtual.nome = nome;
        window._usuarioAtual.username = username || null;
        fecharUsuarioModal();
        mostrarToast("Perfil atualizado com sucesso!", "sucesso");
        await _recarregarListaUsuarios();
        const badgeNome = document.getElementById("headerNomeUsuario");
        if (badgeNome) badgeNome.textContent = nome;
    } catch (e) {
        if (btn) esconderSpinner(btn);
        mostrarToast("Erro ao salvar: " + e.message, "erro", 6000);
    }
}

/* ─── MODAL NOVO USUÁRIO ─── */
function abrirModalNovoUsuario() {
    _abrirModalUsuario(null, _empresasGerenciaveis());
}

function abrirModalEditarUsuario(uid) {
    const u = _usuariosCache.find(u => u.uid === uid);
    if (!u) return;
    // Empresas inativas que o usuário já tem aparecem marcadas: antes elas
    // não apareciam, e salvar qualquer coisa tirava o acesso a elas.
    const gerenciaveis = _empresasGerenciaveis();
    const inativasDele = _idsDoPerfil(u)
        .map(id => db.empresas.find(e => e.id === id))
        .filter(e => e && e.ativo === false && (window._usuarioAtual?.role === "supremo"
            || _idsDoPerfil(window._usuarioAtual).includes(e.id)))
        .map(e => e.nome);
    _abrirModalUsuario(u, gerenciaveis.concat(inativasDele.filter(n => !gerenciaveis.includes(n))));
}

function _abrirModalUsuario(usuario, todasEmpresas) {
    const isNovo     = !usuario;
    const supremoAtual = window._usuarioAtual?.role === "supremo";

    // Do menor para o maior acesso, e um usuário NOVO começa como Operador.
    // Antes a lista abria em Supremo (o primeiro da tabela): bastava não
    // mexer no campo para criar alguém com acesso total (18/09/2026).
    const papelMarcado = usuario?.role || "usuario";
    const rolesOpts = ["usuario", "admin", "supremo"]
        .filter(r => ROLES[r] && (supremoAtual || r !== "supremo"))
        .map(r =>
            `<option value="${r}" ${papelMarcado === r ? "selected" : ""}>${ROLES[r].label}: ${ROLES[r].desc}</option>`
        ).join("");

    const nomesDoAlvo = usuario ? _nomesDasEmpresasDoPerfil(usuario) : [];
    const empresasCheck = todasEmpresas.map(emp => {
        const marcada = nomesDoAlvo.includes(emp);
        const inativa = db.empresas.find(e => e.nome === emp)?.ativo === false;
        // Marcada ou não é só a classe; a cor é do CSS (18/09/2026).
        return `<button type="button"
            class="btn-empresa-toggle${marcada ? ' selecionada' : ''}"
            data-empresa="${escapeHtml(emp)}" aria-pressed="${marcada}"
            onclick="_toggleEmpresaBtn(this)">
            <span class="emp-toggle-dot"></span>
            ${escapeHtml(emp)}${inativa ? ' <small class="texto-fraco">(inativa)</small>' : ''}
        </button>`;
    }).join("");

    const overlay = document.getElementById("usuarioModalOverlay");
    overlay.innerHTML = `
    <div class="modal modal--largo-640">
        <div class="modal-cabecalho">
            <h3>${isNovo ? "Novo usuário" : "Editar usuário"}</h3>
            <button class="modal-fechar" onclick="fecharUsuarioModal()" aria-label="Fechar" title="Fechar">✕</button>
        </div>
        <div class="modal-corpo modal-corpo--pilha">
            <div class="grade-2 grade-2--apertada">
            <div class="campo">
                <label for="usuarioNomeInput">Nome completo *</label>
                <input type="text" id="usuarioNomeInput" value="${escapeHtml(usuario?.nome || '')}" placeholder="Ex: João Silva">
            </div>
            <div class="campo">
                <label for="usuarioEmailInput">E-mail *</label>
                <input type="email" id="usuarioEmailInput" value="${escapeHtml(usuario?.email || '')}" placeholder="email@exemplo.com" ${!isNovo ? 'disabled' : ''}>
                ${!isNovo ? '<p class="dica mt-1">O e-mail não pode ser alterado.</p>' : ''}
            </div>
            </div>
            <div class="${isNovo ? 'grade-2 grade-2--apertada' : ''}">
            ${isNovo ? `
            <div class="campo">
                <label for="usuarioSenhaInput">Senha temporária *</label>
                <input type="text" id="usuarioSenhaInput" value="${_senhaTemporaria()}" placeholder="Mínimo 6 caracteres" class="campo-senha-sorteada">
                <p class="dica mt-1">Sorteada agora. Passe por um canal seguro e peça
                que troque no primeiro acesso.</p>
            </div>` : ''}
            <div class="campo">
                <label for="usuarioUsernameInput">Usuário <span class="rotulo-nota">(opcional)</span></label>
                <div class="campo-arroba">
                    <span class="campo-arroba-sinal">@</span>
                    <input type="text" id="usuarioUsernameInput" value="${escapeHtml(usuario?.username || '')}"
                        placeholder="seunome"
                        oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9._-]/g,'')">
                </div>
                <p class="dica mt-1">Para entrar sem o e-mail. Letras minúsculas, números, ponto, traço e sublinhado.</p>
            </div>
            </div>
            <div class="campo">
                <label for="usuarioRoleSelect">Nível de acesso *</label>
                <select id="usuarioRoleSelect" onchange="_toggleEmpresasRole()">
                    ${rolesOpts}
                </select>
            </div>
            <div class="campo" id="campoEmpresasUsuario">
                <label>Empresas com acesso</label>
                <div class="linha-acoes linha-acoes--apertada mb-2">
                    <button class="btn-secundario" type="button" onclick="_marcarTodasEmpresas(true)">Marcar todas</button>
                    <button class="btn-secundario" type="button" onclick="_marcarTodasEmpresas(false)">Desmarcar todas</button>
                </div>
                <div class="caixa-empresas">
                    ${empresasCheck || '<p class="dica">Nenhuma empresa cadastrada.</p>'}
                </div>
            </div>
        </div>
        <div class="modal-acoes">
            <button class="btn-primario" onclick="${isNovo ? 'confirmarNovoUsuario()' : `confirmarEditarUsuario('${usuario.uid}')`}">
                ${isNovo ? "Criar usuário" : "Salvar alterações"}
            </button>
            <button class="btn-cancelar" onclick="fecharUsuarioModal()">Cancelar</button>
        </div>
    </div>`;
    overlay.style.display = "flex";
    _toggleEmpresasRole();
}

function _toggleEmpresasRole() {
    const role  = document.getElementById("usuarioRoleSelect")?.value;
    const campo = document.getElementById("campoEmpresasUsuario");
    if (!campo) return;
    campo.style.display = role === "supremo" ? "none" : "block";
}

function _toggleEmpresaBtn(btn) {
    const sel = btn.classList.toggle('selecionada');
    btn.setAttribute('aria-pressed', String(sel));
}

function _marcarTodasEmpresas(marcar) {
    document.querySelectorAll(".btn-empresa-toggle").forEach(btn => _toggleEmpresaBtnForcar(btn, marcar));
}

function _toggleEmpresaBtnForcar(btn, marcar) {
    btn.classList.toggle('selecionada', !!marcar);
    btn.setAttribute('aria-pressed', String(!!marcar));
}

function _coletarEmpresasSelecionadas() {
    return Array.from(document.querySelectorAll(".btn-empresa-toggle.selecionada"))
        .map(btn => btn.dataset.empresa);
}

async function confirmarNovoUsuario() {
    if (_bloqueioDemoUsuarios()) return;
    const nome     = document.getElementById("usuarioNomeInput")?.value.trim();
    const email    = document.getElementById("usuarioEmailInput")?.value.trim();
    const senha    = document.getElementById("usuarioSenhaInput")?.value.trim();
    const role     = document.getElementById("usuarioRoleSelect")?.value;
    const username = document.getElementById("usuarioUsernameInput")?.value.trim().toLowerCase() || null;
    const permitidas = _empresasGerenciaveis();
    const empresas = role === "supremo" ? [] : _coletarEmpresasSelecionadas().filter(e => permitidas.includes(e));

    if (!nome)  return mostrarToast("Informe o nome do usuário.", "aviso");
    if (!email) return mostrarToast("Informe o e-mail.", "aviso");
    if (!senha || senha.length < 6) return mostrarToast("A senha deve ter pelo menos 6 caracteres.", "aviso");
    if (username && username.length < 3) return mostrarToast("O usuário deve ter ao menos 3 caracteres.", "aviso");
    if (role !== "supremo" && empresas.length === 0) return mostrarToast("Selecione ao menos uma empresa.", "aviso");

    const btn = document.querySelector("#usuarioModalOverlay .btn-primario");
    if (btn) mostrarSpinner(btn, "Criar usuário");

    try {
        // Valida unicidade do username antes de criar
        if (username) {
            const disponivel = await window._firestore.usuarioUsernameDisponivel(username, null);
            if (!disponivel) {
                if (btn) esconderSpinner(btn);
                return mostrarToast("Este usuário (@" + username + ") já está em uso.", "aviso", 5000);
            }
        }

        const cred = await window._firestore.authCriarUsuario(email, senha);
        const uid  = cred.user.uid;

        // A conta já existe a partir daqui. Se o perfil ou o @ falharem, é
        // preciso dizer exatamente isso: antes a mensagem era "Erro ao criar
        // usuário", e a nova tentativa respondia "e-mail já cadastrado".
        try {
            await window._firestore.usuarioSalvar(uid, {
                nome, email, role, empresas,
                empresaIds: _idsDasEmpresas(empresas),
                username: username || null,
                ativo: true,
                criadoEm: new Date().toISOString(),
                ultimoAcesso: null
            });
        } catch (erroPerfil) {
            if (btn) esconderSpinner(btn);
            await fmConfirm({
                titulo: "Conta criada, perfil não",
                msg: `A conta de acesso de ${email} foi criada, mas o perfil não foi gravado (${erroPerfil.code || erroPerfil.message}).\n\n`
                   + `Sem perfil a pessoa não entra. Peça ao supremo para apagar essa conta no Console do Firebase Authentication e crie de novo.`,
                confirmTxt: "Entendi", cancelTxt: "Fechar", tipo: "aviso"
            });
            return;
        }
        let avisoIndice = "";
        if (username) {
            try { await window._firestore.usernameMapaDefinir(username, email, uid); }
            catch (_) { avisoIndice = ` O login por @${username} não foi registrado: por enquanto a pessoa entra pelo e-mail. Edite o usuário e salve de novo para tentar.`; }
        }

        fecharUsuarioModal();
        mostrarToast(`Usuário "${nome}" criado com sucesso!${avisoIndice}`, avisoIndice ? "aviso" : "sucesso", avisoIndice ? 9000 : 5000);
        await _recarregarListaUsuarios();
    } catch (e) {
        if (btn) esconderSpinner(btn);
        if (e.code === "auth/email-already-in-use") {
            mostrarToast("Este e-mail já está cadastrado. Se o usuário foi excluído recentemente, remova-o também no Console do Firebase Authentication.", "aviso", 9000);
        } else {
            const msgs = {
                "auth/invalid-email":  "E-mail inválido.",
                "auth/weak-password":  "Senha muito fraca (mínimo 6 caracteres).",
            };
            mostrarToast(msgs[e.code] || "Erro ao criar usuário: " + e.message, "erro", 6000);
        }
    }
}

async function confirmarEditarUsuario(uid) {
    if (_bloqueioDemoUsuarios()) return;
    // Admin não pode editar supremo
    const alvo = _usuariosCache.find(u => u.uid === uid);
    if (alvo?.role === "supremo" && window._usuarioAtual?.role === "admin") {
        return mostrarToast("Sem permissão para editar este usuário.", "aviso");
    }

    const nome     = document.getElementById("usuarioNomeInput")?.value.trim();
    const role     = document.getElementById("usuarioRoleSelect")?.value;
    const username = document.getElementById("usuarioUsernameInput")?.value.trim().toLowerCase() || null;
    // As empresas que o modal mostrou são as que este editor gerencia (mais as
    // inativas do alvo). As outras empresas do alvo não passaram pelo modal
    // e ficam como estavam. Antes eram apagadas em qualquer edição.
    const noModal = Array.from(document.querySelectorAll(".btn-empresa-toggle")).map(b => b.dataset.empresa);
    const selecionadas = _coletarEmpresasSelecionadas().filter(e => noModal.includes(e));
    const idsForaDoModal = _idsDoPerfil(alvo || {}).filter(id => {
        const nomeEmp = db.empresas.find(e => e.id === id)?.nome;
        return !nomeEmp || !noModal.includes(nomeEmp);
    });
    const empresaIds = role === "supremo" ? [] : [...new Set(_idsDasEmpresas(selecionadas).concat(idsForaDoModal))];
    const empresas   = empresaIds.map(id => db.empresas.find(e => e.id === id)?.nome).filter(Boolean);

    if (!nome) return mostrarToast("Informe o nome.", "aviso");
    if (username && username.length < 3) return mostrarToast("O usuário deve ter ao menos 3 caracteres.", "aviso");
    if (role !== "supremo" && empresas.length === 0) return mostrarToast("Selecione ao menos uma empresa.", "aviso");

    if (role !== "supremo") {
        const supremos = _usuariosCache.filter(u => u.uid !== uid && u.role === "supremo" && u.ativo !== false);
        const eraSupremo = _usuariosCache.find(u => u.uid === uid)?.role === "supremo";
        if (eraSupremo && supremos.length === 0) {
            return mostrarToast("Não é possível rebaixar o único usuário supremo ativo.", "aviso");
        }
    }

    const btn = document.querySelector("#usuarioModalOverlay .btn-primario");
    if (btn) mostrarSpinner(btn, "Salvar alterações");

    try {
        // Valida unicidade do username (ignora o próprio uid)
        if (username) {
            const disponivel = await window._firestore.usuarioUsernameDisponivel(username, uid);
            if (!disponivel) {
                if (btn) esconderSpinner(btn);
                return mostrarToast("Este usuário (@" + username + ") já está em uso.", "aviso", 5000);
            }
        }

        const usernameAntigo = _usuariosCache.find(u => u.uid === uid)?.username || null;
        await window._firestore.usuarioSalvar(uid, {
            nome, role, empresas, empresaIds,
            username: username || null
        });
        await _sincronizarIndiceUsername(usernameAntigo, username, alvo?.email, uid);
        fecharUsuarioModal();
        mostrarToast("Usuário atualizado.", "sucesso");
        await _recarregarListaUsuarios();
    } catch (e) {
        if (btn) esconderSpinner(btn);
        mostrarToast("Erro ao salvar: " + e.message, "erro", 6000);
    }
}

/* ─── INATIVAR / REATIVAR ─── */
async function toggleAtivoUsuario(uid) {
    if (_bloqueioDemoUsuarios()) return;
    const u = _usuariosCache.find(u => u.uid === uid);
    if (!u) return;

    // Admin não pode alterar status de supremo
    if (u.role === "supremo" && window._usuarioAtual?.role === "admin") {
        return mostrarToast("Sem permissão para alterar este usuário.", "aviso");
    }

    if (u.ativo !== false) {
        const supremosAtivos = _usuariosCache.filter(x => x.role === "supremo" && x.ativo !== false && x.uid !== uid);
        if (u.role === "supremo" && supremosAtivos.length === 0) {
            return mostrarToast("Não é possível inativar o único usuário supremo ativo.", "aviso");
        }
        if (!await fmConfirm({ titulo: `Inativar "${u.nome}"?`, msg: "A pessoa não consegue mais entrar, e uma sessão que esteja aberta é encerrada.", confirmTxt: "Inativar", tipo: "aviso" })) return;
    } else {
        if (!await fmConfirm({ titulo: `Reativar "${u.nome}"?`, confirmTxt: "Reativar", tipo: "info" })) return;
    }

    try {
        await window._firestore.usuarioSalvar(uid, { ativo: u.ativo !== false ? false : true });
        mostrarToast(`Usuário ${u.ativo !== false ? "inativado" : "reativado"}.`, "info");
        await _recarregarListaUsuarios();
    } catch (e) {
        mostrarToast("Erro: " + e.message, "erro");
    }
}

/* ─── EXCLUIR ─── */
/**
 * Exclui o PERFIL do usuário. A conta de autenticação continua existindo.
 *
 * Apagar a conta no Firebase Authentication exige o Admin SDK, num
 * servidor, ou que a própria pessoa esteja logada. Nenhum dos dois existe
 * aqui. Quem barra o desligado é a aplicação: sem perfil, o login cai em
 * "Acesso negado" logo depois de autenticar.
 *
 * Antes, o diálogo não dizia nada disso e prometia uma exclusão que não
 * acontecia. Agora ele diz o que de fato vai acontecer, e aponta o caminho
 * seguro: inativar bloqueia igual e preserva o registro de quem lançou o
 * quê.
 */
async function excluirUsuario(uid) {
    if (_bloqueioDemoUsuarios()) return;
    const u = _usuariosCache.find(u => u.uid === uid);
    if (!u) return;
    if (!await fmConfirm({
        titulo: `Excluir o perfil de "${u.nome}"?`,
        msg: `E-mail: ${u.email}\n\n`
           + `A conta de acesso NÃO é apagada: isso só o Console do Firebase faz. `
           + `O que acontece aqui é que a pessoa perde o perfil e passa a ser recusada no login.\n\n`
           + `Se a intenção é só tirar o acesso, prefira INATIVAR: bloqueia igual e `
           + `preserva o registro de quem lançou o quê.`,
        confirmTxt: "Excluir o perfil", cancelTxt: "Voltar", tipo: "perigo" })) return;

    try {
        await window._firestore.usuarioExcluirFirestore(uid);
        if (u.username) await window._firestore.usernameMapaRemover(u.username);
        mostrarToast(
            `Perfil de "${u.nome}" excluído. A conta de acesso continua no Firebase. `
            + `apague-a pelo Console se a pessoa saiu da empresa.`, "aviso", 9000);
        await _recarregarListaUsuarios();
    } catch (e) {
        mostrarToast("Erro ao excluir: " + e.message, "erro", 6000);
    }
}

/* ─── ALTERAR SENHA (própria) ─── */
function abrirModalAlterarSenha() {
    const overlay = document.getElementById("usuarioModalOverlay");
    overlay.innerHTML = `
    <div class="modal">
        <div class="modal-cabecalho"><h3>Alterar minha senha</h3><button class="modal-fechar" onclick="fecharUsuarioModal()" aria-label="Fechar" title="Fechar">✕</button></div>
        <div class="modal-corpo modal-corpo--pilha">
            <div class="campo">
                <label for="novaSenhaInput">Nova senha *</label>
                <input type="password" id="novaSenhaInput" placeholder="Mínimo 6 caracteres">
            </div>
            <div class="campo">
                <label for="confirmarSenhaInput">Confirmar nova senha *</label>
                <input type="password" id="confirmarSenhaInput" placeholder="Repita a nova senha">
            </div>
        </div>
        <div class="modal-acoes">
            <button class="btn-primario" onclick="confirmarAlterarSenha()">Alterar senha</button>
            <button class="btn-cancelar" onclick="fecharUsuarioModal()">Cancelar</button>
        </div>
    </div>`;
    overlay.style.display = "flex";
}

async function confirmarAlterarSenha() {
    if (_bloqueioDemoUsuarios()) return;
    const nova      = document.getElementById("novaSenhaInput")?.value;
    const confirmar = document.getElementById("confirmarSenhaInput")?.value;

    if (!nova || nova.length < 6) return mostrarToast("A senha deve ter ao menos 6 caracteres.", "aviso");
    if (nova !== confirmar)       return mostrarToast("As senhas não conferem.", "aviso");

    const btn = document.querySelector("#usuarioModalOverlay .btn-primario");
    if (btn) mostrarSpinner(btn, "Alterar senha");

    try {
        await window._firestore.authAlterarSenha(nova);
        fecharUsuarioModal();
        mostrarToast("Senha alterada com sucesso!", "sucesso", 4000);
    } catch (e) {
        if (btn) esconderSpinner(btn);
        if (e.code === "auth/requires-recent-login") {
            mostrarToast("Por segurança, faça logout e login novamente antes de alterar a senha.", "aviso", 8000);
        } else {
            mostrarToast("Erro ao alterar senha: " + e.message, "erro", 6000);
        }
    }
}

/* ─── MODAL UTILITÁRIO ─── */
function fecharUsuarioModal() {
    const overlay = document.getElementById("usuarioModalOverlay");
    if (overlay) overlay.style.display = "none";
}

document.addEventListener("click", e => {
    const overlay = document.getElementById("usuarioModalOverlay");
    if (overlay && e.target === overlay) fecharUsuarioModal();
});