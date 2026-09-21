/*=================================================
  NAVEGACAO.JS: Fuel Mind
  Troca de tela (`mostrarTela`), atalhos globais de teclado, avisos
  (`mostrarToast`) e o formulário sujo do lançamento.

  Parte do antigo app.js, quebrado em 18/09/2026 (programa 6.5).
=================================================*/
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
    // Ctrl+Enter é o atalho do botão primário: "salvar e lançar próxima" numa
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
    // nova roubava a atenção, perda total e silenciosa. Removidos.
    if (e.key === 'Escape') {
        const modal = document.getElementById('modalOverlay');
        if (modal && modal.style.display === 'flex') fecharModal();
        const buscaModal = document.getElementById('buscaGlobalModal');
        if (buscaModal && buscaModal.style.display === 'flex') fecharBuscaGlobal();
    }
});

/**
 * Exibe uma notificação temporária (toast) no canto da tela.
 *
 * Remove qualquer toast anterior antes de exibir o novo: nunca empilha.
 *
 * @param {string} mensagem  - Texto a exibir
 * @param {'sucesso'|'erro'|'aviso'|'info'} [tipo='sucesso'] - Define cor e ícone
 * @param {number} [duracao=3000] - Duração em ms antes de sumir.
 *   Usar 4000ms para validações de formulário, 6000-8000ms para erros graves.
 */
/**
 * Exibe uma mensagem efêmera.
 *
 * As mensagens se EMPILHAM. Antes, cada chamada removia a anterior, e como há
 * caminhos que emitem duas em sequência (o salvamento e o erro de nuvem, por
 * exemplo), a primeira era destruída antes de poder ser lida.
 *
 * O contêiner declara `role="status"` e `aria-live="polite"`: o projeto não
 * tinha nenhuma região viva, então nada do que o sistema comunicava por toast
 * chegava a leitor de tela.
 */
/* Toast com um botão de ação: hoje, o "Desfazer" de uma exclusão
   (18/09/2026). A ação é uma função, não HTML: nada de texto do usuário
   vira código. Fica mais tempo na tela, porque existe para ser clicado. */
function mostrarToastComAcao(mensagem, tipo, duracao, rotulo, aoClicar) {
    mostrarToast(mensagem, tipo, duracao);
    const pilha = document.getElementById("toastPilha");
    const toast = pilha && pilha.lastElementChild;
    if (!toast) return;
    const botao = document.createElement("button");
    botao.className = "toast-acao";
    botao.type = "button";
    botao.textContent = rotulo;
    botao.onclick = () => { toast.remove(); try { aoClicar(); } catch (e) { console.error(e); } };
    toast.appendChild(botao);
}

function mostrarToast(mensagem, tipo = "sucesso", duracao = 3000, opcoes = {}) {
    // O toast avisa no canto; a ação responde também no lugar dela (ui.js,
    // 18/09/2026). Erro fica escrito na tela onde falhou; sucesso pisca o
    // botão clicado e apaga os erros daquele lugar. `fixar: false` é para o
    // que não é de tela nenhuma (a nuvem tentando de novo sozinha).
    if (tipo === "erro" && opcoes.fixar !== false && typeof fixarErroNoLocal === "function") {
        fixarErroNoLocal(mensagem);
    } else if (tipo === "sucesso" && opcoes.local !== false && typeof confirmarNoLocal === "function") {
        confirmarNoLocal(_botaoDaAcao());
        limparErrosNoLocal();
    }
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
 * procuravam `tituloLancamento` (uma letra a menos) e por isso o marcador
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
    // O `h2` da tela fica oculto de propósito: `atualizarTitulosInternos`
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
 * e o botão era "Descartar e sair", o que era FALSO: `mostrarTela` só troca
 * `display`, nada limpa os campos, e os dados continuam lá na volta. O efeito
 * prático era caro: quem precisava conferir uma nota no relatório ou cadastrar
 * um motorista acreditava que o preço era perder tudo, então ou não conferia,
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
    // Telas que exportam ou leem planilha: as bibliotecas vêm agora, em
    // segundo plano, para estarem prontas quando o botão for clicado.
    if (["relatorios", "fretes", "grupo", "conferencia", "sistema"].includes(id)
        && typeof garantirBibliotecas === "function") {
        garantirBibliotecas(["xlsx", "jspdf", "autotable"]).catch(() => {});
    }

    if (["motoristas","veiculos","empresas","combustiveis","cadastros"].includes(id)) atualizarListas();
    if (id === "analitico")    { if (typeof carregarAnalitico === 'function') carregarAnalitico(); }
    if (id === "sistema")      atualizarInfoSistema();
    if (id === "usuarios")     { if (typeof carregarUsuarios === 'function') carregarUsuarios(); }
    if (id === "dashboard")    carregarDashboard();
    if (id === "relatorios")   carregarRelatorio();
    if (id === "fretes")       carregarFretes();
    if (id === "grupo")        { if (typeof carregarGrupo === 'function') carregarGrupo(); }
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
