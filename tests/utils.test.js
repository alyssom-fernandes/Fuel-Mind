/*  TESTES DAS CONTAS QUE MEXEM COM DINHEIRO
 *  ==========================================
 *  Rodar:  node --test tests
 *
 *  Não há build, não há npm install, não há servidor: `node --test` é
 *  nativo do Node (v24 já está na máquina) e o `utils.js` é carregável
 *  fora do navegador porque só declara funções — nenhum acesso ao DOM na
 *  carga. É por isso que a suíte começa por ele.
 *
 *  O que está aqui é o que, se mudar sem eu perceber, muda um número que
 *  vai para o bolso de alguém: litros, preço por litro, taxa de frete,
 *  janela da régua de preço e o critério de nota válida.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// `utils.js` declara tudo no escopo global do navegador; aqui ele é
// avaliado neste mesmo contexto, e as funções ficam disponíveis por nome.
const codigo = fs.readFileSync(path.join(__dirname, "..", "utils.js"), "utf8");
globalThis.db = { lancamentos: [], empresas: [], configAlertas: {} };
globalThis.empresaFiltroGlobal = "";
globalThis.localStorage = {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
};
globalThis.salvarDB = () => {};
vm.runInThisContext(codigo, { filename: "utils.js" });

/* ── LITROS ──────────────────────────────────────────────────────────── */
test("_litrosItem usa a descarga quando informada e a carga quando não", () => {
    assert.equal(_litrosItem({ qtd: 1000, qtdDescargada: 995 }), 995);
    assert.equal(_litrosItem({ qtd: 1000, qtdDescargada: 0 }), 1000);
    assert.equal(_litrosItem({ qtd: 1000 }), 1000);
    assert.equal(_litrosItem({}), 0);
});

/* ── NOTA QUE VALE ───────────────────────────────────────────────────── */
test("lancamentoAtivo: só a ausência de estado é nota válida", () => {
    assert.equal(lancamentoAtivo({ id: "1" }), true);
    assert.equal(lancamentoAtivo({ id: "1", estado: "excluido" }), false);
    assert.equal(lancamentoAtivo({ id: "1", estado: "cancelado" }), false);
    // Convenção do projeto: nunca comparar com a string 'ativo'.
    assert.equal(lancamentoAtivo({ id: "1", estado: "ativo" }), false);
    assert.equal(lancamentoAtivo(null), false);
});

/* ── AS DUAS DATAS ───────────────────────────────────────────────────── */
test("as duas datas: descarga cai para a data da nota em registro antigo", () => {
    assert.equal(dataEmissaoDe({ dataNota: "2026-08-10", dataDescarga: "2026-08-12" }), "2026-08-10");
    assert.equal(dataDescargaDe({ dataNota: "2026-08-10", dataDescarga: "2026-08-12" }), "2026-08-12");
    assert.equal(dataDescargaDe({ dataNota: "2026-08-10" }), "2026-08-10");
    assert.equal(dataEmissaoDe({}), "");
});

/* ── PREÇO POR LITRO (decisão de 17/09/2026) ─────────────────────────── */
test("metricasPreco: o preço de compra divide pelos litros FATURADOS", () => {
    const itens = [
        { qtd: 1000, valor: 6, total: 6000, qtdDescargada: 990 },
        { qtd: 1000, valor: 5, total: 5000 }
    ];
    const m = metricasPreco(itens);
    assert.equal(m.gasto, 11000);
    assert.equal(m.litrosNota, 2000);
    assert.equal(m.precoCompra, 5.5);              // 11000 / 2000
    assert.equal(m.itensTotal, 2);
    // Só o item medido entra no custo recebido.
    assert.equal(m.itensMedidos, 1);
    assert.equal(m.litrosRecebidos, 990);
    assert.equal(m.custoRecebido.toFixed(4), (6000 / 990).toFixed(4));
    // E o mesmo grupo pela carga, para a comparação ser do mesmo tamanho.
    assert.equal(m.precoCompraMedido, 6);
});

test("metricasPreco: perda encarece o litro recebido, nunca o faturado", () => {
    const m = metricasPreco([{ qtd: 1000, valor: 6, total: 6000, qtdDescargada: 997 }]);
    assert.equal(m.precoCompra, 6);
    assert.ok(m.custoRecebido > m.precoCompra);
});

test("metricasPreco: item sem total usa quantidade vezes preço", () => {
    const m = metricasPreco([{ qtd: 500, valor: 4.5 }]);
    assert.equal(m.gasto, 2250);
    assert.equal(m.precoCompra, 4.5);
});

test("metricasPreco: sem item nenhum não divide por zero", () => {
    const m = metricasPreco([]);
    assert.equal(m.precoCompra, 0);
    assert.equal(m.custoRecebido, 0);
    assert.equal(m.precoCompraMedido, 0);
});

/* ── TAXA DE FRETE ───────────────────────────────────────────────────── */
test("_taxaFreteDaEmpresa: valor ausente, inválido ou negativo vira zero", () => {
    assert.equal(_taxaFreteDaEmpresa({ taxaFrete: 0.28 }), 0.28);
    assert.equal(_taxaFreteDaEmpresa({ taxaFrete: "0.28" }), 0.28);
    assert.equal(_taxaFreteDaEmpresa({ taxaFrete: -1 }), 0);
    assert.equal(_taxaFreteDaEmpresa({ taxaFrete: "abc" }), 0);
    assert.equal(_taxaFreteDaEmpresa({}), 0);
    assert.equal(_taxaFreteDaEmpresa(null), 0);
});

/* ── VIGÊNCIA DA TAXA (17/09/2026) ───────────────────────────────────── */
test("_taxaFreteDaEmpresaNaData: cada mês usa a taxa que valia nele", () => {
    const empresa = {
        nome: "Aurora",
        taxaFrete: 0.32,
        taxaHistorico: [
            { taxa: 0.28, vigenciaDe: "2000-01-01", vigenciaAte: "2026-08-31" },
            { taxa: 0.32, vigenciaDe: "2026-09-01", vigenciaAte: null }
        ]
    };
    // Mês já pago continua com a taxa daquele mês.
    assert.equal(_taxaFreteDaEmpresaNaData(empresa, "2026-08-15"), 0.28);
    assert.equal(_taxaFreteDaEmpresaNaData(empresa, "2026-08-31"), 0.28);
    // A nova vale do dia em que entrou.
    assert.equal(_taxaFreteDaEmpresaNaData(empresa, "2026-09-01"), 0.32);
    assert.equal(_taxaFreteDaEmpresaNaData(empresa, "2026-12-31"), 0.32);
    // Sem histórico, a taxa do registro vale para tudo (empresa antiga).
    assert.equal(_taxaFreteDaEmpresaNaData({ taxaFrete: 0.2 }, "2026-08-15"), 0.2);
    // Sem data, é a taxa de hoje.
    assert.equal(_taxaFreteDaEmpresaNaData(empresa, null), 0.32);
    assert.equal(_taxaFreteDaEmpresaNaData(null, "2026-08-15"), 0);
});

test("_taxaFreteDaEmpresaNaData: data anterior a toda vigência usa a mais antiga", () => {
    const empresa = { taxaFrete: 0.5, taxaHistorico: [{ taxa: 0.4, vigenciaDe: "2026-05-01", vigenciaAte: null }] };
    assert.equal(_taxaFreteDaEmpresaNaData(empresa, "2026-01-10"), 0.4);
});

/* ── DATAS SEM UTC ───────────────────────────────────────────────────── */
test("_somarDiasISO e _ultimoDiaDoMesISO andam pelo calendário local", () => {
    assert.equal(_somarDiasISO("2026-08-10", -6), "2026-08-04");
    assert.equal(_somarDiasISO("2026-03-01", -1), "2026-02-28");
    assert.equal(_ultimoDiaDoMesISO("2026-02-10"), "2026-02-28");
    assert.equal(_ultimoDiaDoMesISO("2026-08-01"), "2026-08-31");
});

test("_periodoAnterior: mês inteiro compara com o mês inteiro anterior", () => {
    assert.deepEqual(_periodoAnterior("2026-08-01", "2026-08-31"),
                     { inicio: "2026-07-01", fim: "2026-07-31" });
    // Trecho do mês: mesmo trecho do mês anterior.
    assert.deepEqual(_periodoAnterior("2026-08-01", "2026-08-16"),
                     { inicio: "2026-07-01", fim: "2026-07-16" });
    // Fora do dia 1: o mesmo número de dias imediatamente antes.
    assert.deepEqual(_periodoAnterior("2026-08-10", "2026-08-12"),
                     { inicio: "2026-08-07", fim: "2026-08-09" });
});

/* ── A RÉGUA DE PREÇO ────────────────────────────────────────────────── */
test("referenciaPrecoCombustivel: mediana da janela, sem a nota julgada", () => {
    globalThis.empresaFiltroGlobal = "Aurora";
    db.configAlertas = {};   // padrões: 7 dias, R$ 0,25/L
    db.lancamentos = [
        { id: "a", empresa: "Aurora", dataNota: "2026-08-10", itens: [{ tipo: "S10", qtd: 1, valor: 6.00 }] },
        { id: "b", empresa: "Aurora", dataNota: "2026-08-09", itens: [{ tipo: "S10", qtd: 1, valor: 6.10 }] },
        { id: "c", empresa: "Aurora", dataNota: "2026-08-08", itens: [{ tipo: "S10", qtd: 1, valor: 6.20 }] },
        // Fora da janela de 7 dias que termina em 10/08 (o dia e os 6 antes).
        { id: "d", empresa: "Aurora", dataNota: "2026-08-03", itens: [{ tipo: "S10", qtd: 1, valor: 99 }] },
        // Outra empresa não entra.
        { id: "e", empresa: "Bandeirante", dataNota: "2026-08-10", itens: [{ tipo: "S10", qtd: 1, valor: 1 }] },
        // Nota morta não entra.
        { id: "f", empresa: "Aurora", dataNota: "2026-08-10", estado: "excluido", itens: [{ tipo: "S10", qtd: 1, valor: 1 }] }
    ];
    const r = referenciaPrecoCombustivel("S10", "2026-08-10", null, "Aurora");
    assert.equal(r.amostras, 3);
    assert.equal(r.mediana, 6.10);
    assert.equal(r.dias, 7);
    // A nota em edição sai da régua que a julga.
    const semB = referenciaPrecoCombustivel("S10", "2026-08-10", "b", "Aurora");
    assert.equal(semB.amostras, 2);
    assert.equal(semB.mediana, 6.10);   // média de 6,00 e 6,20
    // Sem nota na janela, não há referência.
    const vazio = referenciaPrecoCombustivel("S10", "2026-01-10", null, "Aurora");
    assert.equal(vazio.amostras, 0);
    assert.equal(vazio.mediana, 0);
});

test("julgarPreco: alerta a partir do limite exato, para cima e para baixo", () => {
    db.configAlertas = {};   // padrão R$ 0,25/L
    assert.equal(julgarPreco(6.00, 6.00), null);
    assert.equal(julgarPreco(6.24, 6.00), null);
    const acima = julgarPreco(6.25, 6.00);
    assert.ok(acima && acima.acima === true);
    assert.equal(acima.diferenca, 0.25);
    const abaixo = julgarPreco(5.75, 6.00);
    assert.ok(abaixo && abaixo.acima === false);
    assert.equal(abaixo.diferenca, -0.25);
    // Sem referência, ou com o alerta desligado, não há julgamento.
    assert.equal(julgarPreco(6.25, 0), null);
    db.configAlertas = { precoAtivo: false };
    assert.equal(julgarPreco(99, 6.00), null);
    db.configAlertas = {};
});

/* ── NÚMERO EM PORTUGUÊS ─────────────────────────────────────────────── */
test("parseNumeroBR: vírgula decimal, milhar e texto inválido", () => {
    assert.equal(parseNumeroBR("1.234,567"), 1234.567);
    assert.equal(parseNumeroBR("1234,5"), 1234.5);
    assert.equal(parseNumeroBR("0,25"), 0.25);
    assert.equal(parseNumeroBR(""), null);
    assert.equal(parseNumeroBR("abc"), null);
});
