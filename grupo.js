/*  VISÃO CONSOLIDADA DO GRUPO
 *  ==========================
 *  Aprovada pelo dono em 17/09/2026. É a única pergunta do escopo que
 *  nenhuma tela respondia: como as empresas do grupo se comparam entre si.
 *
 *  Por que é barata: os lançamentos de TODAS as empresas permitidas já
 *  estão em memória — há um listener do Firestore por empresa (`app.js`).
 *  Não há leitura nova, custo de nuvem nem plano pago; é agregar o que já
 *  está carregado.
 *
 *  Por que é SÓ LEITURA: o topo do `app.js` registra a decisão "empresa
 *  sempre filtrada — sem opção Todas", e as travas de escrita dependem
 *  dela (`lancamentos.js`, `validacao.js`). Esta tela não muda
 *  `empresaFiltroGlobal` e não oferece nenhuma ação de gravar: ela lê o
 *  que já está na memória e compara. Clicar numa empresa troca a empresa
 *  ativa pela porta única (`trocarEmpresaAtiva`) e leva ao Dashboard dela.
 *
 *  As bases de data seguem a decisão da rodada 11: litros e frete pela
 *  DESCARGA, gasto e preço médio pela EMISSÃO. Cada coluna diz qual.
 */

let _grupoPeriodo = { inicio: "", fim: "" };

function _grupoEmpresasVisiveis() {
    // As mesmas empresas que o perfil já carrega, na ordem do cadastro.
    const permitidos = typeof _empresaIdsPermitidos === "function" ? _empresaIdsPermitidos() : null;
    return (db.empresas || [])
        .filter(e => e.ativo !== false)
        .filter(e => !permitidos || permitidos.includes(e.id));
}

function _grupoTotais(empresa, inicio, fim) {
    const dentro = (iso) => iso && (!inicio || iso >= inicio) && (!fim || iso <= fim);
    const daEmpresa = (db.lancamentos || []).filter(l => lancamentoAtivo(l) && l.empresa === empresa.nome);

    const porDescarga = daEmpresa.filter(l => dentro(dataDescargaDe(l)));
    const porEmissao  = daEmpresa.filter(l => dentro(dataEmissaoDe(l)));

    const litros = porDescarga.reduce((s, l) => s + (l.itens || []).reduce((ss, i) => ss + _litrosItem(i), 0), 0);
    const compra = metricasPreco(porEmissao.flatMap(l => l.itens || []));

    let frete = 0, litrosFrete = 0, semTaxa = 0;
    porDescarga.forEach(l => {
        const taxa = _taxaFreteDaEmpresaNaData(empresa, dataDescargaDe(l));
        if (!(taxa > 0)) semTaxa++;
        (l.itens || []).forEach(i => {
            const q = Number(i.qtd) || 0;
            litrosFrete += q;
            frete += q * taxa;
        });
    });

    return {
        empresa: empresa.nome,
        notasDescarga: porDescarga.length,
        litros,
        notasEmissao: porEmissao.length,
        gasto: compra.gasto,
        precoCompra: compra.precoCompra,
        litrosFaturados: compra.litrosNota,
        frete,
        litrosFrete,
        fretePorLitro: litrosFrete > 0 ? frete / litrosFrete : 0,
        semTaxa
    };
}

function carregarGrupo() {
    const container = document.getElementById("grupoConteudo");
    if (!container) return;

    const hoje = new Date();
    const inicio = document.getElementById("grupoInicio")?.value
        || _isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    const fim = document.getElementById("grupoFim")?.value || _hojeISO();
    _grupoPeriodo = { inicio, fim };
    const campoIni = document.getElementById("grupoInicio");
    const campoFim = document.getElementById("grupoFim");
    if (campoIni && !campoIni.value) campoIni.value = inicio;
    if (campoFim && !campoFim.value) campoFim.value = fim;

    const empresas = _grupoEmpresasVisiveis();
    if (!empresas.length) {
        container.innerHTML = `<table><tbody>${linhaTabelaVazia(7, "Nenhuma empresa cadastrada",
            "Cadastre as empresas do grupo para comparar uma com a outra.",
            { texto: "Abrir Cadastros", onclick: "mostrarTela('cadastros')" })}</tbody></table>`;
        return;
    }

    const linhas = empresas.map(e => _grupoTotais(e, inicio, fim));
    const soma = linhas.reduce((acc, x) => ({
        litros: acc.litros + x.litros,
        gasto: acc.gasto + x.gasto,
        litrosFaturados: acc.litrosFaturados + x.litrosFaturados,
        frete: acc.frete + x.frete,
        litrosFrete: acc.litrosFrete + x.litrosFrete,
        notasDescarga: acc.notasDescarga + x.notasDescarga,
        notasEmissao: acc.notasEmissao + x.notasEmissao
    }), { litros: 0, gasto: 0, litrosFaturados: 0, frete: 0, litrosFrete: 0, notasDescarga: 0, notasEmissao: 0 });

    const ordenadas = [...linhas].sort((a, b) => b.frete - a.frete || b.gasto - a.gasto);

    container.innerHTML = `
        <div class="kpi-container" style="margin-bottom:18px">
            <div class="kpi-card">
                <div class="kpi-valor">${empresas.length}</div>
                <div class="kpi-label">Empresas no período</div>
                <div class="kpi-base">as que este perfil enxerga</div>
            </div>
            <div class="kpi-card verde">
                <div class="kpi-valor">${fmtL(soma.litros)}</div>
                <div class="kpi-label">Litros Descarregados</div>
                <div class="kpi-base">pela data da descarga · ${soma.notasDescarga} nota(s)</div>
            </div>
            <div class="kpi-card laranja">
                <div class="kpi-valor">${fmtR(soma.gasto)}</div>
                <div class="kpi-label">Gasto em Compras</div>
                <div class="kpi-base">pela data de emissão · ${soma.notasEmissao} nota(s)</div>
            </div>
            <div class="kpi-card roxo">
                <div class="kpi-valor">${fmtR(soma.frete)}</div>
                <div class="kpi-label">Frete do Grupo</div>
                <div class="kpi-base">pela descarga · ${soma.litrosFrete > 0 ? fmtR4(soma.frete / soma.litrosFrete) : "—"}/L</div>
            </div>
        </div>

        <div class="grafico-wrapper" style="height:240px;margin-bottom:18px"><canvas id="graficoGrupo"></canvas></div>

        <div class="tabela-container">
            <table><thead><tr>
                <th>Empresa</th>
                <th>Notas (descarga)</th>
                <th>Litros descarregados</th>
                <th>Gasto (emissão)</th>
                <th>Preço médio/L (faturado)</th>
                <th>Frete (descarga)</th>
                <th>Frete/L</th>
            </tr></thead>
            <tbody>${ordenadas.map(x => `
                <tr class="linha-clicavel" onclick="_grupoAbrirEmpresa('${escapeJsAttr(x.empresa)}')"
                    title="Trocar a empresa ativa e abrir o Dashboard dela">
                    <td><strong>${escapeHtml(x.empresa)}</strong>${x.semTaxa ? ` <em class="tag-perda" style="color:var(--danger)">${x.semTaxa} sem taxa</em>` : ""}</td>
                    <td>${x.notasDescarga}</td>
                    <td>${fmtL3(x.litros)}</td>
                    <td>${fmtR(x.gasto)}</td>
                    <td>${x.precoCompra > 0 ? fmtR4(x.precoCompra) : "—"}</td>
                    <td><strong>${fmtR(x.frete)}</strong></td>
                    <td>${x.fretePorLitro > 0 ? fmtR4(x.fretePorLitro) : "—"}</td>
                </tr>`).join("")}
            </tbody>
            <tfoot><tr>
                <td><strong>TOTAL</strong></td>
                <td><strong>${soma.notasDescarga}</strong></td>
                <td><strong>${fmtL3(soma.litros)}</strong></td>
                <td><strong>${fmtR(soma.gasto)}</strong></td>
                <td><strong>${soma.litrosFaturados > 0 ? fmtR4(soma.gasto / soma.litrosFaturados) : "—"}</strong></td>
                <td><strong>${fmtR(soma.frete)}</strong></td>
                <td></td>
            </tr></tfoot>
            </table>
        </div>`;

    if (typeof Chart === "undefined") return;
    const cores = getChartColors();
    if (window._chartGrupo) window._chartGrupo.destroy();
    window._chartGrupo = new Chart(document.getElementById("graficoGrupo").getContext("2d"), {
        type: "bar",
        data: {
            labels: ordenadas.map(x => x.empresa),
            datasets: [
                { label: "Frete (R$)", data: ordenadas.map(x => x.frete),
                  backgroundColor: cores.primary + "aa", borderColor: cores.primary, borderWidth: 1 },
                { label: "Gasto em compras (R$)", data: ordenadas.map(x => x.gasto),
                  backgroundColor: (cores.info || "#3b82f6") + "55", borderColor: cores.info || "#3b82f6", borderWidth: 1 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: cores.text } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtR(ctx.raw)}` } }
            },
            scales: {
                x: { ticks: { color: cores.text }, grid: { color: cores.grid } },
                y: { ticks: { color: cores.text, callback: v => fmtR(v) }, grid: { color: cores.grid } }
            }
        }
    });
}

/** Períodos rápidos da tela do grupo. */
function grupoFiltroRapido(periodo) {
    const hoje = new Date();
    let inicio, fim;
    if (periodo === "mes") {
        inicio = _isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
        fim    = _hojeISO();
    } else if (periodo === "mes_anterior") {
        inicio = _isoLocal(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1));
        fim    = _isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 0));
    } else {
        inicio = _isoLocal(new Date(hoje.getFullYear(), 0, 1));
        fim    = _hojeISO();
    }
    document.getElementById("grupoInicio").value = inicio;
    document.getElementById("grupoFim").value    = fim;
    carregarGrupo();
}

/** Da comparação para a empresa: troca a ativa pela porta única e abre o Dashboard. */
async function _grupoAbrirEmpresa(nome) {
    if (typeof trocarEmpresaAtiva === "function") {
        const ok = await trocarEmpresaAtiva(nome);
        if (!ok) return;
    }
    mostrarTela("dashboard");
}

/** Excel da comparação, com número de verdade e linha de total. */
function exportarGrupoExcel() {
    if (adiarAteBibliotecas(["xlsx"], () => exportarGrupoExcel())) return;
    const empresas = _grupoEmpresasVisiveis();
    if (!empresas.length) return mostrarToast("Nenhuma empresa para exportar.", "aviso", 4000);
    const linhas = empresas.map(e => _grupoTotais(e, _grupoPeriodo.inicio, _grupoPeriodo.fim))
        .sort((a, b) => b.frete - a.frete);
    const aoa = [
        ["COMPARAÇÃO ENTRE EMPRESAS DO GRUPO"],
        [`De ${formatarData(_grupoPeriodo.inicio)} a ${formatarData(_grupoPeriodo.fim)} · litros e frete pela descarga, gasto e preço pela emissão`],
        [],
        ["Empresa", "Notas (descarga)", "Litros descarregados", "Gasto (emissão)",
         "Preço médio/L (faturado)", "Frete (descarga)", "Frete/L"]
    ];
    linhas.forEach(x => aoa.push([
        x.empresa, x.notasDescarga, Number(x.litros.toFixed(3)), Number(x.gasto.toFixed(2)),
        Number(x.precoCompra.toFixed(4)), Number(x.frete.toFixed(2)), Number(x.fretePorLitro.toFixed(4))
    ]));
    const soma = linhas.reduce((a, x) => ({
        notas: a.notas + x.notasDescarga, litros: a.litros + x.litros,
        gasto: a.gasto + x.gasto, frete: a.frete + x.frete
    }), { notas: 0, litros: 0, gasto: 0, frete: 0 });
    aoa.push([]);
    aoa.push(["TOTAL", soma.notas, Number(soma.litros.toFixed(3)), Number(soma.gasto.toFixed(2)), "",
              Number(soma.frete.toFixed(2)), ""]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Grupo");
    XLSX.writeFile(wb, `grupo-${_grupoPeriodo.inicio}-a-${_grupoPeriodo.fim}.xlsx`);
}
