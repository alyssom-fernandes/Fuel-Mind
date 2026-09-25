/*  TESTES DO PADRÃO DOS PDFS
 *  =========================
 *  Rodar:  node --test tests/*.test.js
 *
 *  As peças de src/shared/pdf-padrao.js desenham os quatro PDFs desde
 *  25/09/2026. O que se guarda aqui é a regra das larguras, que o dono pediu
 *  em 25/09/2026 ("espero que consiga se adaptar bem a diferentes
 *  quantidades de notas e empresas"): número nunca quebra linha, o texto
 *  longo fica com a sobra, um nome comprido quebra só a linha dele, e a
 *  letra só desce quando a tabela inteira não cabe.
 *
 *  O documento é de mentira: cada letra mede 0,2 do tamanho da fonte (0,22
 *  em negrito), o que basta para as contas serem previsíveis.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

if (typeof globalThis._pdfEncaixar !== "function") {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src", "shared", "pdf-padrao.js"), "utf8"), { filename: "pdf-padrao.js" });
}

const ESTILO = { fonte: "helvetica", cor: [92, 22, 32] };

function docFalso() {
    const d = {
        _negrito: false, _tamanho: 10, desenhos: [],
        internal: { pageSize: { width: 210, height: 297 } },
        setFont(_f, peso) { this._negrito = peso === "bold"; },
        setFontSize(t) { this._tamanho = t; },
        getTextWidth(t) { return String(t).length * this._tamanho * (this._negrito ? 0.22 : 0.2); },
        paginas: 1, textos: [],
        addPage() { this.paginas++; },
        setFillColor() {}, setTextColor() {}, rect() {},
        text(t, x, y) { this.textos.push({ t, x, y, pagina: this.paginas }); },
        roundedRect(x, y, w, h) { this.desenhos.push({ x, y, w, h }); }
    };
    return d;
}

test("o mês sai como 09/2026", () => {
    assert.equal(_pdfMesAno("2026-09"), "09/2026");
    assert.equal(_pdfMesAno("2026-12"), "12/2026");
    assert.equal(_pdfMesAno(""), "");
});

test("o texto da célula vem do valor solto ou do content", () => {
    assert.equal(_pdfTextoCelula("RDE0A10"), "RDE0A10");
    assert.equal(_pdfTextoCelula({ content: "BENTO", styles: { fontStyle: "bold" } }), "BENTO");
    assert.equal(_pdfTextoCelula(4), "4");
    assert.equal(_pdfTextoCelula(null), "");
});

test("a largura mínima mede o maior texto, o TOTAL em negrito e a sublinha na letra dela", () => {
    const doc = docFalso();
    const folga = 2 * 1.8 + 0.4;    // letra 7,5
    // Cabeçalho inteiro: "Litros" em negrito, 6 × 7,5 × 0,22 = 9,9.
    let [w] = _pdfLargurasMinimas(doc, ESTILO, ["Litros"], [["12"]], 7.5, false);
    assert.equal(+(w - folga).toFixed(2), 9.9);
    // O TOTAL mede em negrito: "TOTAL" (5 × 1,65 = 8,25) ganha de "ABCDE" normal (7,5).
    [w] = _pdfLargurasMinimas(doc, ESTILO, ["X"], [["ABCDE"], ["TOTAL"]], 7.5, false);
    assert.equal(+(w - folga).toFixed(2), 8.25);
    // A sublinha em letra 7 mede menos que a mesma palavra em 7,5.
    const [normal] = _pdfLargurasMinimas(doc, ESTILO, ["X"], [["Diesel S10"]], 7.5, false);
    const [menor] = _pdfLargurasMinimas(doc, ESTILO, ["X"], [[{ content: "Diesel S10", styles: { fontSize: 7 } }]], 7.5, false);
    assert.ok(menor < normal);
    // A célula que ocupa duas colunas não conta para nenhuma.
    [w] = _pdfLargurasMinimas(doc, ESTILO, ["X"], [[{ content: "um texto bem comprido", colSpan: 2 }]], 7.5, false);
    assert.equal(+(w - folga).toFixed(2), +(1 * 7.5 * 0.22).toFixed(2));
});

test("por palavra, o cabeçalho mede a maior palavra, porque pode ir para duas linhas", () => {
    const doc = docFalso();
    const [inteiro] = _pdfLargurasMinimas(doc, ESTILO, ["Taxa (R$/L)"], [], 7.5, false);
    const [porPalavra] = _pdfLargurasMinimas(doc, ESTILO, ["Taxa (R$/L)"], [], 7.5, true);
    assert.ok(porPalavra < inteiro);
});

test("cabendo, a letra de sempre, o cabeçalho numa linha e o texto longo com a sobra", () => {
    const doc = docFalso();
    const cab = ["Motorista", "Litros", "Frete"];
    const linhas = [["BENTO", "60.000 L", "R$ 6.000,00"], ["TOTAL", "60.000 L", "R$ 6.000,00"]];
    const r = _pdfEncaixar(doc, ESTILO, cab, linhas, 100, 0);
    assert.equal(r.fonte, 7.5);
    assert.equal(r.quebras, 0);
    assert.equal(+r.larguras.reduce((s, w) => s + w, 0).toFixed(6), 100);
    // As colunas de número ficam na medida delas; a sobra toda vai para o nome.
    const min = _pdfLargurasMinimas(doc, ESTILO, cab, linhas, 7.5, false);
    assert.equal(r.larguras[1], min[1]);
    assert.equal(r.larguras[2], min[2]);
});

test("um nome comprido quebra só a linha dele, sem diminuir a letra da tabela", () => {
    const doc = docFalso();
    const cab = ["Motorista", "Frete"];
    const linhas = [];
    for (let i = 0; i < 30; i++) linhas.push(["JOSE", "R$ 6.000,00"]);
    linhas.push(["MARIA APARECIDA DOS SANTOS GONÇALVES DE OLIVEIRA", "R$ 6.000,00"]);
    const r = _pdfEncaixar(doc, ESTILO, cab, linhas, 60, 0);
    assert.equal(r.fonte, 7.5);
    assert.equal(r.quebras, 1);
});

test("quando a tabela toda não cabe, a letra desce para 7", () => {
    const doc = docFalso();
    // Oito colunas de número e o texto longo (as placas) em todas as linhas:
    // em 7,5 as placas quebrariam em todas; em 7 cabem.
    const cab = ["Placas", "A", "B", "C", "D", "E", "F", "G", "H"];
    const linha = ["RDE0A10 · SKB0A10 · OMI0A10", ...Array(8).fill("R$ 24.000,00")];
    const linhas = Array.from({ length: 20 }, () => linha);
    const largura = 210;
    const em75 = _pdfLargurasMinimas(doc, ESTILO, cab, linhas, 7.5, true).reduce((s, w) => s + w, 0);
    const em7 = _pdfLargurasMinimas(doc, ESTILO, cab, linhas, 7, true).reduce((s, w) => s + w, 0);
    assert.ok(em75 > largura && em7 <= largura, "o cenário precisa caber só em 7");
    const r = _pdfEncaixar(doc, ESTILO, cab, linhas, largura, 0);
    assert.equal(r.fonte, 7);
    assert.equal(r.quebras, 0);
});

test("sem coluna de texto longo, ou tudo cabe e a sobra se divide, ou não há encaixe", () => {
    const doc = docFalso();
    const cab = ["Placa", "Frete"];
    const linhas = [["RDE0A10", "R$ 24.000,00"]];
    const r = _pdfEncaixar(doc, ESTILO, cab, linhas, 80, null);
    const min = _pdfLargurasMinimas(doc, ESTILO, cab, linhas, 7.5, false);
    const extra = (80 - min[0] - min[1]) / 2;
    assert.equal(+(r.larguras[0] - min[0]).toFixed(6), +extra.toFixed(6));
    assert.equal(+(r.larguras[1] - min[1]).toFixed(6), +extra.toFixed(6));
    assert.equal(_pdfEncaixar(doc, ESTILO, cab, linhas, 10, null), null);
});

test("a fileira de cartões ocupa a largura da página, com a mesma altura em todos", () => {
    let doc = docFalso();
    let fim = _pdfCartoes(doc, ESTILO, 21, [
        { rotulo: "A", valor: "1", destaque: true }, { rotulo: "B", valor: "2" },
        { rotulo: "C", valor: "3" }, { rotulo: "D", valor: "4" }
    ]);
    assert.equal(fim, 21 + 17);
    const larg = (210 - 2 * _PDF_MARGEM - 12) / 4;
    doc.desenhos.forEach((c, i) => {
        assert.equal(+c.x.toFixed(6), +(_PDF_MARGEM + (larg + 4) * i).toFixed(6));
        assert.equal(+c.w.toFixed(6), +larg.toFixed(6));
        assert.equal(c.h, 17);
    });
    // Basta um cartão com a linha de apoio para a fileira toda ter 20 mm.
    doc = docFalso();
    fim = _pdfCartoes(doc, ESTILO, 21, [{ rotulo: "A", valor: "1", apoio: "+5,0% vs. 08/2026" }, { rotulo: "B", valor: "2" }, { rotulo: "C", valor: "3" }]);
    assert.equal(fim, 21 + 20);
    assert.deepEqual(doc.desenhos.map(c => c.h), [20, 20, 20]);
});

test("a nota abaixo da tabela abre página nova quando não cabe acima do rodapé", () => {
    let doc = docFalso();
    // Cabe: sai na mesma página, na altura pedida.
    let y = _pdfNota(doc, ESTILO, "Fora de conjunto: 120.000 L", 250);
    assert.equal(doc.paginas, 1);
    assert.equal(doc.textos[0].y, 250);
    assert.equal(y, 256);
    // A tabela terminou no pé: a nota iria para cima do rodapé (ou para fora
    // da folha) e passa para o topo da página seguinte.
    doc = docFalso();
    y = _pdfNota(doc, ESTILO, "Fora de conjunto: 120.000 L", 297 - _PDF_PE + 1);
    assert.equal(doc.paginas, 2);
    assert.equal(doc.textos[0].pagina, 2);
    assert.equal(doc.textos[0].y, _PDF_TOPO + 3);
    assert.equal(y, _PDF_TOPO + 3 + 6);
});
