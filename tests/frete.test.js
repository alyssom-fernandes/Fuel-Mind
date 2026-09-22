/*  TESTES DO MOTOR DE FRETE
 *  ========================
 *  Rodar:  node --test tests/*.test.js
 *
 *  O motor foi tirado de dentro da tela de Fretes em 18/09/2026 justamente
 *  para caber aqui. Antes da troca, o motor novo foi comparado com o
 *  antigo no modo demonstração — três empresas, quatro meses, grupo a
 *  grupo — e deu os mesmos números nos doze casos. Estes testes guardam as
 *  regras que o dono decidiu, para que nenhuma mudança as quebre calada.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

if (typeof globalThis.calcularFretesDoMes !== "function") {
    globalThis.db = globalThis.db || { lancamentos: [], empresas: [], configAlertas: {} };
    globalThis.empresaFiltroGlobal = globalThis.empresaFiltroGlobal || "";
    globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {}, removeItem() {} };
    globalThis.salvarDB = globalThis.salvarDB || (() => {});
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src", "shared", "utils.js"), "utf8"), { filename: "utils.js" });
}

const AURORA = {
    id: "e1", nome: "Aurora", taxaFrete: 0.30,
    taxaHistorico: [
        { taxa: 0.28, vigenciaDe: "2000-01-01", vigenciaAte: "2026-08-15" },
        { taxa: 0.30, vigenciaDe: "2026-08-16", vigenciaAte: null }
    ]
};
const VALE = { id: "e2", nome: "Vale", taxaFrete: 0 };
const EMPRESAS = [AURORA, VALE];
const empresaDe = l => EMPRESAS.find(e => e.nome === l.empresa) || null;

const nota = (id, empresa, dataNota, dataDescarga, itens, extra = {}) =>
    ({ id, empresa, dataNota, dataDescarga, placa: "ABC1D23", motorista: "José", itens, ...extra });

test("frete conta pela DESCARGA, sobre a CARGA da nota, com a taxa da data", () => {
    const lancs = [
        // Emitida em julho, descarregada em agosto: é frete de agosto.
        nota("1", "Aurora", "2026-07-31", "2026-08-01", [{ tipo: "S10", qtd: 10000, qtdDescargada: 9970 }]),
        // Depois da mudança de taxa (16/08): 0,30.
        nota("2", "Aurora", "2026-08-20", "2026-08-20", [{ tipo: "S10", qtd: 5000 }]),
        // Descarregada em setembro: fora de agosto.
        nota("3", "Aurora", "2026-08-31", "2026-09-01", [{ tipo: "S10", qtd: 7000 }])
    ];
    const r = calcularFretesDoMes({ lancamentos: lancs, mes: "2026-08", empresaDoLancamento: empresaDe });
    assert.equal(r.totalNotas, 2);
    // A carga (10.000), não a descarga (9.970): decisão do dono.
    assert.equal(r.totalLitros, 15000);
    // 10.000 × 0,28 (vigência até 15/08) + 5.000 × 0,30.
    assert.equal(r.totalFrete.toFixed(2), (10000 * 0.28 + 5000 * 0.30).toFixed(2));
});

test("nota excluída ou cancelada não gera frete", () => {
    const lancs = [
        nota("1", "Aurora", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }]),
        nota("2", "Aurora", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }], { estado: "excluido" }),
        nota("3", "Aurora", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }], { estado: "cancelado" })
    ];
    const r = calcularFretesDoMes({ lancamentos: lancs, mes: "2026-08", empresaDoLancamento: empresaDe });
    assert.equal(r.totalNotas, 1);
    assert.equal(r.totalLitros, 1000);
});

test("uma viagem por nota, não uma por combustível da nota", () => {
    const lancs = [
        nota("1", "Aurora", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }, { tipo: "Gasolina", qtd: 500 }])
    ];
    const r = calcularFretesDoMes({ lancamentos: lancs, mes: "2026-08", empresaDoLancamento: empresaDe });
    assert.equal(r.porPlaca[0].viagens, 1);
    assert.equal(r.porMotorista[0].viagens, 1);
    assert.equal(Object.keys(r.porPlaca[0].detalhes).length, 2);
});

test("os quatro agrupamentos somam o mesmo total", () => {
    const lancs = [
        nota("1", "Aurora", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }], { placa: "AAA1A11", motorista: "Ana" }),
        nota("2", "Aurora", "2026-08-03", "2026-08-03", [{ tipo: "S10", qtd: 2000 }], { placa: "BBB2B22", motorista: "Bia" }),
        nota("3", "Aurora", "2026-08-25", "2026-08-25", [{ tipo: "S10", qtd: 3000 }], { placa: "AAA1A11", motorista: "Bia" })
    ];
    const r = calcularFretesDoMes({ lancamentos: lancs, mes: "2026-08", empresaDoLancamento: empresaDe });
    const soma = lista => +lista.reduce((s, x) => s + x.frete, 0).toFixed(2);
    assert.equal(soma(r.porPlaca), +r.totalFrete.toFixed(2));
    assert.equal(soma(r.porMotorista), +r.totalFrete.toFixed(2));
    assert.equal(soma(r.porEmpresa), +r.totalFrete.toFixed(2));
});

test("empresa fora do cadastro e taxa zerada são contadas, não silenciadas", () => {
    const lancs = [
        nota("1", "Desconhecida", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }]),
        nota("2", "Vale", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }])
    ];
    const r = calcularFretesDoMes({ lancamentos: lancs, mes: "2026-08", empresaDoLancamento: empresaDe });
    assert.equal(r.semTaxa, 1);
    assert.equal(r.taxaZero, 1);
    assert.deepEqual(r.empresasTaxaZero, ["Vale"]);
    assert.equal(r.totalFrete, 0);
});

test("o filtro de empresa deixa só as notas dela", () => {
    const lancs = [
        nota("1", "Aurora", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }]),
        nota("2", "Vale", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }])
    ];
    const r = calcularFretesDoMes({ lancamentos: lancs, mes: "2026-08", empresaFiltro: "Aurora", empresaDoLancamento: empresaDe });
    assert.equal(r.totalNotas, 1);
    assert.equal(r.porEmpresa[0].nome, "Aurora");
});

test("o conjunto é o que continha a placa NA DATA da descarga", () => {
    const resolver = (placa, data) => data <= "2026-08-15"
        ? { conj: { id: "c1", nome: "Bitrem 01" }, periodo: { placas: [placa, "XYZ9Z99"] } }
        : { conj: { id: "c2", nome: "Rodotrem 02" }, periodo: { placas: [placa] } };
    const lancs = [
        nota("1", "Aurora", "2026-08-02", "2026-08-02", [{ tipo: "S10", qtd: 1000 }]),
        nota("2", "Aurora", "2026-08-20", "2026-08-20", [{ tipo: "S10", qtd: 1000 }])
    ];
    const r = calcularFretesDoMes({ lancamentos: lancs, mes: "2026-08", empresaDoLancamento: empresaDe, resolverConjunto: resolver });
    assert.deepEqual(r.porConjunto.map(c => c.nome), ["Bitrem 01", "Rodotrem 02"]);
    assert.equal(r.porConjunto[0].viagens, 1);
    assert.equal(r.porConjunto[0].porPlacaInterna["ABC1D23"].viagens, 1);
});

test("mês sem descarga devolve tudo zerado, sem erro", () => {
    const r = calcularFretesDoMes({ lancamentos: [], mes: "2026-08", empresaDoLancamento: empresaDe });
    assert.equal(r.totalNotas, 0);
    assert.equal(r.totalFrete, 0);
    assert.deepEqual(r.porPlaca, []);
});

/* ── PAGAMENTO AO MOTORISTA (22/09/2026) ─────────────────────────────
 *  A regra saiu da planilha do dono: em agosto de 2026 ele pagou
 *  R$ 5.967,00 sobre R$ 596.700,00 de frete, exatamente 1%. A conta dele
 *  era "(litros POSTO + litros TRR) ÷ 1.000", que com taxa de R$ 0,10/L dá
 *  no mesmo. Guardamos como percentual para que o pagamento acompanhe uma
 *  futura mudança de taxa.
 */
const POSTO = { id: "p1", nome: "Posto Rosario", taxaFrete: 0.10, taxaHistorico: [] };
const TRR   = { id: "p2", nome: "Fabiandra",     taxaFrete: 0.10, taxaHistorico: [] };

function _notaFrete(empresa, litros, dia, motorista) {
    return {
        id: "n" + dia + empresa, empresa, motorista, placa: "ABC1D23",
        dataDescarga: `2026-08-${String(dia).padStart(2, "0")}`,
        itens: [{ tipo: "Diesel S10", qtd: litros, valor: 6 }]
    };
}

test("_percentualMotoristaDaEmpresa: padrão 1%, zero é zero, valor próprio manda", () => {
    assert.equal(_percentualMotoristaDaEmpresa(undefined), 1);
    assert.equal(_percentualMotoristaDaEmpresa({}), 1);
    assert.equal(_percentualMotoristaDaEmpresa({ percentualMotorista: 0 }), 0);
    assert.equal(_percentualMotoristaDaEmpresa({ percentualMotorista: 2.5 }), 2.5);
    // Lixo no campo não zera o pagamento em silêncio: volta ao padrão.
    assert.equal(_percentualMotoristaDaEmpresa({ percentualMotorista: "abc" }), 1);
    assert.equal(_percentualMotoristaDaEmpresa({ percentualMotorista: -3 }), 1);
});

test("agosto de 2026: R$ 596.700,00 de frete e R$ 5.967,00 aos motoristas", () => {
    const empresas = [POSTO, TRR];
    const lancamentos = [
        _notaFrete("Posto Rosario", 2458000, 10, "ADALBERON"),
        _notaFrete("Fabiandra",     3509000, 11, "ADALBERON")
    ];
    const r = calcularFretesDoMes({
        lancamentos, mes: "2026-08",
        empresaDoLancamento: l => empresas.find(e => e.nome === l.empresa) || null
    });
    assert.equal(r.totalLitros, 5967000);
    assert.equal(+r.totalFrete.toFixed(2), 596700.00);
    assert.equal(+r.totalPagamento.toFixed(2), 5967.00);
    // O que o dono confere: R$ 1,00 por mil litros.
    assert.equal(+(r.totalPagamento / (r.totalLitros / 1000)).toFixed(4), 1.0000);
    // E o mesmo número chega no agrupamento por motorista.
    assert.equal(+r.porMotorista[0].pagamento.toFixed(2), 5967.00);
});

test("cada empresa com o seu percentual, no mesmo motorista", () => {
    const empresas = [
        Object.assign({}, POSTO, { percentualMotorista: 1 }),
        Object.assign({}, TRR,   { percentualMotorista: 2 })
    ];
    const r = calcularFretesDoMes({
        lancamentos: [_notaFrete("Posto Rosario", 100000, 5, "BENTO"),
                      _notaFrete("Fabiandra",     100000, 6, "BENTO")],
        mes: "2026-08",
        empresaDoLancamento: l => empresas.find(e => e.nome === l.empresa) || null
    });
    // 100.000 x 0,10 = 10.000 de frete em cada. 1% + 2% = 100 + 200.
    assert.equal(+r.totalFrete.toFixed(2), 20000.00);
    assert.equal(+r.porMotorista[0].pagamento.toFixed(2), 300.00);
});

test("percentual zerado não paga, e a nota continua gerando frete", () => {
    const empresas = [Object.assign({}, POSTO, { percentualMotorista: 0 })];
    const r = calcularFretesDoMes({
        lancamentos: [_notaFrete("Posto Rosario", 50000, 7, "ELIS")],
        mes: "2026-08",
        empresaDoLancamento: l => empresas.find(e => e.nome === l.empresa) || null
    });
    assert.equal(+r.totalFrete.toFixed(2), 5000.00);
    assert.equal(r.totalPagamento, 0);
});

test("cada grupo se abre por empresa, como o fechamento do dono entrega", () => {
    const empresas = [POSTO, TRR];
    const r = calcularFretesDoMes({
        lancamentos: [
            _notaFrete("Posto Rosario", 118000, 10, "ADALBERON"),
            _notaFrete("Fabiandra",     236000, 11, "ADALBERON")
        ],
        mes: "2026-08",
        empresaDoLancamento: l => empresas.find(e => e.nome === l.empresa) || null
    });
    const m = r.porMotorista[0];
    // É a linha do ADALBERON na planilha de agosto: 118.000 no POSTO,
    // 236.000 no TRR, 354.000 no total, R$ 354,00 a receber.
    assert.equal(m.porEmpresa["Posto Rosario"].litros, 118000);
    assert.equal(m.porEmpresa["Fabiandra"].litros,     236000);
    assert.equal(+m.porEmpresa["Posto Rosario"].frete.toFixed(2), 11800.00);
    assert.equal(+m.porEmpresa["Fabiandra"].frete.toFixed(2),     23600.00);
    assert.equal(+m.pagamento.toFixed(2), 354.00);
    assert.deepEqual(r.empresasDoMes, ["Fabiandra", "Posto Rosario"]);
});
