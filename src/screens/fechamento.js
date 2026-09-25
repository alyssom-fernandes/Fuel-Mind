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

/* As peças do desenho (cartões, títulos, tabelas, larguras e margens)
   estão em src/shared/pdf-padrao.js desde 25/09/2026: o padrão deste
   documento passou a valer para todos os PDFs do sistema. */

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
    const mesLabel = _pdfMesAno(d.mes);
    const estilo = _pdfEstilo();
    const W = doc.internal.pageSize.width;
    const empresas = d.empresasDoMes || [];

    // ── Capa e números do mês ──────────────────────────────────────
    // O subtítulo diz QUAIS empresas entraram: um fechamento parcial que
    // não se identifica como parcial é um documento perigoso.
    const rotuloEmpresas = empresas.length === (base.empresasDoMes || []).length
        ? (empresas.join(" · ") || "Todas as empresas")
        : `Somente ${empresas.join(" · ")}`;
    // A data e a hora da geração saem no rodapé de todas as páginas desde
    // 25/09/2026, e não no título: uma folha solta continua dizendo de
    // quando é.
    const geradoEm = _pdfGeradoEm();
    /* ALUGUEL, e não frete, no que se paga pelos veículos (25/09/2026,
       pedido do dono): o contrato com a locadora é de LOCAÇÃO de veículos,
       sem condutor, cobrada por litro transportado, e as planilhas dele já
       diziam aluguel. A troca é só neste documento, que vai para fora; a
       tela de Fretes e o resto do sistema seguem com "frete". O que vai
       para os motoristas continua "Frete do mês (Motoristas)" no cartão e
       "A pagar" nas tabelas, como na tela, para o mesmo valor não ter dois
       nomes; na tabela por empresa, onde os dois aparecem lado a lado, os
       parênteses dizem de quem é cada um. */
    let y = _pdfCabecalho(doc, estilo, `Fechamento de Aluguel de Veículos e Frete - ${mesLabel}`,
        rotuloEmpresas, true);

    // Os rótulos dos cartões são os do dono (24 e 25/09/2026).
    y = _pdfCartoes(doc, estilo, y, [
        { rotulo: "Aluguel do mês (Veículos)", valor: fmtR(d.totalFrete), destaque: true },
        { rotulo: "Litros (Carregados)",       valor: fmtL(d.totalLitros) },
        { rotulo: "Frete do mês (Motoristas)", valor: fmtR(d.totalPagamento) },
        { rotulo: "Notas (Descarregadas)",     valor: String(d.totalNotas) }
    ]) + 6;

    // ── Por empresa ────────────────────────────────────────────────
    y = _pdfTitulo(doc, estilo, "Por empresa", y);
    const corpoEmpresas = d.porEmpresa.map(e => [
        e.nome, e.viagens, _fmtLitrosFrete(e.litros), _fmtTaxaGrupo(e), fmtR(e.frete), fmtR(e.pagamento || 0)
    ]);
    corpoEmpresas.push(["TOTAL", d.totalNotas, _fmtLitrosFrete(d.totalLitros), "", fmtR(d.totalFrete), fmtR(d.totalPagamento)]);
    y = _pdfTabela(doc, estilo, {
        head: [["Empresa", "Notas", "Litros", "Taxa (R$/L)", "Aluguel (Veículos)", "A pagar (Motoristas)"]],
        body: corpoEmpresas, startY: y,
        columnStyles: { 0: { halign: "left", cellWidth: 70 }, 1: { halign: "right" }, 2: { halign: "right" },
                        3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }
    }) + 7;

    // ── Por conjunto: o coração do fechamento ──────────────────────
    // Uma coluna de litros e uma de aluguel POR EMPRESA, que é como o dono
    // entrega hoje, mais o total do conjunto. Sem a linha de apoio desde
    // 25/09/2026 (pedido do dono), como as outras seções: o que ela dizia
    // (volume e aluguel por empresa) o cabeçalho já mostra.
    if (d.porConjunto.length) {
        y = _pdfEspaco(doc, y, false, 2);
        y = _pdfTitulo(doc, estilo, "Por conjunto", y);
        const cabTopo = [{ content: "Conjunto", rowSpan: 2 }, { content: "Placas", rowSpan: 2 }];
        const cabBase = [];
        empresas.forEach(nome => { cabTopo.push({ content: nome, colSpan: 2, styles: { halign: "center", __proprio: true } }); cabBase.push("Litros", "Aluguel"); });
        cabTopo.push({ content: "Total", colSpan: 2, styles: { halign: "center", __proprio: true } });
        cabBase.push("Litros", "Aluguel");

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
        const util = W - 2 * _PDF_MARGEM;
        const cabColunas = ["Conjunto", "Placas", ...cabBase];
        const min = _pdfLargurasMinimas(doc, estilo, cabColunas, corpo, 7.5, false);
        const cabeNoDeSempre = min[0] <= 22 && min[1] <= 58
            && min.slice(2).reduce((s, w) => s + w, 0) <= util - 22 - 58;
        const encaixe = cabeNoDeSempre ? null : _pdfEncaixar(doc, estilo, cabColunas, corpo, util, 1);
        const estilos = {};
        if (encaixe) {
            encaixe.larguras.forEach((w, i) => { estilos[i] = { halign: i < 2 ? "left" : "right", cellWidth: w }; });
        } else {
            estilos[0] = { halign: "left", cellWidth: 22 }; estilos[1] = { halign: "left", cellWidth: 58 };
            for (let i = 2; i < cabColunas.length; i++) estilos[i] = { halign: "right" };
        }
        y = _pdfTabela(doc, estilo, { head: [cabTopo, cabBase], body: corpo, startY: y, columnStyles: estilos,
                                       fonte: encaixe ? encaixe.fonte : 7.5 }) + 7;

        // As notas que não estavam em conjunto nenhum: o total por conjunto
        // não fecha com o do mês sem esta linha, e omitir isso faria o
        // leitor procurar um erro que não existe.
        const fora = d.totalFrete - somaConj.frete;
        if (Math.abs(fora) > 0.005) {
            y = _pdfNota(doc, estilo, `Fora de conjunto: ${_fmtLitrosFrete(d.totalLitros - somaConj.litros)} e ${fmtR(fora)} de placas que não estavam em nenhum conjunto na data da descarga.`, y);
        }
    }

    // ── Por motorista, com o que cada um recebe ────────────────────
    // Sem a coluna do aluguel desde 25/09/2026 (pedido do dono): o foco
    // aqui é o motorista, e o aluguel já está nas outras tabelas. Sem a
    // linha de apoio também: a proporção entre o aluguel e o "A pagar" se
    // vê lado a lado na tabela por empresa.
    y = _pdfEspaco(doc, y, false);
    y = _pdfTitulo(doc, estilo, "Por motorista", y);
    const corpoMot = d.porMotorista.map(m => {
        const linha = [m.nome, m.viagens];
        empresas.forEach(nome => {
            const e = (m.porEmpresa || {})[nome];
            linha.push(e ? _fmtLitrosFrete(e.litros) : "—");
        });
        linha.push(_fmtLitrosFrete(m.litros), fmtR(m.pagamento || 0));
        return linha;
    });
    const totalMot = ["TOTAL", d.totalNotas];
    empresas.forEach(nome => {
        let l = 0;
        d.porMotorista.forEach(m => { const e = (m.porEmpresa || {})[nome]; if (e) l += e.litros; });
        totalMot.push(_fmtLitrosFrete(l));
    });
    totalMot.push(_fmtLitrosFrete(d.totalLitros), fmtR(d.totalPagamento));
    corpoMot.push(totalMot);
    // Os números com a largura do conteúdo e o nome com o resto, como no
    // nota a nota (24/09/2026, pedido do dono). Com o nome fixo em 62 mm, da
    // folha deitada, os nomes longos quebravam em duas linhas enquanto as
    // colunas de número sobravam. Com três empresas ou mais, o nome da
    // empresa no cabeçalho pode ir para duas linhas, e a letra desce para 7
    // se ainda faltar espaço (25/09/2026).
    const cabMot = ["Motorista", "Viagens", ...empresas, "Litros", "A pagar"];
    const encMot = _pdfEncaixar(doc, estilo, cabMot, corpoMot, W - 2 * _PDF_MARGEM, 0);
    const estMot = {};
    cabMot.forEach((_, i) => {
        estMot[i] = { halign: i === 0 ? "left" : "right",
                      cellWidth: encMot ? encMot.larguras[i] : (i === 0 ? "auto" : "wrap") };
    });
    y = _pdfTabela(doc, estilo, {
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
    const cabPlaca = ["Placa", "Conjunto", "Viagens", "Litros", "Taxa (R$/L)", "Aluguel"];
    const corpoPlaca = d.porPlaca.map(p => [p.nome, p.conjunto || "—", p.viagens, _fmtLitrosFrete(p.litros), _fmtTaxaGrupo(p), fmtR(p.frete)]);
    const totalPlaca = ["TOTAL", "", d.totalNotas, _fmtLitrosFrete(d.totalLitros), "", fmtR(d.totalFrete)];
    const alinPlaca = ["left", "left", "right", "right", "right", "right"];
    const vao = 3;
    const metade = (W - 2 * _PDF_MARGEM - vao) / 2;
    const encPlaca = corpoPlaca.length >= 10
        ? _pdfEncaixar(doc, estilo, cabPlaca, [...corpoPlaca, totalPlaca], metade, 1) : null;
    if (encPlaca && encPlaca.quebras <= encPlaca.tolera) {
        const estilos = {};
        encPlaca.larguras.forEach((w, j) => { estilos[j] = { halign: alinPlaca[j], cellWidth: w }; });
        const meio = Math.ceil((corpoPlaca.length + 1) / 2);
        const pe = { top: _PDF_TOPO, bottom: _PDF_PE };
        y = _pdfEspaco(doc, y, false, 2);
        y = _pdfTitulo(doc, estilo, "Por placa", y);
        const pagina = doc.internal.getCurrentPageInfo().pageNumber;
        const fimEsq = _pdfTabela(doc, estilo, {
            head: [cabPlaca], body: corpoPlaca.slice(0, meio), startY: y, columnStyles: estilos, fonte: encPlaca.fonte,
            margin: Object.assign({ left: _PDF_MARGEM, right: W - _PDF_MARGEM - metade }, pe)
        });
        const pagEsq = doc.internal.getCurrentPageInfo().pageNumber;
        // A segunda metade começa na mesma página e altura da primeira. Se
        // precisar de página nova, o autoTable passa para a que a primeira
        // já abriu, em vez de criar outra no fim.
        doc.setPage(pagina);
        const fimDir = _pdfTabela(doc, estilo, {
            head: [cabPlaca], body: [...corpoPlaca.slice(meio), totalPlaca], startY: y, columnStyles: estilos, fonte: encPlaca.fonte,
            margin: Object.assign({ left: _PDF_MARGEM + metade + vao, right: _PDF_MARGEM }, pe)
        });
        const pagDir = doc.internal.getCurrentPageInfo().pageNumber;
        // O documento continua de onde a mais comprida das duas terminou.
        if (pagEsq > pagDir || (pagEsq === pagDir && fimEsq > fimDir)) { doc.setPage(pagEsq); y = fimEsq + 7; }
        else y = fimDir + 7;
    } else {
        // Inteira: Placa e Conjunto com 26 e 30 mm, ou mais, se o nome pedir
        // (um conjunto "SCANIA 12 / RANDON" quebrava em 30 mm).
        const minTab = _pdfLargurasMinimas(doc, estilo, cabPlaca, [...corpoPlaca, totalPlaca], 7.5, false);
        y = _pdfEspaco(doc, y, false);
        y = _pdfTitulo(doc, estilo, "Por placa", y);
        y = _pdfTabela(doc, estilo, {
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
        // Sem a linha de apoio desde 25/09/2026 (pedido do dono): a contagem
        // está no cartão e no TOTAL, e a ordem se vê na coluna Descarga.
        y = _pdfEspaco(doc, y, false);
        y = _pdfTitulo(doc, estilo, "Nota a nota", y);
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
        _pdfTabela(doc, estilo, {
            fonte: 7,
            head: [["Descarga", "Nota", "Empresa", "Base", "Motorista", "Placa", "Litros", "Aluguel"]],
            body: corpoNotas, startY: y,
            columnStyles: { 0: curta("left"), 1: curta("left"), 2: curta("left"), 3: curta("left"),
                            4: { halign: "left", cellWidth: "auto" },
                            5: curta("left"), 6: curta("right"), 7: curta("right") }
        });
    }

    _pdfRodapes(doc, estilo, `Fechamento de ${mesLabel} · ${rotuloEmpresas}`, { direita: `Gerado em ${geradoEm}` });
    _pdfEntregar(doc, `fechamento-${d.mes}.pdf`);
    mostrarToast("Fechamento gerado.", "sucesso", 3000);
}
