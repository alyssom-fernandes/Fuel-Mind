/*  A CENTRAL DE RELATÓRIOS E OS DOIS PERÍODOS DO HISTÓRICO
 *  =======================================================
 *  Rodar:  node --test tests
 *
 *  O que está aqui é o que, se quebrar sem ninguém perceber, o dono só
 *  descobre na frente de um documento errado:
 *
 *  1. Um botão da central que chama uma função que não existe mais. Foi
 *     exatamente esse tipo de furo (o relatório que estava "em algum
 *     lugar") que originou a tela, e o teste varre os fontes atrás de
 *     cada nome que a lista promete.
 *  2. A regra dos dois pares de datas. Ela decide quais notas SOMAM, e a
 *     armadilha do OU já cobrou o preço uma vez: em 16/09/2026, julho e
 *     agosto consultados em separado somavam 29.500 L a mais que o
 *     intervalo inteiro.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const raiz = path.join(__dirname, "..");
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), "utf8");

/* `central.js` e `utils.js` só declaram: nenhum acesso ao DOM na carga, e
   é por isso que rodam aqui fora do navegador sem simulação nenhuma. */
globalThis.db = { lancamentos: [], empresas: [], configAlertas: {} };
globalThis.empresaFiltroGlobal = "";
globalThis.localStorage = {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
};
globalThis.salvarDB = () => {};
if (typeof _litrosItem !== "function") {
    vm.runInThisContext(ler("src", "shared", "utils.js"), { filename: "utils.js" });
}
vm.runInThisContext(ler("src", "screens", "central.js"), { filename: "central.js" });

/* ── OS DOIS PARES DE DATAS ──────────────────────────────────────────── */
/* A nota de referência é a da fronteira, a que motivou a regra: emitida no
   fim de agosto e descarregada no começo de setembro. */
const fronteira = { dataNota: "2026-08-31", dataDescarga: "2026-09-01" };
const agosto    = { dataNota: "2026-08-10", dataDescarga: "2026-08-12" };
const setembro  = { dataNota: "2026-09-05", dataDescarga: "2026-09-06" };

test("_passaPeriodos: par vazio não filtra nada", () => {
    assert.equal(_passaPeriodos(fronteira, {}), true);
    assert.equal(_passaPeriodos(fronteira, null), true);
    assert.equal(_passaPeriodos(agosto, { emissaoInicio: "", emissaoFim: "" }), true);
});

test("_passaPeriodos: só emissão de agosto pega a nota da fronteira", () => {
    const p = { emissaoInicio: "2026-08-01", emissaoFim: "2026-08-31" };
    assert.equal(_passaPeriodos(agosto, p), true);
    assert.equal(_passaPeriodos(fronteira, p), true);   // emitida em 31/08
    assert.equal(_passaPeriodos(setembro, p), false);
});

test("_passaPeriodos: só descarga de agosto deixa a da fronteira de fora", () => {
    const p = { descargaInicio: "2026-08-01", descargaFim: "2026-08-31" };
    assert.equal(_passaPeriodos(agosto, p), true);
    assert.equal(_passaPeriodos(fronteira, p), false);  // descarregada em 01/09
    assert.equal(_passaPeriodos(setembro, p), false);
});

test("_passaPeriodos: os dois pares valem com E, nunca com OU", () => {
    // A pergunta que só o cruzamento responde: emitida em agosto E
    // descarregada em setembro. É a nota da fronteira, e só ela.
    const cruzado = {
        emissaoInicio: "2026-08-01",  emissaoFim: "2026-08-31",
        descargaInicio: "2026-09-01", descargaFim: "2026-09-30"
    };
    assert.equal(_passaPeriodos(fronteira, cruzado), true);
    assert.equal(_passaPeriodos(agosto, cruzado), false);
    assert.equal(_passaPeriodos(setembro, cruzado), false);

    // E a trava contra a volta do OU: agosto nos dois pares NÃO pode
    // trazer a nota da fronteira. Com OU ela entraria, e o total de
    // agosto somaria litros que descarregaram em setembro.
    const ambosAgosto = {
        emissaoInicio: "2026-08-01",  emissaoFim: "2026-08-31",
        descargaInicio: "2026-08-01", descargaFim: "2026-08-31"
    };
    assert.equal(_passaPeriodos(agosto, ambosAgosto), true);
    assert.equal(_passaPeriodos(fronteira, ambosAgosto), false);
});

test("_passaPeriodos: nota sem data reprova no par preenchido", () => {
    const semNada = {};
    assert.equal(_passaPeriodos(semNada, { emissaoInicio: "2026-08-01" }), false);
    assert.equal(_passaPeriodos(semNada, { descargaInicio: "2026-08-01" }), false);
    // Registro antigo sem `dataDescarga` recorre à data da nota, e é essa
    // recuperação que o filtro de descarga enxerga.
    const antigo = { dataNota: "2026-08-10" };
    assert.equal(_passaPeriodos(antigo, { descargaInicio: "2026-08-01", descargaFim: "2026-08-31" }), true);
});

test("_passaPeriodos: extremo aberto de um lado só", () => {
    assert.equal(_passaPeriodos(agosto, { emissaoInicio: "2026-08-10" }), true);
    assert.equal(_passaPeriodos(agosto, { emissaoInicio: "2026-08-11" }), false);
    assert.equal(_passaPeriodos(agosto, { emissaoFim: "2026-08-10" }), true);
    assert.equal(_passaPeriodos(agosto, { emissaoFim: "2026-08-09" }), false);
});

/* ── A LISTA DA CENTRAL ──────────────────────────────────────────────── */
test("_centralItens: todo item tem id único, nome e uma linha de explicação", () => {
    const itens = _centralItens({ papel: "supremo" });
    assert.ok(itens.length >= 5, "a central não pode nascer vazia");
    const ids = itens.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length, "id repetido: `centralExecutar` acharia o errado");
    itens.forEach(i => {
        assert.ok(i.nome && i.nome.trim(), `${i.id} sem nome`);
        assert.ok(i.linha && i.linha.length > 25, `${i.id} sem a linha de explicação`);
        assert.ok(i.tela, `${i.id} não diz para qual tela leva`);
    });
});

test("_centralItens: o operador vê o mesmo que o supremo, e é de propósito", () => {
    // Nenhum relatório de hoje exige papel. O dia em que um exigir, é esta
    // asserção que vai cair, e é onde a regra tem de ser revista.
    const operador = _centralItens({ papel: "" }).map(i => i.id);
    const supremo  = _centralItens({ papel: "supremo" }).map(i => i.id);
    assert.deepEqual(operador, supremo);
});

test("central: cada tela citada existe no index.html", () => {
    const html = ler("index.html");
    _centralItens({ papel: "supremo" }).forEach(i => {
        assert.ok(html.includes(`id="${i.tela}"`), `a central aponta para a tela "${i.tela}", que não existe`);
    });
});

test("central: cada formato chama uma função que existe nos fontes", () => {
    // A varredura é por texto porque as telas que definem essas funções
    // tocam o DOM na carga e não sobem fora do navegador. Vale o mesmo:
    // renomear `exportarFretesCSV` sem atualizar a lista derruba isto.
    const dir = path.join(raiz, "src");
    const fontes = [];
    (function varrer(d) {
        fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) varrer(p);
            else if (e.name.endsWith(".js")) fontes.push(fs.readFileSync(p, "utf8"));
        });
    })(dir);
    const todo = fontes.join("\n");

    let conferidos = 0;
    _centralItens({ papel: "supremo" }).forEach(item => {
        (item.formatos || []).forEach(f => {
            const declarada = new RegExp(`function\\s+${f.fn}\\s*\\(`).test(todo);
            assert.ok(declarada, `"${item.nome}" em ${f.rotulo} chama ${f.fn}(), que não existe em src/`);
            conferidos++;
        });
    });
    assert.ok(conferidos >= 8, "poucos formatos conferidos: a lista encolheu sem querer?");
});

test("central: os rótulos de formato de um item não se repetem", () => {
    // `centralExecutar` acha o formato pelo rótulo: dois "PDF" no mesmo
    // cartão fariam o segundo botão gerar o arquivo do primeiro.
    _centralItens({ papel: "supremo" }).forEach(item => {
        const rotulos = (item.formatos || []).map(f => f.rotulo);
        assert.equal(new Set(rotulos).size, rotulos.length, `${item.id} tem rótulo de formato repetido`);
    });
});

test("_centralRotuloBase: toda base declarada tem texto, e nada inventa texto", () => {
    assert.match(_centralRotuloBase("descarga"), /descarga/);
    assert.match(_centralRotuloBase("emissao"), /emiss/);
    assert.match(_centralRotuloBase("ambas"), /descarga/);
    assert.equal(_centralRotuloBase("qualquer-coisa"), "");
    _centralItens({ papel: "supremo" }).forEach(i => {
        assert.ok(_centralRotuloBase(i.base), `${i.id} declara base "${i.base}", que não tem rótulo`);
    });
});
