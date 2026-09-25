/*  VISÃO CONSOLIDADA DO GRUPO
 *  ==========================
 *  Aprovada pelo dono em 17/09/2026. É a única pergunta do escopo que
 *  nenhuma tela respondia: como as empresas do grupo se comparam entre si.
 *
 *  Por que é barata: os lançamentos de TODAS as empresas permitidas já
 *  estão em memória: há um listener do Firestore por empresa (`sincronizacao.js`).
 *  Não há leitura nova, custo de nuvem nem plano pago; é agregar o que já
 *  está carregado.
 *
 *  Por que é SÓ LEITURA: o topo do `sessao.js` (antes, do `app.js`) registra a decisão "empresa
 *  sempre filtrada, sem opção Todas", e as travas de escrita dependem
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
        // Sem o .tabela-container a tabela perde borda, fundo, sombra e cantos
        // arredondados e o estado vazio nao parece um cartao. (21/09/2026)
        container.innerHTML = `<div class="tabela-container"><table><tbody>${linhaTabelaVazia(7, "Nenhuma empresa cadastrada",
            "Cadastre as empresas do grupo para comparar uma com a outra.",
            { texto: "Abrir Cadastros", onclick: "mostrarTela('cadastros')" })}</tbody></table></div>`;
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

    // Período sem nenhuma nota: aviso no lugar do gráfico de barras zeradas.
    const semMovimento = soma.notasDescarga === 0 && soma.notasEmissao === 0;
    container.innerHTML = `
        <div class="kpi-container mb-5">
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
                <div class="kpi-base">pela descarga · ${soma.litrosFrete > 0 ? fmtFreteL(soma.frete / soma.litrosFrete) : "—"}/L</div>
            </div>
        </div>

        ${semMovimento
            ? `<p class="grafico-vazio mb-5">Nenhuma nota no período, em nenhuma das empresas.</p>`
            : `<div class="grafico-wrapper grafico-wrapper--240 mb-5"><canvas id="graficoGrupo"></canvas></div>`}

        <div class="tabela-container">
            <table class="tabela-numeros"><thead><tr>
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
                    <td><strong>${escapeHtml(x.empresa)}</strong>${x.semTaxa ? ` <em class="tag-perda tag-perda--perigo">${x.semTaxa} sem taxa</em>` : ""}</td>
                    <td>${x.notasDescarga}</td>
                    <td>${fmtL(x.litros, Number.isInteger(Math.round(x.litros * 1000) / 1000) ? 0 : 3)}</td>
                    <td>${fmtR(x.gasto)}</td>
                    <td>${x.precoCompra > 0 ? fmtRL(x.precoCompra) : "—"}</td>
                    <td><strong>${fmtR(x.frete)}</strong></td>
                    <td>${x.fretePorLitro > 0 ? fmtFreteL(x.fretePorLitro) : "—"}</td>
                </tr>`).join("")}
            </tbody>
            <tfoot><tr>
                <td><strong>Total</strong></td>
                <td><strong>${soma.notasDescarga}</strong></td>
                <td><strong>${fmtL(soma.litros, Number.isInteger(Math.round(soma.litros * 1000) / 1000) ? 0 : 3)}</strong></td>
                <td><strong>${fmtR(soma.gasto)}</strong></td>
                <td><strong>${soma.litrosFaturados > 0 ? fmtRL(soma.gasto / soma.litrosFaturados) : "—"}</strong></td>
                <td><strong>${fmtR(soma.frete)}</strong></td>
                <td></td>
            </tr></tfoot>
            </table>
        </div>`;

    if (window._chartGrupo) { window._chartGrupo.destroy(); window._chartGrupo = null; }
    if (typeof Chart === "undefined" || semMovimento) return;
    const cores = getChartColors();
    window._chartGrupo = new Chart(document.getElementById("graficoGrupo").getContext("2d"), {
        type: "bar",
        data: {
            labels: ordenadas.map(x => x.empresa),
            datasets: [
                // Cada um no seu eixo (18/09/2026): no mesmo eixo o frete, uma
                // ordem de grandeza menor que o gasto, virava um risco no chão.
                { label: "Gasto em compras (R$), eixo da esquerda", data: ordenadas.map(x => x.gasto), yAxisID: "y",
                  backgroundColor: (cores.info || "#3b82f6") + "55", borderColor: cores.info || "#3b82f6", borderWidth: 1 },
                { label: "Frete (R$), eixo da direita", data: ordenadas.map(x => x.frete), yAxisID: "yF",
                  backgroundColor: cores.primary + "aa", borderColor: cores.primary, borderWidth: 1 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: cores.text } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label.split(' — ')[0]}: ${fmtR(ctx.raw)}` } }
            },
            scales: {
                x: { ticks: { color: cores.text }, grid: { color: cores.grid } },
                y:  { position: "left",  ticks: { color: cores.text, callback: v => fmtEixoR(v) }, grid: { color: cores.grid } },
                yF: { position: "right", ticks: { color: cores.primary, callback: v => fmtEixoR(v) }, grid: { display: false } }
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
    recalcularTela('grupo', carregarGrupo);
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
    const soma = linhas.reduce((a, x) => ({
        notas: a.notas + x.notasDescarga, litros: a.litros + x.litros,
        gasto: a.gasto + x.gasto, frete: a.frete + x.frete
    }), { notas: 0, litros: 0, gasto: 0, frete: 0 });
    // No padrão dos PDFs desde 25/09/2026 (pedido do dono): a faixa, os
    // cartões com os totais do grupo e a tabela com o TOTAL.
    const ws = _planilhaPadrao({
        titulo: "Comparação entre empresas do grupo",
        subtitulo: `De ${formatarData(_grupoPeriodo.inicio)} a ${formatarData(_grupoPeriodo.fim)} · litros e frete pela descarga, gasto e preço pela emissão`,
        geradoEm: _pdfGeradoEm(),
        cartoes: [
            { rotulo: "Frete (descarga)",     valor: Number(soma.frete.toFixed(2)), f: "reais" },
            { rotulo: "Litros descarregados", valor: Number(soma.litros.toFixed(3)), f: "litrosRedondo" },
            { rotulo: "Gasto (emissão)",      valor: Number(soma.gasto.toFixed(2)), f: "reais" },
            { rotulo: "Notas (descarga)",     valor: soma.notas, f: "inteiro" }
        ],
        secoes: [{
            titulo: "Por empresa",
            cabecalho: ["Empresa", "Notas (descarga)", "Litros descarregados", "Gasto (emissão)",
                        "Preço médio/L (faturado)", "Frete (descarga)", "Frete/L"],
            formatos: [null, "inteiro", "litros", "reais", "preco", "reais", "taxa"],
            linhas: linhas.map(x => [
                x.empresa, x.notasDescarga, Number(x.litros.toFixed(3)), Number(x.gasto.toFixed(2)),
                Number(x.precoCompra.toFixed(4)), Number(x.frete.toFixed(2)), Number(x.fretePorLitro.toFixed(2))
            ]),
            total: ["TOTAL", soma.notas, Number(soma.litros.toFixed(3)), Number(soma.gasto.toFixed(2)), "",
                    Number(soma.frete.toFixed(2)), ""]
        }]
    });
    _gravarPlanilhaPadrao([{ nome: "Grupo", ws }], `grupo-${_grupoPeriodo.inicio}-a-${_grupoPeriodo.fim}.xlsx`);
}
