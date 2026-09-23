/*=================================================
  MES-FECHADO.JS: Fuel Mind
  O mês fechado, por empresa (decisão do dono, 23/09/2026).

  Fechar um mês trava TUDO o que ele mostra, para qualquer papel,
  inclusive o supremo: as notas com descarga nele (lançar, editar,
  excluir, restaurar, cancelar, importar, mudar a data para dentro ou
  para fora), a taxa de frete e o % do motorista que valem nos dias dele,
  e os conjuntos de veículos desses dias. Quem precisa alterar reabre o
  mês, com motivo, e o motivo fica no histórico do fechamento. A razão é
  a do dono: evitar a alteração que ninguém quis fazer.

  ONDE A TRAVA MORA
  As notas de uma empresa vivem num documento só, numa lista, e a regra
  do Firestore não percorre lista: ela não tem como saber o mês de cada
  nota. Por isso a trava é do sistema, e não do banco (opção A, escolhida
  pelo dono em 23/09/2026). A regra do banco protege o registro do
  fechamento: operador não fecha nem reabre. Quando as notas forem
  repartidas em um documento por mês (opção B), a regra passa a usar
  este mesmo registro e a trava fica completa.

  COMO A TRAVA DECIDE
  Não há uma regra por tela. Há uma pergunta só, feita sobre o estado
  antes e depois de qualquer alteração: algum mês fechado ficaria
  diferente? `violacoesMesFechado` compara, para cada mês fechado, as
  notas dele, a taxa e o % de cada dia dele, e o conjunto de cada placa
  em cada dia dele. É isso que deixa a trava sem brecha: uma tela nova que
  grave nota passa pela mesma pergunta sem saber que ela existe.

  As funções de cima são puras (recebem o estado, não leem `db`) e são
  elas que os testes conferem. As de baixo ligam a pergunta ao sistema.
=================================================*/

/** Id do registro de fechamento de um mês de uma empresa. */
function _fechamentoId(empresaId, mes) {
    return `${empresaId}__${mes}`;
}

/** `"AAAA-MM"` da descarga da nota: é o mês a que ela pertence. */
function mesDaDescarga(l) {
    return dataDescargaDe(l).slice(0, 7);
}

function _registroFechamento(fechamentos, empresaId, mes) {
    if (!empresaId || !mes) return null;
    const id = _fechamentoId(empresaId, mes);
    return (fechamentos || []).find(f => f && f.id === id) || null;
}

function mesEstaFechado(fechamentos, empresaId, mes) {
    const r = _registroFechamento(fechamentos, empresaId, mes);
    return !!(r && r.fechado);
}

/** "julho de 2026". */
function _nomeMesLongo(mes) {
    const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
                   "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const [a, m] = String(mes || "").split("-").map(Number);
    return nomes[m - 1] ? `${nomes[m - 1]} de ${a}` : String(mes || "");
}

function _diasDoMes(mes) {
    const [a, m] = mes.split("-").map(Number);
    const total = new Date(a, m, 0).getDate();
    const dias = [];
    for (let d = 1; d <= total; d++) dias.push(`${mes}-${String(d).padStart(2, "0")}`);
    return dias;
}

/* A empresa de uma nota num estado qualquer, e não no `db`: a mesma regra
   de `_empresaIdDoLancamento` (dados.js), o nome primeiro e o id gravado
   na nota depois. */
function _empresaIdNoEstado(l, empresas) {
    const porNome = (empresas || []).find(e => e && e.nome === l.empresa);
    return (porNome && porNome.id) || l.empresaId || null;
}

/* O conjunto de uma placa numa data, sobre uma lista de conjuntos dada.
   É a regra de `resolverConjuntoEPeriodo` (cadastros.js), que passou a
   chamar esta: comparar o antes e o depois exige resolver sobre duas
   listas, e não só sobre a que está no `db`. */
function _normalizarPlacaTrava(p) {
    if (typeof normalizarPlaca === "function") return normalizarPlaca(p);
    return String(p || "").replace(/[-\s]/g, "").toUpperCase();
}

function _resolverConjuntoNaLista(conjuntos, placa, data) {
    if (!placa || !Array.isArray(conjuntos)) return null;
    const placaNorm = _normalizarPlacaTrava(placa);
    const dataRef = data || "9999-12-31";
    for (const conj of conjuntos) {
        if (!data && conj.ativo === false) continue;
        const hist = [...(conj.historico || [])].reverse();
        for (const h of hist) {
            if (h.vigenciaDe > dataRef) continue;
            if (h.vigenciaAte && h.vigenciaAte < dataRef) continue;
            if ((h.placas || []).map(_normalizarPlacaTrava).includes(placaNorm)) return { conj, periodo: h };
        }
    }
    return null;
}

/** Os meses fechados de uma lista de registros, por chave `empresaId__mes`. */
function _mesesFechadosDe(fechamentos) {
    const m = new Map();
    (fechamentos || []).forEach(f => {
        if (f && f.fechado && f.empresaId && f.mes) m.set(_fechamentoId(f.empresaId, f.mes), { empresaId: f.empresaId, mes: f.mes });
    });
    return m;
}

/* As notas de cada mês fechado, como texto comparável. Entra a nota
   inteira, inclusive o estado e o histórico: excluir ou restaurar também
   é alterar o mês. O `empresaId` sai porque é carimbo de memória, que a
   carga e o agrupamento põem sozinhos, e não alteração de ninguém. */
function _notasPorMesFechado(estado, chaves) {
    const grupos = new Map();
    (estado.lancamentos || []).forEach(l => {
        if (!l) return;
        const k = _fechamentoId(_empresaIdNoEstado(l, estado.empresas), mesDaDescarga(l));
        if (!chaves.has(k)) return;
        if (!grupos.has(k)) grupos.set(k, []);
        const c = Object.assign({}, l);
        delete c.empresaId;
        grupos.get(k).push(c);
    });
    const texto = new Map();
    grupos.forEach((lista, k) => {
        lista.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        texto.set(k, JSON.stringify(lista));
    });
    return texto;
}

/* Placas cujo conjunto pode ter mudado: as de todo conjunto que não está
   igual nas duas listas. Resolver só elas mantém a conta pequena mesmo
   com muitos meses fechados. */
function _placasDeConjuntosAlterados(antes, depois) {
    const porId = lista => new Map((lista || []).map(c => [String(c.id), JSON.stringify(c)]));
    const a = porId(antes), d = porId(depois);
    const placas = new Set();
    const juntar = c => {
        if (!c) return;
        (c.composicaoAtual || []).forEach(p => placas.add(_normalizarPlacaTrava(p)));
        (c.historico || []).forEach(h => (h.placas || []).forEach(p => placas.add(_normalizarPlacaTrava(p))));
    };
    new Set([...a.keys(), ...d.keys()]).forEach(id => {
        if (a.get(id) === d.get(id)) return;
        juntar((antes || []).find(c => String(c.id) === id));
        juntar((depois || []).find(c => String(c.id) === id));
    });
    // A ordem da lista também decide (o primeiro conjunto que contém a
    // placa vence): se só a ordem mudou, todas as placas entram.
    if (!placas.size && JSON.stringify(antes || []) !== JSON.stringify(depois || [])) {
        (depois || []).forEach(juntar);
        (antes || []).forEach(juntar);
    }
    return placas;
}

function _assinaturaConjunto(r) {
    if (!r) return "";
    return `${r.conj.id}|${r.conj.nome || ""}|${(r.periodo.placas || []).map(_normalizarPlacaTrava).sort().join(",")}`;
}

/**
 * Os meses fechados que uma alteração mudaria.
 *
 * `antes` e `depois` são estados: `{ lancamentos, empresas,
 * conjuntosVeiculos, fechamentosMes }`. Um mês conta como fechado se está
 * fechado em qualquer dos dois: reabrir e fechar não mudam nada sozinhos,
 * e o que mudar junto com eles é conferido.
 *
 * @returns {Array<{empresaId: string, mes: string, motivos: string[]}>}
 */
function violacoesMesFechado(antes, depois) {
    const fechados = new Map([..._mesesFechadosDe(antes.fechamentosMes), ..._mesesFechadosDe(depois.fechamentosMes)]);
    if (!fechados.size) return [];
    const chaves = new Set(fechados.keys());
    const motivos = new Map();
    const marcar = (k, motivo) => {
        if (!motivos.has(k)) motivos.set(k, new Set());
        motivos.get(k).add(motivo);
    };

    // 1. As notas.
    const na = _notasPorMesFechado(antes, chaves);
    const nd = _notasPorMesFechado(depois, chaves);
    chaves.forEach(k => { if ((na.get(k) || "[]") !== (nd.get(k) || "[]")) marcar(k, "notas"); });

    // 2. A taxa e o % do motorista de cada dia do mês.
    if (JSON.stringify(antes.empresas || []) !== JSON.stringify(depois.empresas || [])) {
        fechados.forEach(({ empresaId, mes }, k) => {
            const ea = (antes.empresas || []).find(e => e && e.id === empresaId) || null;
            const ed = (depois.empresas || []).find(e => e && e.id === empresaId) || null;
            if (JSON.stringify(ea) === JSON.stringify(ed)) return;
            for (const dia of _diasDoMes(mes)) {
                if (_taxaFreteDaEmpresaNaData(ea, dia) !== _taxaFreteDaEmpresaNaData(ed, dia)) marcar(k, "taxa de frete");
                if (!ea !== !ed || (ea && _percentualMotoristaDaEmpresaNaData(ea, dia) !== _percentualMotoristaDaEmpresaNaData(ed, dia))) marcar(k, "% do motorista");
            }
        });
    }

    // 3. O conjunto de cada placa em cada dia. Conjunto não é de uma
    //    empresa só: um mês fechado em qualquer empresa o trava.
    const placas = _placasDeConjuntosAlterados(antes.conjuntosVeiculos, depois.conjuntosVeiculos);
    if (placas.size) {
        const porMes = new Map();
        fechados.forEach(({ mes }, k) => { if (!porMes.has(mes)) porMes.set(mes, []); porMes.get(mes).push(k); });
        porMes.forEach((ks, mes) => {
            const mudou = _diasDoMes(mes).some(dia => [...placas].some(p =>
                _assinaturaConjunto(_resolverConjuntoNaLista(antes.conjuntosVeiculos, p, dia))
                !== _assinaturaConjunto(_resolverConjuntoNaLista(depois.conjuntosVeiculos, p, dia))));
            if (mudou) ks.forEach(k => marcar(k, "conjuntos de veículos"));
        });
    }

    return [...motivos.entries()].map(([k, s]) => Object.assign({}, fechados.get(k), { motivos: [...s] }));
}

/** "Posto Rosário, julho de 2026 (notas); Fabiandra, agosto de 2026 (taxa de frete)". */
function descreverViolacoesMes(violacoes, empresas) {
    return (violacoes || []).map(v => {
        const nome = ((empresas || []).find(e => e && e.id === v.empresaId) || {}).nome || "empresa sem cadastro";
        return `${nome}, ${_nomeMesLongo(v.mes)} (${v.motivos.join(", ")})`;
    }).join("; ");
}

/*=================================================
  A TRAVA NO SISTEMA
=================================================*/

/* Identifica esta aba. O registro de fechamento guarda a aba que fechou,
   e é isso que separa, na hora de subir para a nuvem, a nota que a própria
   pessoa alterou antes de fechar o mês (sobe) da nota alterada num
   navegador que ficou sem internet enquanto outra pessoa fechava (não
   sobe). */
const _SESSAO_TRAVA = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

function _fechadoNestaSessao(reg) {
    const logs = (reg && Array.isArray(reg.logs)) ? reg.logs : [];
    for (let i = logs.length - 1; i >= 0; i--) {
        if (logs[i] && logs[i].acao === "Fechado") return logs[i].sessao === _SESSAO_TRAVA;
    }
    return false;
}

function _clonarTrava(v) {
    return typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

/* Fotografia do que a trava confere e do que ela devolve se recusar. As
   configurações entram só para voltar junto: uma restauração de backup
   recusada não pode deixar a régua de alertas e o PDF do backup na
   memória, prontos para subir na gravação seguinte.

   Sem mês fechado em lugar nenhum não há o que conferir, e a foto é leve:
   clonar o banco inteiro a cada gravação só se paga quando há o que
   proteger. */
function _travaFoto() {
    if (!haMesFechado()) return { leve: true, lancamentos: [], fechamentosMes: [] };
    const foto = { lancamentos: db.lancamentos || [] };
    _LISTAS_COMPARTILHADO.forEach(c => { foto[c] = db[c] || []; });
    _OBJETOS_COMPARTILHADO.forEach(c => { foto[c] = db[c]; });
    return _clonarTrava(foto);
}

function _travaRestaurar(foto) {
    if (foto.leve) return;
    const copia = _clonarTrava(foto);
    db.lancamentos = copia.lancamentos || [];
    _LISTAS_COMPARTILHADO.forEach(c => { db[c] = copia[c] || []; });
    _OBJETOS_COMPARTILHADO.forEach(c => { if (copia[c] !== undefined) db[c] = copia[c]; });
}

function _travaMensagem(acao, violacoes) {
    return `${acao}: isto alteraria um mês fechado. Onde: ${descreverViolacoesMes(violacoes, db.empresas)}. `
         + `Nada foi alterado. Para mudar, reabra o mês na tela de Fretes.`;
}

/**
 * A recusa numa tela: devolve o `db` à fotografia tirada antes da ação e
 * avisa. Para as telas que dão mensagem de sucesso ou fecham um modal
 * depois de gravar: sem isto, a recusa do `salvarDB` viria depois do
 * "salvo com sucesso".
 * @returns {boolean} true quando recusou
 */
function _travaBarrar(foto, acao) {
    // Foto leve: não havia mês fechado quando a ação começou, e nenhuma
    // ação de tela fecha mês no meio.
    if (foto.leve) return false;
    const v = violacoesMesFechado(foto, db);
    if (!v.length) return false;
    _travaRestaurar(foto);
    mostrarToast(_travaMensagem(acao, v), "erro", 10000);
    if (typeof atualizarListas === "function") atualizarListas();
    if (typeof _rerenderTelaAtual === "function") _rerenderTelaAtual();
    return true;
}

/* ── A REDE: TODA GRAVAÇÃO PASSA POR AQUI ──────────────────────────────
   `salvarDB` chama isto antes de gravar qualquer coisa. `_travaAprovado`
   é o estado da última gravação aceita (ou da última carga): o que mudou
   desde ele é o que a pessoa acabou de fazer. Se mexe em mês fechado,
   volta tudo, e nada é gravado. */
let _travaAprovado = null;

function _travaAtualizarAprovado() {
    if (typeof db === "undefined" || !db) return;
    _travaAprovado = _travaFoto();
}

function _travaConferirAntesDeGravar() {
    // Sem aprovação, ou aprovação de quando não havia mês fechado: a
    // gravação que está chegando é a do próprio fechamento (que não mexe
    // em mais nada) ou uma que não tinha o que proteger.
    if (!_travaAprovado || _travaAprovado.leve) { _travaAtualizarAprovado(); return true; }
    const v = violacoesMesFechado(_travaAprovado, db);
    if (!v.length) { _travaAtualizarAprovado(); return true; }
    console.error("[mês fechado] Gravação recusada:", v);
    _travaRestaurar(_travaAprovado);
    mostrarToast(_travaMensagem("Alteração recusada", v), "erro", 10000);
    if (typeof atualizarListas === "function") atualizarListas();
    if (typeof _rerenderTelaAtual === "function") _rerenderTelaAtual();
    return false;
}

/* ── O QUE SOBE DEPOIS ─────────────────────────────────────────────────
   Uma nota alterada neste navegador e que ainda não chegou à nuvem pode
   encontrar o mês fechado quando chegar: a aba ficou sem internet, ou a
   alteração é de uma sessão anterior e voltou da cópia local. Antes de
   gravar, cada nota pendente é conferida contra o que o servidor tem; se
   ela mexe num mês que outra aba fechou, volta à versão do servidor. */
function _travaRevisarPendentes() {
    const fechamentos = db.fechamentosMes || [];
    if (!fechamentos.some(f => f && f.fechado)) return 0;
    const barra = (empresaId, l) => {
        const reg = _registroFechamento(fechamentos, empresaId, mesDaDescarga(l));
        return !!(reg && reg.fechado && !_fechadoNestaSessao(reg));
    };
    const grupos = _agruparLancamentos();
    const desfeitas = [];
    _empresaIdsPermitidos().forEach(empresaId => {
        const base = _base[_nomeDocLanc(empresaId)];
        const naBase = (base && base.listas && base.listas.lancamentos) || null;
        if (!naBase) return;
        const presentes = new Set();
        (grupos[empresaId] || []).forEach(l => {
            const k = _chaveItem(l);
            presentes.add(k);
            const j = naBase.get(k);
            if (j === JSON.stringify(l)) return;
            const antiga = j ? JSON.parse(j) : null;
            if (!barra(empresaId, l) && !(antiga && barra(empresaId, antiga))) return;
            desfeitas.push({ id: l.id, antiga });
        });
        naBase.forEach((j, k) => {
            if (presentes.has(k)) return;
            const antiga = JSON.parse(j);
            if (barra(empresaId, antiga)) desfeitas.push({ id: antiga.id, antiga });
        });
    });
    desfeitas.forEach(({ id, antiga }) => {
        db.lancamentos = db.lancamentos.filter(l => l.id !== id);
        if (antiga) db.lancamentos.push(antiga);
    });

    // Taxa, % e conjuntos que mudaram aqui e ainda não subiram: se mudam um
    // dia de mês fechado por outra aba, as empresas e os conjuntos voltam ao
    // que o servidor tem. É a mesma pergunta da trava, feita contra o
    // servidor e só com os meses fechados de fora.
    const baseComp = _base[_NOME_COMPARTILHADO];
    const listaDaBase = campo => {
        const m = baseComp && baseComp.listas && baseComp.listas[campo];
        return m ? [...m.values()].map(j => JSON.parse(j)) : null;
    };
    const empresasServ = listaDaBase("empresas");
    const conjuntosServ = listaDaBase("conjuntosVeiculos");
    const deFora = fechamentos.filter(f => f && f.fechado && !_fechadoNestaSessao(f));
    let cadastrosDesfeitos = false;
    if (empresasServ && conjuntosServ && deFora.length) {
        const v = violacoesMesFechado(
            { lancamentos: [], empresas: empresasServ, conjuntosVeiculos: conjuntosServ, fechamentosMes: deFora },
            { lancamentos: [], empresas: db.empresas || [], conjuntosVeiculos: db.conjuntosVeiculos || [], fechamentosMes: deFora });
        if (v.length) {
            db.empresas = empresasServ;
            db.conjuntosVeiculos = conjuntosServ;
            cadastrosDesfeitos = true;
        }
    }

    if (!desfeitas.length && !cadastrosDesfeitos) return 0;
    console.error("[mês fechado] Alterações pendentes desfeitas:", desfeitas.map(d => d.id), cadastrosDesfeitos ? "e cadastros" : "");
    const partes = [];
    if (desfeitas.length) partes.push(`${desfeitas.length} nota(s)`);
    if (cadastrosDesfeitos) partes.push("taxas, % do motorista ou conjuntos");
    mostrarToast(`Alterações feitas neste navegador em ${partes.join(" e ")} foram desfeitas: `
        + `mexiam num mês que outra pessoa fechou nesse meio tempo. Confira o que está gravado.`, "erro", 12000);
    _travaAtualizarAprovado();
    if (typeof _gravarCopiaLocal === "function") _gravarCopiaLocal();
    if (typeof atualizarListas === "function") atualizarListas();
    if (typeof _rerenderTelaAtual === "function") _rerenderTelaAtual();
    return desfeitas.length + (cadastrosDesfeitos ? 1 : 0);
}

/* ── PARA AS TELAS ─────────────────────────────────────────────────── */

/** O registro de fechamento do mês de uma nota, se o mês estiver fechado. */
function mesFechadoDaNota(l) {
    if (!l) return null;
    const empresaId = typeof _empresaIdDoLancamento === "function" ? _empresaIdDoLancamento(l) : l.empresaId;
    const reg = _registroFechamento(db.fechamentosMes, empresaId, mesDaDescarga(l));
    return reg && reg.fechado ? reg : null;
}

/** O registro de fechamento de um mês de uma empresa, pelo NOME da empresa. */
function mesFechadoDaEmpresa(nomeEmpresa, mes) {
    const emp = (db.empresas || []).find(e => e.nome === nomeEmpresa);
    const reg = emp ? _registroFechamento(db.fechamentosMes, emp.id, mes) : null;
    return reg && reg.fechado ? reg : null;
}

/** Recusa na hora uma ação sobre nota de mês fechado. @returns {boolean} true quando recusou */
function barrarNotaDeMesFechado(l, acao) {
    const reg = mesFechadoDaNota(l);
    if (!reg) return false;
    mostrarToast(`${acao}: a nota é de ${_nomeMesLongo(reg.mes)}, mês fechado da empresa ${l.empresa}. `
        + `Para alterar, reabra o mês na tela de Fretes.`, "aviso", 8000);
    return true;
}

/** Algum mês fechado, em qualquer empresa? */
function haMesFechado() {
    return (db.fechamentosMes || []).some(f => f && f.fechado);
}
