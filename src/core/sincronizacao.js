/*=================================================
  SINCRONIZACAO.JS: Fuel Mind
  Pendentes, cópia local, gravação (`salvarDB`, `_executarSave`),
  carga (`carregarDB`), escutas em tempo real, e o que a tela mostra
  disso: o carregamento e a pílula de conexão.

  Parte do antigo app.js, quebrado em 18/09/2026 (programa 6.5).
=================================================*/
/* ── O QUE FOI SALVO MAS AINDA NÃO SUBIU ────────────────────────────
   Registro, no `localStorage`, dos lançamentos que mudaram neste navegador
   e cuja gravação na nuvem ainda não foi confirmada. Precisa sobreviver ao
   fechamento da aba.

   Guarda só ids. O conteúdo está na cópia local; na próxima carga, a nota
   pendente da cópia local é aplicada por cima do que veio do servidor:
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
 * O debounce de 600ms agrupa chamadas em rápida sucessão (por exemplo,
 * edições consecutivas em cadastros) numa gravação só. `imediato` existe
 * para o salvamento fiscal: quem clica em "Salvar" e fecha a aba meio
 * segundo depois precisa ter tido a tentativa.
 */
function salvarDB(opcoes) {
    // Toda gravação muda a versão dos dados (o cache da busca do relatório a usa).
    window._versaoDados = (window._versaoDados || 0) + 1;
    // Mês fechado (mes-fechado.js, 23/09/2026): a alteração que mexe nele
    // volta inteira, e nada é gravado. Vem antes do modo demonstração para
    // a trava valer também lá, onde ela é testada.
    if (!_travaConferirAntesDeGravar()) return;
    // Modo demonstração: nada sai da máquina. Esta é a trava: se ela
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
    // A nota pendente que encontrou o mês fechado por outra aba volta ao
    // que o servidor tem, antes de qualquer coisa subir.
    _travaRevisarPendentes();
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
            _travaAtualizarAprovado();
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
            mostrarToast("Erro ao salvar na nuvem. Tentando novamente em 30s…", "erro", 6000, { fixar: false });
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
 * que traz `db.empresas`: sem a lista de empresas não há como resolver
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
            _travaAtualizarAprovado();
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
        // O que acabou de chegar é o ponto de partida da trava do mês
        // fechado: dali em diante, o que mudar é alteração de alguém.
        _travaAtualizarAprovado();
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
   empresas muda: uma empresa criada durante a sessão ganha listener na
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
    if (db.lancamentos.length !== antes) {
        // Não é alteração de ninguém: sem isto, a trava do mês fechado
        // veria as notas da empresa que saiu como "apagadas" e recusaria a
        // gravação seguinte, levando junto a nota que acabou de ser salva.
        _travaAtualizarAprovado();
        _rerenderTelaAtual();
    }
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
        _travaAtualizarAprovado();
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
 * sempre: com o perfil alterado no meio da sessão, eram dezenas de
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
        if (n === 1) mostrarToast("A cota diária da nuvem foi atingida. Os dados podem ficar desatualizados até amanhã.", "erro", 10000, { fixar: false });
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
 * o tipo correto, mesmo que o documento salvo esteja desatualizado.
 *
 * Regras de mesclagem por tipo de campo:
 * - Arrays (`motoristas`, `veiculos`, `empresas`, `combustiveis`, `lancamentos`,
 *   `bases`): substituídos integralmente se `dados` tiver array
 *   válido; senão mantém array vazio do padrão.
 * - `configRelatorio`: merge superficial (`Object.assign`) com o padrão,
 *   preservando configurações parcialmente salvas.
 *
 * É o ponto central de hidratação do `db`: novos campos adicionados ao
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
     'conjuntosVeiculos','fechamentosMes'].forEach(campo => {
        if (Array.isArray(dados[campo])) resultado[campo] = dados[campo];
    });

    if (dados.configRelatorio && typeof dados.configRelatorio === 'object') {
        resultado.configRelatorio = Object.assign({}, DB_PADRAO.configRelatorio, dados.configRelatorio);
    }

    // Vazio até alguém salvar a configuração; `configAlertas()` completa com
    // os padrões na leitura. Depois do primeiro "Salvar", a configuração
    // inteira fica gravada: mudar um padrão no código só vale para quem
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
            <div class="carregando-tela" role="status">
                <img class="carregando-logo" alt="Fuel Mind" width="1199" height="291"
                     src="${document.documentElement.getAttribute("data-theme") === "light" ? "assets/logo-light.svg" : "assets/logo-dark.svg"}">
                <div class="carregando-roda" aria-hidden="true"></div>
                <span class="carregando-texto">Carregando dados da nuvem…</span>
            </div>`;
        document.body.appendChild(el);
    } else {
        if (el) el.remove();
    }
}

function _criarIndicadorConexao() {
    if (document.getElementById("_statusConexao")) return;
    const el = document.createElement("div");
    el.id = "_statusConexao";
    el.className = "status-conexao";
    el.style.display = "none";
    el.title = "Clique para sincronizar agora";
    el.onclick = () => sincronizarAgora();
    document.body.appendChild(el);
    _setStatusConexao("conectando");
}

function _setStatusConexao(status) {
    const el = document.getElementById("_statusConexao");
    if (!el) return;
    const cfg = {
        conectando:   { icone:"○", texto:"Conectando…"   },
        sincronizado: { icone:"●", texto:"Sincronizado"  },
        salvando:     { icone:"●", texto:"Salvando…"     },
        offline:      { icone:"●", texto:"Offline"       },
        pendente:     { icone:"▲", texto:"Pendente"      },
        erro:         { icone:"●", texto:"Erro na nuvem" },
    };
    const chave = cfg[status] ? status : "conectando";
    const c = cfg[chave];
    // A cor de cada estado mora no CSS (`.status-conexao-ponto--*`).
    el.innerHTML = `<span class="status-conexao-ponto status-conexao-ponto--${chave}">${c.icone}</span>${c.texto}`;

    // Visível apenas quando há algo relevante a comunicar;
    // quando sincronizado, some completamente (sem área clicável invisível)
    if (['offline','pendente','erro','salvando','conectando'].includes(status)) {
        el.style.display = "flex";
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
