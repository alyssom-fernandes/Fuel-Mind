/*=================================================
  TEMA.JS — Fuel Mind
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
    const icone = document.getElementById("iconeTema");
    if (icone) icone.innerHTML = document.documentElement.getAttribute("data-theme") === "dark"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}
aplicarTemaInicial();

function toggleModoEscuro() {
    const html = document.documentElement;
    const novo = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", novo);
    const icone = document.getElementById("iconeTema");
    if (icone) icone.innerHTML = novo === "dark"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    localStorage.setItem("tema", novo);
    _aplicarLogoDoTema(novo);
    // A cor de texto da marca depende do tema; se há cor personalizada, o
    // estilo em linha dela precisa ser recalculado agora.
    const corPersonalizada = localStorage.getItem('corPrimaria');
    if (corPersonalizada) _aplicarCorDoTexto(corPersonalizada);
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
        ? "logo-light.svg" : "logo-dark.svg";
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

/* A cor da marca como TEXTO. No tema escuro o vinho puro sobre o fundo
   quase preto fica ilegível (contraste 2,3), então o texto usa uma versão
   clareada; no tema claro é a própria cor. Precisa ser reaplicada ao trocar
   de tema, porque o estilo em linha do `aplicarCorPersonalizada` vence o
   CSS. (21/09/2026) */
function _aplicarCorDoTexto(cor) {
    const escuro = document.documentElement.getAttribute('data-theme') !== 'light';
    document.documentElement.style.setProperty('--primary-texto',
        escuro ? _clarearHex(cor, 0.42) : cor);
}

function aplicarCorPersonalizada(cor) {
    const root = document.documentElement;
    const { r, g, b } = _hexParaRGB(cor);
    root.style.setProperty('--primary',         cor);
    _aplicarCorDoTexto(cor);
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
