/*=================================================
  ANALITICO – com Chart.js, tooltips formatados,
  alternância Valor/Litros, gráfico de evolução de preços,
  cache e filtro global por empresa
=================================================*/

// Instâncias globais dos gráficos
let chartMensal, chartMotoristas, chartVeiculos, chartCombustivel, chartComparativo, chartPizzaComb, chartPizzaMotor, chartEvolucaoPrecos;

// Cache dos dados calculados
let _dadosAnaliticoAtual = null;

/**
 * Baixa como PNG o gráfico Chart.js da aba do Analítico indicada por `nomeGrafico`.
 * OBS: esta função nunca existia — os botões "Baixar PNG" já presentes no HTML
 * (ex: Evolução de Preços) chamavam uma função inexistente e não funcionavam.
 */
function baixarGrafico(nomeGrafico) {
    const charts = {
        mensal: () => chartMensal,
        motoristas: () => chartMotoristas,
        veiculos: () => chartVeiculos,
        combustivel: () => chartCombustivel,
        comparativo: () => chartComparativo,
        pizzaCombustivel: () => chartPizzaComb,
        pizzaMotorista: () => chartPizzaMotor,
        evolucaoPrecos: () => chartEvolucaoPrecos,
    };
    const chart = charts[nomeGrafico]?.();
    if (!chart) { mostrarToast('Gráfico ainda não carregado.', 'aviso'); return; }
    const link = document.createElement('a');
    link.href = chart.toBase64Image('image/png', 1);
    link.download = `${nomeGrafico}-${_hojeISO()}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

// Métrica atual: 'gasto' ou 'litros' (padrão 'gasto')
let metricaAtual = 'gasto';

// ========== INICIALIZAÇÃO DOS BOTÕES DE MÉTRICA ==========
function inicializarBotoesMetrica() {
    const btnGasto = document.getElementById('btnMetricaGasto');
    const btnLitros = document.getElementById('btnMetricaLitros');
    if (!btnGasto || !btnLitros) return;

    btnGasto.addEventListener('click', () => setMetrica('gasto'));
    btnLitros.addEventListener('click', () => setMetrica('litros'));

    // Define o estado inicial
    atualizarBotoesMetrica();
}

function atualizarBotoesMetrica() {
    const btnGasto = document.getElementById('btnMetricaGasto');
    const btnLitros = document.getElementById('btnMetricaLitros');
    if (!btnGasto || !btnLitros) return;

    if (metricaAtual === 'gasto') {
        btnGasto.style.background = 'var(--primary)';
        btnGasto.style.color = 'white';
        btnLitros.style.background = '';
        btnLitros.style.color = '';
    } else {
        btnLitros.style.background = 'var(--primary)';
        btnLitros.style.color = 'white';
        btnGasto.style.background = '';
        btnGasto.style.color = '';
    }
}

function setMetrica(metrica) {
    if (metrica !== 'gasto' && metrica !== 'litros') return;
    metricaAtual = metrica;
    atualizarBotoesMetrica();

    // Recarrega a aba atual com a nova métrica
    if (_dadosAnaliticoAtual) {
        const botaoAtivo = document.querySelector("#analiticoAbas .aba-btn.ativa");
        const abaId = botaoAtivo?.dataset.aba || 'mensal';
        trocarAba(abaId, botaoAtivo);
    }
}

// ========== FUNÇÕES ORIGINAIS (com filtro global) ==========
function preencherSelectsAnalitico() {
    preencherSelect("analiticoCombustivel",
        db.combustiveis.map(c => ({ valor: c.nome, texto: c.nome })),
        "Todos"
    );
}

function carregarAnalitico() {
    // O combustível escolhido é lido ANTES de refazer a lista: refazer o
    // select volta a escolha para "Todos", e o filtro nunca era aplicado.
    const combustivel = document.getElementById("analiticoCombustivel").value;
    preencherSelectsAnalitico();
    const selComb = document.getElementById("analiticoCombustivel");
    if (selComb && [...selComb.options].some(o => o.value === combustivel)) selComb.value = combustivel;
    const inicio      = document.getElementById("analiticoInicio").value;
    const fim         = document.getElementById("analiticoFim").value;

    const labelPeriodo = document.getElementById("analiticoPeriodoLabel");
    if (labelPeriodo) {
        if (!inicio && !fim) {
            labelPeriodo.style.display = "block";
            labelPeriodo.innerHTML = '<p class="dica" style="margin-bottom:12px">Nenhum período selecionado — exibindo <strong>todo o histórico</strong>.</p>';
        } else {
            labelPeriodo.style.display = "none";
        }
    }

    const lancamentos = db.lancamentos.filter(l => {
        // Funil único das sete abas: quem não está ativo não entra em
        // nenhuma delas, nem nos KPIs, nem na evolução de preços.
        if (!lancamentoAtivo(l)) return false;
        // Filtro global por empresa (se ativo)
        if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
        // Pela emissão (rodada 11, decisão do dono): o Analítico é de gasto e
        // preço, e o valor é da compra na data em que a nota foi emitida.
        const emissao = dataEmissaoDe(l);
        if (inicio && emissao < inicio) return false;
        if (fim    && emissao > fim)    return false;
        return true;
    });

    const dados = calcularDadosAnalitico(lancamentos, combustivel);
    _dadosAnaliticoAtual = dados;
    renderKPIs(dados);
    renderAbaMensal(dados);
    renderAbaMotoristas(dados);
    renderAbaVeiculos(dados);
    renderAbaCombustivel(dados);
    renderAbaComparativo(dados);
    renderAbaDistribuicao(dados);
    renderAbaEvolucaoPrecos(dados);
}

function calcularDadosAnalitico(lancamentos, filtroCombustivel) {
    const mensal = {}, porMotorista = {}, porVeiculo = {}, porCombustivel = {};
    let totalGasto = 0, totalLitros = 0;
    const numNotas = lancamentos.length;

    // Para evolução de preços
    const precosPorMes = {};

    lancamentos.forEach(l => {
        // Com um combustível escolhido, a nota que não tem esse combustível
        // não conta como nota nem como viagem: antes contava, e a linha dizia
        // "12 viagens" ao lado dos litros de 3.
        if (filtroCombustivel && !(l.itens || []).some(i => i.tipo === filtroCombustivel)) return;

        const mesKey = dataEmissaoDe(l) ? dataEmissaoDe(l).slice(0, 7) : "desconhecido";
        if (!mensal[mesKey]) mensal[mesKey] = { mes: mesKey, notas: 0, litros: 0, gasto: 0 };
        mensal[mesKey].notas++;

        const mot = l.motorista || "(sem motorista)";
        if (!porMotorista[mot]) porMotorista[mot] = { nome: mot, viagens: 0, litros: 0, gasto: 0 };
        porMotorista[mot].viagens++;

        const vei = l.placa || "(sem placa)";
        if (!porVeiculo[vei]) porVeiculo[vei] = { nome: vei, viagens: 0, litros: 0, gasto: 0 };
        porVeiculo[vei].viagens++;

        (l.itens || []).forEach(item => {
            if (filtroCombustivel && item.tipo !== filtroCombustivel) return;

            // Volume agregado segue o critério único (descarga quando houver);
            // o preço unitário permanece sobre a carga faturada da nota.
            const litros      = _litrosItem(item);
            const litrosNota  = item.qtd   || 0;
            const gasto       = item.total || 0;
            const preco       = litrosNota > 0 ? gasto / litrosNota : 0;

            totalGasto  += gasto;
            totalLitros += litros;
            mensal[mesKey].litros += litros;
            mensal[mesKey].gasto  += gasto;
            porMotorista[mot].litros += litros;
            porMotorista[mot].gasto  += gasto;
            porVeiculo[vei].litros   += litros;
            porVeiculo[vei].gasto    += gasto;

            const tipo = item.tipo || "Desconhecido";
            if (!porCombustivel[tipo]) {
                porCombustivel[tipo] = { nome: tipo, notas: 0, litros: 0, gasto: 0, precoMin: Infinity, precoMax: -Infinity };
            }
            porCombustivel[tipo].notas++;
            porCombustivel[tipo].litros += litros;
            porCombustivel[tipo].gasto  += gasto;
            if (preco > 0) {
                porCombustivel[tipo].precoMin = Math.min(porCombustivel[tipo].precoMin, preco);
                porCombustivel[tipo].precoMax = Math.max(porCombustivel[tipo].precoMax, preco);
            }

            // Para evolução de preços
            if (!precosPorMes[mesKey]) precosPorMes[mesKey] = {};
            if (!precosPorMes[mesKey][tipo]) precosPorMes[mesKey][tipo] = { soma: 0, count: 0 };
            precosPorMes[mesKey][tipo].soma += preco;
            precosPorMes[mesKey][tipo].count += (preco > 0 ? 1 : 0);
        });
    });

    // Processa preços por mês
    const mesesOrdenados = Object.keys(mensal).sort();
    const precosPorCombustivel = {};
    mesesOrdenados.forEach(mes => {
        const precosMes = precosPorMes[mes] || {};
        Object.entries(precosMes).forEach(([tipo, {soma, count}]) => {
            if (!precosPorCombustivel[tipo]) precosPorCombustivel[tipo] = [];
            precosPorCombustivel[tipo].push({
                mes,
                precoMedio: count > 0 ? soma / count : 0
            });
        });
    });

    return {
        totalGasto, totalLitros, numNotas,
        custoMedio: totalLitros > 0 ? totalGasto / totalLitros : 0,
        mensal:         Object.values(mensal).sort((a, b) => a.mes.localeCompare(b.mes)),
        porMotorista:   Object.values(porMotorista).sort((a, b) => b.gasto - a.gasto),
        porVeiculo:     Object.values(porVeiculo).sort((a, b) => b.gasto - a.gasto),
        porCombustivel: Object.values(porCombustivel).sort((a, b) => b.litros - a.litros),
        precosPorCombustivel: precosPorCombustivel,
        meses: mesesOrdenados
    };
}

function renderKPIs(dados) {
    document.getElementById("kpiContainer").innerHTML = `
        <div class="kpi-card">
            <div class="kpi-valor">${dados.numNotas}</div>
            <div class="kpi-label">Total de Notas</div>
        </div>
        <div class="kpi-card verde">
            <div class="kpi-valor">${fmtR(dados.totalGasto)}</div>
            <div class="kpi-label">Total Gasto no Período</div>
        </div>
        <div class="kpi-card laranja">
            <div class="kpi-valor">${fmtL(dados.totalLitros)}</div>
            <div class="kpi-label">Total de Litros</div>
        </div>
        <div class="kpi-card roxo">
            <div class="kpi-valor">${dados.custoMedio > 0 ? "R$ " + dados.custoMedio.toFixed(4) : "—"}</div>
            <div class="kpi-label">Custo Médio por Litro</div>
        </div>
    `;
}

// ========== GRÁFICOS COM CHART.JS ==========

function destruirGraficos() {
    if (chartMensal) chartMensal.destroy();
    if (chartMotoristas) chartMotoristas.destroy();
    if (chartVeiculos) chartVeiculos.destroy();
    if (chartCombustivel) chartCombustivel.destroy();
    if (chartComparativo) chartComparativo.destroy();
    if (chartPizzaComb) chartPizzaComb.destroy();
    if (chartPizzaMotor) chartPizzaMotor.destroy();
    if (chartEvolucaoPrecos) chartEvolucaoPrecos.destroy();
}

/* ── ESTADO VAZIO DO GRÁFICO ─────────────────────────────────────────
   Nunca apagar o <canvas> com innerHTML no wrapper: ele não volta, e a
   passada seguinte COM dados chamava getContext num null. O TypeError
   estourava dentro de carregarAnalitico e as abas seguintes não rodavam —
   a tela ficava misturando número novo com número velho até um F5.
   Reproduzido em 17/09/2026 no modo demonstração: período sem nota,
   Atualizar, período com nota, Atualizar.

   O aviso agora é um irmão do canvas, e o canvas só é escondido.
   renderAbaDistribuicao já fazia certo (guarda, sem apagar o wrapper). */
function _graficoVazio(idCanvas, msg) {
    const canvas = document.getElementById(idCanvas);
    if (!canvas) return;
    const wrapper = canvas.closest(".grafico-wrapper") || canvas.parentElement;
    if (!wrapper) return;
    canvas.style.display = "none";
    let aviso = wrapper.querySelector(".grafico-vazio");
    if (!aviso) {
        aviso = document.createElement("p");
        aviso.className = "grafico-vazio";
        wrapper.appendChild(aviso);
    }
    aviso.textContent = msg;
    aviso.style.display = "";
}

/** Devolve o canvas pronto para desenho (ou null se ele não existir). */
function _graficoPronto(idCanvas) {
    const canvas = document.getElementById(idCanvas);
    if (!canvas) return null;
    const wrapper = canvas.closest(".grafico-wrapper") || canvas.parentElement;
    const aviso = wrapper && wrapper.querySelector(".grafico-vazio");
    if (aviso) aviso.style.display = "none";
    canvas.style.display = "";
    return canvas;
}

function renderAbaMensal(dados) {
    const tbody = document.getElementById("tabelaMensal");
    const meses = dados.mensal;
    if (meses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="td-vazio">Sem dados para o período.</td></tr>`;
        _graficoVazio("graficoMensal", "Sem dados suficientes.");
        return;
    }
    tbody.innerHTML = meses.map((m, idx) => {
        const cm = m.litros > 0 ? m.gasto / m.litros : 0;
        const varBadge = idx > 0 ? badgeVariacao(cm, meses[idx-1].litros > 0 ? meses[idx-1].gasto/meses[idx-1].litros : 0) : "";
        return `<tr>
            <td>${nomeMes(m.mes)}</td><td>${m.notas}</td><td>${fmtL(m.litros)}</td>
            <td>${fmtR(m.gasto)}</td><td>${cm > 0 ? fmtR4(cm) : "—"}</td>
            <td>${varBadge || "—"}</td>
        </tr>`;
    }).join("");
    
    const canvas = _graficoPronto("graficoMensal");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (chartMensal) chartMensal.destroy();
    const colors = getChartColors();
    chartMensal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: meses.map(m => nomeMes(m.mes)),
            datasets: [{
                label: metricaAtual === 'gasto' ? 'Gasto Total (R$)' : 'Litros Totais',
                data: meses.map(m => metricaAtual === 'gasto' ? m.gasto : m.litros),
                backgroundColor: colors.primary + '80',
                borderColor: colors.primary,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => formatarTooltipValor(ctx.raw, metricaAtual === 'gasto' ? 'R$' : 'L')
                    }
                }
            },
            scales: {
                y: { 
                    ticks: {
                        callback: (val) => metricaAtual === 'gasto' ? fmtR(val) : fmtL(val),
                        color: colors.text
                    },
                    grid: { color: colors.grid }
                },
                x: { ticks: { color: colors.text, maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

function renderAbaMotoristas(dados) {
    const tbody = document.getElementById("tabelaMotoristas");
    const lista = dados.porMotorista;
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="td-vazio">Sem dados.</td></tr>`;
        _graficoVazio("graficoMotoristas", "Sem dados.");
        return;
    }
    tbody.innerHTML = lista.map(m => {
        const cm  = m.litros > 0 ? m.gasto/m.litros : 0;
        const pct = dados.totalGasto > 0 ? m.gasto/dados.totalGasto*100 : 0;
        return `<tr>
            <td>${escapeHtml(m.nome)}</td><td>${m.viagens}</td><td>${fmtL(m.litros)}</td>
            <td>${fmtR(m.gasto)}</td><td>${cm>0?fmtR4(cm):"—"}</td>
            <td>${pct.toFixed(1)}%<div class="barra-progresso"><div class="barra-progresso-fill" style="width:${pct}%"></div></div></td>
        </tr>`;
    }).join("");
    
    const canvas = _graficoPronto("graficoMotoristas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (chartMotoristas) chartMotoristas.destroy();
    const colors = getChartColors();
    chartMotoristas = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: lista.map(m => m.nome.length > 15 ? m.nome.substring(0,12)+'…' : m.nome),
            datasets: [{
                label: metricaAtual === 'gasto' ? 'Gasto (R$)' : 'Litros',
                data: lista.map(m => metricaAtual === 'gasto' ? m.gasto : m.litros),
                backgroundColor: colors.success + '80',
                borderColor: colors.success,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => formatarTooltipValor(ctx.raw, metricaAtual === 'gasto' ? 'R$' : 'L')
                    }
                }
            },
            scales: {
                y: { 
                    ticks: {
                        callback: (val) => metricaAtual === 'gasto' ? fmtR(val) : fmtL(val),
                        color: colors.text
                    },
                    grid: { color: colors.grid }
                },
                x: { ticks: { color: colors.text, maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

function renderAbaVeiculos(dados) {
    const tbody = document.getElementById("tabelaVeiculos");
    const lista = dados.porVeiculo;
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="td-vazio">Sem dados.</td></tr>`;
        _graficoVazio("graficoVeiculos", "Sem dados.");
        return;
    }
    tbody.innerHTML = lista.map(v => {
        const cm  = v.litros > 0 ? v.gasto/v.litros : 0;
        const pct = dados.totalGasto > 0 ? v.gasto/dados.totalGasto*100 : 0;
        return `<tr>
            <td>${escapeHtml(v.nome)}</td><td>${v.viagens}</td><td>${fmtL(v.litros)}</td>
            <td>${fmtR(v.gasto)}</td><td>${cm>0?fmtR4(cm):"—"}</td>
            <td>${pct.toFixed(1)}%<div class="barra-progresso"><div class="barra-progresso-fill" style="width:${pct}%"></div></div></td>
        </tr>`;
    }).join("");
    
    const canvas = _graficoPronto("graficoVeiculos");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (chartVeiculos) chartVeiculos.destroy();
    const colors = getChartColors();
    chartVeiculos = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: lista.map(v => v.nome.length > 10 ? v.nome.substring(0,8)+'…' : v.nome),
            datasets: [{
                label: metricaAtual === 'gasto' ? 'Gasto (R$)' : 'Litros',
                data: lista.map(v => metricaAtual === 'gasto' ? v.gasto : v.litros),
                backgroundColor: colors.warning + '80',
                borderColor: colors.warning,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => formatarTooltipValor(ctx.raw, metricaAtual === 'gasto' ? 'R$' : 'L')
                    }
                }
            },
            scales: {
                y: { 
                    ticks: {
                        callback: (val) => metricaAtual === 'gasto' ? fmtR(val) : fmtL(val),
                        color: colors.text
                    },
                    grid: { color: colors.grid }
                },
                x: { ticks: { color: colors.text, maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

function renderAbaCombustivel(dados) {
    const tbody = document.getElementById("tabelaCombustivel");
    const lista = dados.porCombustivel;
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="td-vazio">Sem dados.</td></tr>`;
        _graficoVazio("graficoCombustivel", "Sem dados.");
        return;
    }
    tbody.innerHTML = lista.map(c => {
        const pm = c.litros > 0 ? c.gasto/c.litros : 0;
        const mm = c.precoMin !== Infinity ? `${fmtR4(c.precoMin)} / ${fmtR4(c.precoMax)}` : "—";
        return `<tr>
            <td>${escapeHtml(c.nome)}</td><td>${c.notas}</td><td>${fmtL(c.litros)}</td>
            <td>${fmtR(c.gasto)}</td><td>${pm>0?fmtR4(pm):"—"}</td><td>${mm}</td>
        </tr>`;
    }).join("");
    
    const canvas = _graficoPronto("graficoCombustivel");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (chartCombustivel) chartCombustivel.destroy();
    const colors = getChartColors();
    chartCombustivel = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: lista.map(c => c.nome),
            datasets: [{
                label: metricaAtual === 'gasto' ? 'Gasto (R$)' : 'Litros',
                data: lista.map(c => metricaAtual === 'gasto' ? c.gasto : c.litros),
                backgroundColor: colors.info + '80',
                borderColor: colors.info,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => formatarTooltipValor(ctx.raw, metricaAtual === 'gasto' ? 'R$' : 'L')
                    }
                }
            },
            scales: {
                y: { 
                    ticks: {
                        callback: (val) => metricaAtual === 'gasto' ? fmtR(val) : fmtL(val),
                        color: colors.text
                    },
                    grid: { color: colors.grid }
                },
                x: { ticks: { color: colors.text, maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

function renderAbaComparativo(dados) {
    const tbody = document.getElementById("tabelaComparativo");
    const meses = dados.mensal;
    if (meses.length < 2) {
        tbody.innerHTML = `<tr><td colspan="5" class="td-vazio">São necessários pelo menos 2 meses de dados.</td></tr>`;
        _graficoVazio("graficoComparativo", "Dados insuficientes para o comparativo.");
        document.getElementById("alertaComparativo").style.display = "none";
        return;
    }
    const custosMedias = meses.map(m => m.litros > 0 ? m.gasto/m.litros : 0);
    tbody.innerHTML = meses.map((m, idx) => {
        const cm = custosMedias[idx];
        const varBadge = idx > 0 ? badgeVariacao(cm, custosMedias[idx-1]) : "—";
        return `<tr>
            <td>${nomeMes(m.mes)}</td><td>${cm>0?fmtR4(cm):"—"}</td>
            <td>${varBadge}</td><td>${fmtL(m.litros)}</td><td>${fmtR(m.gasto)}</td>
        </tr>`;
    }).join("");
    
    const canvas = _graficoPronto("graficoComparativo");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (chartComparativo) chartComparativo.destroy();
    const colors = getChartColors();
    chartComparativo = new Chart(ctx, {
        type: 'line',
        data: {
            labels: meses.map(m => nomeMes(m.mes)),
            datasets: [{
                label: 'Custo Médio (R$/L)',
                data: custosMedias,
                borderColor: colors.primary,
                backgroundColor: colors.primary + '20',
                tension: 0.1,
                fill: true,
                pointBackgroundColor: colors.primary,
                pointBorderColor: 'white',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => 'R$ ' + ctx.raw.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
                    }
                }
            },
            scales: {
                y: { 
                    ticks: {
                        callback: (val) => fmtR(val),
                        color: colors.text
                    },
                    grid: { color: colors.grid }
                },
                x: { ticks: { color: colors.text, maxRotation: 45, minRotation: 45 } }
            }
        }
    });

    // Alerta de variação
    const ultimo   = custosMedias[custosMedias.length - 1] || 0;
    const anterior = custosMedias[custosMedias.length - 2] || 0;
    const alerta   = document.getElementById("alertaComparativo");

    if (ultimo > 0 && anterior > 0) {
        const diff = (ultimo - anterior) / anterior * 100;
        if (Math.abs(diff) >= 1) {
            alerta.style.display = "block";
            if (diff > 0) {
                alerta.innerHTML = `<strong>Atenção:</strong> O custo médio subiu <strong>${diff.toFixed(1)}%</strong> no último mês.`;
                alerta.style.cssText = "display:block;background:#f8d7da;border-color:#f5c6c6;color:#721c24;border-radius:6px;padding:10px 14px;margin-top:12px;";
            } else {
                alerta.innerHTML = `<strong>Boa notícia:</strong> O custo médio caiu <strong>${Math.abs(diff).toFixed(1)}%</strong> no último mês.`;
                alerta.style.cssText = "display:block;background:#d4edda;border-color:#b2dfcb;color:#155724;border-radius:6px;padding:10px 14px;margin-top:12px;";
            }
        } else {
            alerta.style.display = "none";
        }
    } else {
        alerta.style.display = "none";
    }
}

function renderAbaDistribuicao(dados) {
    const canvasComb = _graficoPronto("graficoPizzaCombustivel");
    const canvasMotor = _graficoPronto("graficoPizzaMotoristas");
    if (!canvasComb || !canvasMotor) return;
    
    const colors = getChartColors();
    
    // Pizza por combustível
    let combData = dados.porCombustivel.map(c => ({ 
        label: c.nome, 
        value: metricaAtual === 'gasto' ? c.gasto : c.litros 
    }));
    combData.sort((a,b) => b.value - a.value);
    if (combData.length > 5) {
        const top5 = combData.slice(0,5);
        const outros = combData.slice(5).reduce((acc, c) => acc + c.value, 0);
        combData = top5.concat([{ label: 'Outros', value: outros }]);
    }
    
    if (chartPizzaComb) chartPizzaComb.destroy();
    chartPizzaComb = new Chart(canvasComb.getContext('2d'), {
        type: 'pie',
        data: {
            labels: combData.map(d => d.label),
            datasets: [{
                data: combData.map(d => d.value),
                backgroundColor: ['#a02828', '#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#64748b'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: colors.text } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${formatarTooltipValor(ctx.raw, metricaAtual === 'gasto' ? 'R$' : 'L')}`
                    }
                }
            }
        }
    });
    
    // Pizza por motorista
    let motorData = dados.porMotorista.map(m => ({ 
        label: m.nome, 
        value: metricaAtual === 'gasto' ? m.gasto : m.litros 
    }));
    motorData.sort((a,b) => b.value - a.value);
    if (motorData.length > 5) {
        const top5 = motorData.slice(0,5);
        const outros = motorData.slice(5).reduce((acc, m) => acc + m.value, 0);
        motorData = top5.concat([{ label: 'Outros', value: outros }]);
    }
    if (chartPizzaMotor) chartPizzaMotor.destroy();
    chartPizzaMotor = new Chart(canvasMotor.getContext('2d'), {
        type: 'pie',
        data: {
            labels: motorData.map(d => d.label),
            datasets: [{
                data: motorData.map(d => d.value),
                backgroundColor: ['#a02828', '#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#64748b'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: colors.text } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${formatarTooltipValor(ctx.raw, metricaAtual === 'gasto' ? 'R$' : 'L')}`
                    }
                }
            }
        }
    });
}

// Nova aba: Evolução de Preços
function renderAbaEvolucaoPrecos(dados) {
    const canvas = document.getElementById("graficoEvolucaoPrecos");
    if (!canvas) return;

    const precosPorComb = dados.precosPorCombustivel;
    const meses = dados.meses;

    if (Object.keys(precosPorComb).length === 0 || meses.length < 2) {
        _graficoVazio("graficoEvolucaoPrecos", "Dados insuficientes para evolução de preços.");
        return;
    }

    _graficoPronto("graficoEvolucaoPrecos");

    const colors = getChartColors();
    const datasets = [];
    const combustiveis = Object.keys(precosPorComb).sort();

    combustiveis.forEach((tipo, idx) => {
        const dadosTipo = precosPorComb[tipo];
        // Preenche todos os meses, mesmo os que não têm dados (null)
        const valores = meses.map(mes => {
            const registro = dadosTipo.find(d => d.mes === mes);
            return registro ? registro.precoMedio : null;
        });
        datasets.push({
            label: tipo,
            data: valores,
            borderColor: `hsl(${idx * 60 % 360}, 70%, 50%)`,
            backgroundColor: 'transparent',
            tension: 0.2,
            pointRadius: 4,
            spanGaps: true
        });
    });

    if (chartEvolucaoPrecos) chartEvolucaoPrecos.destroy();
    const ctx = canvas.getContext("2d");
    chartEvolucaoPrecos = new Chart(ctx, {
        type: 'line',
        data: {
            labels: meses.map(m => nomeMes(m)),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: R$ ${ctx.raw ? ctx.raw.toFixed(4) : '—'}`
                    }
                }
            },
            scales: {
                y: { 
                    ticks: { callback: (val) => fmtR(val), color: colors.text },
                    grid: { color: colors.grid }
                },
                x: { ticks: { color: colors.text, maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

function badgeVariacao(atual, anterior) {
    if (anterior <= 0) return "";
    const diff = (atual - anterior) / anterior * 100;
    if (Math.abs(diff) < 0.01) return `<span class="badge-var igual">= 0%</span>`;
    if (diff > 0) return `<span class="badge-var alta">▲ +${diff.toFixed(1)}%</span>`;
    return `<span class="badge-var baixa">▼ ${diff.toFixed(1)}%</span>`;
}

function trocarAba(nomeAba, botao) {
    document.querySelectorAll(".aba-conteudo").forEach(a => a.style.display = "none");
    document.querySelectorAll(".aba-btn").forEach(b => b.classList.remove("ativa"));
    document.getElementById("aba-" + nomeAba).style.display = "block";
    botao.classList.add("ativa");
    // Re-renderiza gráficos após o bloco ficar visível
    if (_dadosAnaliticoAtual) {
        requestAnimationFrame(() => {
            if (nomeAba === "mensal")      renderAbaMensal(_dadosAnaliticoAtual);
            if (nomeAba === "motoristas")  renderAbaMotoristas(_dadosAnaliticoAtual);
            if (nomeAba === "veiculos")    renderAbaVeiculos(_dadosAnaliticoAtual);
            if (nomeAba === "combustivel") renderAbaCombustivel(_dadosAnaliticoAtual);
            if (nomeAba === "comparativo") renderAbaComparativo(_dadosAnaliticoAtual);
            if (nomeAba === "distribuicao") renderAbaDistribuicao(_dadosAnaliticoAtual);
            if (nomeAba === "evolucaoPrecos") renderAbaEvolucaoPrecos(_dadosAnaliticoAtual);
        });
    }
}

// Inicializa os botões de métrica quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(inicializarBotoesMetrica, 500);
});