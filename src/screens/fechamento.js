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

  Paisagem, e não retrato: com duas empresas a tabela por conjunto tem oito
  colunas, e o nota a nota tem dez. Em retrato elas quebram e a leitura se
  perde.

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
    const alt = 24;
    doc.setFillColor(...(destaque ? estilo.cor : _fechClaro(estilo.cor, 0.93)));
    doc.roundedRect(x, y, largura, alt, 2, 2, "F");
    doc.setTextColor(...(destaque ? [255, 255, 255] : estilo.cor));
    doc.setFont(estilo.fonte, "bold");
    doc.setFontSize(14);
    doc.text(String(valor), x + 5, y + 12);
    doc.setFont(estilo.fonte, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...(destaque ? _fechClaro(estilo.cor, 0.75) : [110, 110, 110]));
    doc.text(String(rotulo).toUpperCase(), x + 5, y + 18);
    if (apoio) doc.text(String(apoio), x + 5, y + 22);
    doc.setTextColor(0, 0, 0);
    return y + alt;
}

/** Título de seção: barra na cor de destaque e o texto ao lado. */
function _fechTitulo(doc, estilo, texto, y, apoio) {
    doc.setFillColor(...estilo.cor);
    doc.rect(14, y - 4, 2.2, 7, "F");
    doc.setFont(estilo.fonte, "bold");
    doc.setFontSize(11);
    doc.setTextColor(...estilo.cor);
    doc.text(texto, 19, y + 2);
    if (apoio) {
        doc.setFont(estilo.fonte, "normal");
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(apoio, 19, y + 7);
    }
    doc.setTextColor(0, 0, 0);
    return y + (apoio ? 12 : 8);
}

/** Opções comuns das tabelas, para as seções não divergirem entre si. */
function _fechTabela(doc, estilo, opcoes) {
    /* O autoTable NÃO propaga o `halign` de `columnStyles` para o
       cabeçalho, só para o corpo. Sem isto, ou o cabeçalho inteiro fica à
       direita (e "Placa" encosta na borda errada sobre uma coluna de
       texto), ou fica inteiro à esquerda (e "Frete" descola dos valores
       logo abaixo). Copiamos coluna a coluna. */
    const alinhamentos = opcoes.columnStyles || {};
    doc.autoTable(Object.assign({
        theme: "grid",
        // Sem `halign` aqui de propósito: o alinhamento vem de
        // `columnStyles`, que o autoTable aplica ao cabeçalho e ao corpo.
        // Fixar "right" no cabeçalho deixava "Placa" e "Conjunto"
        // encostados à direita sobre uma coluna de texto alinhada à
        // esquerda, e era a primeira coisa que saltava no PDF.
        headStyles: { fillColor: estilo.cor, textColor: 255, fontSize: 7.5 },
        bodyStyles: { fontSize: 7.5 },
        alternateRowStyles: { fillColor: _fechClaro(estilo.cor, 0.965) },
        styles: { font: estilo.fonte, cellPadding: 1.8, lineColor: [225, 225, 225], lineWidth: 0.1 },
        margin: { left: 14, right: 14 },
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

/** Garante espaço para o próximo bloco; abre página nova quando não cabe. */
function _fechEspaco(doc, y, precisa) {
    if (y + precisa <= doc.internal.pageSize.height - 16) return y;
    doc.addPage();
    return 20;
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
    if (adiarAteLogoPdf(() => exportarFechamentoPDF(empresasEscolhidas))) return;
    if (!dadosFretesAtual || !dadosFretesAtual.mes) {
        mostrarToast("Escolha o mês primeiro.", "aviso", 4000);
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape" });

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
    const mesLabel = nomeMes(d.mes);
    const estilo = _pdfEstilo();
    const W = doc.internal.pageSize.width;
    const empresas = d.empresasDoMes || [];

    // ── Capa e números do mês ──────────────────────────────────────
    // O subtítulo diz QUAIS empresas entraram: um fechamento parcial que
    // não se identifica como parcial é um documento perigoso.
    const rotuloEmpresas = empresas.length === (base.empresasDoMes || []).length
        ? (empresas.join(" · ") || "Todas as empresas")
        : `Somente ${empresas.join(" · ")}`;
    let y = _pdfCabecalho(doc, estilo, `Fechamento de frete · ${mesLabel}`,
        `${rotuloEmpresas} · pela data da descarga · gerado em ${new Date().toLocaleDateString("pt-BR")}`);

    const larg = (W - 28 - 12) / 4;
    _fechCartao(doc, estilo, 14,                    y, larg, "Frete do mês",   fmtR(d.totalFrete),    "", true);
    _fechCartao(doc, estilo, 14 + (larg + 4),       y, larg, "Litros (carga)", fmtL(d.totalLitros),   "");
    _fechCartao(doc, estilo, 14 + (larg + 4) * 2,   y, larg, "A pagar",        fmtR(d.totalPagamento), "aos motoristas");
    y = _fechCartao(doc, estilo, 14 + (larg + 4) * 3, y, larg, "Notas",        String(d.totalNotas),  "descarregadas") + 10;

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
    }) + 10;

    // ── Por conjunto: o coração do fechamento ──────────────────────
    // Uma coluna de litros e uma de frete POR EMPRESA, que é como o dono
    // entrega hoje, mais o total do conjunto.
    if (d.porConjunto.length) {
        y = _fechEspaco(doc, y, 40);
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

        const estilos = { 0: { halign: "left", cellWidth: 22 }, 1: { halign: "left", cellWidth: 58 } };
        for (let i = 2; i < 2 + (empresas.length + 1) * 2; i++) estilos[i] = { halign: "right" };
        y = _fechTabela(doc, estilo, { head: [cabTopo, cabBase], body: corpo, startY: y, columnStyles: estilos }) + 10;

        // As notas que não estavam em conjunto nenhum: o total por conjunto
        // não fecha com o do mês sem esta linha, e omitir isso faria o
        // leitor procurar um erro que não existe.
        const fora = d.totalFrete - somaConj.frete;
        if (Math.abs(fora) > 0.005) {
            doc.setFont(estilo.fonte, "normal"); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
            doc.text(`Fora de conjunto: ${_fmtLitrosFrete(d.totalLitros - somaConj.litros)} e ${fmtR(fora)} de placas que não estavam em nenhum conjunto na data da descarga.`, 14, y);
            doc.setTextColor(0, 0, 0);
            y += 8;
        }
    }

    // ── Por motorista, com o que cada um recebe ────────────────────
    y = _fechEspaco(doc, y, 40);
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
    const estMot = { 0: { halign: "left", cellWidth: 62 } };
    for (let i = 1; i < 2 + empresas.length + 3; i++) estMot[i] = { halign: "right" };
    y = _fechTabela(doc, estilo, {
        head: [["Motorista", "Viagens", ...empresas, "Litros", "Frete", "A pagar"]],
        body: corpoMot, startY: y, columnStyles: estMot
    }) + 10;

    // ── Por placa ──────────────────────────────────────────────────
    y = _fechEspaco(doc, y, 40);
    y = _fechTitulo(doc, estilo, "Por placa", y);
    const corpoPlaca = d.porPlaca.map(p => [p.nome, p.conjunto || "—", p.viagens, _fmtLitrosFrete(p.litros), _fmtTaxaGrupo(p), fmtR(p.frete)]);
    corpoPlaca.push(["TOTAL", "", d.totalNotas, _fmtLitrosFrete(d.totalLitros), "", fmtR(d.totalFrete)]);
    y = _fechTabela(doc, estilo, {
        head: [["Placa", "Conjunto", "Viagens", "Litros", "Taxa (R$/L)", "Frete"]],
        body: corpoPlaca, startY: y,
        columnStyles: { 0: { halign: "left", cellWidth: 26 }, 1: { halign: "left", cellWidth: 30 },
                        2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }
    });

    // ── Nota a nota, sempre em página própria ──────────────────────
    const notas = _freteNotaANota(d.mes);
    if (notas.length) {
        doc.addPage();
        let yn = _fechTitulo(doc, estilo, "Nota a nota", 20,
            `${notas.length} nota(s) descarregada(s) em ${mesLabel}, na ordem da descarga.`);
        const corpoNotas = notas.map(n => [
            formatarData(n.descarga), formatarData(n.emissao), n.nota, n.empresa,
            n.motorista, n.placa, n.conjunto || "—",
            _fmtLitrosFrete(n.litros), n.taxa > 0 ? fmtFreteL(n.taxa) : "—", fmtR(n.frete)
        ]);
        corpoNotas.push(["TOTAL", "", `${notas.length} nota(s)`, "", "", "", "",
            _fmtLitrosFrete(notas.reduce((s, n) => s + n.litros, 0)), "",
            fmtR(notas.reduce((s, n) => s + n.frete, 0))]);
        _fechTabela(doc, estilo, {
            head: [["Descarga", "Emissão", "Nota", "Empresa", "Motorista", "Placa", "Conjunto", "Litros", "Taxa", "Frete"]],
            body: corpoNotas, startY: yn,
            columnStyles: { 0: { halign: "left", cellWidth: 20 }, 1: { halign: "left", cellWidth: 20 },
                            2: { halign: "left", cellWidth: 22 }, 3: { halign: "left" }, 4: { halign: "left" },
                            5: { halign: "left", cellWidth: 22 }, 6: { halign: "left", cellWidth: 22 },
                            7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } }
        });
    }

    _pdfRodapes(doc, estilo, `Fechamento de ${mesLabel} · ${rotuloEmpresas}`);
    doc.save(`fechamento-${d.mes}.pdf`);
    mostrarToast("Fechamento gerado.", "sucesso", 3000);
}
