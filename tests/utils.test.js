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
const codigo = fs.readFileSync(path.join(__dirname, "..", "src", "shared", "utils.js"), "utf8");
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

/* ── DUAS CASAS NO FRETE, TRÊS NO PREÇO (22/09/2026) ─────────────────── */
/*  O dono separou os dois números: a taxa vem de contrato e os contratos
 *  dele são redondos (R$ 0,10/L); o preço vem da NF-e, que traz até dez
 *  casas. Estes testes existem para que ninguém volte a juntar as duas
 *  funções — se `fmtFreteL` passar a chamar `fmtRL`, o preço da nota perde
 *  uma casa na tela inteira sem ninguém notar.
 */
test("fmtFreteL: taxa de frete com duas casas", () => {
    assert.equal(fmtFreteL(0.10),   "R$ 0,10");
    assert.equal(fmtFreteL(0.1),    "R$ 0,10");
    assert.equal(fmtFreteL(0),      "R$ 0,00");
    assert.equal(fmtFreteL(0.125),  "R$ 0,13");
    assert.equal(fmtFreteL(1.5),    "R$ 1,50");
});

test("fmtRL continua com três casas: o preço da nota não foi junto", () => {
    assert.equal(fmtRL(6.18),   "R$ 6,180");
    assert.equal(fmtRL(5.8765), "R$ 5,877");
    assert.equal(fmtRL(0.10),   "R$ 0,100");
});

test("frete de R$ 0,10/L: a tela reproduz a conta na calculadora", () => {
    // O que motivou a mudança: com 3 casas a tela escrevia "R$ 0,100/L", e
    // quem conferia na mão multiplicava por um número com uma casa a mais
    // do que o contrato tem. Com 0,10 o texto e a conta agora coincidem.
    const taxa = 0.10, litros = 2458000;
    assert.equal(fmtFreteL(taxa), "R$ 0,10");
    assert.equal(fmtR(litros * taxa), "R$ 245.800,00");
});

test("_formatoPlanilhaPorCabecalho: a planilha diz o mesmo que a tela", () => {
    const f = _formatoPlanilhaPorCabecalho;
    // Frete: duas casas, como na tela desde 22/09/2026.
    assert.equal(f("taxa (r$/l)", 0.10),                 "#,##0.00");
    assert.equal(f("frete/l", 0.10),                     "#,##0.00");
    assert.equal(f("frete (r$)", 245800),                "#,##0.00");
    assert.equal(f("frete (descarga)", 245800),          "#,##0.00");
    // Preço do combustível: continua com três.
    assert.equal(f("preço médio/l (faturado)", 6.18),    "#,##0.000");
    assert.equal(f("valor unit.", 5.8765),               "#,##0.000");
    // Litros: inteiro sem casas, quebrado com três.
    assert.equal(f("litros (l)", 60000),                 "#,##0");
    assert.equal(f("litros (l)", 60000.5),               "#,##0.000");
    assert.equal(f("viagens", 4),                        "");
});

/* ── APELIDOS DE CADASTRO (22/09/2026) ───────────────────────────────
 *  A equipe escreve "BMAD" e "RICARDO R"; o cadastro guarda o nome
 *  completo. Estes testes guardam as duas cautelas da regra: nome exato
 *  nunca perde para apelido, e apelido ambíguo não é resolvido no chute.
 */
test("_cadastroPorNomeOuApelido: nome, apelido, e o que NÃO pode acontecer", () => {
    const bases = [
        { nome: "RAIZEN · S. F. CONDE", apelidos: "BMAD / MADRE DE DEUS" },
        { nome: "RAIZEN · BRASILIA",    apelidos: "BSB" },
        { nome: "PETROBAHIA · LEM" }
    ];
    assert.equal(_cadastroPorNomeOuApelido(bases, "RAIZEN · S. F. CONDE").nome, "RAIZEN · S. F. CONDE");
    assert.equal(_cadastroPorNomeOuApelido(bases, "BMAD").nome,          "RAIZEN · S. F. CONDE");
    assert.equal(_cadastroPorNomeOuApelido(bases, "bmad").nome,          "RAIZEN · S. F. CONDE");
    assert.equal(_cadastroPorNomeOuApelido(bases, "Madre de Deus").nome, "RAIZEN · S. F. CONDE");
    assert.equal(_cadastroPorNomeOuApelido(bases, "BSB").nome,           "RAIZEN · BRASILIA");
    assert.equal(_cadastroPorNomeOuApelido(bases, "PETROBAHIA · LEM").nome, "PETROBAHIA · LEM");
    assert.equal(_cadastroPorNomeOuApelido(bases, "não existe"), null);
    assert.equal(_cadastroPorNomeOuApelido(bases, ""), null);

    // Nome exato vence apelido: senão, cadastrar uma base chamada "BMAD"
    // faria as notas dela irem parar na de São Francisco do Conde.
    const comConflito = [...bases, { nome: "BMAD", apelidos: "" }];
    assert.equal(_cadastroPorNomeOuApelido(comConflito, "BMAD").nome, "BMAD");

    // Apelido repetido não é sorteado: devolve null e a linha fica para
    // quem importa resolver.
    const ambiguo = [
        { nome: "RICARDO RODRIGUES DA COSTA", apelidos: "RICARDO" },
        { nome: "RICARDO SANTOS DE OLIVEIRA", apelidos: "RICARDO" }
    ];
    assert.equal(_cadastroPorNomeOuApelido(ambiguo, "RICARDO"), null);
    assert.equal(_cadastroPorNomeOuApelido(ambiguo, "RICARDO RODRIGUES DA COSTA").nome, "RICARDO RODRIGUES DA COSTA");
});
