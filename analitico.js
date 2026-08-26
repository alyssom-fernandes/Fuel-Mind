/*=================================================
  ANALITICO – com Chart.js, tooltips formatados,
  alternância Valor/Litros, gráfico de evolução de preços,
  cache e filtro global por empresa
=================================================*/

// Instâncias globais dos gráficos
let chartMensal, chartMotoristas, chartVeiculos, chartCombustivel, chartComparativo, chartPizzaComb, chartPizzaMotor, chartEvolucaoPrecos, chartEstoque;

// Cache dos dados calculados
let _dadosAnaliticoAtual = null;

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
        const abaAtiva = document.querySelector("#analitico .aba-btn.ativa")?.textContent.trim().toLowerCase() || 'mensal';
        // Mapeia o texto do botão para o ID da aba
        const mapa = {
            'mensal': 'mensal',
            'motorista': 'motoristas',
            'veículo': 'veiculos',
            'combustível': 'combustivel',
            'comparativo': 'comparativo',
            'distribuição': 'distribuicao',
            'evolução preços': 'evolucaoPrecos'
        };
        // Extrai a primeira palavra do texto do botão
        const abaId = mapa[abaAtiva.split(' ')[0]] || 'mensal';
        const botaoAtivo = document.querySelector("#analitico .aba-btn.ativa");
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
    preencherSelectsAnalitico();
    const inicio      = document.getElementById("analiticoInicio").value;
    const fim         = document.getElementById("analiticoFim").value;
    const combustivel = document.getElementById("analiticoCombustivel").value;

    const lancamentos = db.lancamentos.filter(l => {
        // Filtro global por empresa (se ativo)
        if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
        if (inicio && l.dataNota < inicio) return false;
        if (fim    && l.dataNota > fim)    return false;
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
    renderAbaEstoque();
}

function calcularDadosAnalitico(lancamentos, filtroCombustivel) {
    const mensal = {}, porMotorista = {}, porVeiculo = {}, porCombustivel = {};
    let totalGasto = 0, totalLitros = 0;
    const numNotas = lancamentos.length;

    // Para evolução de preços
    const precosPorMes = {};

    lancamentos.forEach(l => {
        const mesKey = l.dataNota ? l.dataNota.slice(0, 7) : "desconhecido";
        if (!mensal[mesKey]) mensal[mesKey] = { mes: mesKey, notas: 0, litros: 0, gasto: 0 };
        mensal[mesKey].notas++;

        const mot = l.motorista || "(sem motorista)";
        if (!porMotorista[mot]) porMotorista[mot] = { nome: mot, viagens: 0, litros: 0, gasto: 0 };
        porMotorista[mot].viagens++;

        const vei = l.placa || "(sem placa)";
        if (!porVeiculo[vei]) porVeiculo[vei] = { nome: vei, viagens: 0, litros: 0, gasto: 0 };
        porVeiculo[vei].viagens++;

        l.itens.forEach(item => {
            if (filtroCombustivel && item.tipo !== filtroCombustivel) return;

            const litros = item.qtd   || 0;
            const gasto  = item.total || 0;
            const preco  = litros > 0 ? gasto / litros : 0;

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

function renderAbaMensal(dados) {
    const tbody = document.getElementById("tabelaMensal");
    const meses = dados.mensal;
    if (meses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="td-vazio">Sem dados para o período.</td></tr>`;
        document.getElementById("graficoMensal").closest(".grafico-wrapper").innerHTML = `<p class="grafico-vazio">Sem dados suficientes.</p>`;
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
    
    const canvas = document.getElementById("graficoMensal");
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
                        callback: (val) => metricaAtual === 'gasto' ? 'R$ ' + val.toFixed(2) : val.toFixed(0) + ' L',
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
        document.getElementById("graficoMotoristas").closest(".grafico-wrapper").innerHTML = `<p class="grafico-vazio">Sem dados.</p>`;
        return;
    }
    tbody.innerHTML = lista.map(m => {
        const cm  = m.litros > 0 ? m.gasto/m.litros : 0;
        const pct = dados.totalGasto > 0 ? m.gasto/dados.totalGasto*100 : 0;
        return `<tr>
            <td>${m.nome}</td><td>${m.viagens}</td><td>${fmtL(m.litros)}</td>
            <td>${fmtR(m.gasto)}</td><td>${cm>0?fmtR4(cm):"—"}</td>
            <td>${pct.toFixed(1)}%<div class="barra-progresso"><div class="barra-progresso-fill" style="width:${pct}%"></div></div></td>
        </tr>`;
    }).join("");
    
    const canvas = document.getElementById("graficoMotoristas");
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
                        callback: (val) => metricaAtual === 'gasto' ? 'R$ ' + val.toFixed(2) : val.toFixed(0) + ' L',
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
        document.getElementById("graficoVeiculos").closest(".grafico-wrapper").innerHTML = `<p class="grafico-vazio">Sem dados.</p>`;
        return;
    }
    tbody.innerHTML = lista.map(v => {
        const cm  = v.litros > 0 ? v.gasto/v.litros : 0;
        const pct = dados.totalGasto > 0 ? v.gasto/dados.totalGasto*100 : 0;
        return `<tr>
            <td>${v.nome}</td><td>${v.viagens}</td><td>${fmtL(v.litros)}</td>
            <td>${fmtR(v.gasto)}</td><td>${cm>0?fmtR4(cm):"—"}</td>
            <td>${pct.toFixed(1)}%<div class="barra-progresso"><div class="barra-progresso-fill" style="width:${pct}%"></div></div></td>
        </tr>`;
    }).join("");
    
    const canvas = document.getElementById("graficoVeiculos");
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
                        callback: (val) => metricaAtual === 'gasto' ? 'R$ ' + val.toFixed(2) : val.toFixed(0) + ' L',
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
        document.getElementById("graficoCombustivel").closest(".grafico-wrapper").innerHTML = `<p class="grafico-vazio">Sem dados.</p>`;
        return;
    }
    tbody.innerHTML = lista.map(c => {
        const pm = c.litros > 0 ? c.gasto/c.litros : 0;
        const mm = c.precoMin !== Infinity ? `${fmtR4(c.precoMin)} / ${fmtR4(c.precoMax)}` : "—";
        return `<tr>
            <td>${c.nome}</td><td>${c.notas}</td><td>${fmtL(c.litros)}</td>
            <td>${fmtR(c.gasto)}</td><td>${pm>0?fmtR4(pm):"—"}</td><td>${mm}</td>
        </tr>`;
    }).join("");
    
    const canvas = document.getElementById("graficoCombustivel");
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
                        callback: (val) => metricaAtual === 'gasto' ? 'R$ ' + val.toFixed(2) : val.toFixed(0) + ' L',
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
        document.getElementById("graficoComparativo").closest(".grafico-wrapper").innerHTML = `<p class="grafico-vazio">Dados insuficientes para o comparativo.</p>`;
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
    
    const canvas = document.getElementById("graficoComparativo");
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
                        callback: (val) => 'R$ ' + val.toFixed(2),
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
    const canvasComb = document.getElementById("graficoPizzaCombustivel");
    const canvasMotor = document.getElementById("graficoPizzaMotoristas");
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
        canvas.closest(".grafico-wrapper").innerHTML = `<p class="grafico-vazio">Dados insuficientes para evolução de preços.</p>`;
        return;
    }

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
                    ticks: { callback: (val) => 'R$ ' + val.toFixed(2), color: colors.text },
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


/* ─── ABA ESTOQUE ─────────────────────────────── */
function renderAbaEstoque() {
    const container = document.getElementById('aba-estoque');
    if (!container) return;

    const inicio = document.getElementById('analiticoInicio')?.value || '';
    const fim    = document.getElementById('analiticoFim')?.value    || '';
    const filtroEmpresa = empresaFiltroGlobal || null;

    if (!db.estoqueEmpresas || !db.combustiveis) {
        container.innerHTML = '<p class="grafico-vazio">Sem dados de estoque.</p>';
        return;
    }

    const empresas = filtroEmpresa
        ? [filtroEmpresa]
        : [...new Set(db.lancamentos.map(l => l.empresa).filter(Boolean))];

    const combustiveis = db.combustiveis.filter(c => c.ativo !== false).map(c => c.nome);

    // Acumular saídas, evaporação e Veeder por combustível no período
    const resumo = {}; // { comb: { saida, evap, veederDias, calcDias, divergencia } }

    combustiveis.forEach(comb => {
        resumo[comb] = { saida: 0, evap: 0, veederEntradas: 0, veederDias: 0, semVeeder: 0 };
    });

    // Gerar dias do período
    const dias = [];
    if (inicio && fim) {
        const cur = new Date(inicio + 'T00:00:00');
        const end = new Date(fim + 'T00:00:00');
        while (cur <= end) { dias.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }
    }

    if (dias.length === 0) {
        container.innerHTML = '<p class="grafico-vazio">Defina um período nos filtros acima.</p>';
        return;
    }

    // Acumular por empresa e combustível
    empresas.forEach(empresa => {
        const medEmp = db.estoqueEmpresas?.[empresa] || {};
        combustiveis.forEach(comb => {
            const medComb = medEmp[comb] || {};
            const perdaPct = db.combustiveis.find(c => c.nome === comb)?.perda ?? 0;

            dias.forEach(data => {
                const med = medComb[data] || {};
                // Saída
                resumo[comb].saida += med.saida ?? 0;
                // Evaporação: usa evapLitros se disponível, senão calcula pelo pct
                if (med.evapLitros != null) {
                    resumo[comb].evap += med.evapLitros;
                } else {
                    const pct = med.evapPct != null ? med.evapPct : perdaPct;
                    // Estimativa: usa estoque calculado até esse dia seria complexo aqui,
                    // então aproximamos: entrada do dia * pct / 100
                    const entradaDia = (db.lancamentos || [])
                        .filter(l => l.empresa === empresa && (l.dataDescarga || l.dataNota) === data)
                        .flatMap(l => l.itens.filter(i => i.tipo === comb))
                        .reduce((s,i) => s + ((i.qtdDescargada && i.qtdDescargada > 0) ? i.qtdDescargada : (i.qtd || 0)), 0);
                    if (entradaDia > 0) resumo[comb].evap += entradaDia * pct / 100;
                }
                // Veeder
                if (med.veeder != null) {
                    resumo[comb].veederEntradas += med.veeder;
                    resumo[comb].veederDias++;
                } else {
                    resumo[comb].semVeeder++;
                }
            });
        });
    });

    // Entradas totais por combustível no período
    const entradas = {};
    combustiveis.forEach(comb => {
        entradas[comb] = (db.lancamentos || [])
            .filter(l => {
                if (filtroEmpresa && l.empresa !== filtroEmpresa) return false;
                const d = l.dataDescarga || l.dataNota;
                if (inicio && d < inicio) return false;
                if (fim    && d > fim)    return false;
                return true;
            })
            .flatMap(l => l.itens.filter(i => i.tipo === comb))
            .reduce((s,i) => s + ((i.qtdDescargada && i.qtdDescargada > 0) ? i.qtdDescargada : (i.qtd || 0)), 0);
    });

    // Montar tabela resumo
    const linhas = combustiveis.map(comb => {
        const r = resumo[comb];
        const entrada = entradas[comb] || 0;
        const saldo = entrada - r.saida - r.evap;
        return { comb, entrada, saida: r.saida, evap: r.evap, saldo,
                 veederDias: r.veederDias, semVeeder: r.semVeeder };
    }).filter(r => r.entrada > 0 || r.saida > 0);

    if (linhas.length === 0) {
        container.innerHTML = '<p class="grafico-vazio">Sem movimentação no período.</p>';
        return;
    }

    const colors = getChartColors();

    const tabelaHTML = `
    <div class="tabela-container" style="margin-bottom:24px;">
        <table>
            <thead><tr>
                <th>Combustível</th>
                <th style="text-align:right">Entradas (L)</th>
                <th style="text-align:right">Vendas (L)</th>
                <th style="text-align:right">Evaporação (L)</th>
                <th style="text-align:right">Saldo Calc. (L)</th>
                <th style="text-align:right">Dias c/ Veeder</th>
            </tr></thead>
            <tbody>
                ${linhas.map(r => `<tr>
                    <td><strong>${r.comb}</strong></td>
                    <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmtL3(r.entrada)}</td>
                    <td style="text-align:right;font-family:'JetBrains Mono',monospace">${r.saida > 0 ? fmtL3(r.saida) : '—'}</td>
                    <td style="text-align:right;font-family:'JetBrains Mono',monospace">${r.evap > 0 ? fmtL3(r.evap) : '—'}</td>
                    <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-weight:700">${fmtL3(r.saldo)}</td>
                    <td style="text-align:right;color:${r.semVeeder > 0 ? 'var(--warning)' : 'var(--success)'}">
                        ${r.veederDias}${r.semVeeder > 0 ? ` <span style="font-size:0.75rem">(${r.semVeeder} s/ leitura)</span>` : ' ✓'}
                    </td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr style="font-weight:700;border-top:2px solid var(--border)">
                <td>TOTAL</td>
                <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmtL3(linhas.reduce((s,r)=>s+r.entrada,0))}</td>
                <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmtL3(linhas.reduce((s,r)=>s+r.saida,0))}</td>
                <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmtL3(linhas.reduce((s,r)=>s+r.evap,0))}</td>
                <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmtL3(linhas.reduce((s,r)=>s+r.saldo,0))}</td>
                <td></td>
            </tr></tfoot>
        </table>
    </div>`;

    // Gráfico de barras: entradas, vendas, evaporação por combustível
    const graficoHTML = `<div class="grafico-wrapper" style="height:300px;margin-bottom:24px;">
        <canvas id="graficoEstoque"></canvas>
    </div>`;

    container.innerHTML = tabelaHTML + graficoHTML;

    // Renderizar gráfico
    requestAnimationFrame(() => {
        const canvas = document.getElementById('graficoEstoque');
        if (!canvas) return;
        if (chartEstoque) chartEstoque.destroy();
        const ctx = canvas.getContext('2d');
        chartEstoque = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: linhas.map(r => r.comb),
                datasets: [
                    { label: 'Entradas', data: linhas.map(r => r.entrada), backgroundColor: 'rgba(99,102,241,0.7)' },
                    { label: 'Vendas',   data: linhas.map(r => r.saida),   backgroundColor: 'rgba(34,197,94,0.7)' },
                    { label: 'Evap.',    data: linhas.map(r => r.evap),    backgroundColor: 'rgba(251,146,60,0.7)' },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtL3(ctx.raw)} L` } }
                },
                scales: {
                    y: { ticks: { callback: v => fmtL(v), color: colors.text }, grid: { color: colors.grid } },
                    x: { ticks: { color: colors.text } }
                }
            }
        });
    });
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
            if (nomeAba === "estoque") renderAbaEstoque();
        });
    }
}

// Inicializa os botões de métrica quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(inicializarBotoesMetrica, 500);
});