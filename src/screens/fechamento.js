/*=================================================
  FECHAMENTO DO MÊS EM PDF (22/09/2026)

  O que o dono entrega hoje é uma planilha montada à mão: uma aba com as
  notas do mês e outra com um bloco por conjunto, cada bloco trazendo
  volume e frete separados por empresa. Este arquivo produz o mesmo
  conteúdo num PDF pronto para enviar, sem retoque.

  Por que PDF e não planilha: o Excel já sai pelo botão ao lado. O que
  faltava era a peça que se manda para alguém ler e pagar, e para isso o
  que vale é hierarquia visual: o número do mês grande na frente, cada
  corte numa seção, o total sempre no mesmo lugar.

  Retrato desde 24/09/2026 (pedido do dono), e não mais paisagem: a folha
  deitada deixava um terço da largura em branco nas tabelas estreitas, e um
  mês cheio dava 7 páginas. O que impedia o retrato era o nota a nota, com
  onze colunas: saíram Emissão, Conjunto e Taxa (a taxa e o conjunto de
  cada placa estão em "Por placa"), e as colunas curtas passaram a ter a
  largura do conteúdo, o que deixa ao Motorista espaço para o nome inteiro.
  A margem é quase zero: o documento é feito para ler em PDF, e quem
  imprimir ajusta a impressão.

  A quebra por empresa vem de `grupo.porEmpresa`, que o motor passou a
  acumular junto com o resto: é ela que permite pôr POSTO numa coluna e TRR
  na outra sem refazer a conta aqui.
=================================================*/

/** Tom claro da cor de destaque, para faixas e linhas de total. */
function _fechClaro(cor, fator) {
    return cor.map(v => Math.min(255, Math.round(v + (255 - v) * fator)));
}

/**
 * Cartão de número grande. É o que dá ao PDF a mesma leitura da tela: o
 * essencial do mês antes de qualquer tabela.
 */
function _fechCartao(doc, estilo, x, y, largura, rotulo, valor, apoio, destaque) {
    // Mais baixo desde 24/09/2026 (pedido do dono): 17 mm, com a mesma
    // folga em cima do número e embaixo do rótulo. Antes, 24 mm.
    const alt = apoio ? 20 : 17;
    doc.setFillColor(...(destaque ? estilo.cor : _fechClaro(estilo.cor, 0.93)));
    doc.roundedRect(x, y, largura, alt, 2, 2, "F");
    doc.setTextColor(...(destaque ? [255, 255, 255] : estilo.cor));
    doc.setFont(estilo.fonte, "bold");
    doc.setFontSize(13);
    doc.text(String(valor), x + 5, y + 8);
    doc.setFont(estilo.fonte, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...(destaque ? _fechClaro(estilo.cor, 0.75) : [110, 110, 110]));
    doc.text(String(rotulo).toUpperCase(), x + 5, y + 13);
    if (apoio) doc.text(String(apoio), x + 5, y + 16.5);
    doc.setTextColor(0, 0, 0);
    return y + alt;
}

/* Título de seção: barra na cor de destaque e o texto ao lado.

   Refeito em 24/09/2026, a pedido do dono: a barra ficava deslocada do
   texto e com um vão grande até ele, e o bloco ocupava 12 mm. Agora `y` é
   o topo do bloco, a barra cobre exatamente o título (e a linha de apoio,
   quando há), e o texto fica colado nela. Devolve onde a tabela começa. */
const _FECH_TITULO_ALT = { so: 7.2, comApoio: 11 };
/* As margens do fechamento, quase zeradas (24/09/2026, pedido do dono: o
   documento é para ler em PDF). Os lados e o topo das páginas seguintes
   ficam a 2 mm da borda, o bastante para a linha da tabela não encostar
   nela. Embaixo, o rodapé fica com a linha do texto a 2,5 mm do pé e a
   tabela para a 5,5 mm, logo acima dele. Os outros PDFs seguem com os
   8 mm de `_PDF_MARGEM`. */
const _FECH_MARGEM = 2;
const _FECH_TOPO = 2, _FECH_PE = 5.5, _FECH_RODAPE = 2.5;

function _fechTitulo(doc, estilo, texto, y, apoio) {
    const xTexto = _FECH_MARGEM + 2.2 + 2.8;
    const base = y + 3.4;                    // linha de base do título, letra 10,5
    const baseApoio = base + 3.9;            // linha de base do apoio, letra 7,5
    const fimBarra = (apoio ? baseApoio : base) + 0.7;
    doc.setFillColor(...estilo.cor);
    doc.rect(_FECH_MARGEM, y, 2.2, fimBarra - y, "F");
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
    return y + (apoio ? _FECH_TITULO_ALT.comApoio : _FECH_TITULO_ALT.so);
}

/** Opções comuns das tabelas, para as seções não divergirem entre si. */
function _fechTabela(doc, estilo, opcoes) {
    /* O autoTable NÃO propaga o `halign` de `columnStyles` para o
       cabeçalho, só para o corpo. Sem isto, ou o cabeçalho inteiro fica à
       direita (e "Placa" encosta na borda errada sobre uma coluna de
       texto), ou fica inteiro à esquerda (e "Frete" descola dos valores
       logo abaixo). Copiamos coluna a coluna. */
    const alinhamentos = opcoes.columnStyles || {};
    /* A caixa proporcional à letra (pedido do dono, 24/09/2026): a folga em
       volta do texto é uma fração da letra, então a tabela de letra menor
       (o nota a nota, 7) tem a caixa menor na mesma medida. As outras ficam
       com 7,5, que é o texto principal do fechamento. Com folga fixa de
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
        alternateRowStyles: { fillColor: _fechClaro(estilo.cor, 0.965) },
        styles: { font: estilo.fonte, cellPadding: folga, lineColor: [225, 225, 225], lineWidth: 0.1 },
        // Em cima e embaixo, a margem do fechamento e não a do autoTable
        // (14 mm): embaixo, a tabela para logo acima do rodapé.
        margin: { left: _FECH_MARGEM, right: _FECH_MARGEM, top: _FECH_TOPO, bottom: _FECH_PE },
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
            if (d.section === "body" && String(d.row.raw[0]).startsWith("TOTAL")) {
                d.cell.styles.fillColor = _fechClaro(estilo.cor, 0.82);
                d.cell.styles.fontStyle = "bold";
            }
        }
    }, opcoes));
    return doc.lastAutoTable.finalY;
}

/* Garante espaço para o próximo bloco; abre página nova quando não cabe.
   A reserva é a medida do que vem: o título (com ou sem a linha de apoio),
   o cabeçalho da tabela e duas linhas. O bastante para o título não ficar
   sozinho no pé da página, e não mais que isso: a tabela continua na
   página seguinte sozinha, com o cabeçalho repetido. Uma reserva fixa e
   folgada empurrava seções inteiras para a página seguinte com meia página
   em branco (24/09/2026). O limite é o mesmo em que as tabelas param. */
function _fechEspaco(doc, y, comApoio, linhasCabecalho) {
    const linha = 7.5 * 0.3528 * 1.15 + 2 * 7.5 * 0.13;
    const precisa = (comApoio ? _FECH_TITULO_ALT.comApoio : _FECH_TITULO_ALT.so)
                  + linha * ((linhasCabecalho || 1) + 2);
    if (y + precisa <= doc.internal.pageSize.height - _FECH_PE) return y;
    doc.addPage();
    return _FECH_TOPO;
}

/* A largura mínima de cada coluna para o corpo não quebrar linha: o maior
   texto dela mais a folga da célula (e 0,4 mm de sobra, para o
   arredondamento não quebrar o que cabe justo). A linha de TOTAL sai em
   negrito e mede em negrito. Com `porPalavra`, o cabeçalho mede pela maior
   palavra, porque ele pode ir para duas linhas ("Taxa" em cima de
   "(R$/L)") e o corpo não; sem ele, mede inteiro, numa linha (24/09/2026). */
function _fechLargurasMinimas(doc, estilo, cabecalho, linhas, fonte, porPalavra) {
    const folga = 2 * +(fonte * 0.24).toFixed(2) + 0.4;
    const medir = (texto, negrito) => {
        doc.setFont(estilo.fonte, negrito ? "bold" : "normal");
        return doc.getTextWidth(String(texto));
    };
    doc.setFontSize(fonte);
    const larguras = cabecalho.map((rotulo, j) => {
        const partes = porPalavra ? String(rotulo).split(" ") : [String(rotulo)];
        let maior = Math.max(...partes.map(p => medir(p, true)));
        linhas.forEach(l => { maior = Math.max(maior, medir(l[j], String(l[0]).startsWith("TOTAL"))); });
        return maior + folga;
    });
    doc.setFont(estilo.fonte, "normal");
    return larguras;
}

/* Larguras de coluna que cabem em `largura` (25/09/2026, pedido do dono:
   o fechamento tem de se adaptar a meses com mais notas, placas e
   empresas). As colunas de número nunca quebram linha; a coluna `flex`, a
   do texto longo (motorista, placas, conjunto), fica com a sobra. Tenta em
   ordem:
     1. a letra de sempre, com o cabeçalho numa linha;
     2. a mesma letra, com o cabeçalho podendo ir para duas;
     3. e 4. as mesmas duas com a letra 7, a do nota a nota.
   Fica com a primeira em que o texto longo cabe, TOLERANDO algumas linhas
   quebradas (duas, ou 5% da tabela): um nome comprido quebra só a linha
   dele, em vez de diminuir a letra da tabela inteira. A letra só desce
   quando o problema é da tabela toda (três empresas espremem as placas de
   todos os conjuntos, por exemplo). Se nenhuma tentativa ficar dentro da
   tolerância, devolve a que quebra menos linhas; `quebras` e `tolera` vão
   junto, para quem chama decidir. Devolve null quando nem o cabeçalho da
   coluna `flex` cabe na sobra. Sem `flex`, todas as colunas têm de caber
   sem quebrar, e a sobra se divide por igual. */
function _fechEncaixar(doc, estilo, cabecalho, linhas, largura, flex, fontes) {
    fontes = fontes || [7.5, 7];
    const tolera = Math.max(2, Math.ceil(linhas.length * 0.05));
    let melhor = null;
    for (const fonte of fontes) {
        for (const porPalavra of [false, true]) {
            const min = _fechLargurasMinimas(doc, estilo, cabecalho, linhas, fonte, porPalavra);
            const soma = min.reduce((s, w) => s + w, 0);
            if (flex == null) {
                if (soma > largura) continue;
                const extra = (largura - soma) / min.length;
                return { fonte, larguras: min.map(w => w + extra), quebras: 0, tolera };
            }
            const resto = largura - (soma - min[flex]);
            const cabFlex = _fechLargurasMinimas(doc, estilo, [cabecalho[flex]], [], fonte, true)[0];
            if (resto < cabFlex) continue;
            // Quantas linhas teriam o texto longo quebrado com essa sobra.
            const folga = 2 * +(fonte * 0.24).toFixed(2) + 0.4;
            doc.setFontSize(fonte);
            const quebras = linhas.filter(l => {
                doc.setFont(estilo.fonte, String(l[0]).startsWith("TOTAL") ? "bold" : "normal");
                return doc.getTextWidth(String(l[flex])) + folga > resto;
            }).length;
            doc.setFont(estilo.fonte, "normal");
            const tentativa = { fonte, larguras: min.map((w, j) => j === flex ? resto : w), quebras, tolera };
            if (quebras <= tolera) return tentativa;
            if (!melhor || quebras < melhor.quebras) melhor = tentativa;
        }
    }
    return melhor;
}

/** O mês inteiro calculado na abertura do modal, reaproveitado na
 *  geração para não refazer a conta duas vezes. */
let _fechMesInteiro = null;

/*─────────────────────────────────────────────
  ESCOLHA DAS EMPRESAS
  O fechamento é o documento que vai para alguém pagar, e nem sempre as
  duas empresas entram no mesmo papel. A lista traz só as que o perfil
  acessa: quem não enxerga uma empresa não pode tirar um relatório dela
  por um caminho lateral.
─────────────────────────────────────────────*/
/* O mês inteiro, SEM o filtro global de empresa.

   A tela de Fretes mostra uma empresa de cada vez, e o fechamento herdava
   esse recorte: quem estava com "Transportadora Aurora" ativa abria o
   modal e via uma opção só, como se as outras não existissem. Mas o
   documento que se manda para pagar costuma ser o do mês inteiro, e é
   justamente aqui que a escolha tem de ser livre. Quem manda no recorte é
   a marcação do modal, e o cabeçalho do PDF declara o que entrou. */
function _fechDadosDoMes() {
    if (!dadosFretesAtual || !dadosFretesAtual.mes) return null;
    return calcularFretesDoMes({
        lancamentos: db.lancamentos,
        mes: dadosFretesAtual.mes,
        empresaDoLancamento: _empresaDoLancamentoFrete,
        resolverConjunto: typeof resolverConjuntoEPeriodo === "function" ? resolverConjuntoEPeriodo : null
    });
}

function abrirFechamentoPDF() {
    const mesInteiro = _fechDadosDoMes();
    if (!mesInteiro || mesInteiro.totalNotas === 0) {
        mostrarToast("Não há nada para fechar neste mês.", "aviso", 4000);
        return;
    }
    _fechMesInteiro = mesInteiro;
    const permitidos = typeof _empresaIdsPermitidos === "function" ? _empresaIdsPermitidos() : null;
    const doMes = mesInteiro.empresasDoMes || [];
    const disponiveis = doMes.filter(nome => {
        if (!permitidos) return true;
        const cad = (db.empresas || []).find(e => e.nome === nome);
        return !cad || permitidos.includes(cad.id);
    });

    if (!disponiveis.length) {
        mostrarToast("Nenhuma empresa deste mês está liberada para o seu perfil.", "aviso", 5000);
        return;
    }

    const alvo = document.getElementById("fechamentoEmpresasLista");
    alvo.innerHTML = disponiveis.map((nome, i) => {
        const e = mesInteiro.porEmpresa.find(x => x.nome === nome);
        return `<label class="fm-escolha">
            <input type="checkbox" class="fechamento-empresa" value="${escapeHtml(nome)}" checked>
            <span><strong>${escapeHtml(nome)}</strong>
            <em class="dica">${e ? `${e.viagens} nota(s) · ${_fmtLitrosFrete(e.litros)} · ${fmtR(e.frete)}` : "sem notas"}</em></span>
        </label>`;
    }).join("");
    document.getElementById("fechamentoSubtitulo").textContent =
        `${nomeMes(mesInteiro.mes)} · marque as empresas que entram no documento.`
        + (empresaFiltroGlobal ? ` A tela está filtrada por ${empresaFiltroGlobal}, mas aqui você escolhe livremente.` : "");
    document.getElementById("fechamentoModal").style.display = "flex";
}

function fecharFechamentoModal() {
    const m = document.getElementById("fechamentoModal");
    if (m) m.style.display = "none";
}

function confirmarFechamentoPDF() {
    const nomes = [...document.querySelectorAll(".fechamento-empresa:checked")].map(c => c.value);
    if (!nomes.length) {
        mostrarToast("Marque ao menos uma empresa.", "aviso", 4000);
        return;
    }
    fecharFechamentoModal();
    exportarFechamentoPDF(nomes);
}

/*─────────────────────────────────────────────
  O RELATÓRIO
─────────────────────────────────────────────*/
function exportarFechamentoPDF(empresasEscolhidas) {
    if (adiarAteBibliotecas(["jspdf", "autotable"], () => exportarFechamentoPDF(empresasEscolhidas))) return;
    if (!dadosFretesAtual || !dadosFretesAtual.mes) {
        mostrarToast("Escolha o mês primeiro.", "aviso", 4000);
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait" });

    /* Recalcula só com as empresas escolhidas, em vez de filtrar os totais
       depois: o frete, o pagamento e a composição dos conjuntos têm de ser
       os daquele recorte, e podar o resultado pronto deixaria o total do
       mês somando notas que não estão no papel. */
    const base = _fechMesInteiro || _fechDadosDoMes() || dadosFretesAtual;
    const escolhidas = new Set(empresasEscolhidas || base.empresasDoMes || []);
    // Sem `empresaFiltro` aqui de propósito: quem decide o recorte é a
    // marcação do modal, não o filtro da tela.
    const d = calcularFretesDoMes({
        lancamentos: db.lancamentos.filter(l => {
            const cad = _empresaDoLancamentoFrete(l);
            return escolhidas.has((cad && cad.nome) || l.empresa);
        }),
        mes: base.mes,
        empresaDoLancamento: _empresaDoLancamentoFrete,
        resolverConjunto: typeof resolverConjuntoEPeriodo === "function" ? resolverConjuntoEPeriodo : null
    });

    if (d.totalNotas === 0) {
        mostrarToast("As empresas escolhidas não têm nota descarregada neste mês.", "aviso", 5000);
        return;
    }
    // "09/2026" em todo o documento, a pedido do dono (24/09/2026), no lugar
    // de "Set/26".
    const [anoMes, numMes] = String(d.mes).split("-");
    const mesLabel = `${numMes}/${anoMes}`;
    const estilo = _pdfEstilo();
    const W = doc.internal.pageSize.width;
    const empresas = d.empresasDoMes || [];

    // ── Capa e números do mês ──────────────────────────────────────
    // O subtítulo diz QUAIS empresas entraram: um fechamento parcial que
    // não se identifica como parcial é um documento perigoso.
    const rotuloEmpresas = empresas.length === (base.empresasDoMes || []).length
        ? (empresas.join(" · ") || "Todas as empresas")
        : `Somente ${empresas.join(" · ")}`;
    // Com a hora: no mesmo dia pode sair mais de uma versão, e a hora diz
    // qual é a última (pedido do dono, 24/09/2026).
    const agora = new Date();
    const geradoEm = `${agora.toLocaleDateString("pt-BR")} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    let y = _pdfCabecalho(doc, estilo, `Fechamento de frete - ${mesLabel}`,
        `${rotuloEmpresas} · gerado em ${geradoEm}`, true);

    // Os rótulos dos cartões são os do dono (24/09/2026).
    const larg = (W - _FECH_MARGEM * 2 - 12) / 4;
    _fechCartao(doc, estilo, _FECH_MARGEM,                  y, larg, "Frete do mês (Veículos)",   fmtR(d.totalFrete),     "", true);
    _fechCartao(doc, estilo, _FECH_MARGEM + (larg + 4),     y, larg, "Litros (Carregados)",       fmtL(d.totalLitros),    "");
    _fechCartao(doc, estilo, _FECH_MARGEM + (larg + 4) * 2, y, larg, "Frete do mês (Motoristas)", fmtR(d.totalPagamento), "");
    y = _fechCartao(doc, estilo, _FECH_MARGEM + (larg + 4) * 3, y, larg, "Notas (Descarregadas)", String(d.totalNotas),   "") + 6;

    // ── Por empresa ────────────────────────────────────────────────
    y = _fechTitulo(doc, estilo, "Por empresa", y);
    const corpoEmpresas = d.porEmpresa.map(e => [
        e.nome, e.viagens, _fmtLitrosFrete(e.litros), _fmtTaxaGrupo(e), fmtR(e.frete), fmtR(e.pagamento || 0)
    ]);
    corpoEmpresas.push(["TOTAL", d.totalNotas, _fmtLitrosFrete(d.totalLitros), "", fmtR(d.totalFrete), fmtR(d.totalPagamento)]);
    y = _fechTabela(doc, estilo, {
        head: [["Empresa", "Notas", "Litros", "Taxa (R$/L)", "Frete", "A pagar"]],
        body: corpoEmpresas, startY: y,
        columnStyles: { 0: { halign: "left", cellWidth: 70 }, 1: { halign: "right" }, 2: { halign: "right" },
                        3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }
    }) + 7;

    // ── Por conjunto: o coração do fechamento ──────────────────────
    // Uma coluna de litros e uma de frete POR EMPRESA, que é como o dono
    // entrega hoje, mais o total do conjunto.
    if (d.porConjunto.length) {
        y = _fechEspaco(doc, y, true, 2);
        y = _fechTitulo(doc, estilo, "Por conjunto", y,
            "Cavalo e reboques que rodaram juntos na data da descarga. Volume e frete separados por empresa.");
        const cabTopo = [{ content: "Conjunto", rowSpan: 2 }, { content: "Placas", rowSpan: 2 }];
        const cabBase = [];
        empresas.forEach(nome => { cabTopo.push({ content: nome, colSpan: 2, styles: { halign: "center", __proprio: true } }); cabBase.push("Litros", "Frete"); });
        cabTopo.push({ content: "Total", colSpan: 2, styles: { halign: "center", __proprio: true } });
        cabBase.push("Litros", "Frete");

        const corpo = d.porConjunto.map(c => {
            const linha = [c.nome, (c.placas || []).join(" · ")];
            empresas.forEach(nome => {
                const e = (c.porEmpresa || {})[nome];
                linha.push(e ? _fmtLitrosFrete(e.litros) : "—", e ? fmtR(e.frete) : "—");
            });
            linha.push(_fmtLitrosFrete(c.litros), fmtR(c.frete));
            return linha;
        });
        const somaConj = { litros: 0, frete: 0 };
        d.porConjunto.forEach(c => { somaConj.litros += c.litros; somaConj.frete += c.frete; });
        const linhaTotal = ["TOTAL", `${d.porConjunto.length} conjunto(s)`];
        empresas.forEach(nome => {
            let l = 0, f = 0;
            d.porConjunto.forEach(c => { const e = (c.porEmpresa || {})[nome]; if (e) { l += e.litros; f += e.frete; } });
            linhaTotal.push(_fmtLitrosFrete(l), fmtR(f));
        });
        linhaTotal.push(_fmtLitrosFrete(somaConj.litros), fmtR(somaConj.frete));
        corpo.push(linhaTotal);

        // As larguras de sempre (Conjunto 22 mm, Placas 58, os números com o
        // resto) quando o mês cabe nelas sem quebrar linha. Com mais
        // empresas, ou nomes de conjunto compridos, os números quebravam em
        // duas linhas ("R$" em cima do valor) em todas as linhas: aí cada
        // coluna passa a ter a largura do conteúdo, e as Placas ficam com a
        // sobra (25/09/2026).
        const util = W - 2 * _FECH_MARGEM;
        const cabColunas = ["Conjunto", "Placas", ...cabBase];
        const min = _fechLargurasMinimas(doc, estilo, cabColunas, corpo, 7.5, false);
        const cabeNoDeSempre = min[0] <= 22 && min[1] <= 58
            && min.slice(2).reduce((s, w) => s + w, 0) <= util - 22 - 58;
        const encaixe = cabeNoDeSempre ? null : _fechEncaixar(doc, estilo, cabColunas, corpo, util, 1);
        const estilos = {};
        if (encaixe) {
            encaixe.larguras.forEach((w, i) => { estilos[i] = { halign: i < 2 ? "left" : "right", cellWidth: w }; });
        } else {
            estilos[0] = { halign: "left", cellWidth: 22 }; estilos[1] = { halign: "left", cellWidth: 58 };
            for (let i = 2; i < cabColunas.length; i++) estilos[i] = { halign: "right" };
        }
        y = _fechTabela(doc, estilo, { head: [cabTopo, cabBase], body: corpo, startY: y, columnStyles: estilos,
                                       fonte: encaixe ? encaixe.fonte : 7.5 }) + 7;

        // As notas que não estavam em conjunto nenhum: o total por conjunto
        // não fecha com o do mês sem esta linha, e omitir isso faria o
        // leitor procurar um erro que não existe.
        const fora = d.totalFrete - somaConj.frete;
        if (Math.abs(fora) > 0.005) {
            doc.setFont(estilo.fonte, "normal"); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
            doc.text(`Fora de conjunto: ${_fmtLitrosFrete(d.totalLitros - somaConj.litros)} e ${fmtR(fora)} de placas que não estavam em nenhum conjunto na data da descarga.`, _FECH_MARGEM, y);
            doc.setTextColor(0, 0, 0);
            y += 6;
        }
    }

    // ── Por motorista, com o que cada um recebe ────────────────────
    y = _fechEspaco(doc, y, true);
    y = _fechTitulo(doc, estilo, "Por motorista", y, "A coluna 'A pagar' é o percentual do frete definido em cada empresa.");
    const corpoMot = d.porMotorista.map(m => {
        const linha = [m.nome, m.viagens];
        empresas.forEach(nome => {
            const e = (m.porEmpresa || {})[nome];
            linha.push(e ? _fmtLitrosFrete(e.litros) : "—");
        });
        linha.push(_fmtLitrosFrete(m.litros), fmtR(m.frete), fmtR(m.pagamento || 0));
        return linha;
    });
    const totalMot = ["TOTAL", d.totalNotas];
    empresas.forEach(nome => {
        let l = 0;
        d.porMotorista.forEach(m => { const e = (m.porEmpresa || {})[nome]; if (e) l += e.litros; });
        totalMot.push(_fmtLitrosFrete(l));
    });
    totalMot.push(_fmtLitrosFrete(d.totalLitros), fmtR(d.totalFrete), fmtR(d.totalPagamento));
    corpoMot.push(totalMot);
    // Os números com a largura do conteúdo e o nome com o resto, como no
    // nota a nota (24/09/2026, pedido do dono). Com o nome fixo em 62 mm, da
    // folha deitada, os nomes longos quebravam em duas linhas enquanto as
    // colunas de número sobravam. Com três empresas ou mais, o nome da
    // empresa no cabeçalho pode ir para duas linhas, e a letra desce para 7
    // se ainda faltar espaço (25/09/2026).
    const cabMot = ["Motorista", "Viagens", ...empresas, "Litros", "Frete", "A pagar"];
    const encMot = _fechEncaixar(doc, estilo, cabMot, corpoMot, W - 2 * _FECH_MARGEM, 0);
    const estMot = {};
    cabMot.forEach((_, i) => {
        estMot[i] = { halign: i === 0 ? "left" : "right",
                      cellWidth: encMot ? encMot.larguras[i] : (i === 0 ? "auto" : "wrap") };
    });
    y = _fechTabela(doc, estilo, {
        head: [cabMot], body: corpoMot, startY: y, columnStyles: estMot, fonte: encMot ? encMot.fonte : 7.5
    }) + 7;

    // ── Por placa ──────────────────────────────────────────────────
    // Em duas metades lado a lado quando cabe (24/09/2026, pedido do dono):
    // são seis colunas estreitas, e a tabela inteira ocupava a largura da
    // folha com os números espalhados e a altura de uma linha por placa.
    // As metades têm as mesmas larguras de coluna, para lerem como uma
    // tabela só: a primeira vai até o meio da lista e a segunda termina no
    // TOTAL. Num mês grande o total ("R$ 1.032.000,00") alarga as colunas,
    // e a letra desce para 7 antes de desistir das metades; um nome de
    // conjunto comprido quebra só a linha dele (25/09/2026). Se nem assim
    // couber, com muitas linhas quebrando, ou se forem poucas placas (menos
    // de 10, e a economia seria de poucas linhas), sai a tabela inteira,
    // como antes.
    const cabPlaca = ["Placa", "Conjunto", "Viagens", "Litros", "Taxa (R$/L)", "Frete"];
    const corpoPlaca = d.porPlaca.map(p => [p.nome, p.conjunto || "—", p.viagens, _fmtLitrosFrete(p.litros), _fmtTaxaGrupo(p), fmtR(p.frete)]);
    const totalPlaca = ["TOTAL", "", d.totalNotas, _fmtLitrosFrete(d.totalLitros), "", fmtR(d.totalFrete)];
    const alinPlaca = ["left", "left", "right", "right", "right", "right"];
    const vao = 3;
    const metade = (W - 2 * _FECH_MARGEM - vao) / 2;
    const encPlaca = corpoPlaca.length >= 10
        ? _fechEncaixar(doc, estilo, cabPlaca, [...corpoPlaca, totalPlaca], metade, 1) : null;
    if (encPlaca && encPlaca.quebras <= encPlaca.tolera) {
        const estilos = {};
        encPlaca.larguras.forEach((w, j) => { estilos[j] = { halign: alinPlaca[j], cellWidth: w }; });
        const meio = Math.ceil((corpoPlaca.length + 1) / 2);
        const pe = { top: _FECH_TOPO, bottom: _FECH_PE };
        y = _fechEspaco(doc, y, false, 2);
        y = _fechTitulo(doc, estilo, "Por placa", y);
        const pagina = doc.internal.getCurrentPageInfo().pageNumber;
        const fimEsq = _fechTabela(doc, estilo, {
            head: [cabPlaca], body: corpoPlaca.slice(0, meio), startY: y, columnStyles: estilos, fonte: encPlaca.fonte,
            margin: Object.assign({ left: _FECH_MARGEM, right: W - _FECH_MARGEM - metade }, pe)
        });
        const pagEsq = doc.internal.getCurrentPageInfo().pageNumber;
        // A segunda metade começa na mesma página e altura da primeira. Se
        // precisar de página nova, o autoTable passa para a que a primeira
        // já abriu, em vez de criar outra no fim.
        doc.setPage(pagina);
        const fimDir = _fechTabela(doc, estilo, {
            head: [cabPlaca], body: [...corpoPlaca.slice(meio), totalPlaca], startY: y, columnStyles: estilos, fonte: encPlaca.fonte,
            margin: Object.assign({ left: _FECH_MARGEM + metade + vao, right: _FECH_MARGEM }, pe)
        });
        const pagDir = doc.internal.getCurrentPageInfo().pageNumber;
        // O documento continua de onde a mais comprida das duas terminou.
        if (pagEsq > pagDir || (pagEsq === pagDir && fimEsq > fimDir)) { doc.setPage(pagEsq); y = fimEsq + 7; }
        else y = fimDir + 7;
    } else {
        // Inteira: Placa e Conjunto com 26 e 30 mm, ou mais, se o nome pedir
        // (um conjunto "SCANIA 12 / RANDON" quebrava em 30 mm).
        const minTab = _fechLargurasMinimas(doc, estilo, cabPlaca, [...corpoPlaca, totalPlaca], 7.5, false);
        y = _fechEspaco(doc, y, false);
        y = _fechTitulo(doc, estilo, "Por placa", y);
        y = _fechTabela(doc, estilo, {
            head: [cabPlaca], body: [...corpoPlaca, totalPlaca], startY: y,
            columnStyles: { 0: { halign: "left", cellWidth: Math.max(26, minTab[0]) }, 1: { halign: "left", cellWidth: Math.max(30, minTab[1]) },
                            2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }
        }) + 7;
    }

    // ── Nota a nota ────────────────────────────────────────────────
    // Das empresas escolhidas no modal, e não da ativa na tela: o PDF das
    // duas empresas saía com as notas de uma só (24/09/2026). Continua logo
    // abaixo da seção anterior quando cabe: a página própria deixava meia
    // página em branco antes dela. A base entrou a pedido do dono.
    //
    // Sem Emissão, Conjunto e Taxa desde 24/09/2026, para caber em retrato
    // (pedido do dono). O conjunto e a taxa de cada placa estão em "Por
    // placa"; a tela e as planilhas continuam com as onze colunas.
    const notas = _freteNotaANota(d.mes, [...escolhidas]);
    if (notas.length) {
        y = _fechEspaco(doc, y, true);
        y = _fechTitulo(doc, estilo, "Nota a nota", y,
            `${notas.length} nota(s) descarregada(s) em ${mesLabel}, na ordem da descarga.`);
        const corpoNotas = notas.map(n => [
            formatarData(n.descarga), n.nota, n.empresa, n.base || "",
            n.motorista, n.placa, _fmtLitrosFrete(n.litros), fmtR(n.frete)
        ]);
        // A contagem na coluna do Motorista, que é a larga: na do número da
        // nota, "119 nota(s)" quebrava em duas linhas.
        corpoNotas.push(["TOTAL", "", "", "", `${notas.length} nota(s)`, "",
            _fmtLitrosFrete(notas.reduce((s, n) => s + n.litros, 0)),
            fmtR(notas.reduce((s, n) => s + n.frete, 0))]);
        // As colunas curtas com a largura do conteúdo ("wrap": o maior texto
        // do mês, cabeçalho incluído, sem quebrar linha) e o Motorista com o
        // resto. Com as larguras fixas da folha deitada, em retrato o nome
        // ficava com 46 mm e mais da metade das notas quebrava em duas
        // linhas; medidas pelo conteúdo, sobram uns 69 mm, e o nome mais
        // longo do teste ("RICARDO RODRIGUES GONÇALVES DOS SANTOS") pede 63.
        // Uma base de nome maior alarga a própria coluna em vez de quebrar.
        // Letra 7, a pedido do dono.
        const curta = halign => ({ halign, cellWidth: "wrap" });
        _fechTabela(doc, estilo, {
            fonte: 7,
            head: [["Descarga", "Nota", "Empresa", "Base", "Motorista", "Placa", "Litros", "Frete"]],
            body: corpoNotas, startY: y,
            columnStyles: { 0: curta("left"), 1: curta("left"), 2: curta("left"), 3: curta("left"),
                            4: { halign: "left", cellWidth: "auto" },
                            5: curta("left"), 6: curta("right"), 7: curta("right") }
        });
    }

    _pdfRodapes(doc, estilo, `Fechamento de ${mesLabel} · ${rotuloEmpresas}`,
        { margem: _FECH_MARGEM, distancia: _FECH_RODAPE });
    _pdfEntregar(doc, `fechamento-${d.mes}.pdf`);
    mostrarToast("Fechamento gerado.", "sucesso", 3000);
}
