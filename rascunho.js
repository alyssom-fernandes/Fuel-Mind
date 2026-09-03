/*=================================================
  RASCUNHO.JS — o formulário de lançamento sobrevive
  a F5, a fechar a aba e a um travamento.

  Por que existe (tema 02 da pesquisa): até aqui, um F5 no meio da nota
  apagava tudo, inclusive os dados já extraídos de um XML importado.
  Navegar entre telas nunca perdeu nada, porque `mostrarTela` só troca
  `display`; os caminhos de perda real eram F5, fechar a aba, o botão
  Cancelar e o XML sobrescrevendo formulário preenchido.

  Decisões que vieram da pesquisa e do trade-off declarado pelo dono
  (segurança primeiro), e que NÃO devem ser revertidas sem motivo:

  - O rascunho vive só no cliente. Nunca no Firestore por tecla: os
    lançamentos de cada empresa moram num documento único, e transformá-lo
    em contador de digitação custaria escrita e conflito por nada.
  - O rascunho NUNCA preenche a tela sozinho. Ao voltar, aparece uma
    faixa com Continuar e Descartar, e nenhum campo é tocado antes do
    clique. Campo preenchido sozinho é como se lança dado errado sem
    perceber.
  - Rascunho não é lançamento. Ele guarda trabalho em andamento; quem
    grava nota é o botão de salvar.
  - Apagado só DEPOIS de o lançamento entrar na memória e no backup
    local, nunca antes. Se esperássemos a confirmação do Firestore, uma
    tentativa que demora meio minuto deixaria o rascunho vivo e ele
    reapareceria depois como nota fantasma.
=================================================*/

const FM_RASCUNHO_VERSAO   = 1;
const FM_RASCUNHO_DEBOUNCE = 500;
const FM_RASCUNHO_VALIDADE = 30 * 24 * 60 * 60 * 1000;   // 30 dias

let _fmRascunhoTimer = null;
let _fmRascunhoUltimo = null;   // último JSON gravado, para não regravar igual
let _fmRascunhoPendente = null; // rascunho encontrado e ainda não decidido

function _fmChaveRascunho() {
    const uid = (window._usuarioAtual && window._usuarioAtual.uid) || 'anon';
    return 'fm_rascunho_lanc_' + uid;
}

/** Lê o formulário inteiro, incluindo as linhas de combustível. */
function _fmRascunhoCapturar() {
    const val = id => (document.getElementById(id) || {}).value || '';
    const itens = [...document.querySelectorAll('.linha-combustivel')].map(l => ({
        tipo:          l.querySelector('.tipo').value,
        qtd:           l.querySelector('.qtd').value,
        qtdDescargada: l.querySelector('.qtdDescargada').value,
        valor:         l.querySelector('.valor').value
    }));
    const bannerXML = document.getElementById('bannerXML');
    return {
        v: FM_RASCUNHO_VERSAO,
        ts: Date.now(),
        empresaAtiva: empresaFiltroGlobal || '',
        editandoId: (typeof lancamentoEditandoId !== 'undefined' && lancamentoEditandoId) || null,
        isClonando: (typeof isClonando !== 'undefined' && isClonando) || false,
        chaveAcesso: (typeof _chaveAcessoAtual !== 'undefined' && _chaveAcessoAtual) || null,
        campos: {
            dataNota:     val('dataNota'),
            dataDescarga: val('dataDescarga'),
            numeroNota:   val('numeroNota'),
            base:         val('baseEntradaInput'),
            empresa:      val('empresaInput'),
            motorista:    val('motoristaInput'),
            placa:        val('placaInput'),
            observacoes:  val('observacoes')
        },
        itens,
        bannerXML: (bannerXML && bannerXML.style.display !== 'none') ? bannerXML.innerHTML : null
    };
}

/**
 * Um formulário só com a Empresa preenchida não é rascunho: `mostrarTela`
 * preenche esse campo sozinho a partir da empresa ativa. Sem esta guarda,
 * abrir a tela e sair já criaria um rascunho para restaurar depois.
 */
function _fmRascunhoTemConteudo(r) {
    const c = r.campos;
    if (c.dataNota || c.dataDescarga || c.numeroNota || c.base ||
        c.motorista || c.placa || c.observacoes) return true;
    return r.itens.some(i => i.tipo || i.qtd || i.qtdDescargada || i.valor);
}

function fmRascunhoGravarAgora() {
    // O rascunho vale também no modo demonstração. A chave inclui o uid, e o
    // uid da demo é próprio, então nada se mistura com dado real. Bloquear
    // aqui tornaria a proteção contra F5 impossível de ver e de testar, que é
    // justamente onde o modo demo serve.
    const r = _fmRascunhoCapturar();
    if (!_fmRascunhoTemConteudo(r)) { fmRascunhoApagar(); return; }

    const json = JSON.stringify(r);
    // Comparação sem o carimbo de tempo: só o conteúdo decide se regrava.
    const semTs = json.replace(/"ts":\d+/, '"ts":0');
    if (semTs === _fmRascunhoUltimo) return;
    try {
        localStorage.setItem(_fmChaveRascunho(), json);
        _fmRascunhoUltimo = semTs;
    } catch (_) { /* quota cheia: o formulário continua funcionando */ }
}

/** Agendado a cada alteração; junta rajadas de digitação num só gravar. */
function fmRascunhoAgendar() {
    clearTimeout(_fmRascunhoTimer);
    _fmRascunhoTimer = setTimeout(fmRascunhoGravarAgora, FM_RASCUNHO_DEBOUNCE);
}

function fmRascunhoApagar() {
    clearTimeout(_fmRascunhoTimer);
    _fmRascunhoUltimo = null;
    _fmRascunhoPendente = null;
    try { localStorage.removeItem(_fmChaveRascunho()); } catch (_) {}
    const faixa = document.getElementById('bannerRascunho');
    if (faixa) faixa.style.display = 'none';
}

/**
 * Chamado ao entrar na tela de lançamento. Não preenche nada: só mostra
 * a faixa e espera o operador decidir.
 */
function fmRascunhoVerificar() {
    const faixa = document.getElementById('bannerRascunho');
    if (!faixa) return;

    let r = null;
    try {
        const bruto = localStorage.getItem(_fmChaveRascunho());
        if (bruto) r = JSON.parse(bruto);
    } catch (_) { r = null; }

    if (!r || r.v !== FM_RASCUNHO_VERSAO) { fmRascunhoApagar(); return; }
    if (Date.now() - (r.ts || 0) > FM_RASCUNHO_VALIDADE) { fmRascunhoApagar(); return; }
    if (!_fmRascunhoTemConteudo(r)) { fmRascunhoApagar(); return; }
    // Já há trabalho na tela: não oferecer nada, para não competir com ele.
    if (_formularioSujo) { faixa.style.display = 'none'; return; }

    _fmRascunhoPendente = r;

    const d = new Date(r.ts);
    const quando = d.toLocaleDateString('pt-BR') === new Date().toLocaleDateString('pt-BR')
        ? `hoje às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
        : `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

    const resumo = [
        r.campos.numeroNota ? `nota ${r.campos.numeroNota}` : null,
        r.campos.motorista  || null,
        r.itens.length ? `${r.itens.length} combustível(is)` : null
    ].filter(Boolean).join(' · ');

    let aviso = '';
    if (r.editandoId) {
        const existe = (db.lancamentos || []).some(l => l.id === r.editandoId);
        aviso = existe
            ? '<br><small>Era uma <strong>edição</strong> de lançamento existente.</small>'
            : '<br><small>Era a edição de um lançamento que <strong>não existe mais</strong>. Só é possível descartar.</small>';
        if (!existe) r.__orfao = true;
    }
    if (r.empresaAtiva && empresaFiltroGlobal && r.empresaAtiva !== empresaFiltroGlobal) {
        aviso += `<br><small>Foi começado com a empresa <strong>${escapeHtml(r.empresaAtiva)}</strong>, e a empresa ativa agora é <strong>${escapeHtml(empresaFiltroGlobal)}</strong>.</small>`;
    }

    faixa.style.display = 'block';
    faixa.innerHTML =
        `Há um lançamento não salvo de <strong>${escapeHtml(quando)}</strong>`
        + (resumo ? ` — ${escapeHtml(resumo)}` : '')
        + `.${aviso}<div class="banner-acoes">`
        + (r.__orfao ? '' : `<button class="btn-primario" onclick="fmRascunhoRestaurar()">Continuar</button>`)
        + `<button class="btn-cancelar" onclick="fmRascunhoDescartar()">Descartar</button></div>`;
}

/** Só aqui os campos são tocados, e só depois do clique em Continuar. */
function fmRascunhoRestaurar() {
    const r = _fmRascunhoPendente;
    if (!r) return;

    const c = r.campos;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };

    if (r.editandoId && (db.lancamentos || []).some(l => l.id === r.editandoId)) {
        lancamentoEditandoId = r.editandoId;
        isClonando = false;
        document.getElementById('tituloLancamentos').textContent = 'Editando Lançamento';
        document.getElementById('btnSalvarLancamento').textContent = 'Salvar';
        const bs = document.getElementById('btnSalvarSair');
        if (bs) bs.textContent = 'Salvar e voltar';
    } else {
        lancamentoEditandoId = null;
        isClonando = !!r.isClonando;
    }

    set('dataNota', c.dataNota);
    set('dataDescarga', c.dataDescarga);
    set('numeroNota', c.numeroNota);
    set('observacoes', c.observacoes);
    setBase(c.base);
    set('empresaInput', c.empresa);
    set('empresaSelect', c.empresa);
    set('motoristaInput', c.motorista);
    set('motoristaSelect', c.motorista);
    set('placaInput', c.placa);
    set('placaSelect', c.placa);

    document.getElementById('combustiveisNota').innerHTML = '';
    (r.itens || []).forEach(i => adicionarCombustivelNota({
        tipo: i.tipo, qtd: i.qtd, qtdDescargada: i.qtdDescargada, valor: i.valor
    }));
    if (!r.itens || !r.itens.length) adicionarCombustivelNota();

    const bx = document.getElementById('bannerXML');
    if (bx && r.bannerXML) { bx.innerHTML = r.bannerXML; bx.style.display = 'block'; }
    _chaveAcessoAtual = r.chaveAcesso || null;

    document.getElementById('bannerRascunho').style.display = 'none';
    _fmRascunhoPendente = null;
    atualizarTotalizadorNota();
    marcarFormularioSujo();
    // Restaurar preenche por script, e script não dispara `change`: sem esta
    // chamada os alertas do que foi recuperado só apareceriam ao tocar num campo.
    if (typeof validarLancamento === 'function') validarLancamento();
    mostrarToast('Lançamento recuperado. Confira os dados antes de salvar.', 'info', 5000);
    const foco = document.getElementById(c.numeroNota ? 'dataNota' : 'numeroNota');
    if (foco) foco.focus();
}

async function fmRascunhoDescartar() {
    if (!await fmConfirm({
        titulo: 'Descartar o lançamento não salvo?',
        msg: 'O que foi preenchido antes será perdido. Esta ação não pode ser desfeita.',
        confirmTxt: 'Descartar',
        cancelTxt: 'Manter',
        tipo: 'perigo'
    })) return;
    fmRascunhoApagar();
    mostrarToast('Rascunho descartado.', 'info');
}

/* ── GRAVAÇÃO IMEDIATA AO SAIR ──────────────────────────────────────
   O debounce de meio segundo deixaria uma janela em que a última tecla
   não chegou ao armazenamento. `pagehide` cobre fechar a aba, navegar e
   recarregar; `beforeunload` fica como reserva para navegadores que
   disparam só ele.
   ────────────────────────────────────────────────────────────────── */
window.addEventListener('pagehide', fmRascunhoGravarAgora);
window.addEventListener('beforeunload', fmRascunhoGravarAgora);
