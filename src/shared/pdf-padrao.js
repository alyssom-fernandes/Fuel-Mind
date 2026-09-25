/*=================================================
  O PADRÃO DOS PDFS (25/09/2026)

  O fechamento de frete foi desenhado com o dono em 24 e 25/09/2026: folha
  em pé, margem quase zero, faixa compacta no título, cartões com os
  números do documento, títulos de seção com a barra, tabelas de grade
  fina com a linha de TOTAL, colunas do tamanho do conteúdo e a data de
  geração no rodapé de todas as páginas. Depois ele pediu "o mesmo padrão
  de design do fechamento aplicado em todos os relatórios do site", e as
  peças saíram de `fechamento.js` para cá: o fechamento, o resumo de
  fretes, o relatório mensal e o PDF de entradas desenham com elas.

  A faixa do título (`_pdfCabecalho`), o rodapé (`_pdfRodapes`), a marca,
  a cor e a fonte continuam em `relatorios.js`, onde já eram comuns.
=================================================*/

/* AS MARGENS, em milímetros.

   Eram 14, passaram a 8 (escolha do dono, para caber mais conteúdo) e, no
   fechamento de 24/09/2026, quase zero: o documento é feito para ler em
   PDF, e quem imprimir ajusta a impressão. Desde 25/09/2026 valem para os
   quatro PDFs. Os lados e o topo das páginas seguintes ficam a 2 mm da
   borda, o bastante para a linha da tabela não encostar nela. Embaixo, o
   rodapé fica com a linha do texto a 2,5 mm do pé e a tabela para a
   5,5 mm, logo acima dele. */
const _PDF_MARGEM = 2;
const _PDF_TOPO = 2, _PDF_PE = 5.5, _PDF_RODAPE = 2.5;

/* Título de seção: barra na cor de destaque e o texto ao lado.

   Refeito em 24/09/2026, a pedido do dono: a barra ficava deslocada do
   texto e com um vão grande até ele, e o bloco ocupava 12 mm. Agora `y` é
   o topo do bloco, a barra cobre exatamente o título (e a linha de apoio,
   quando há), e o texto fica colado nela. Devolve onde a tabela começa. */
const _PDF_TITULO_ALT = { so: 7.2, comApoio: 11 };

/** Tom claro da cor de destaque, para faixas e linhas de total. */
function _pdfClaro(cor, fator) {
    return cor.map(v => Math.min(255, Math.round(v + (255 - v) * fator)));
}

/** "25/09/2026 às 10:15": quando o documento foi gerado. Com a hora, porque
 *  no mesmo dia pode sair mais de uma versão e a hora diz qual é a última
 *  (pedido do dono, 24/09/2026). Vai no rodapé de todas as páginas. */
function _pdfGeradoEm(agora) {
    agora = agora || new Date();
    return `${agora.toLocaleDateString("pt-BR")} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** "2026-09" vira "09/2026": o mês em todos os documentos, a pedido do
 *  dono (24/09/2026), no lugar de "Set/26". */
function _pdfMesAno(mes) {
    const [ano, num] = String(mes || "").split("-");
    return ano && num ? `${num}/${ano}` : String(mes || "");
}

/**
 * Cartão de número grande. É o que dá ao PDF a mesma leitura da tela: o
 * essencial antes de qualquer tabela. `alt` iguala a altura dos cartões
 * de uma fileira quando só alguns têm a linha de apoio.
 */
function _pdfCartao(doc, estilo, x, y, largura, rotulo, valor, apoio, destaque, alt) {
    // Mais baixo desde 24/09/2026 (pedido do dono): 17 mm, com a mesma
    // folga em cima do número e embaixo do rótulo. Antes, 24 mm.
    alt = alt || (apoio ? 20 : 17);
    doc.setFillColor(...(destaque ? estilo.cor : _pdfClaro(estilo.cor, 0.93)));
    doc.roundedRect(x, y, largura, alt, 2, 2, "F");
    doc.setTextColor(...(destaque ? [255, 255, 255] : estilo.cor));
    doc.setFont(estilo.fonte, "bold");
    doc.setFontSize(13);
    doc.text(String(valor), x + 5, y + 8);
    doc.setFont(estilo.fonte, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...(destaque ? _pdfClaro(estilo.cor, 0.75) : [110, 110, 110]));
    doc.text(String(rotulo).toUpperCase(), x + 5, y + 13);
    if (apoio) doc.text(String(apoio), x + 5, y + 16.5);
    doc.setTextColor(0, 0, 0);
    return y + alt;
}

/** Uma fileira de cartões na largura da página, com 4 mm entre eles e a
 *  mesma altura em todos. `cartoes`: [{ rotulo, valor, apoio, destaque }].
 *  Devolve o fim da fileira. */
function _pdfCartoes(doc, estilo, y, cartoes) {
    const W = doc.internal.pageSize.width;
    const n = cartoes.length;
    const larg = (W - _PDF_MARGEM * 2 - 4 * (n - 1)) / n;
    const alt = cartoes.some(c => c.apoio) ? 20 : 17;
    cartoes.forEach((c, i) => {
        _pdfCartao(doc, estilo, _PDF_MARGEM + (larg + 4) * i, y, larg, c.rotulo, c.valor, c.apoio, c.destaque, alt);
    });
    return y + alt;
}

function _pdfTitulo(doc, estilo, texto, y, apoio) {
    const xTexto = _PDF_MARGEM + 2.2 + 2.8;
    const base = y + 3.4;                    // linha de base do título, letra 10,5
    const baseApoio = base + 3.9;            // linha de base do apoio, letra 7,5
    const fimBarra = (apoio ? baseApoio : base) + 0.7;
    doc.setFillColor(...estilo.cor);
    doc.rect(_PDF_MARGEM, y, 2.2, fimBarra - y, "F");
    doc.setFont(estilo.fonte, "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...estilo.cor);
    doc.text(texto, xTexto, base);
    if (apoio) {
        doc.setFont(estilo.fonte, "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(120, 120, 120);
        doc.text(apoio, xTexto, baseApoio);
    }
    doc.setTextColor(0, 0, 0);
    return y + (apoio ? _PDF_TITULO_ALT.comApoio : _PDF_TITULO_ALT.so);
}

/** O texto de uma célula, seja ela o valor solto ou `{ content, styles }`
 *  (as sublinhas do resumo de fretes, que vêm com estilo próprio). */
function _pdfTextoCelula(c) {
    if (c && typeof c === "object" && "content" in c) return String(c.content ?? "");
    return String(c ?? "");
}

/** Opções comuns das tabelas, para as seções não divergirem entre si. */
function _pdfTabela(doc, estilo, opcoes) {
    /* O autoTable NÃO propaga o `halign` de `columnStyles` para o
       cabeçalho, só para o corpo. Sem isto, ou o cabeçalho inteiro fica à
       direita (e "Placa" encosta na borda errada sobre uma coluna de
       texto), ou fica inteiro à esquerda (e "Frete" descola dos valores
       logo abaixo). Copiamos coluna a coluna. */
    const alinhamentos = opcoes.columnStyles || {};
    /* A caixa proporcional à letra (pedido do dono, 24/09/2026): a folga em
       volta do texto é uma fração da letra, então a tabela de letra menor
       (o nota a nota, 7) tem a caixa menor na mesma medida. As outras ficam
       com 7,5, que é o texto principal do documento. Com folga fixa de
       1,8 mm, um mês cheio dava 10 páginas. */
    const fonte = opcoes.fonte || 7.5;
    const folga = { top: +(fonte * 0.13).toFixed(2), bottom: +(fonte * 0.13).toFixed(2),
                    left: +(fonte * 0.24).toFixed(2), right: +(fonte * 0.24).toFixed(2) };
    opcoes = Object.assign({}, opcoes);
    delete opcoes.fonte;
    doc.autoTable(Object.assign({
        theme: "grid",
        // Sem `halign` aqui de propósito: o alinhamento vem de
        // `columnStyles`, que o autoTable aplica ao cabeçalho e ao corpo.
        // Fixar "right" no cabeçalho deixava "Placa" e "Conjunto"
        // encostados à direita sobre uma coluna de texto alinhada à
        // esquerda, e era a primeira coisa que saltava no PDF.
        headStyles: { fillColor: estilo.cor, textColor: 255, fontSize: fonte },
        bodyStyles: { fontSize: fonte },
        alternateRowStyles: { fillColor: _pdfClaro(estilo.cor, 0.965) },
        styles: { font: estilo.fonte, cellPadding: folga, lineColor: [225, 225, 225], lineWidth: 0.1 },
        // Em cima e embaixo, a margem do padrão e não a do autoTable
        // (14 mm): embaixo, a tabela para logo acima do rodapé.
        margin: { left: _PDF_MARGEM, right: _PDF_MARGEM, top: _PDF_TOPO, bottom: _PDF_PE },
        didParseCell: d => {
            if (d.section === "head") {
                const h = (alinhamentos[d.column.index] || {}).halign;
                // Célula que já traz alinhamento próprio (os grupos de
                // empresa, centralizados) manda no seu.
                if (h && !d.cell.styles.__proprio) d.cell.styles.halign = h;
            }
            // A linha de total se reconhece pela primeira célula, e não pelo
            // índice: uma seção vazia mudaria o índice e pintaria a linha
            // errada.
            if (d.section === "body" && _pdfTextoCelula(d.row.raw[0]).startsWith("TOTAL")) {
                d.cell.styles.fillColor = _pdfClaro(estilo.cor, 0.82);
                d.cell.styles.fontStyle = "bold";
            }
        }
    }, opcoes));
    return doc.lastAutoTable.finalY;
}

/* Uma linha de nota em cinza logo abaixo de uma tabela (a de "Fora de
   conjunto", no fechamento e no resumo de fretes). Abre página nova quando
   ela não cabe acima do rodapé: escrita depois de uma tabela que terminou
   no pé da página, caía sobre o rodapé ou fora da folha (25/09/2026,
   revisão). Devolve onde o próximo bloco começa. */
function _pdfNota(doc, estilo, texto, y) {
    if (y > doc.internal.pageSize.height - _PDF_PE) { doc.addPage(); y = _PDF_TOPO + 3; }
    doc.setFont(estilo.fonte, "normal"); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
    doc.text(texto, _PDF_MARGEM, y);
    doc.setTextColor(0, 0, 0);
    return y + 6;
}

/* Garante espaço para o próximo bloco; abre página nova quando não cabe.
   A reserva é a medida do que vem: o título (com ou sem a linha de apoio),
   o cabeçalho da tabela e duas linhas. O bastante para o título não ficar
   sozinho no pé da página, e não mais que isso: a tabela continua na
   página seguinte sozinha, com o cabeçalho repetido. Uma reserva fixa e
   folgada empurrava seções inteiras para a página seguinte com meia página
   em branco (24/09/2026). O limite é o mesmo em que as tabelas param. */
function _pdfEspaco(doc, y, comApoio, linhasCabecalho) {
    const linha = 7.5 * 0.3528 * 1.15 + 2 * 7.5 * 0.13;
    const precisa = (comApoio ? _PDF_TITULO_ALT.comApoio : _PDF_TITULO_ALT.so)
                  + linha * ((linhasCabecalho || 1) + 2);
    if (y + precisa <= doc.internal.pageSize.height - _PDF_PE) return y;
    doc.addPage();
    return _PDF_TOPO;
}

/* A largura mínima de cada coluna para o corpo não quebrar linha: o maior
   texto dela mais a folga da célula (e 0,4 mm de sobra, para o
   arredondamento não quebrar o que cabe justo). A linha de TOTAL sai em
   negrito e mede em negrito; a célula com estilo próprio mede na letra e
   no peso dela, e a que ocupa várias colunas não conta para nenhuma. Com
   `porPalavra`, o cabeçalho mede pela maior palavra, porque ele pode ir
   para duas linhas ("Taxa" em cima de "(R$/L)") e o corpo não; sem ele,
   mede inteiro, numa linha (24/09/2026). */
function _pdfLargurasMinimas(doc, estilo, cabecalho, linhas, fonte, porPalavra) {
    const folga = 2 * +(fonte * 0.24).toFixed(2) + 0.4;
    const medir = (texto, negrito, tamanho) => {
        doc.setFont(estilo.fonte, negrito ? "bold" : "normal");
        doc.setFontSize(tamanho || fonte);
        return doc.getTextWidth(String(texto));
    };
    const larguras = cabecalho.map((rotulo, j) => {
        const partes = porPalavra ? String(rotulo).split(" ") : [String(rotulo)];
        let maior = Math.max(...partes.map(p => medir(p, true)));
        linhas.forEach(l => {
            const c = l[j];
            const st = (c && typeof c === "object" && c.styles) || {};
            if ((c && typeof c === "object" && c.colSpan > 1)) return;
            const negrito = _pdfTextoCelula(l[0]).startsWith("TOTAL") || st.fontStyle === "bold";
            maior = Math.max(maior, medir(_pdfTextoCelula(c), negrito, st.fontSize));
        });
        return maior + folga;
    });
    doc.setFont(estilo.fonte, "normal");
    doc.setFontSize(fonte);
    return larguras;
}

/* Larguras de coluna que cabem em `largura` (25/09/2026, pedido do dono:
   o documento tem de se adaptar a meses com mais notas, placas e
   empresas). As colunas de número nunca quebram linha; a coluna `flex`, a
   do texto longo (motorista, placas, conjunto), fica com a sobra. Tenta em
   ordem, com as letras de `fontes` (a de sempre e a 7, do nota a nota):
     1. a primeira letra, com o cabeçalho numa linha;
     2. a mesma letra, com o cabeçalho podendo ir para duas;
     3. e 4. as mesmas duas com a letra seguinte.
   Fica com a primeira em que o texto longo cabe, TOLERANDO algumas linhas
   quebradas (duas, ou 5% da tabela): um nome comprido quebra só a linha
   dele, em vez de diminuir a letra da tabela inteira. A letra só desce
   quando o problema é da tabela toda (três empresas espremem as placas de
   todos os conjuntos, por exemplo). Se nenhuma tentativa ficar dentro da
   tolerância, devolve a que quebra menos linhas; `quebras` e `tolera` vão
   junto, para quem chama decidir. Devolve null quando nem o cabeçalho da
   coluna `flex` cabe na sobra. Sem `flex`, todas as colunas têm de caber
   sem quebrar, e a sobra se divide por igual. */
function _pdfEncaixar(doc, estilo, cabecalho, linhas, largura, flex, fontes) {
    fontes = fontes || [7.5, 7];
    const tolera = Math.max(2, Math.ceil(linhas.length * 0.05));
    let melhor = null;
    for (const fonte of fontes) {
        for (const porPalavra of [false, true]) {
            const min = _pdfLargurasMinimas(doc, estilo, cabecalho, linhas, fonte, porPalavra);
            const soma = min.reduce((s, w) => s + w, 0);
            if (flex == null) {
                if (soma > largura) continue;
                const extra = (largura - soma) / min.length;
                return { fonte, larguras: min.map(w => w + extra), quebras: 0, tolera };
            }
            const resto = largura - (soma - min[flex]);
            const cabFlex = _pdfLargurasMinimas(doc, estilo, [cabecalho[flex]], [], fonte, true)[0];
            if (resto < cabFlex) continue;
            // Quantas linhas teriam o texto longo quebrado com essa sobra.
            const folga = 2 * +(fonte * 0.24).toFixed(2) + 0.4;
            const quebras = linhas.filter(l => {
                const c = l[flex];
                const st = (c && typeof c === "object" && c.styles) || {};
                doc.setFont(estilo.fonte, _pdfTextoCelula(l[0]).startsWith("TOTAL") || st.fontStyle === "bold" ? "bold" : "normal");
                doc.setFontSize(st.fontSize || fonte);
                return doc.getTextWidth(_pdfTextoCelula(c)) + folga > resto;
            }).length;
            doc.setFont(estilo.fonte, "normal");
            doc.setFontSize(fonte);
            const tentativa = { fonte, larguras: min.map((w, j) => j === flex ? resto : w), quebras, tolera };
            if (quebras <= tolera) return tentativa;
            if (!melhor || quebras < melhor.quebras) melhor = tentativa;
        }
    }
    return melhor;
}
