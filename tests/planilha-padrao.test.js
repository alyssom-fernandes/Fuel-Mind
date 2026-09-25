/*  TESTES DO PADRÃO DAS PLANILHAS
 *  ==============================
 *  Rodar:  node --test tests/*.test.js
 *
 *  As planilhas seguem o desenho dos PDFs desde 25/09/2026 (pedido do dono).
 *  Aqui se guarda o que decide a aparência e os números: a faixa do título,
 *  o cartão em destaque, o cabeçalho, a linha de TOTAL em negrito, os
 *  formatos ("R$" e "L", com as casas dos litros só quando há fração) e que
 *  a célula continua número.
 *
 *  O `XLSX` de verdade só existe no navegador; este é um de mentira, com as
 *  duas funções que o padrão usa.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function coluna(c) { let s = ""; c++; while (c > 0) { const r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = Math.floor((c - 1) / 26); } return s; }
globalThis.XLSX = globalThis.XLSX || {
    utils: {
        encode_cell: ({ r, c }) => coluna(c) + (r + 1),
        aoa_to_sheet(aoa) {
            const ws = {}; let maxC = 0;
            aoa.forEach((linha, r) => linha.forEach((v, c) => {
                if (v === undefined) return;
                maxC = Math.max(maxC, c);
                ws[coluna(c) + (r + 1)] = typeof v === "number" ? { t: "n", v } : { t: "s", v: String(v) };
            }));
            ws["!ref"] = `A1:${coluna(maxC)}${aoa.length}`;
            return ws;
        }
    }
};
if (typeof globalThis._PDF_COR === "undefined") globalThis._PDF_COR = [92, 22, 32];
if (typeof globalThis._planilhaPadrao !== "function") {
    for (const f of ["pdf-padrao.js", "planilha-padrao.js"]) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src", "shared", f), "utf8"), { filename: f });
    }
}

const MODELO = {
    titulo: "Resumo de fretes - 09/2026",
    subtitulo: "Posto · pela data da descarga",
    geradoEm: "25/09/2026 às 10:00",
    cartoes: [
        { rotulo: "Frete do mês (Veículos)", valor: 1234.5, f: "reais" },
        { rotulo: "Litros (Carregados)",     valor: 60000.4, f: "litrosRedondo" }
    ],
    secoes: [{
        titulo: "Por placa",
        cabecalho: ["Placa", "Litros", "Frete"],
        formatos: [null, "litros", "reais"],
        linhas: [["RDE0A10", 60000, 6000], { c: ["   · Diesel S10", 12.5, 1.25], estilo: "sub" }],
        total: ["TOTAL", 60012.5, 6001.25]
    }]
};

test("a cor sai em hexadecimal, a mesma do PDF", () => {
    assert.equal(_xlHex([92, 22, 32]), "5C1620");
    assert.equal(_xlHex([255, 255, 255]), "FFFFFF");
});

test("litros sem casas quando inteiro e com três quando há fração; os cartões arredondam", () => {
    assert.equal(_xlFormato("litros", 60000), '#,##0 "L"');
    assert.equal(_xlFormato("litros", 12.5), '#,##0.000 "L"');
    assert.equal(_xlFormato("litrosRedondo", 60000.4), '#,##0 "L"');
    assert.equal(_xlFormato("reais", 1), '"R$" #,##0.00');
    // A taxa com duas casas, como a tela (22/09/2026), mesmo que a célula
    // guarde mais.
    assert.equal(_xlFormato("taxa", 0.1025), '"R$" #,##0.00');
    assert.equal(_xlFormato(null, 1), "");
});

test("a faixa do título ocupa a largura da tabela, em vinho, com o título e o subtítulo", () => {
    const ws = _planilhaPadrao(MODELO);
    assert.equal(ws.A1.v, "Resumo de fretes - 09/2026");
    assert.equal(ws.A2.v, "Posto · pela data da descarga");
    assert.equal(ws.A1.s.fill.fgColor.rgb, "5C1620");
    assert.equal(ws.C1.s.fill.fgColor.rgb, "5C1620");
    assert.deepEqual(ws["!merges"].slice(0, 2), [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }]);
    assert.equal(ws.A3.v, "Gerado em 25/09/2026 às 10:00");
    assert.equal(ws["!padrao"], true);
});

test("o primeiro cartão sai em destaque, e o valor continua número com o formato do PDF", () => {
    const ws = _planilhaPadrao(MODELO);
    assert.equal(ws.A5.v, "FRETE DO MÊS (VEÍCULOS)");
    assert.equal(ws.B5.t, "n");
    assert.equal(ws.B5.v, 1234.5);
    assert.equal(ws.B5.z, '"R$" #,##0.00');
    assert.equal(ws.B5.s.fill.fgColor.rgb, "5C1620");
    assert.equal(ws.B6.s.fill.fgColor.rgb, _xlHex(_pdfClaro([92, 22, 32], 0.93)));
    assert.equal(ws.B6.z, '#,##0 "L"');
});

test("cabeçalho em vinho, números à direita, sublinha em cinza e TOTAL em negrito", () => {
    const ws = _planilhaPadrao(MODELO);
    // Linhas: 1-3 faixa e data, 4 vazia, 5-6 cartões, 7 vazia, 8 título da
    // seção, 9 cabeçalho, 10-11 corpo, 12 TOTAL.
    assert.equal(ws.A8.v, "Por placa");
    assert.equal(ws.A9.v, "Placa");
    assert.equal(ws.B9.s.fill.fgColor.rgb, "5C1620");
    assert.equal(ws.A9.s.alignment.horizontal, "left");
    assert.equal(ws.B9.s.alignment.horizontal, "right");
    assert.equal(ws.B10.z, '#,##0 "L"');
    assert.equal(ws.B11.z, '#,##0.000 "L"');
    assert.equal(ws.A11.s.font.color.rgb, "6E6E6E");
    assert.equal(ws.A12.v, "TOTAL");
    assert.equal(ws.A12.s.font.bold, true);
    assert.equal(ws.C12.s.font.bold, true);
    assert.equal(ws.C12.v, 6001.25);
    assert.equal(ws.C12.s.fill.fgColor.rgb, _xlHex(_pdfClaro([92, 22, 32], 0.82)));
});

test("o cabeçalho de duas linhas mescla os grupos e as colunas que ocupam as duas", () => {
    const ws = _planilhaPadrao({
        titulo: "Fechamento", subtitulo: "", geradoEm: "x",
        secoes: [{
            titulo: "Por conjunto", cabecalho: ["Conjunto", "Placas", "Litros", "Aluguel"], formatos: [null, null, "litros", "reais"],
            grupos: [{ texto: "Posto", col: 2, span: 2 }], mesclarCabecalho: [0, 1],
            linhas: [["12", "RDE0A10", 100, 10]], total: ["TOTAL", "1 conjunto(s)", 100, 10]
        }]
    });
    // Linha 6: grupos; 7: Litros e Aluguel.
    assert.equal(ws.A6.v, "Conjunto");
    assert.equal(ws.C6.v, "Posto");
    assert.equal(ws.C7.v, "Litros");
    const m = ws["!merges"].map(x => `${x.s.r},${x.s.c}-${x.e.r},${x.e.c}`);
    assert.ok(m.includes("5,0-6,0") && m.includes("5,1-6,1") && m.includes("5,2-5,3"));
});
