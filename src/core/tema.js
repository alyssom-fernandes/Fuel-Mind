/*=================================================
  TEMA.JS: Fuel Mind
  Tema claro e escuro, logo do tema e cor principal personalizada. Roda
  na carga: aplica o tema e a cor salvos antes do primeiro desenho.

  Parte do antigo app.js, quebrado em 18/09/2026 (programa 6.5).
=================================================*/
// ========== TEMA AUTOMÁTICO ==========
function aplicarTemaInicial() {
    const temaSalvo = localStorage.getItem("tema");
    setTimeout(() => _aplicarLogoDoTema(), 0);
    if (temaSalvo) {
        document.documentElement.setAttribute("data-theme", temaSalvo);
    } else {
        const prefereEscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const tema = prefereEscuro ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", tema);
        localStorage.setItem("tema", tema);
    }
    _pintarBotaoTema(document.documentElement.getAttribute("data-theme"));
}

/* O botão do tema mora no RODAPÉ da barra lateral desde 22/09/2026, e
   mostra para onde o clique leva, não onde se está: no escuro ele oferece
   "Tema claro". O ícone acompanha. Antes isto era um par de SVGs colados
   em dois lugares deste arquivo, e mudar um sem o outro deixava o botão
   mentindo em metade dos caminhos. */
function _pintarBotaoTema(tema) {
    const escuro = tema === "dark";
    const icone = document.getElementById("sidebarIconeTema");
    if (icone) icone.innerHTML = escuro
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    const rotulo = document.getElementById("sidebarRotuloTema");
    if (rotulo) rotulo.textContent = escuro ? "Tema claro" : "Tema escuro";
}
aplicarTemaInicial();

function toggleModoEscuro() {
    const html = document.documentElement;
    const novo = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", novo);
    _pintarBotaoTema(novo);
    localStorage.setItem("tema", novo);
    _aplicarLogoDoTema(novo);
    // Os gráficos leem a cor do tema na hora em que são criados: quem
    // trocava o tema com o Dashboard ou o Analítico aberto ficava com eixo
    // e legenda na cor antiga até sair e voltar (17/09/2026).
    // Fretes e Grupo também têm gráfico: no tema claro os rótulos do eixo,
    // desenhados em cinza-claro, sumiam (18/09/2026).
    const tela = document.querySelector(".tela[style*='block']")?.id;
    if (tela === "dashboard" && typeof carregarDashboard === "function") carregarDashboard();
    if (tela === "analitico" && typeof carregarAnalitico === "function") carregarAnalitico();
    if (tela === "fretes"    && typeof carregarFretes    === "function") carregarFretes();
    if (tela === "grupo"     && typeof carregarGrupo     === "function") carregarGrupo();
}

/** A sidebar tem uma imagem só; o tema decide qual arquivo ela usa.
 *  O nome do arquivo diz o FUNDO para o qual ele foi feito: `logo-dark.svg`
 *  tem letras brancas (fundo escuro), `logo-light.svg` letras escuras (fundo
 *  claro). A troca estava invertida e a logo sumia nos dois temas. */
function _aplicarLogoDoTema(tema) {
    const img = document.getElementById("sidebarLogo");
    if (img) img.src = (tema || document.documentElement.getAttribute("data-theme")) === "light"
        ? "assets/logo-light.svg" : "assets/logo-dark.svg";
}

/* A cor da marca saiu de ser configurável em 21/09/2026, a pedido do dono:
   ela é a identidade do site, e o seletor nunca se comportou como ele
   queria. As variáveis --primary, --primary-texto e as derivadas vivem
   inteiramente no style.css, uma definição por tema. Com isso saíram daqui
   `aplicarCorPersonalizada`, `resetarCorPadrao`, `_aplicarCorDoTexto` e as
   funções de clarear e escurecer hexadecimal, que só serviam a elas. A
   chave `corPrimaria` do localStorage deixou de ser lida; some sozinha. */
