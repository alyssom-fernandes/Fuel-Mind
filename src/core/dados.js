/*=================================================
  DADOS.JS: Fuel Mind
  O modelo do banco em memória (`db`, `DB_PADRAO`), o estado da
  sincronização, os ids, e a divisão em documentos: um compartilhado e um
  de lançamentos por empresa. Aqui também a mesclagem (`_base`,
  `_mudancasLocais`, `_mesclar`), que aplica só o que este navegador mudou.

  Parte do antigo app.js, quebrado em 18/09/2026 (programa 6.5).
=================================================*/
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

// Timer do debounce: agrupa writes múltiplos em uma gravação só.
let _timerDebounce = null;
const _DEBOUNCE_MS = 600;

// Nome do documento de cadastros compartilhados.
const _NOME_COMPARTILHADO = "compartilhado";
const _NOME_LEGADO        = "principal";

// true quando os dados já estão repartidos por empresa; false enquanto o
// banco ainda estiver no documento único `dados/principal`. Só é decidido
// por uma carga que DEU CERTO: ver `_cargaOk`.
let _layoutNovo = false;

/* ── CARGA CONFIRMADA ───────────────────────────────────────────────
   Nada vai para a nuvem enquanto a carga da nuvem não tiver dado certo.

   Antes, uma falha ao ler um documento virava "documento vazio": a
   empresa cuja leitura falhou ficava sem nota nenhuma em memória, e o
   primeiro salvamento gravava um vetor vazio por cima do histórico dela.
   E uma falha ao ler o compartilhado deixava a sessão gravando no
   documento do layout antigo, com a pílula verde: as notas sumiam no F5
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
   aplica só essas mudanças por cima dele, em vez de regravar o vetor
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
 * IDs são sempre strings: nunca usar `+id` ou `parseInt(id)`.
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
   `db` continua com a mesma forma de sempre (`db.lancamentos` é um array
   único), só que contendo apenas as empresas que o usuário pode ver.

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
 * O nome que está na nota decide primeiro: é ele que o operador vê e
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
