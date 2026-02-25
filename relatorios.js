/*=================================================
  VARIÁVEIS GLOBAIS DE DADOS FILTRADOS
=================================================*/
let dadosRelatorioAtual = [];
let dadosHistoricoAtual = [];

// Paginação
const ITENS_POR_PAGINA = 50;
let paginaRelatorio = 1;
let paginaHistorico = 1;

/*=================================================
  RELATÓRIOS
=================================================*/
function carregarRelatorio() {
    paginaRelatorio = 1; // reseta para página 1 ao filtrar
    _aplicarFiltroRelatorio();
}

function _aplicarFiltroRelatorio() {
    const dataInicio  = document.getElementById("filtroDataInicio").value;
    const dataFim     = document.getElementById("filtroDataFim").value;
    const empresa     = document.getElementById("filtroEmpresa").value;
    const motorista   = document.getElementById("filtroMotorista").value;
    const placa       = document.getElementById("filtroPlaca").value;
    const combustivel = document.getElementById("filtroCombustivel").value;
    const nota        = document.getElementById("filtroNota").value.trim().toLowerCase();
    const base        = document.getElementById("filtroBase").value.trim().toLowerCase();
    const busca       = document.getElementById("filtroBusca").value.trim().toLowerCase();

    dadosRelatorioAtual = db.lancamentos.filter(l => {
        if (dataInicio  && l.dataNota < dataInicio) return false;
        if (dataFim     && l.dataNota > dataFim)    return false;
        if (empresa     && l.empresa !== empresa)   return false;
        if (motorista   && l.motorista !== motorista) return false;
        if (placa       && l.placa !== placa)       return false;
        if (nota        && !l.numeroNota.toLowerCase().includes(nota)) return false;
        if (base        && !(l.base || "").toLowerCase().includes(base)) return false;
        if (combustivel && !l.itens.some(i => i.tipo === combustivel)) return false;
        if (busca       && !JSON.stringify(l).toLowerCase().includes(busca)) return false;
        return true;
    });

    // Ordena por data desc
    dadosRelatorioAtual.sort((a, b) => b.dataNota.localeCompare(a.dataNota));

    renderTabelaLancamentos("tabelaRelatorio", dadosRelatorioAtual, "painelDetalhes", "conteudoDetalhes", paginaRelatorio, "relatorio");

    const totalGeral = dadosRelatorioAtual.reduce((soma, l) => soma + l.total, 0);
    const resumo = document.getElementById("resumoRelatorio");
    const barra  = document.getElementById("barraExportacaoRelatorio");

    if (dadosRelatorioAtual.length === 0) {
        resumo.style.display = "none";
        if (barra) barra.style.display = "none";
    } else {
        resumo.style.display = "block";
        resumo.innerHTML = `
            📋 <strong>${dadosRelatorioAtual.length}</strong> lançamento(s) &nbsp;|&nbsp;
            💰 Total: <strong>${fmtR(totalGeral)}</strong>
        `;
        if (barra) barra.style.display = "flex";
    }
    fecharDetalhes('relatorio');
}

function limparFiltros(contexto) {
    if (!contexto || contexto === "relatorio") {
        ["filtroDataInicio","filtroDataFim","filtroEmpresa","filtroMotorista",
         "filtroPlaca","filtroCombustivel","filtroNota","filtroBase","filtroBusca"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        carregarRelatorio();
    } else if (contexto === "historico") {
        ["historicoDataInicio","historicoDataFim","historicoMotorista","historicoPlaca","historicoBusca"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        dadosHistoricoAtual = [];
        document.getElementById("tabelaHistorico").innerHTML =
            `<tr><td colspan="9" class="td-vazio">Selecione um motorista ou placa para filtrar.</td></tr>`;
        document.getElementById("resumoHistorico").style.display = "none";
        const barra = document.getElementById("barraExportacaoHistorico");
        if (barra) barra.style.display = "none";
    }
}

/*=================================================
  HISTÓRICO
=================================================*/
function preencherSelectsHistorico() {
    preencherSelect("historicoMotorista",
        db.motoristas.map(m => ({ valor: m.nome, texto: m.nome + (m.ativo ? "" : " (inativo)") })),
        "Todos os motoristas"
    );
    preencherSelect("historicoPlaca",
        db.veiculos.map(v => ({ valor: v.nome, texto: v.nome + (v.ativo ? "" : " (inativo)") })),
        "Todas as placas"
    );
}

function carregarHistorico() {
    paginaHistorico = 1;
    _aplicarFiltroHistorico();
}

function _aplicarFiltroHistorico() {
    const motorista  = document.getElementById("historicoMotorista").value;
    const placa      = document.getElementById("historicoPlaca").value;
    const dataInicio = document.getElementById("historicoDataInicio").value;
    const dataFim    = document.getElementById("historicoDataFim").value;
    const busca      = document.getElementById("historicoBusca").value.trim().toLowerCase();

    if (!motorista && !placa) return alert("Selecione um motorista ou uma placa.");

    dadosHistoricoAtual = db.lancamentos.filter(l => {
        if (motorista  && l.motorista !== motorista) return false;
        if (placa      && l.placa !== placa)         return false;
        if (dataInicio && l.dataNota < dataInicio)   return false;
        if (dataFim    && l.dataNota > dataFim)      return false;
        if (busca      && !JSON.stringify(l).toLowerCase().includes(busca)) return false;
        return true;
    });

    dadosHistoricoAtual.sort((a, b) => b.dataNota.localeCompare(a.dataNota));

    renderTabelaLancamentos("tabelaHistorico", dadosHistoricoAtual, "painelDetalhesHistorico", "conteudoDetalhesHistorico", paginaHistorico, "historico");

    const totalGeral = dadosHistoricoAtual.reduce((soma, l) => soma + l.total, 0);
    const resumo = document.getElementById("resumoHistorico");
    const barra  = document.getElementById("barraExportacaoHistorico");

    if (dadosHistoricoAtual.length === 0) {
        resumo.style.display = "none";
        if (barra) barra.style.display = "none";
    } else {
        resumo.style.display = "block";
        resumo.innerHTML = `
            📋 <strong>${dadosHistoricoAtual.length}</strong> lançamento(s) &nbsp;|&nbsp;
            💰 Total: <strong>${fmtR(totalGeral)}</strong>
        `;
        if (barra) barra.style.display = "flex";
    }
    fecharDetalhes('historico');
}

/*=================================================
  RENDER TABELA COM PAGINAÇÃO — Melhoria 5
=================================================*/
function renderTabelaLancamentos(idTabela, dados, idPainel, idConteudo, pagina = 1, contexto = "relatorio") {
    const tbody = document.getElementById(idTabela);
    const total = dados.length;

    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="td-vazio">Nenhum lançamento encontrado.</td></tr>`;
        _renderPaginacao(idTabela, 0, 0, 0, contexto);
        return;
    }

    const totalPaginas = Math.ceil(total / ITENS_POR_PAGINA);
    const paginaAtual  = Math.min(pagina, totalPaginas);
    const inicio       = (paginaAtual - 1) * ITENS_POR_PAGINA;
    const fim          = Math.min(inicio + ITENS_POR_PAGINA, total);
    const fatia        = dados.slice(inicio, fim);

    tbody.innerHTML = fatia.map(l => `
        <tr>
            <td>${formatarData(l.dataNota)}</td>
            <td>${formatarData(l.dataDescarga)}</td>
            <td>${l.numeroNota}</td>
            <td>${l.base || '—'}</td>
            <td>${l.empresa || '—'}</td>
            <td>${l.motorista || '—'}</td>
            <td>${l.placa || '—'}</td>
            <td>${fmtR(l.total)}</td>
            <td class="no-print">
                <button class="btn-editar" onclick="editarLancamento(${l.id})">Editar</button>
                <button class="btn-clonar" onclick="clonarLancamento(${l.id})">Clonar</button>
                <button class="btn-excluir" onclick="excluirLancamento(${l.id}, '${contexto}')">Excluir</button>
                <button class="btn-secundario" onclick="mostrarDetalhes(${l.id}, '${contexto}')">Ver</button>
            </td>
        </tr>
    `).join("");

    _renderPaginacao(idTabela, paginaAtual, totalPaginas, total, contexto);
}

function _renderPaginacao(idTabela, paginaAtual, totalPaginas, totalItens, contexto) {
    const idPag = `paginacao_${idTabela}`;
    let el = document.getElementById(idPag);

    if (!el) {
        el = document.createElement("div");
        el.id = idPag;
        el.className = "paginacao";
        const container = document.getElementById(idTabela).closest(".tabela-container");
        if (container) container.after(el);
    }

    if (totalPaginas <= 1) {
        el.innerHTML = "";
        return;
    }

    const inicio = ((paginaAtual - 1) * ITENS_POR_PAGINA) + 1;
    const fim    = Math.min(paginaAtual * ITENS_POR_PAGINA, totalItens);

    // Gera botões de páginas — mostra até 5 ao redor da atual
    let pagBtns = "";
    const JANELA = 2;
    for (let p = 1; p <= totalPaginas; p++) {
        if (p === 1 || p === totalPaginas || (p >= paginaAtual - JANELA && p <= paginaAtual + JANELA)) {
            const ativo = p === paginaAtual ? "ativo" : "";
            pagBtns += `<button class="pag-btn ${ativo}" onclick="_irParaPagina(${p}, '${contexto}')">${p}</button>`;
        } else if (p === paginaAtual - JANELA - 1 || p === paginaAtual + JANELA + 1) {
            pagBtns += `<span class="pag-ellipsis">…</span>`;
        }
    }

    el.innerHTML = `
        <div class="pag-info">Exibindo <strong>${inicio}–${fim}</strong> de <strong>${totalItens}</strong> registros</div>
        <div class="pag-controles">
            <button class="pag-btn" onclick="_irParaPagina(${paginaAtual - 1}, '${contexto}')" ${paginaAtual <= 1 ? "disabled" : ""}>‹</button>
            ${pagBtns}
            <button class="pag-btn" onclick="_irParaPagina(${paginaAtual + 1}, '${contexto}')" ${paginaAtual >= totalPaginas ? "disabled" : ""}>›</button>
        </div>
    `;
}

function _irParaPagina(pagina, contexto) {
    if (contexto === "relatorio") {
        paginaRelatorio = pagina;
        renderTabelaLancamentos("tabelaRelatorio", dadosRelatorioAtual, "painelDetalhes", "conteudoDetalhes", paginaRelatorio, "relatorio");
    } else if (contexto === "historico") {
        paginaHistorico = pagina;
        renderTabelaLancamentos("tabelaHistorico", dadosHistoricoAtual, "painelDetalhesHistorico", "conteudoDetalhesHistorico", paginaHistorico, "historico");
    }
    // Rola suavemente para o topo da tabela
    document.getElementById(contexto === "relatorio" ? "relatorios" : "historico")
        .querySelector(".tabela-container")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/*=================================================
  DETALHES
=================================================*/
function mostrarDetalhes(id, contexto) {
    const painel = document.getElementById(`painelDetalhes${contexto.charAt(0).toUpperCase() + contexto.slice(1)}`);
    const conteudo = document.getElementById(`conteudoDetalhes${contexto.charAt(0).toUpperCase() + contexto.slice(1)}`);

    const l = db.lancamentos.find(x => x.id === id);
    if (!l) return;

    let htmlItens = l.itens.map(item => `
        <tr>
            <td>${item.tipo}</td>
            <td>${fmtL3(item.qtd)}</td>
            <td>${item.qtdDescargada ? fmtL3(item.qtdDescargada) : "—"}</td>
            <td>${fmtR4(item.valor)}</td>
            <td>${fmtR(item.total)}</td>
            <td>${calcularPerdaBadge(item.tipo, item.qtd, item.qtdDescargada)}</td>
        </tr>
    `).join("");

    conteudo.innerHTML = `
        <div class="detalhe-info">
            <div><span>Data Nota</span><strong>${formatarData(l.dataNota)}</strong></div>
            <div><span>Data Descarga</span><strong>${l.dataDescarga ? formatarData(l.dataDescarga) : "—"}</strong></div>
            <div><span>Nota</span><strong>${l.numeroNota}</strong></div>
            <div><span>Base</span><strong>${l.base || "—"}</strong></div>
            <div><span>Empresa</span><strong>${l.empresa || "—"}</strong></div>
            <div><span>Motorista</span><strong>${l.motorista || "—"}</strong></div>
            <div><span>Placa</span><strong>${l.placa || "—"}</strong></div>
            <div><span>Total</span><strong>${fmtR(l.total)}</strong></div>
        </div>

        <h4>Combustíveis</h4>
        <table class="detalhe-tabela">
            <thead><tr>
                <th>Tipo</th><th>Qtd Carga</th><th>Qtd Descarga</th>
                <th>Valor Unit.</th><th>Total</th><th>Perda</th>
            </tr></thead>
            <tbody>${htmlItens}</tbody>
        </table>

        <div class="detalhe-obs">
            <strong>Observações</strong>
            <br>${l.observacoes || "—"}
        </div>

        <div class="detalhe-obs">
            <strong>Nota Fiscal</strong>
            <br>${l.notaFile ? (l.notaFile.startsWith('data:image/') ? `<img src="${l.notaFile}" class="preview-nf" alt="Nota Fiscal">` : `<a href="${l.notaFile}" target="_blank">Abrir PDF</a>`) : "—"}
        </div>

        <div class="detalhe-obs">
            <strong>Histórico de Alterações</strong>
            <ul class="log-list">${l.logs ? l.logs.map(log => `<li>${log}</li>`).join('') : "—"}</ul>
        </div>
    `;

    painel.style.display = "block";
}

function fecharDetalhes(contexto) {
    document.getElementById(`painelDetalhes${contexto.charAt(0).toUpperCase() + contexto.slice(1)}`).style.display = "none";
}

/*=================================================
  EXPORTAÇÕES
=================================================*/
function exportarExcel(contexto) {
    const dados = contexto === "relatorio" ? dadosRelatorioAtual : dadosHistoricoAtual;
    if (!dados || dados.length === 0) { alert("Não há dados para exportar."); return; }

    const linhas = dados.map(l => {
        const totalLitros = l.itens.reduce((s, i) => s + (i.qtd || 0), 0);
        const combustiveis = l.itens.map(i => `${i.tipo}: ${i.qtd.toFixed(3)} L`).join(" | ");
        return [
            formatarData(l.dataNota),
            l.dataDescarga ? formatarData(l.dataDescarga) : "",
            l.numeroNota,
            l.base || "",
            l.empresa || "",
            l.motorista || "",
            l.placa || "",
            combustiveis,
            totalLitros.toFixed(3),
            l.total.toFixed(2)
        ];
    });

    linhas.unshift(["Data Nota", "Data Descarga", "Nota", "Base", "Empresa", "Motorista", "Placa", "Combustíveis", "Total Litros (L)", "Total (R$)"]);

    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatorio");
    XLSX.writeFile(wb, "controle-combustivel.xlsx");
}

function exportarPDF(contexto) {
    const dados = contexto === "relatorio" ? dadosRelatorioAtual : dadosHistoricoAtual;
    if (!dados || dados.length === 0) { alert("Não há dados para exportar."); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Controle de Entradas de Combustível", 105, 15, { align: "center" });
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`, 105, 22, { align: "center" });

    doc.autoTable({
        head: [["Data Nota", "Data Descarga", "Nota", "Base", "Empresa", "Motorista", "Placa", "Litros (L)", "Total (R$)"]],
        body: dados.map(l => {
            const totalLitros = l.itens.reduce((s, i) => s + (i.qtd || 0), 0);
            return [
                formatarData(l.dataNota),
                l.dataDescarga ? formatarData(l.dataDescarga) : "",
                l.numeroNota,
                l.base || "",
                l.empresa || "",
                l.motorista || "",
                l.placa || "",
                totalLitros.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                `R$ ${l.total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ];
        }),
        startY: 30,
        theme: "grid",
        headStyles: { fillColor: [26, 58, 92] },
        margin: { left: 14, right: 14 },
        columnStyles: { 7: { cellWidth: 20, halign: "right" } },
        didDrawPage: function (data) { data.settings.margin.top = 10; }
    });

    const finalY = doc.lastAutoTable.finalY || 30;
    const totalGeral = dados.reduce((s, l) => s + l.total, 0);
    doc.setFontSize(10);
    doc.setTextColor(26, 58, 92);
    doc.text(`Total Geral: R$ ${totalGeral.toFixed(2)}`, doc.internal.pageSize.width - 14, finalY, { align: "right" });
    doc.save(`controle-combustivel-${new Date().toISOString().slice(0,10)}.pdf`);
}

function imprimirRelatorio() {
    const telaRelatorio = document.getElementById("relatorios").style.display !== "none";
    const dados  = telaRelatorio ? dadosRelatorioAtual : dadosHistoricoAtual;
    const titulo = telaRelatorio ? "Relatório de Entradas" : "Histórico de Entradas";

    if (!dados || dados.length === 0) { alert("Não há dados para imprimir."); return; }

    const totalGeral = dados.reduce((s, l) => s + l.total, 0);
    const dataHoje   = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });

    document.getElementById("impressaoTitulo").textContent = titulo;
    document.getElementById("impressaoData").textContent   = `Impresso em: ${dataHoje} | ${dados.length} registros | Total: ${fmtR(totalGeral)}`;

    document.getElementById("impressaoConteudo").innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Data Nota</th><th>Data Desc.</th><th>Nota</th><th>Base</th>
                    <th>Empresa</th><th>Motorista</th><th>Placa</th><th>Litros (L)</th><th>Total (R$)</th>
                </tr>
            </thead>
            <tbody>
                ${dados.map(l => {
                    const totalLitros = l.itens.reduce((s, i) => s + (i.qtd || 0), 0);
                    return `
                    <tr>
                        <td>${formatarData(l.dataNota)}</td>
                        <td>${l.dataDescarga ? formatarData(l.dataDescarga) : ""}</td>
                        <td>${l.numeroNota}</td>
                        <td>${l.base || ""}</td>
                        <td>${l.empresa || ""}</td>
                        <td>${l.motorista || ""}</td>
                        <td>${l.placa || ""}</td>
                        <td>${totalLitros.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                        <td>R$ ${l.total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>`;
                }).join("")}
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="7"><strong>Total Geral</strong></td>
                    <td><strong>${dados.reduce((s,l) => s + l.itens.reduce((ss,i) => ss + (i.qtd||0),0), 0).toLocaleString("pt-BR", {minimumFractionDigits:3, maximumFractionDigits:3})} L</strong></td>
                    <td><strong>${fmtR(totalGeral)}</strong></td>
                </tr>
            </tfoot>
        </table>
    `;
    window.print();
}

function compartilharWhatsApp(contexto) {
    const lista = contexto === "relatorio" ? dadosRelatorioAtual : dadosHistoricoAtual;
    if (!lista || lista.length === 0) { alert("Não há dados para compartilhar."); return; }

    const totalGeral = lista.reduce((s, l) => s + l.total, 0);
    const dataHoje   = new Date().toLocaleDateString("pt-BR");
    let mensagem = `⛽ *Controle de Combustível*\n📅 ${dataHoje}\n📋 ${lista.length} lançamento(s)\n💰 Total: ${fmtR(totalGeral)}\n\n`;

    lista.slice(-5).forEach(l => {
        mensagem += `• ${formatarData(l.dataNota)} | ${l.numeroNota} | ${l.motorista || "—"} | ${fmtR(l.total)}\n`;
    });
    if (lista.length > 5) mensagem += `\n... e mais ${lista.length - 5} registro(s).`;

    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, "_blank");
}

function compartilharEmail(contexto) {
    const lista = contexto === "relatorio" ? dadosRelatorioAtual : dadosHistoricoAtual;
    if (!lista || lista.length === 0) { alert("Não há dados para compartilhar."); return; }

    const totalGeral = lista.reduce((s, l) => s + l.total, 0);
    const dataHoje   = new Date().toLocaleDateString("pt-BR");
    const assunto    = `Controle de Combustível — ${dataHoje}`;

    let corpo = `Controle de Entradas de Combustível\nData: ${dataHoje}\nRegistros: ${lista.length}\nTotal: ${fmtR(totalGeral)}\n\n${"=".repeat(60)}\n\n`;
    lista.forEach(l => {
        corpo += `Data: ${formatarData(l.dataNota)}\nNota: ${l.numeroNota} | Base: ${l.base || "—"}\nEmpresa: ${l.empresa || "—"} | Motorista: ${l.motorista || "—"} | Placa: ${l.placa || "—"}\nTotal: ${fmtR(l.total)}\n${"-".repeat(40)}\n`;
    });

    window.location.href = `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}