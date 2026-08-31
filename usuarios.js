/*=================================================
  USUARIOS.JS — Gerenciamento de Usuários e Permissões
  Acessível apenas para role: 'supremo' | 'admin'
  v1.1 — Fuel Mind
  FIX: usuário pode editar próprio nome (não só senha)
=================================================*/

/* ─── ESTADO ─── */
let _usuariosCache = [];

/* ─── ROLES ─── */
const ROLES = {
    supremo: { label: "Supremo",  desc: "Acesso total, gerencia usuários e configurações" },
    admin:   { label: "Admin",    desc: "Acesso total às empresas permitidas, sem gerenciar usuários" },
    usuario: { label: "Usuário",  desc: "Acesso operacional às empresas permitidas" },
};

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
    const ativas = db.empresas.filter(e => e.ativo !== false).map(e => e.nome);
    if (perfil.role === "supremo") return ativas;
    return ativas.filter(nome => (perfil.empresas || []).includes(nome));
}

/**
 * Regrava o índice público `usernames/{username}` para todos os usuários
 * que já têm username cadastrado.
 *
 * Necessária uma única vez, na virada para o índice: antes dela o login
 * por @usuario dependia de a coleção `usuarios` ser legível sem
 * autenticação. Idempotente — pode ser rodada quantas vezes for preciso.
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

    let ok = 0, falhas = 0;
    for (const u of comUsername) {
        try {
            await window._firestore.usernameMapaDefinir(u.username, u.email, u.uid);
            ok++;
        } catch (e) {
            falhas++;
            console.error("[Usernames] Falha em @" + u.username + ":", e);
        }
    }
    mostrarToast(
        falhas === 0
            ? `Índice reconstruído: ${ok} usuário(s).`
            : `Índice reconstruído com ${ok} sucesso(s) e ${falhas} falha(s). Veja o console.`,
        falhas === 0 ? "sucesso" : "aviso",
        6000
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
        container.innerHTML =
            `<div class="card" style="text-align:center;padding:40px;">
                <p style="color:var(--danger)">Você não tem permissão para acessar esta área.</p>
                <p class="dica" style="margin-top:8px;">Role: ${window._usuarioAtual?.role || 'não definido'}</p>
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
        if (!window._firestore?.usuariosListar) {
            throw new Error("Firebase não inicializado ainda.");
        }
        const todos = await window._firestore.usuariosListar();
        if (window._usuarioAtual?.role === "supremo") {
            _usuariosCache = todos;
        } else {
            // Admin só enxerga a si mesmo e usuários que compartilhem ao menos
            // uma empresa com ele — nunca a base de usuários inteira.
            const minhasEmpresas = window._usuarioAtual?.empresas || [];
            _usuariosCache = todos.filter(u =>
                u.uid === window._usuarioAtual?.uid ||
                (u.empresas || []).some(e => minhasEmpresas.includes(e))
            );
        }
        _renderUsuarios();
    } catch (e) {
        console.error("[Usuarios] Erro:", e);
        container.innerHTML = `
            <div style="padding:20px;background:var(--surface-alt);border-radius:var(--radius);border:1px solid var(--border);">
                <p style="color:var(--danger);margin-bottom:8px;">Erro ao carregar usuários:</p>
                <code style="font-size:0.82rem;color:var(--text-muted);">${e.message}</code>
                <br><br>
                <button class="btn-secundario" onclick="_recarregarListaUsuarios()">Tentar novamente</button>
            </div>`;
    }
}

function _renderUsuarios() {
    const container = document.getElementById("usuariosConteudo");
    if (!container) return;

    const supremoAtual = window._usuarioAtual?.role === "supremo";

    const linhas = _usuariosCache.map(u => {
        const roleInfo   = ROLES[u.role] || { label: u.role };
        const isSelf     = u.uid === window._usuarioAtual?.uid;
        const empresasStr = u.role === "supremo"
            ? "<em style='color:var(--text-muted)'>Todas</em>"
            : (u.empresas?.length
                ? u.empresas.map(e => `<span class="badge-empresa-tag">${escapeHtml(e)}</span>`).join(" ")
                : "<em style='color:var(--text-muted)'>Nenhuma</em>");

        const ultimoAcesso = u.ultimoAcesso
            ? new Date(u.ultimoAcesso).toLocaleString("pt-BR")
            : "Nunca";

        const badges = `<span class="badge-role badge-role-${u.role}">${roleInfo.label}</span>
                        ${u.ativo === false ? '<span class="badge-inativo-user">Inativo</span>' : ''}
                        ${isSelf ? '<span class="badge-voce">Você</span>' : ''}`;

        // ── Ações: usuário próprio pode editar perfil (nome + senha) ──
        // Admin não pode editar, inativar ou excluir usuários supremo
        const editorRole   = window._usuarioAtual?.role;
        const alvoBloqueado = u.role === "supremo" && editorRole === "admin";

        const acoes = isSelf
            ? `<button class="btn-editar" onclick="abrirModalEditarProprioPerfil()">Editar perfil</button>
               <button class="btn-secundario" onclick="abrirModalAlterarSenha()">Alterar senha</button>`
            : alvoBloqueado
            ? `<span style="font-size:0.78rem;color:var(--text-muted);font-style:italic">Sem permissão</span>`
            : `<button class="btn-editar" onclick="abrirModalEditarUsuario('${u.uid}')">Editar</button>
               ${u.ativo !== false
                   ? `<button class="btn-inativar" onclick="toggleAtivoUsuario('${u.uid}')">Inativar</button>`
                   : `<button class="btn-secundario" onclick="toggleAtivoUsuario('${u.uid}')">Reativar</button>`
               }
               ${supremoAtual && u.role !== "supremo"
                   ? `<button class="btn-excluir" onclick="excluirUsuario('${u.uid}')">Excluir</button>`
                   : ""}`;

        return `<tr class="${u.ativo === false ? 'linha-inativo' : ''}">
            <td><strong>${escapeHtml(u.nome)}</strong><br><small style="color:var(--text-muted)">${escapeHtml(u.email)}</small>${u.username ? `<br><small style="color:var(--primary);opacity:0.8">@${escapeHtml(u.username)}</small>` : ''}</td>
            <td>${badges}</td>
            <td>${empresasStr}</td>
            <td style="font-size:0.78rem;color:var(--text-muted)">${ultimoAcesso}</td>
            <td class="no-print"><div style="display:flex;gap:6px;flex-wrap:wrap">${acoes}</div></td>
        </tr>`;
    }).join("");

    const semIndice = _usuariosCache.filter(u => u.username).length;

    container.innerHTML = `
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:16px;">
            ${supremoAtual && semIndice > 0
                ? `<button class="btn-secundario" onclick="migrarIndiceUsernames()"
                       title="Regrava o índice público que permite login por @usuario">
                       Reconstruir índice de @usuarios
                   </button>`
                : ''}
            <button class="btn-primario" onclick="abrirModalNovoUsuario()">Novo Usuário</button>
        </div>
        <div class="tabela-container">
            <table>
                <thead><tr>
                    <th>Nome / E-mail</th>
                    <th>Nível</th>
                    <th>Empresas com Acesso</th>
                    <th>Último Acesso</th>
                    <th class="no-print">Ações</th>
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
    <div class="modal" style="max-width:420px;">
        <div class="modal-header"><h3>Editar Meu Perfil</h3></div>
        <div class="modal-corpo" style="display:flex;flex-direction:column;gap:14px;">
            <div class="campo">
                <label>Nome completo *</label>
                <input type="text" id="perfilNomeInput" value="${escapeHtml(u.nome || '')}" placeholder="Seu nome completo">
            </div>
            <div class="campo">
                <label>Usuário <span style="font-weight:400;opacity:0.65;font-size:0.78rem">(opcional — para login sem e-mail)</span></label>
                <div style="position:relative">
                    <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);pointer-events:none">@</span>
                    <input type="text" id="perfilUsernameInput" value="${escapeHtml(u.username || '')}"
                        placeholder="seunome"
                        style="padding-left:24px"
                        oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9._-]/g,'')">
                </div>
                <p class="dica" style="margin-top:4px">Apenas letras minúsculas, números, ponto, traço e sublinhado.</p>
            </div>
            <div class="campo">
                <label>E-mail</label>
                <input type="text" value="${escapeHtml(u.email || '')}" disabled
                    style="opacity:0.6;cursor:not-allowed;">
                <p class="dica" style="margin-top:4px">E-mail não pode ser alterado.</p>
            </div>
        </div>
        <div class="modal-acoes">
            <button class="btn-primario" onclick="confirmarEditarProprioPerfil()">Salvar</button>
            <button class="btn-secundario" onclick="fecharUsuarioModal()">Cancelar</button>
        </div>
    </div>`;
    overlay.style.display = "flex";
    document.getElementById("perfilNomeInput")?.focus();
}

async function confirmarEditarProprioPerfil() {
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
    _abrirModalUsuario(u, _empresasGerenciaveis());
}

function _abrirModalUsuario(usuario, todasEmpresas) {
    const isNovo     = !usuario;
    const supremoAtual = window._usuarioAtual?.role === "supremo";

    const rolesOpts = Object.entries(ROLES)
        .filter(([r]) => supremoAtual || r !== "supremo")
        .map(([r, info]) =>
            `<option value="${r}" ${usuario?.role === r ? "selected" : ""}>${info.label} — ${info.desc}</option>`
        ).join("");

    const empresasCheck = todasEmpresas.map(emp => {
        const marcada = usuario?.empresas?.includes(emp) || false;
        const borderC = marcada ? 'var(--primary)' : 'var(--border)';
        const bgC     = marcada ? 'var(--primary-subtle)' : 'var(--surface-alt)';
        const dotBg   = marcada ? 'var(--primary)' : 'transparent';
        return `<button type="button"
            class="btn-empresa-toggle${marcada ? ' selecionada' : ''}"
            data-empresa="${escapeHtml(emp)}"
            onclick="_toggleEmpresaBtn(this)"
            style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;
                   padding:8px 12px;margin-bottom:6px;border-radius:var(--radius-sm);
                   border:1px solid ${borderC};background:${bgC};
                   color:var(--text);cursor:pointer;transition:all 0.15s;font-size:0.88rem;">
            <span class="emp-toggle-dot" style="width:14px;height:14px;flex-shrink:0;border-radius:50%;
                border:2px solid ${borderC};background:${dotBg};transition:all 0.15s;"></span>
            ${escapeHtml(emp)}
        </button>`;
    }).join("");

    const overlay = document.getElementById("usuarioModalOverlay");
    overlay.innerHTML = `
    <div class="modal" style="max-width:500px;">
        <div class="modal-header">
            <h3>${isNovo ? "Novo Usuário" : "Editar Usuário"}</h3>
        </div>
        <div class="modal-corpo" style="display:flex;flex-direction:column;gap:14px;">
            <div class="campo">
                <label>Nome completo *</label>
                <input type="text" id="usuarioNomeInput" value="${escapeHtml(usuario?.nome || '')}" placeholder="Ex: João Silva">
            </div>
            <div class="campo">
                <label>E-mail *</label>
                <input type="email" id="usuarioEmailInput" value="${escapeHtml(usuario?.email || '')}" placeholder="email@exemplo.com" ${!isNovo ? 'disabled' : ''}>
                ${!isNovo ? '<p class="dica" style="margin-top:4px">E-mail não pode ser alterado.</p>' : ''}
            </div>
            ${isNovo ? `
            <div class="campo">
                <label>Senha temporária *</label>
                <input type="text" id="usuarioSenhaInput" value="123456" placeholder="Mínimo 6 caracteres">
                <p class="dica" style="margin-top:4px">O usuário poderá alterar a senha após o primeiro acesso.</p>
            </div>` : ''}
            <div class="campo">
                <label>Usuário <span style="font-weight:400;opacity:0.65;font-size:0.78rem">(opcional — para login sem e-mail)</span></label>
                <div style="position:relative">
                    <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);pointer-events:none">@</span>
                    <input type="text" id="usuarioUsernameInput" value="${escapeHtml(usuario?.username || '')}"
                        placeholder="seunome" style="padding-left:24px"
                        oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9._-]/g,'')">
                </div>
                <p class="dica" style="margin-top:4px">Apenas letras minúsculas, números, ponto, traço e sublinhado.</p>
            </div>
            <div class="campo">
                <label>Nível de acesso *</label>
                <select id="usuarioRoleSelect" onchange="_toggleEmpresasRole()">
                    ${rolesOpts}
                </select>
            </div>
            <div class="campo" id="campoEmpresasUsuario">
                <label>Empresas com acesso</label>
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                    <button class="btn-secundario" type="button" onclick="_marcarTodasEmpresas(true)">Marcar todas</button>
                    <button class="btn-secundario" type="button" onclick="_marcarTodasEmpresas(false)">Desmarcar todas</button>
                </div>
                <div style="background:var(--surface-alt);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;">
                    ${empresasCheck || '<p class="dica">Nenhuma empresa cadastrada.</p>'}
                </div>
            </div>
        </div>
        <div class="modal-acoes">
            <button class="btn-primario" onclick="${isNovo ? 'confirmarNovoUsuario()' : `confirmarEditarUsuario('${usuario.uid}')`}">
                ${isNovo ? "Criar Usuário" : "Salvar Alterações"}
            </button>
            <button class="btn-secundario" onclick="fecharUsuarioModal()">Cancelar</button>
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
    const dot = btn.querySelector('.emp-toggle-dot');
    btn.style.borderColor = sel ? 'var(--primary)' : 'var(--border)';
    btn.style.background  = sel ? 'var(--primary-subtle)' : 'var(--surface-alt)';
    if (dot) {
        dot.style.background   = sel ? 'var(--primary)' : 'transparent';
        dot.style.borderColor  = sel ? 'var(--primary)' : 'var(--border)';
    }
}

function _marcarTodasEmpresas(marcar) {
    document.querySelectorAll(".btn-empresa-toggle").forEach(btn => _toggleEmpresaBtnForcar(btn, marcar));
}

function _toggleEmpresaBtnForcar(btn, marcar) {
    const dot = btn.querySelector('.emp-toggle-dot');
    if (marcar) btn.classList.add('selecionada');
    else btn.classList.remove('selecionada');
    btn.style.borderColor = marcar ? 'var(--primary)' : 'var(--border)';
    btn.style.background  = marcar ? 'var(--primary-subtle)' : 'var(--surface-alt)';
    if (dot) {
        dot.style.background  = marcar ? 'var(--primary)' : 'transparent';
        dot.style.borderColor = marcar ? 'var(--primary)' : 'var(--border)';
    }
}

function _coletarEmpresasSelecionadas() {
    return Array.from(document.querySelectorAll(".btn-empresa-toggle.selecionada"))
        .map(btn => btn.dataset.empresa);
}

async function confirmarNovoUsuario() {
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
    if (btn) mostrarSpinner(btn, "Criar Usuário");

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

        await window._firestore.usuarioSalvar(uid, {
            nome, email, role, empresas,
            empresaIds: _idsDasEmpresas(empresas),
            username: username || null,
            ativo: true,
            criadoEm: new Date().toISOString(),
            ultimoAcesso: null
        });
        if (username) await window._firestore.usernameMapaDefinir(username, email, uid);

        fecharUsuarioModal();
        mostrarToast(`Usuário "${nome}" criado com sucesso!`, "sucesso", 5000);
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
    // Admin não pode editar supremo
    const alvo = _usuariosCache.find(u => u.uid === uid);
    if (alvo?.role === "supremo" && window._usuarioAtual?.role === "admin") {
        return mostrarToast("Sem permissão para editar este usuário.", "aviso");
    }

    const nome     = document.getElementById("usuarioNomeInput")?.value.trim();
    const role     = document.getElementById("usuarioRoleSelect")?.value;
    const username = document.getElementById("usuarioUsernameInput")?.value.trim().toLowerCase() || null;
    const permitidas = _empresasGerenciaveis();
    const empresas = role === "supremo" ? [] : _coletarEmpresasSelecionadas().filter(e => permitidas.includes(e));

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
    if (btn) mostrarSpinner(btn, "Salvar Alterações");

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
            nome, role, empresas,
            empresaIds: _idsDasEmpresas(empresas),
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
        if (!await fmConfirm({ titulo: `Inativar "${u.nome}"?`, msg: "Ele não conseguirá mais fazer login.", confirmTxt: "Inativar", tipo: "aviso" })) return;
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
async function excluirUsuario(uid) {
    const u = _usuariosCache.find(u => u.uid === uid);
    if (!u) return;
    if (!await fmConfirm({ titulo: `Excluir "${u.nome}"?`, msg: `E-mail: ${u.email}\n\nEsta ação não pode ser desfeita.`, confirmTxt: "Excluir", tipo: "perigo" })) return;

    try {
        await window._firestore.usuarioExcluirFirestore(uid);
        if (u.username) await window._firestore.usernameMapaRemover(u.username);
        mostrarToast(`Usuário "${u.nome}" excluído.`, "sucesso");
        await _recarregarListaUsuarios();
    } catch (e) {
        mostrarToast("Erro ao excluir: " + e.message, "erro", 6000);
    }
}

/* ─── ALTERAR SENHA (própria) ─── */
function abrirModalAlterarSenha() {
    const overlay = document.getElementById("usuarioModalOverlay");
    overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
        <div class="modal-header"><h3>Alterar Minha Senha</h3></div>
        <div class="modal-corpo" style="display:flex;flex-direction:column;gap:14px;">
            <div class="campo">
                <label>Nova senha *</label>
                <input type="password" id="novaSenhaInput" placeholder="Mínimo 6 caracteres">
            </div>
            <div class="campo">
                <label>Confirmar nova senha *</label>
                <input type="password" id="confirmarSenhaInput" placeholder="Repita a nova senha">
            </div>
        </div>
        <div class="modal-acoes">
            <button class="btn-primario" onclick="confirmarAlterarSenha()">Alterar Senha</button>
            <button class="btn-secundario" onclick="fecharUsuarioModal()">Cancelar</button>
        </div>
    </div>`;
    overlay.style.display = "flex";
}

async function confirmarAlterarSenha() {
    const nova      = document.getElementById("novaSenhaInput")?.value;
    const confirmar = document.getElementById("confirmarSenhaInput")?.value;

    if (!nova || nova.length < 6) return mostrarToast("A senha deve ter ao menos 6 caracteres.", "aviso");
    if (nova !== confirmar)       return mostrarToast("As senhas não conferem.", "aviso");

    const btn = document.querySelector("#usuarioModalOverlay .btn-primario");
    if (btn) mostrarSpinner(btn, "Alterar Senha");

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