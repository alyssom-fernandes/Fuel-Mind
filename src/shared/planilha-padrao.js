/*=================================================
  O PADRÃO DAS PLANILHAS (25/09/2026)

  Pedido do dono, depois dos PDFs: "que ajuste todos os relatórios em
  excel do site" no mesmo padrão. Cada planilha passa a ter o desenho do
  PDF correspondente: a faixa vinho com o título e o subtítulo, a data de
  geração, os números principais em cartões, e as seções com título,
  cabeçalho vinho, linhas alternadas e a linha de TOTAL em negrito.

  Cores e negrito exigem a biblioteca que grava estilo: `xlsx-js-style`,
  a mesma interface do SheetJS (o `XLSX` de sempre), carregada em
  `_BIBLIOTECAS.xlsx` (utils.js). A versão gratuita do SheetJS grava só
  valores, formatos e larguras.

  A célula continua NÚMERO: soma e ordena no Excel. O formato é que a
  mostra como no PDF ("R$ 1.234,56", "12.000 L").
=================================================*/

/** "5C1620": a cor do PDF em hexadecimal, para o Excel. */
function _xlHex(rgb) {
    return rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/* As cores e as letras, tiradas das mesmas contas do PDF (`_PDF_COR` e
   `_pdfClaro`), para os dois nunca divergirem. */
function _xlPaleta() {
    const cor = _PDF_COR;
    return {
        cor: _xlHex(cor),
        zebra: _xlHex(_pdfClaro(cor, 0.965)),
        total: _xlHex(_pdfClaro(cor, 0.82)),
        cartao: _xlHex(_pdfClaro(cor, 0.93)),
        rotuloDestaque: _xlHex(_pdfClaro(cor, 0.75)),
        cinza: "6E6E6E",
        grade: "E1E1E1",
        fonte: "Arial"
    };
}

/* Os formatos de número. Litros sem casas quando o valor é inteiro e com
   três quando há fração, como `_fmtLitrosFrete` nos PDFs; nos cartões,
   arredondados, como o cartão do PDF (a célula guarda o valor exato). A
   taxa por litro com duas casas, como a tela desde 22/09/2026 (a célula
   guarda as que tiver). */
const _XL_FORMATOS = {
    litrosRedondo: '#,##0 "L"',
    reais:   '"R$" #,##0.00',
    taxa:    '"R$" #,##0.00',
    preco:   '"R$" #,##0.000',
    inteiro: '#,##0',
    pct:     '+0.0%;-0.0%;0.0%'
};
function _xlFormato(tipo, valor) {
    if (tipo === "litros") {
        const n = Number(valor) || 0;
        return Math.abs(n - Math.round(n)) < 0.0005 ? '#,##0 "L"' : '#,##0.000 "L"';
    }
    return _XL_FORMATOS[tipo] || "";
}

/**
 * Monta uma aba no padrão. `m`:
 *   titulo, subtitulo, geradoEm
 *   cartoes:  [{ rotulo, valor, f }]  os números principais; o primeiro
 *             em destaque, como no PDF (f: o formato do valor)
 *   secoes:   [{ titulo, cabecalho: [...], formatos: [...], linhas,
 *               total, nota, grupos, mesclarCabecalho }]
 *     formatos: o formato de cada coluna ("reais", "litros", "taxa",
 *               "preco", "inteiro", "pct" ou null para texto); coluna com
 *               formato é de número e fica à direita
 *     linhas:   arrays de valores, ou { c: [...], estilo, negrito: [col] }
 *               com estilo "principal" (a linha do grupo, com fundo),
 *               "detalhe" (sem fundo) ou "sub" (sem fundo, em cinza)
 *     total:    a linha de TOTAL, ou nada
 *     nota:     uma linha de texto em cinza abaixo da tabela
 *     grupos:   [{ texto, col, span }], uma linha de cabeçalho acima da
 *               principal (as empresas sobre "Litros" e "Aluguel");
 *               `mesclarCabecalho`: as colunas cujo cabeçalho ocupa as
 *               duas linhas
 * Devolve a aba (`ws`), pronta para `book_append_sheet`.
 */
function _planilhaPadrao(m) {
    const P = _xlPaleta();
    const secoes = m.secoes || [];
    const largura = Math.max(2, ...secoes.map(s => s.cabecalho.length));
    const aoa = [], meta = [], merges = [];
    const push = (linha, info) => { aoa.push(linha); meta.push(info || { tipo: "vazio" }); };

    push([m.titulo], { tipo: "faixaTitulo" });
    push([m.subtitulo || ""], { tipo: "faixaSub" });
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: largura - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: largura - 1 } });
    push([`Gerado em ${m.geradoEm}`], { tipo: "gerado" });
    push([]);

    (m.cartoes || []).forEach((c, i) => {
        push([String(c.rotulo).toUpperCase(), c.valor], { tipo: "cartao", destaque: i === 0, f: c.f });
    });
    if ((m.cartoes || []).length) push([]);

    secoes.forEach(s => {
        const n = s.cabecalho.length;
        const formatos = s.formatos || [];
        if (s.titulo) push([s.titulo], { tipo: "secao" });
        if (s.grupos) {
            const r = aoa.length;
            const linha = Array(n).fill("");
            (s.mesclarCabecalho || []).forEach(j => { linha[j] = s.cabecalho[j]; merges.push({ s: { r, c: j }, e: { r: r + 1, c: j } }); });
            s.grupos.forEach(g => { linha[g.col] = g.texto; if (g.span > 1) merges.push({ s: { r, c: g.col }, e: { r, c: g.col + g.span - 1 } }); });
            push(linha, { tipo: "cab", n, formatos, grupo: true });
            push(s.cabecalho.map((t, j) => (s.mesclarCabecalho || []).includes(j) ? "" : t), { tipo: "cab", n, formatos });
        } else {
            push(s.cabecalho.slice(), { tipo: "cab", n, formatos });
        }
        (s.linhas || []).forEach((l, i) => {
            const obj = Array.isArray(l) ? { c: l } : l;
            push(obj.c.slice(), { tipo: "corpo", n, formatos, i, estilo: obj.estilo, negrito: obj.negrito || [] });
        });
        if (s.total) push(s.total.slice(), { tipo: "total", n, formatos });
        if (s.nota) push([s.nota], { tipo: "nota" });
        push([]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const borda = { style: "thin", color: { rgb: P.grade } };
    const grade = { top: borda, bottom: borda, left: borda, right: borda };
    const fonte = (extra) => Object.assign({ name: P.fonte, sz: 10 }, extra || {});

    meta.forEach((info, r) => {
        const cel = (c) => {
            const ref = XLSX.utils.encode_cell({ r, c });
            if (!ws[ref]) ws[ref] = { t: "s", v: "" };
            return ws[ref];
        };
        const numero = (c, f) => {
            const x = cel(c);
            if (x.t === "n" && f) { x.z = _xlFormato(f, x.v); }
            return x;
        };
        if (info.tipo === "faixaTitulo" || info.tipo === "faixaSub") {
            for (let c = 0; c < largura; c++) {
                cel(c).s = {
                    fill: { fgColor: { rgb: P.cor } },
                    font: fonte(info.tipo === "faixaTitulo" ? { sz: 14, bold: true, color: { rgb: "FFFFFF" } } : { sz: 10, color: { rgb: "FFFFFF" } }),
                    alignment: { horizontal: "center", vertical: "center" }
                };
            }
        } else if (info.tipo === "gerado" || info.tipo === "nota") {
            cel(0).s = { font: fonte({ sz: 9, color: { rgb: P.cinza } }) };
        } else if (info.tipo === "cartao") {
            const fill = { fgColor: { rgb: info.destaque ? P.cor : P.cartao } };
            cel(0).s = { fill, font: fonte({ sz: 9, color: { rgb: info.destaque ? P.rotuloDestaque : P.cinza } }), alignment: { vertical: "center" } };
            const v = numero(1, info.f);
            v.s = { fill, font: fonte({ sz: 12, bold: true, color: { rgb: info.destaque ? "FFFFFF" : P.cor } }),
                    alignment: { horizontal: "right", vertical: "center" }, numFmt: v.z };
        } else if (info.tipo === "secao") {
            cel(0).s = { font: fonte({ sz: 11, bold: true, color: { rgb: P.cor } }),
                         border: { left: { style: "thick", color: { rgb: P.cor } } } };
        } else if (info.tipo === "cab") {
            for (let c = 0; c < info.n; c++) {
                cel(c).s = { fill: { fgColor: { rgb: P.cor } }, font: fonte({ bold: true, color: { rgb: "FFFFFF" } }), border: grade,
                             alignment: { horizontal: info.grupo && aoa[r][c] ? "center" : (info.formatos[c] ? "right" : "left"), vertical: "center", wrapText: true } };
            }
        } else if (info.tipo === "corpo" || info.tipo === "total") {
            const eTotal = info.tipo === "total";
            for (let c = 0; c < info.n; c++) {
                const x = numero(c, info.formatos[c]);
                let fill = eTotal ? P.total : (info.i % 2 === 0 ? P.zebra : "FFFFFF");
                let f = { bold: eTotal };
                if (info.estilo === "principal") { fill = P.zebra; f.bold = info.negrito.includes(c); }
                if (info.estilo === "detalhe") fill = "FFFFFF";
                if (info.estilo === "sub") { fill = "FFFFFF"; f = { sz: 9, color: { rgb: P.cinza } }; }
                x.s = { fill: { fgColor: { rgb: fill } }, font: fonte(f), border: grade,
                        alignment: { horizontal: info.formatos[c] ? "right" : "left", vertical: "center" } };
                if (x.z) x.s.numFmt = x.z;
            }
        }
    });

    ws["!merges"] = merges;
    ws["!rows"] = [{ hpt: 24 }, { hpt: 18 }];
    // A aba já sai com os formatos certos: o acabamento geral (utils.js)
    // só calcula as larguras dela, sem trocar os formatos.
    ws["!padrao"] = true;
    return ws;
}

/** Um arquivo com as abas no padrão. `abas`: [{ nome, ws }]. */
function _gravarPlanilhaPadrao(abas, nomeArquivo) {
    const wb = XLSX.utils.book_new();
    abas.forEach(a => XLSX.utils.book_append_sheet(wb, a.ws, a.nome));
    XLSX.writeFile(wb, nomeArquivo);
}
