/*=================================================
  FRETES — FASE 8 + EXPORTAÇÃO CSV + FILTRO GLOBAL
  + AGRUPAMENTO POR CONJUNTO DE VEÍCULOS
  Lógica: para cada mês, agrupa os lançamentos por
  Placa, Motorista, Empresa e Conjunto, calculando:
    Litros transportados (qtd carga)
    Frete = litros × taxa por combustível
  A taxa é configurável por combustível e salva em db.taxasFrete
  FIX: garantirConjuntos() chamado antes de processar para
       garantir que db.conjuntosVeiculos existe
=================================================*/

let dadosFretesAtual = null;

/*=================================================
  CARREGAR TELA DE FRETES
=================================================*/
function carregarFretes() {
    if (!db.taxasFrete) { db.taxasFrete = {}; salvarDB(); }

    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

    const sel = document.getElementById("fretesSelectMes");
    if (sel && !sel.value) sel.value = mesAtual;

    renderTaxasFretes();
    calcularEExibirFretes();
}

function renderTaxasFretes() {
    const container = document.getElementById("fretesTodasTaxas");
    if (!container) return;

    if (db.combustiveis.length === 0) {
        container.innerHTML = `<p class="dica">Nenhum combustível cadastrado.</p>`;
        return;
    }

    container.innerHTML = db.combustiveis.map(c => {
        const taxa = db.taxasFrete[c.nome] ?? "";
        return `
            <div class="frete-taxa-item">
                <label>${c.nome}</label>
                <div style="display:flex; gap:8px; align-items:center">
                    <span style="color:var(--text-muted); font-size:0.9rem">R$</span>
                    <input type="number" class="input-tabela" min="0" step="0.0001"
                           style="max-width:130px"
                           value="${taxa}"
                           placeholder="0,0000"
                           id="taxaFrete_${c.nome.replace(/\s+/g,'_')}"
                           onchange="salvarTaxaFrete('${c.nome.replace(/'/g,"\\'")}', this.value)">
                    <span style="color:var(--text-muted); font-size:0.85rem">/ litro</span>
                </div>
            </div>
        `;
    }).join("");
}

function salvarTaxaFrete(nomeCombustivel, valor) {
    if (!db.taxasFrete) db.taxasFrete = {};
    const val = parseFloat(valor);
    db.taxasFrete[nomeCombustivel] = isNaN(val) ? 0 : val;
    salvarDB();
    calcularEExibirFretes();
}

function calcularEExibirFretes() {
    const mes = document.getElementById("fretesSelectMes")?.value;
    if (!mes) return;

    // ── FIX: garante que db.conjuntosVeiculos existe antes de processar ──
    if (typeof garantirConjuntos === 'function') garantirConjuntos();

    const lancamentosMes = db.lancamentos.filter(l => {
        if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
        const d = l.dataDescarga || l.dataNota;
        return d && d.startsWith(mes);
    });

    const porPlaca      = {};
    const porMotorista  = {};
    const porEmpresa    = {};
    const porConjunto   = {};

    lancamentosMes.forEach(l => {
        const placa     = l.placa     || "(sem placa)";
        const motorista = l.motorista || "(sem motorista)";
        const empresa   = l.empresa   || "(sem empresa)";
        const dataRef   = l.dataDescarga || l.dataNota || mes + "-01";

        // Resolver conjunto vigente para esta placa e data
        const conjObj = typeof resolverConjuntoPorPlaca === 'function'
            ? resolverConjuntoPorPlaca(placa, dataRef)
            : null;
        const conjKey = conjObj
            ? conjObj.id
            : null;
        const conjLabel = conjObj
            ? (conjObj.nome || `Conjunto ${conjObj.composicaoAtual[0]}`)
            : null;

        if (!porPlaca[placa])         porPlaca[placa]         = { nome: placa,     viagens: 0, litros: 0, frete: 0, detalhes: {}, conjunto: conjLabel };
        if (!porMotorista[motorista]) porMotorista[motorista] = { nome: motorista,  viagens: 0, litros: 0, frete: 0, detalhes: {} };
        if (!porEmpresa[empresa])     porEmpresa[empresa]     = { nome: empresa,    viagens: 0, litros: 0, frete: 0, detalhes: {} };

        if (conjKey && !porConjunto[conjKey]) {
            porConjunto[conjKey] = {
                id: conjKey,
                nome: conjLabel,
                placas: conjObj.composicaoAtual.slice(),
                viagens: 0,
                litros: 0,
                frete: 0,
                detalhes: {},
                porPlacaInterna: {}
            };
        }

        porPlaca[placa].viagens++;
        porMotorista[motorista].viagens++;
        porEmpresa[empresa].viagens++;
        if (conjKey) porConjunto[conjKey].viagens++;

        l.itens.forEach(item => {
            const litros = item.qtd || 0;
            const taxa   = db.taxasFrete?.[item.tipo] ?? 0;
            const frete  = litros * taxa;
            const tipo   = item.tipo || "Desconhecido";

            // Por placa
            porPlaca[placa].litros += litros;
            porPlaca[placa].frete  += frete;
            if (!porPlaca[placa].detalhes[tipo]) porPlaca[placa].detalhes[tipo] = { litros: 0, frete: 0 };
            porPlaca[placa].detalhes[tipo].litros += litros;
            porPlaca[placa].detalhes[tipo].frete  += frete;

            // Por motorista
            porMotorista[motorista].litros += litros;
            porMotorista[motorista].frete  += frete;
            if (!porMotorista[motorista].detalhes[tipo]) porMotorista[motorista].detalhes[tipo] = { litros: 0, frete: 0 };
            porMotorista[motorista].detalhes[tipo].litros += litros;
            porMotorista[motorista].detalhes[tipo].frete  += frete;

            // Por empresa
            porEmpresa[empresa].litros += litros;
            porEmpresa[empresa].frete  += frete;
            if (!porEmpresa[empresa].detalhes[tipo]) porEmpresa[empresa].detalhes[tipo] = { litros: 0, frete: 0 };
            porEmpresa[empresa].detalhes[tipo].litros += litros;
            porEmpresa[empresa].detalhes[tipo].frete  += frete;

            // Por conjunto
            if (conjKey) {
                const conj = porConjunto[conjKey];
                conj.litros += litros;
                conj.frete  += frete;
                if (!conj.detalhes[tipo]) conj.detalhes[tipo] = { litros: 0, frete: 0 };
                conj.detalhes[tipo].litros += litros;
                conj.detalhes[tipo].frete  += frete;

                // Sub-agrupamento por placa dentro do conjunto
                if (!conj.porPlacaInterna[placa]) conj.porPlacaInterna[placa] = { viagens: 0, litros: 0, frete: 0 };
                conj.porPlacaInterna[placa].viagens++;
                conj.porPlacaInterna[placa].litros += litros;
                conj.porPlacaInterna[placa].frete  += frete;
            }
        });
    });

    const sortDesc = obj => Object.values(obj).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const sortDescConj = obj => Object.values(obj).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    dadosFretesAtual = {
        mes,
        totalNotas:  lancamentosMes.length,
        totalLitros: lancamentosMes.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + (i.qtd || 0), 0), 0),
        totalFrete:  lancamentosMes.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + (i.qtd || 0) * (db.taxasFrete?.[i.tipo] ?? 0), 0), 0),
        porPlaca:     sortDesc(porPlaca),
        porMotorista: sortDesc(porMotorista),
        porEmpresa:   sortDesc(porEmpresa),
        porConjunto:  sortDescConj(porConjunto)
    };

    renderFreteResumo();
    renderAbaPlacas();
    renderAbaMotoristasFrete();
    renderAbaEmpresasFrete();
    renderAbaConjuntosFretes();
}

function renderFreteResumo() {
    const resumo = document.getElementById("fretesResumoMes");
    if (!resumo || !dadosFretesAtual) return;

    if (dadosFretesAtual.totalNotas === 0) {
        resumo.innerHTML = `<span class="dica" style="margin:0">Nenhum lançamento encontrado para ${nomeMes(dadosFretesAtual.mes)}.</span>`;
    } else {
        resumo.innerHTML = `
            <strong>${dadosFretesAtual.totalNotas}</strong> nota(s)
            &nbsp;|&nbsp; Litros: <strong>${fmtL(dadosFretesAtual.totalLitros)}</strong>
            &nbsp;|&nbsp; Frete total: <strong>${fmtR(dadosFretesAtual.totalFrete)}</strong>
        `;
    }
}

function linhasDetalhes(detalhes) {
    return Object.entries(detalhes).map(([tipo, d]) => `
        <tr class="linha-detalhe-frete">
            <td colspan="2" style="padding-left:24px; color:var(--text-muted); font-size:0.85rem">↳ ${tipo}</td>
            <td style="color:var(--text-muted); font-size:0.85rem">${fmtL3(d.litros)}</td>
            <td style="color:var(--text-muted); font-size:0.85rem">${db.taxasFrete?.[tipo] > 0 ? fmtR4(db.taxasFrete[tipo]) : "—"}</td>
            <td style="color:var(--text-muted); font-size:0.85rem">${d.frete > 0 ? fmtR(d.frete) : "—"}</td>
        </tr>
    `).join("");
}

function renderAbaPlacas() {
    const tbody = document.getElementById("tabelaFretePlacas");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porPlaca;
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="td-vazio">Nenhum dado para este mês.</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(p => `
        <tr>
            <td><strong>${p.nome}</strong></td>
            <td style="font-size:0.78rem;color:var(--text-muted)">${p.conjunto || "—"}</td>
            <td>${p.viagens}</td>
            <td>${fmtL3(p.litros)}</td>
            <td>—</td>
            <td><strong>${fmtR(p.frete)}</strong></td>
        </tr>
        ${linhasDetalhes(p.detalhes)}
    `).join("");
}

function renderAbaMotoristasFrete() {
    const tbody = document.getElementById("tabelaFreteMotoristas");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porMotorista;
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="td-vazio">Nenhum dado para este mês.</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(m => `
        <tr>
            <td><strong>${m.nome}</strong></td>
            <td>${m.viagens}</td>
            <td>${fmtL3(m.litros)}</td>
            <td>—</td>
            <td><strong>${fmtR(m.frete)}</strong></td>
        </tr>
        ${linhasDetalhes(m.detalhes)}
    `).join("");
}

function renderAbaEmpresasFrete() {
    const tbody = document.getElementById("tabelaFreteEmpresas");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porEmpresa;
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="td-vazio">Nenhum dado para este mês.</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(e => `
        <tr>
            <td><strong>${e.nome}</strong></td>
            <td>${e.viagens}</td>
            <td>${fmtL3(e.litros)}</td>
            <td>—</td>
            <td><strong>${fmtR(e.frete)}</strong></td>
        </tr>
        ${linhasDetalhes(e.detalhes)}
    `).join("");
}

/*=================================================
  ABA: POR CONJUNTO
=================================================*/
function renderAbaConjuntosFretes() {
    const tbody = document.getElementById("tabelaFreteConjuntos");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porConjunto;
    if (!lista || lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="td-vazio">Nenhum lançamento vinculado a conjuntos neste mês.</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(c => {
        const detalhesCombs = linhasDetalhes(c.detalhes);

        const detalhesPlacas = Object.entries(c.porPlacaInterna).map(([placa, d]) => `
            <tr class="linha-detalhe-frete">
                <td colspan="2" style="padding-left:24px; color:var(--text-muted); font-size:0.82rem">
                     ${placa}
                </td>
                <td style="color:var(--text-muted); font-size:0.82rem">${d.viagens}</td>
                <td style="color:var(--text-muted); font-size:0.82rem">${fmtL3(d.litros)}</td>
                <td style="color:var(--text-muted); font-size:0.82rem">${d.frete > 0 ? fmtR(d.frete) : "—"}</td>
            </tr>
        `).join("");

        return `
            <tr style="background:var(--bg-secondary)">
                <td colspan="2"><strong> ${c.nome}</strong></td>
                <td><strong>${c.viagens}</strong></td>
                <td><strong>${fmtL3(c.litros)}</strong></td>
                <td><strong>${fmtR(c.frete)}</strong></td>
            </tr>
            ${detalhesPlacas}
            ${detalhesCombs}
        `;
    }).join("");
}

function trocarAbaFretes(nomeAba, botao) {
    document.querySelectorAll("#fretes .aba-conteudo").forEach(a => a.style.display = "none");
    document.querySelectorAll("#fretesAbas .aba-btn").forEach(b => b.classList.remove("ativa"));
    document.getElementById("frete-aba-" + nomeAba).style.display = "block";
    botao.classList.add("ativa");
}

/*=================================================
  EXPORTAÇÕES
=================================================*/

// ========== EXPORTAÇÃO EXCEL ==========
function exportarFretesExcel() {
    if (!dadosFretesAtual || dadosFretesAtual.totalNotas === 0) {
        mostrarToast("Não há dados para exportar.", "aviso", 4000);
        return;
    }
    const d = dadosFretesAtual;
    const mesLabel = nomeMes(d.mes);
    const linhas = [];

    linhas.push([`RESUMO DE FRETES — ${mesLabel}`]);
    linhas.push([`Notas: ${d.totalNotas}`, `Litros: ${d.totalLitros.toFixed(0)} L`, `Frete Total: R$ ${d.totalFrete.toFixed(2)}`]);
    linhas.push([]);

    linhas.push(["POR PLACA"]);
    linhas.push(["Placa", "Conjunto", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porPlaca.forEach(p => {
        linhas.push([p.nome, p.conjunto || "—", p.viagens, p.litros.toFixed(3), "", p.frete.toFixed(2)]);
        Object.entries(p.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", "", det.litros.toFixed(3), (db.taxasFrete?.[tipo] ?? 0).toFixed(4), det.frete.toFixed(2)]);
        });
    });
    linhas.push([]);

    linhas.push(["POR CONJUNTO"]);
    linhas.push(["Conjunto", "", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porConjunto.forEach(c => {
        linhas.push([c.nome, "", c.viagens, c.litros.toFixed(3), "", c.frete.toFixed(2)]);
        Object.entries(c.porPlacaInterna).forEach(([placa, det]) => {
            linhas.push([`  ↳ ${placa}`, "", det.viagens, det.litros.toFixed(3), "", det.frete.toFixed(2)]);
        });
        Object.entries(c.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", "", det.litros.toFixed(3), (db.taxasFrete?.[tipo] ?? 0).toFixed(4), det.frete.toFixed(2)]);
        });
    });
    linhas.push([]);

    linhas.push(["POR MOTORISTA"]);
    linhas.push(["Motorista", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porMotorista.forEach(m => {
        linhas.push([m.nome, m.viagens, m.litros.toFixed(3), "", m.frete.toFixed(2)]);
        Object.entries(m.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", det.litros.toFixed(3), (db.taxasFrete?.[tipo] ?? 0).toFixed(4), det.frete.toFixed(2)]);
        });
    });
    linhas.push([]);

    linhas.push(["POR EMPRESA"]);
    linhas.push(["Empresa", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porEmpresa.forEach(e => {
        linhas.push([e.nome, e.viagens, e.litros.toFixed(3), "", e.frete.toFixed(2)]);
        Object.entries(e.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", det.litros.toFixed(3), (db.taxasFrete?.[tipo] ?? 0).toFixed(4), det.frete.toFixed(2)]);
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fretes");
    XLSX.writeFile(wb, `fretes-${d.mes}.xlsx`);
}

// ========== EXPORTAÇÃO PDF ==========
function exportarFretesPDF() {
    if (!dadosFretesAtual || dadosFretesAtual.totalNotas === 0) {
        mostrarToast("Não há dados para exportar.", "aviso", 4000);
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const d = dadosFretesAtual;
    const mesLabel = nomeMes(d.mes);

    doc.setFontSize(16);
    doc.text(`Resumo de Fretes — ${mesLabel}`, 105, 14, { align: "center" });
    doc.setFontSize(9);
    doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")} | Notas: ${d.totalNotas} | Litros: ${d.totalLitros.toFixed(0)} L | Frete Total: R$ ${d.totalFrete.toFixed(2)}`, 105, 21, { align: "center" });

    const cabecalho = ["Nome", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"];

    const montarCorpo = (lista) => {
        const rows = [];
        lista.forEach(item => {
            rows.push([item.nome, item.viagens, item.litros.toFixed(3), "—", `R$ ${item.frete.toFixed(2)}`]);
            Object.entries(item.detalhes).forEach(([tipo, det]) => {
                const taxa = db.taxasFrete?.[tipo] ?? 0;
                rows.push([
                    `  ↳ ${tipo}`, "",
                    det.litros.toFixed(3),
                    taxa > 0 ? `R$ ${taxa.toFixed(4)}` : "—",
                    det.frete > 0 ? `R$ ${det.frete.toFixed(2)}` : "—"
                ]);
            });
        });
        return rows;
    };

    const montarCorpoConjuntos = (lista) => {
        const rows = [];
        lista.forEach(c => {
            rows.push([`${c.nome}`, c.viagens, c.litros.toFixed(3), "—", `R$ ${c.frete.toFixed(2)}`]);
            Object.entries(c.porPlacaInterna).forEach(([placa, det]) => {
                rows.push([`  ${placa}`, det.viagens, det.litros.toFixed(3), "—", det.frete > 0 ? `R$ ${det.frete.toFixed(2)}` : "—"]);
            });
            Object.entries(c.detalhes).forEach(([tipo, det]) => {
                const taxa = db.taxasFrete?.[tipo] ?? 0;
                rows.push([`    ↳ ${tipo}`, "", det.litros.toFixed(3), taxa > 0 ? `R$ ${taxa.toFixed(4)}` : "—", det.frete > 0 ? `R$ ${det.frete.toFixed(2)}` : "—"]);
            });
        });
        return rows;
    };

    let startY = 28;

    const secoes = [
        { titulo: "Por Conjunto",   corpo: montarCorpoConjuntos(d.porConjunto) },
        { titulo: "Por Placa",      corpo: montarCorpo(d.porPlaca) },
        { titulo: "Por Motorista",  corpo: montarCorpo(d.porMotorista) },
        { titulo: "Por Empresa",    corpo: montarCorpo(d.porEmpresa) }
    ];

    secoes.forEach(s => {
        if (!s.corpo || s.corpo.length === 0) return;
        doc.setFontSize(11);
        doc.setTextColor(26, 58, 92);
        doc.text(s.titulo, 14, startY + 4);

        doc.autoTable({
            head: [cabecalho],
            body: s.corpo,
            startY: startY + 7,
            theme: "grid",
            headStyles: { fillColor: [26, 58, 92] },
            margin: { left: 14, right: 14 },
            styles: { fontSize: 8 },
            didDrawPage: function(data) { data.settings.margin.top = 10; }
        });

        startY = doc.lastAutoTable.finalY + 10;
    });

    doc.save(`fretes-${d.mes}.pdf`);
}

// ========== EXPORTAÇÃO CSV ==========
function exportarFretesCSV() {
    if (!dadosFretesAtual || dadosFretesAtual.totalNotas === 0) {
        mostrarToast("Não há dados para exportar.", "aviso", 4000);
        return;
    }
    const d = dadosFretesAtual;
    const linhas = [];

    linhas.push(['"RESUMO DE FRETES"', `"${nomeMes(d.mes)}"`, "", "", ""]);
    linhas.push([`"Notas: ${d.totalNotas}"`, `"Litros: ${d.totalLitros.toFixed(0)} L"`, `"Frete Total: R$ ${d.totalFrete.toFixed(2)}"`, "", ""]);
    linhas.push([]);

    linhas.push(["POR PLACA"]);
    linhas.push(["Placa", "Conjunto", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porPlaca.forEach(p => {
        linhas.push([p.nome, p.conjunto || "—", p.viagens, p.litros.toFixed(3), "", p.frete.toFixed(2)]);
        Object.entries(p.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", "", det.litros.toFixed(3), (db.taxasFrete?.[tipo] ?? 0).toFixed(4), det.frete.toFixed(2)]);
        });
    });
    linhas.push([]);

    linhas.push(["POR CONJUNTO"]);
    linhas.push(["Conjunto", "", "Viagens", "Litros (L)", "", "Frete (R$)"]);
    d.porConjunto.forEach(c => {
        linhas.push([c.nome, "", c.viagens, c.litros.toFixed(3), "", c.frete.toFixed(2)]);
        Object.entries(c.porPlacaInterna).forEach(([placa, det]) => {
            linhas.push([`  ↳ ${placa}`, "", det.viagens, det.litros.toFixed(3), "", det.frete.toFixed(2)]);
        });
    });
    linhas.push([]);

    linhas.push(["POR MOTORISTA"]);
    linhas.push(["Motorista", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porMotorista.forEach(m => {
        linhas.push([m.nome, m.viagens, m.litros.toFixed(3), "", m.frete.toFixed(2)]);
        Object.entries(m.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", det.litros.toFixed(3), (db.taxasFrete?.[tipo] ?? 0).toFixed(4), det.frete.toFixed(2)]);
        });
    });
    linhas.push([]);

    linhas.push(["POR EMPRESA"]);
    linhas.push(["Empresa", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porEmpresa.forEach(e => {
        linhas.push([e.nome, e.viagens, e.litros.toFixed(3), "", e.frete.toFixed(2)]);
        Object.entries(e.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", det.litros.toFixed(3), (db.taxasFrete?.[tipo] ?? 0).toFixed(4), det.frete.toFixed(2)]);
        });
    });

    const csv = linhas.map(row => row.map(cell => `"${cell}"`).join(';')).join('\n');
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fretes-${d.mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ========== IMPRESSÃO ==========
function imprimirFretes() {
    if (!dadosFretesAtual || dadosFretesAtual.totalNotas === 0) {
        mostrarToast("Não há dados para imprimir.", "aviso", 4000);
        return;
    }

    const d = dadosFretesAtual;
    const mesLabel = nomeMes(d.mes);
    const dataHoje = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });

    document.getElementById("impressaoTitulo").textContent = `Fretes — ${mesLabel}`;
    document.getElementById("impressaoData").textContent = `Impresso em: ${dataHoje} | ${d.totalNotas} nota(s) | ${d.totalLitros.toFixed(0)} L | Frete Total: R$ ${d.totalFrete.toFixed(2)}`;

    const montarTabela = (titulo, lista) => {
        const linhas = lista.map(item => `
            <tr>
                <td><strong>${item.nome}</strong></td>
                <td>${item.viagens}</td>
                <td>${item.litros.toFixed(3)} L</td>
                <td>—</td>
                <td><strong>R$ ${item.frete.toFixed(2)}</strong></td>
            </tr>
            ${Object.entries(item.detalhes).map(([tipo, det]) => `
                <tr style="color:#666; font-size:0.85em">
                    <td style="padding-left:20px">↳ ${tipo}</td>
                    <td></td>
                    <td>${det.litros.toFixed(3)} L</td>
                    <td>${db.taxasFrete?.[tipo] > 0 ? "R$ " + (db.taxasFrete[tipo]).toFixed(4) : "—"}</td>
                    <td>${det.frete > 0 ? "R$ " + det.frete.toFixed(2) : "—"}</td>
                </tr>
            `).join("")}
        `).join("");

        return `
            <h3 style="margin-top:20px">${titulo}</h3>
            <table>
                <thead><tr>
                    <th>Nome</th><th>Viagens</th><th>Litros</th><th>Taxa (R$/L)</th><th>Frete (R$)</th>
                </tr></thead>
                <tbody>${linhas}</tbody>
            </table>
        `;
    };

    const montarTabelaConjuntos = () => {
        if (!d.porConjunto || d.porConjunto.length === 0) return "";
        const linhas = d.porConjunto.map(c => `
            <tr style="background:#f0f0f0">
                <td><strong>${c.nome}</strong></td>
                <td><strong>${c.viagens}</strong></td>
                <td><strong>${c.litros.toFixed(3)} L</strong></td>
                <td>—</td>
                <td><strong>R$ ${c.frete.toFixed(2)}</strong></td>
            </tr>
            ${Object.entries(c.porPlacaInterna).map(([placa, det]) => `
                <tr style="color:#444; font-size:0.85em">
                    <td style="padding-left:16px">${placa}</td>
                    <td>${det.viagens}</td>
                    <td>${det.litros.toFixed(3)} L</td>
                    <td>—</td>
                    <td>${det.frete > 0 ? "R$ " + det.frete.toFixed(2) : "—"}</td>
                </tr>
            `).join("")}
        `).join("");
        return `
            <h3 style="margin-top:20px">Por Conjunto</h3>
            <table>
                <thead><tr><th>Conjunto / Placa</th><th>Viagens</th><th>Litros</th><th>Taxa</th><th>Frete (R$)</th></tr></thead>
                <tbody>${linhas}</tbody>
            </table>
        `;
    };

    document.getElementById("impressaoConteudo").innerHTML =
        montarTabelaConjuntos() +
        montarTabela("Por Placa",     d.porPlaca) +
        montarTabela("Por Motorista", d.porMotorista) +
        montarTabela("Por Empresa",   d.porEmpresa);

    window.print();
}