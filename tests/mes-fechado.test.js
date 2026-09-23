/*  TESTES DO MÊS FECHADO
 *  =====================
 *  Rodar:  node --test tests/*.test.js
 *
 *  A trava (mes-fechado.js) faz uma pergunta só, sobre o estado antes e
 *  depois de uma alteração: algum mês fechado ficaria diferente? Estes
 *  testes guardam o que o dono decidiu em 23/09/2026: fechado trava tudo
 *  do mês (notas, taxa, % do motorista, conjuntos), por empresa, e só o
 *  que está no mês fechado.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

if (typeof globalThis.violacoesMesFechado !== "function") {
    globalThis.db = globalThis.db || { lancamentos: [], empresas: [], configAlertas: {} };
    globalThis.empresaFiltroGlobal = globalThis.empresaFiltroGlobal || "";
    globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {}, removeItem() {} };
    globalThis.salvarDB = globalThis.salvarDB || (() => {});
    if (typeof globalThis.calcularFretesDoMes !== "function") {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src", "shared", "utils.js"), "utf8"), { filename: "utils.js" });
    }
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src", "shared", "mes-fechado.js"), "utf8"), { filename: "mes-fechado.js" });
}

const clone = o => JSON.parse(JSON.stringify(o));

const POSTO = {
    id: "e1", nome: "Posto", taxaFrete: 0.10,
    taxaHistorico: [{ taxa: 0.10, vigenciaDe: "2000-01-01", vigenciaAte: null }]
};
const FAB = { id: "e2", nome: "Fabiandra", taxaFrete: 0.10 };

const nota = (id, empresa, descarga, extra = {}) => ({
    id, empresa, dataNota: descarga, dataDescarga: descarga, placa: "ABC1D23", motorista: "José",
    itens: [{ tipo: "S10", qtd: 10000 }], ...extra
});

const fechado = (empresaId, mes) => ({
    id: `${empresaId}__${mes}`, empresaId, mes, fechado: true,
    logs: [{ acao: "Fechado", ts: "2026-08-02T10:00:00.000Z", usuario: "Dono" }]
});

const CONJ = {
    id: "c1", nome: "Conjunto 1", composicaoAtual: ["ABC1D23", "XYZ9A87"], ativo: true,
    historico: [{ placas: ["ABC1D23", "XYZ9A87"], vigenciaDe: "2026-01-01", vigenciaAte: null }]
};

function estadoBase() {
    return {
        lancamentos: [
            nota("n1", "Posto", "2026-07-10"),
            nota("n2", "Posto", "2026-08-05"),
            nota("n3", "Fabiandra", "2026-07-12")
        ],
        empresas: [clone(POSTO), clone(FAB)],
        conjuntosVeiculos: [clone(CONJ)],
        // Julho fechado só para o Posto.
        fechamentosMes: [fechado("e1", "2026-07")]
    };
}

test("sem mês fechado, nada é recusado", () => {
    const antes = estadoBase();
    antes.fechamentosMes = [];
    const depois = clone(antes);
    depois.lancamentos[0].itens[0].qtd = 1;
    assert.deepEqual(violacoesMesFechado(antes, depois), []);
});

test("editar, excluir ou tirar a nota do mês fechado é recusado", () => {
    const antes = estadoBase();

    const editada = clone(antes);
    editada.lancamentos[0].itens[0].qtd = 9000;
    const v = violacoesMesFechado(antes, editada);
    assert.equal(v.length, 1);
    assert.equal(v[0].empresaId, "e1");
    assert.equal(v[0].mes, "2026-07");
    assert.deepEqual(v[0].motivos, ["notas"]);

    const excluida = clone(antes);
    excluida.lancamentos[0].estado = "excluido";
    assert.equal(violacoesMesFechado(antes, excluida).length, 1);

    // Mudar a descarga para agosto tira a nota de julho: também altera julho.
    const movida = clone(antes);
    movida.lancamentos[0].dataDescarga = "2026-08-01";
    assert.equal(violacoesMesFechado(antes, movida).length, 1);
});

test("nota nova entra em mês aberto e é recusada em mês fechado", () => {
    const antes = estadoBase();
    const emAgosto = clone(antes);
    emAgosto.lancamentos.push(nota("n9", "Posto", "2026-08-20"));
    assert.deepEqual(violacoesMesFechado(antes, emAgosto), []);

    const emJulho = clone(antes);
    emJulho.lancamentos.push(nota("n9", "Posto", "2026-07-31"));
    assert.equal(violacoesMesFechado(antes, emJulho).length, 1);
});

test("o fechamento é por empresa: julho da Fabiandra continua aberto", () => {
    const antes = estadoBase();
    const depois = clone(antes);
    depois.lancamentos[2].itens[0].qtd = 1;
    assert.deepEqual(violacoesMesFechado(antes, depois), []);
});

test("o mês é o da DESCARGA, não o da emissão", () => {
    const antes = estadoBase();
    // Emitida em julho, descarregada em agosto: é de agosto, que está aberto.
    antes.lancamentos.push(nota("n5", "Posto", "2026-08-01", { dataNota: "2026-07-30" }));
    const depois = clone(antes);
    depois.lancamentos[3].itens[0].qtd = 1;
    assert.deepEqual(violacoesMesFechado(antes, depois), []);
});

test("taxa: vigência que muda um dia de julho é recusada; a partir de agosto passa", () => {
    const antes = estadoBase();

    const emJulho = clone(antes);
    emJulho.empresas[0].taxaHistorico = [
        { taxa: 0.10, vigenciaDe: "2000-01-01", vigenciaAte: "2026-07-19" },
        { taxa: 0.12, vigenciaDe: "2026-07-20", vigenciaAte: null }
    ];
    const v = violacoesMesFechado(antes, emJulho);
    assert.equal(v.length, 1);
    assert.deepEqual(v[0].motivos, ["taxa de frete"]);

    const emAgosto = clone(antes);
    emAgosto.empresas[0].taxaHistorico = [
        { taxa: 0.10, vigenciaDe: "2000-01-01", vigenciaAte: "2026-07-31" },
        { taxa: 0.12, vigenciaDe: "2026-08-01", vigenciaAte: null }
    ];
    assert.deepEqual(violacoesMesFechado(antes, emAgosto), []);
});

test("taxa: trocar a forma do histórico sem mudar valor de nenhum dia passa", () => {
    const antes = estadoBase();
    antes.empresas[0].taxaHistorico = [{ taxa: 0.10, vigenciaDe: "2026-09-23", vigenciaAte: null }];
    const depois = clone(antes);
    // Antes de 23/09 valia a mais antiga (0,10); gravar desde o início dá o mesmo.
    depois.empresas[0].taxaHistorico = [{ taxa: 0.10, vigenciaDe: "2000-01-01", vigenciaAte: null }];
    assert.deepEqual(violacoesMesFechado(antes, depois), []);
});

test("% do motorista: vigência dentro de julho é recusada", () => {
    const antes = estadoBase();
    const depois = clone(antes);
    depois.empresas[0].pctHistorico = [
        { pct: 1, vigenciaDe: "2000-01-01", vigenciaAte: "2026-07-14" },
        { pct: 2, vigenciaDe: "2026-07-15", vigenciaAte: null }
    ];
    const v = violacoesMesFechado(antes, depois);
    assert.equal(v.length, 1);
    assert.deepEqual(v[0].motivos, ["% do motorista"]);
});

test("conjunto: nova composição que vale em julho é recusada; a partir de agosto passa", () => {
    const antes = estadoBase();

    const emJulho = clone(antes);
    emJulho.conjuntosVeiculos[0].historico = [
        { placas: ["ABC1D23", "XYZ9A87"], vigenciaDe: "2026-01-01", vigenciaAte: "2026-07-20" },
        { placas: ["ABC1D23", "QWE1R23"], vigenciaDe: "2026-07-20", vigenciaAte: null }
    ];
    const v = violacoesMesFechado(antes, emJulho);
    assert.equal(v.length, 1);
    assert.deepEqual(v[0].motivos, ["conjuntos de veículos"]);

    const emAgosto = clone(antes);
    emAgosto.conjuntosVeiculos[0].historico = [
        { placas: ["ABC1D23", "XYZ9A87"], vigenciaDe: "2026-01-01", vigenciaAte: "2026-08-01" },
        { placas: ["ABC1D23", "QWE1R23"], vigenciaDe: "2026-08-01", vigenciaAte: null }
    ];
    // A última composição que contém a placa na data vence: 01/08 já é a nova.
    assert.deepEqual(violacoesMesFechado(antes, emAgosto), []);
});

test("reabrir e fechar, sozinhos, não mudam nada", () => {
    const antes = estadoBase();
    const reaberto = clone(antes);
    reaberto.fechamentosMes[0].fechado = false;
    assert.deepEqual(violacoesMesFechado(antes, reaberto), []);
    assert.deepEqual(violacoesMesFechado(reaberto, antes), []);
});

test("renomear o motorista de nota de mês fechado é recusado", () => {
    const antes = estadoBase();
    const depois = clone(antes);
    depois.lancamentos = depois.lancamentos.map(l => Object.assign({}, l, { motorista: "José da Silva" }));
    const v = violacoesMesFechado(antes, depois);
    assert.equal(v.length, 1);
    assert.equal(v[0].empresaId, "e1");
});

test("o carimbo de empresaId da memória não conta como alteração", () => {
    const antes = estadoBase();
    const depois = clone(antes);
    depois.lancamentos.forEach(l => { l.empresaId = l.empresa === "Posto" ? "e1" : "e2"; });
    assert.deepEqual(violacoesMesFechado(antes, depois), []);
});

test("% do motorista por data: o frete paga cada nota pelo % da descarga", () => {
    const emp = {
        id: "e1", nome: "Posto", taxaFrete: 0.10, percentualMotorista: 2,
        pctHistorico: [
            { pct: 1, vigenciaDe: "2000-01-01", vigenciaAte: "2026-08-15" },
            { pct: 2, vigenciaDe: "2026-08-16", vigenciaAte: null }
        ]
    };
    assert.equal(_percentualMotoristaDaEmpresaNaData(emp, "2026-08-15"), 1);
    assert.equal(_percentualMotoristaDaEmpresaNaData(emp, "2026-08-16"), 2);
    // Sem histórico, vale o percentual único, e sem ele o padrão de 1%.
    assert.equal(_percentualMotoristaDaEmpresaNaData({ percentualMotorista: 3 }, "2026-08-01"), 3);
    assert.equal(_percentualMotoristaDaEmpresaNaData({}, "2026-08-01"), 1);

    const r = calcularFretesDoMes({
        mes: "2026-08",
        lancamentos: [nota("a", "Posto", "2026-08-10"), nota("b", "Posto", "2026-08-20")],
        empresaDoLancamento: () => emp
    });
    // 10.000 L × 0,10 = R$ 1.000 por nota; 1% da primeira e 2% da segunda.
    assert.equal(r.totalPagamento.toFixed(2), (10 + 20).toFixed(2));
});

test("descrição da recusa diz empresa, mês e o quê", () => {
    const txt = descreverViolacoesMes(
        [{ empresaId: "e1", mes: "2026-07", motivos: ["notas", "taxa de frete"] }],
        [POSTO]);
    assert.equal(txt, "Posto, julho de 2026 (notas, taxa de frete)");
});
