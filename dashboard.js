/*=================================================
  DASHBOARD v3.2
  - KPIs com filtro de período (inputs + botões rápidos)
  - Usa dataDescarga como referência (fallback dataNota)
  - Por combustível com abas
  - Comparativo mês a mês (últimos 6 meses)
  - Alertas clicáveis com opção de ignorar
  - Notificações push para alertas críticos
  - Gráfico de pizza (distribuição de gastos por combustível)
=================================================*/

let dashAbaAtiva = null;

// Permissão para notificações
let notificacoesPermitidas = false;

function solicitarPermissaoNotificacoes() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        notificacoesPermitidas = true;
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            notificacoesPermitidas = permission === "granted";
        });
    }
}

function dispararNotificacao(titulo, corpo, tag, id) {
    if (!notificacoesPermitidas) return;
    const notificacao = new Notification(titulo, {
        body: corpo,
        icon: '/favicon.ico',
        tag: tag,
        renotify: true
    });
    notificacao.onclick = function() {
        window.focus();
        irParaLancamento(id);
    };
}

function _mediaPrecoPeriodo(nomeCombustivel, dias) {
    const limite = new Date();
    limite.setDate(limite.getDate() - dias);
    const limitStr = limite.toISOString().slice(0, 10);
    const precos = db.lancamentos
        .filter(l => (l.dataNota||'') >= limitStr && ((!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal)))
        .flatMap(l => l.itens.filter(i => i.tipo === nomeCombustivel && i.valor > 0))
        .map(i => i.valor);
    if (precos.length === 0) return 0;
    return precos.reduce((s, v) => s + v, 0) / precos.length;
}

function _mediaVolumePorNota(nomeCombustivel) {
    const volumes = db.lancamentos
        .filter(l => (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal))
        .flatMap(l => l.itens.filter(i => i.tipo === nomeCombustivel && i.qtd > 0))
        .map(i => i.qtd);
    if (volumes.length === 0) return 0;
    return volumes.reduce((s, v) => s + v, 0) / volumes.length;
}

// ─── Filtros rápidos do Dashboard ───────────────────────────────────────────
function dashFiltroRapido(periodo) {
    const hoje = new Date();
    let inicio, fim;
    if (periodo === 'mes') {
        inicio = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`;
        fim    = hoje.toISOString().slice(0,10);
    } else if (periodo === 'mes_anterior') {
        inicio = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1).toISOString().slice(0,10);
        fim    = new Date(hoje.getFullYear(), hoje.getMonth(), 0).toISOString().slice(0,10);
    } else if (periodo === 'ano') {
        inicio = `${hoje.getFullYear()}-01-01`;
        fim    = hoje.toISOString().slice(0,10);
    }
    const i = document.getElementById('dashInicio');
    const f = document.getElementById('dashFim');
    if (i) i.value = inicio;
    if (f) f.value = fim;
    carregarDashboard();
}

// ─── Garante filtros de período no DOM (cria se ainda não existir) ───────────
function _garantirFiltrosDashboard() {
    if (document.getElementById('dashFiltrosPeriodo')) return;

    const hoje = new Date();
    const inicioMesStr = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`;
    const fimHojeStr   = hoje.toISOString().slice(0,10);

    const filtrosDiv = document.createElement('div');
    filtrosDiv.id = 'dashFiltrosPeriodo';
    filtrosDiv.style.cssText = 'display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;';
    filtrosDiv.innerHTML = `
        <div class="campo" style="min-width:140px">
            <label for="dashInicio">Período — início</label>
            <input type="date" id="dashInicio" value="${inicioMesStr}" onchange="carregarDashboard()">
        </div>
        <div class="campo" style="min-width:140px">
            <label for="dashFim">Período — fim</label>
            <input type="date" id="dashFim" value="${fimHojeStr}" onchange="carregarDashboard()">
        </div>
        <div style="display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;padding-bottom:2px;">
            <span class="filtros-rapidos-sep" style="align-self:center;">Rápido:</span>
            <button class="btn-filtro-rapido" onclick="dashFiltroRapido('mes')">Este mês</button>
            <button class="btn-filtro-rapido" onclick="dashFiltroRapido('mes_anterior')">Mês anterior</button>
            <button class="btn-filtro-rapido" onclick="dashFiltroRapido('ano')">Este ano</button>
        </div>
    `;

    const dashEl = document.getElementById('dashboard');
    const kpiEl  = document.getElementById('kpiDashboard');
    if (dashEl && kpiEl) {
        dashEl.insertBefore(filtrosDiv, kpiEl);
    }
}

function carregarDashboard() {
    _garantirFiltrosDashboard();

    const hoje = new Date();
    const inputI = document.getElementById('dashInicio');
    const inputF = document.getElementById('dashFim');
    const inicioMesStr = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`;
    const fimHojeStr   = hoje.toISOString().slice(0,10);
    const inicio = inputI?.value || inicioMesStr;
    const fim    = inputF?.value || fimHojeStr;

    // FIX: usa dataDescarga como referência principal, fallback para dataNota
    const lancamentosMes = db.lancamentos.filter(l => {
        if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
        const dRef = l.dataDescarga || l.dataNota || '';
        return dRef >= inicio && dRef <= fim;
    });

    const totalNotas  = lancamentosMes.length;
    const totalLitros = lancamentosMes.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0);
    const totalGasto  = lancamentosMes.reduce((s, l) => s + l.total, 0);
    const custoMedio  = totalLitros > 0 ? totalGasto / totalLitros : 0;

    document.getElementById("kpiDashboard").innerHTML = `
        <div class="kpi-card">
            <div class="kpi-valor">${totalNotas}</div>
            <div class="kpi-label">Notas no Período</div>
        </div>
        <div class="kpi-card verde">
            <div class="kpi-valor">${fmtL(totalLitros)}</div>
            <div class="kpi-label">Litros no Período</div>
        </div>
        <div class="kpi-card laranja">
            <div class="kpi-valor">${fmtR(totalGasto)}</div>
            <div class="kpi-label">Gasto no Período</div>
        </div>
        <div class="kpi-card roxo">
            <div class="kpi-valor">${fmtR4(custoMedio)}</div>
            <div class="kpi-label">Custo Médio / L</div>
        </div>
    `;

    if (typeof injetarIconesKPI === 'function') injetarIconesKPI();
    _renderAlertas(lancamentosMes);
    renderDashCombustiveis(lancamentosMes);
    renderComparativoMeses();
    // Destrói pizza anterior para redesenhar com período correto
    const pizzaAnterior = document.getElementById('graficoPizzaDashboard');
    if (pizzaAnterior) pizzaAnterior.remove();
    renderGraficoPizzaDashboard(lancamentosMes);

    const ultimas = [...db.lancamentos]
        .filter(l => (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal))
        .sort((a, b) => (b.dataDescarga || b.dataNota).localeCompare(a.dataDescarga || a.dataNota))
        .slice(0, 5);

    document.getElementById("ultimasEntradasBody").innerHTML = ultimas.length === 0
        ? `<tr><td colspan="10" class="td-vazio">Nenhum lançamento ainda.</td></tr>`
        : ultimas.map(l => {
            const totalLitros = (l.itens || []).reduce((s, i) => s + _litrosItem(i), 0);
            return `
            <tr>
                <td>${formatarData(l.dataNota)}</td>
                <td>${formatarData(l.dataDescarga)}</td>
                <td>${escapeHtml(l.numeroNota)}</td>
                <td>${escapeHtml(l.base) || '—'}</td>
                <td>${escapeHtml(l.empresa) || '—'}</td>
                <td>${escapeHtml(l.motorista) || '—'}</td>
                <td>${escapeHtml(l.placa) || '—'}</td>
                <td style="text-align:right">${totalLitros.toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits:0})}</td>
                <td>${fmtR(l.total)}</td>
                <td class="no-print">
                    <button class="btn-secundario" data-id="${l.id}" onclick="_verDetalheDashboard(this.dataset.id)">Ver</button>
                </td>
            </tr>`;
        }).join('');
}

function _renderAlertas(lancamentosMes) {
    const cfg       = configAlertas();
    const ignorados = alertasIgnorados();
    const hoje      = new Date(); hoje.setHours(0,0,0,0);
    const alertas   = [];

    lancamentosMes.forEach(l => {
        l.itens.forEach(i => {
            const chavePreco = `preco|${l.numeroNota}|${i.tipo}`;
            const chaveVol   = `vol|${l.numeroNota}|${i.tipo}`;

            if (cfg.precoAtivo && i.valor > 0 && !ignorados[chavePreco]) {
                const media = _mediaPrecoPeriodo(i.tipo, cfg.precoPeriodoDias);
                const diff  = i.valor - media;
                if (media > 0 && diff >= cfg['precoDiferencaR$']) {
                    alertas.push({
                        tipo: 'preco', chave: chavePreco,
                        icone: '', cor: 'laranja',
                        titulo: `Preço alto — ${escapeHtml(i.tipo)}`,
                        msg: `Nota <strong>${escapeHtml(l.numeroNota)}</strong> (${formatarData(l.dataNota)}): ` +
                             `<strong>${fmtR4(i.valor)}/L</strong> — ` +
                             `R$&nbsp;${diff.toFixed(2)} acima da média dos últimos ${cfg.precoPeriodoDias} dias ` +
                             `(média: ${fmtR4(media)}/L)`,
                        id: l.id,
                        notificacao: `Preço alto em ${l.numeroNota}: ${fmtR4(i.valor)}/L (R$ ${diff.toFixed(2)} acima da média)`
                    });
                }
            }

            if (cfg.volumeAtivo && i.qtd > 0 && !ignorados[chaveVol]) {
                const mediaVol = _mediaVolumePorNota(i.tipo);
                if (mediaVol > 0) {
                    const varPerc = ((i.qtd - mediaVol) / mediaVol) * 100;
                    if (varPerc >= cfg.volumeAcimaPerc) {
                        alertas.push({
                            tipo: 'volume', chave: chaveVol,
                            icone: '', cor: 'azul',
                            titulo: `Volume acima do usual — ${escapeHtml(i.tipo)}`,
                            msg: `Nota <strong>${escapeHtml(l.numeroNota)}</strong>: ` +
                                 `<strong>${fmtL3(i.qtd)}</strong> — ` +
                                 `${varPerc.toFixed(0)}% acima da média histórica ` +
                                 `(média: ${fmtL3(mediaVol)}/nota)`,
                            id: l.id,
                            notificacao: `Volume alto em ${l.numeroNota}: ${fmtL3(i.qtd)} (${varPerc.toFixed(0)}% acima da média)`
                        });
                    } else if (varPerc <= -cfg.volumeAbaixoPerc) {
                        alertas.push({
                            tipo: 'volume', chave: chaveVol,
                            icone: '', cor: 'azul',
                            titulo: `Volume abaixo do usual — ${escapeHtml(i.tipo)}`,
                            msg: `Nota <strong>${escapeHtml(l.numeroNota)}</strong>: ` +
                                 `<strong>${fmtL3(i.qtd)}</strong> — ` +
                                 `${Math.abs(varPerc).toFixed(0)}% abaixo da média histórica ` +
                                 `(média: ${fmtL3(mediaVol)}/nota)`,
                            id: l.id,
                            notificacao: `Volume baixo em ${l.numeroNota}: ${fmtL3(i.qtd)} (${Math.abs(varPerc).toFixed(0)}% abaixo da média)`
                        });
                    }
                }
            }
        });

        if (cfg.dataAtivo) {
            const chaveData = `data|${l.numeroNota}`;
            if (!ignorados[chaveData]) {
                const tolerMs   = cfg.dataTolerDias * 86400000;
                const dtDesc    = l.dataDescarga ? new Date(l.dataDescarga + 'T00:00:00') : null;
                const dtNota    = l.dataNota     ? new Date(l.dataNota     + 'T00:00:00') : null;
                const isFutDesc = dtDesc && (dtDesc - hoje) > tolerMs;
                const isFutNota = dtNota && (dtNota - hoje) > tolerMs;

                let grandeDiff = false;
                if (dtNota && dtDesc) {
                    const diffDias = Math.round((dtDesc - dtNota) / 86400000);
                    if (diffDias > cfg.dataMaxDescNota) grandeDiff = true;
                }

                if (isFutDesc || isFutNota || grandeDiff) {
                    let motivo = [];
                    if (isFutDesc) motivo.push(`descarga em ${formatarData(l.dataDescarga)} (data futura)`);
                    if (isFutNota) motivo.push(`nota em ${formatarData(l.dataNota)} (data futura)`);
                    if (grandeDiff && !isFutDesc && !isFutNota) {
                        const dias = Math.round((new Date(l.dataDescarga+'T00:00:00') - new Date(l.dataNota+'T00:00:00')) / 86400000);
                        motivo.push(`${dias} dias entre nota e descarga`);
                    }
                    alertas.push({
                        tipo: 'data', chave: chaveData,
                        icone: '', cor: 'vermelho',
                        titulo: `Data suspeita — nota ${escapeHtml(l.numeroNota)}`,
                        msg: motivo.join(' · '),
                        id: l.id,
                        notificacao: `Data suspeita na nota ${l.numeroNota}: ${motivo.join(', ')}`,
                        confirmarLabel: 'Confirmar data',
                    });
                }
            }
        }
    });

    alertas.forEach(a => {
        if (!ignorados[a.chave]) {
            dispararNotificacao(
                `Fuel Mind: ${a.titulo}`,
                a.notificacao,
                a.chave,
                a.id
            );
        }
    });

    const el = document.getElementById("alertasDashboard");
    if (alertas.length === 0) {
        el.innerHTML = '<p class="dica">Nenhum alerta no período.</p>';
        return;
    }

    el.innerHTML = alertas.map(a => {
        const { icone, cor, titulo, msg, chave, id, confirmarLabel } = a;
        return `
        <div class="alerta-card alerta-card--${cor} alerta-clicavel">
            <div class="alerta-corpo"
                 onclick="editarLancamento('${id}')"
                 title="Clique para editar o lançamento"
                 style="cursor:pointer">
                ${icone} <strong class="alerta-titulo">${titulo}</strong> —
                <span class="alerta-msg">${msg}</span>
                <span class="alerta-link">Ver →</span>
            </div>
            <button class="alerta-ignorar"
                    onclick="ignorarAlerta('${chave}'); carregarDashboard();"
                    title="Marcar como verificado e não exibir mais">
                ✓ ${confirmarLabel || 'Confirmar'}
            </button>
        </div>`;
    }).join('');
}

function renderDashCombustiveis(lancamentosMes) {
    const container = document.getElementById("dashCombustiveisContainer");
    if (!container) return;

    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);
    if (combustiveis.length === 0) {
        container.innerHTML = '<p class="dica">Cadastre combustíveis para ver o detalhamento.</p>';
        return;
    }

    if (lancamentosMes.length === 0) {
        container.innerHTML = '<p class="dica">Nenhum lançamento no período selecionado.</p>';
        return;
    }

    if (!dashAbaAtiva || !combustiveis.find(c => c.nome === dashAbaAtiva)) {
        dashAbaAtiva = combustiveis[0].nome;
    }

    const resumo = {};
    combustiveis.forEach(c => {
        const itens = lancamentosMes.flatMap(l => l.itens.filter(i => i.tipo === c.nome));
        resumo[c.nome] = {
            litros: itens.reduce((s, i) => s + _litrosItem(i), 0),
            gasto:  itens.reduce((s, i) => s + (i.total ?? i.qtd * i.valor), 0),
            notas:  lancamentosMes.filter(l => l.itens.some(i => i.tipo === c.nome)).length,
        };
    });

    const abas = combustiveis.map(c => `
        <button class="aba-btn ${c.nome === dashAbaAtiva ? 'ativa' : ''}">
            ${escapeHtml(c.nome)}
            ${resumo[c.nome].litros > 0 ? `<span class="badge-aba">${fmtL(resumo[c.nome].litros)}</span>` : ''}
        </button>
    `).join('');

    // Guarda referência global para re-render ao trocar aba
    window._dashLancMes = lancamentosMes;

    container.innerHTML = `
        <div class="analitico-abas" style="margin-bottom:12px">${abas}</div>
        <div id="dashCombConteudo">${_renderConteudoCombustivel(dashAbaAtiva, resumo[dashAbaAtiva], lancamentosMes)}</div>
    `;

    // Liga o clique de cada aba pelo índice (evita ambiguidade entre nomes de
    // combustível que compartilham prefixo, ex: "Diesel" e "Diesel S10").
    container.querySelectorAll('.aba-btn').forEach((btn, idx) => {
        btn.onclick = function() {
            dashAbaAtiva = combustiveis[idx].nome;
            container.querySelectorAll('.aba-btn').forEach(b => b.classList.remove('ativa'));
            this.classList.add('ativa');
            document.getElementById('dashCombConteudo').innerHTML =
                _renderConteudoCombustivel(dashAbaAtiva, resumo[dashAbaAtiva], lancamentosMes);
        };
    });
}

function _renderConteudoCombustivel(nomeComb, r, lancamentosMes) {
    if (!r || r.litros === 0) {
        return `<p class="dica">Nenhum lançamento de <strong>${escapeHtml(nomeComb)}</strong> no período.</p>`;
    }

    const custoMedio = r.litros > 0 ? r.gasto / r.litros : 0;

    // Variação vs mês anterior — calcula corretamente usando Date para evitar "YYYY-00" em janeiro
    const hoje = new Date();
    const dtMesAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const mesAntStr = `${dtMesAnt.getFullYear()}-${String(dtMesAnt.getMonth() + 1).padStart(2, '0')}`;
    const lancMesAnt = db.lancamentos.filter(l => {
        if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
        return l.dataNota && l.dataNota.startsWith(mesAntStr);
    });
    const itensMesAnt = lancMesAnt.flatMap(l => l.itens.filter(i => i.tipo === nomeComb));
    const gastMesAnt  = itensMesAnt.reduce((s, i) => s + (i.total ?? i.qtd * i.valor), 0);
    const litMesAnt   = itensMesAnt.reduce((s, i) => s + _litrosItem(i), 0);
    const custoAnt    = litMesAnt > 0 ? gastMesAnt / litMesAnt : 0;
    let variacaoHTML  = '';
    if (custoAnt > 0) {
        const vp  = ((custoMedio - custoAnt) / custoAnt) * 100;
        const sinal = vp > 0 ? '▲' : '▼';
        const cls   = vp > 0 ? 'danger' : 'success';
        variacaoHTML = `<span style="font-size:0.7rem; color:var(--${cls}); margin-left:4px">${sinal} ${Math.abs(vp).toFixed(1)}% vs mês ant.</span>`;
    }

    const lancsComb = lancamentosMes
        .filter(l => l.itens.some(i => i.tipo === nomeComb))
        .sort((a, b) => (b.dataDescarga || b.dataNota).localeCompare(a.dataDescarga || a.dataNota))
        .slice(0, 10);

    const tabelaHTML = `
        <div class="tabela-container" style="margin-top:12px">
            <table><thead><tr>
                <th>Data</th><th>Nota</th><th>Motorista</th>
                <th>Qtd (L)</th><th>R$/L</th><th>Total</th>
            </tr></thead><tbody>
            ${lancsComb.map(l => {
                const item = l.itens.find(i => i.tipo === nomeComb);
                return `<tr>
                    <td>${formatarData(l.dataDescarga || l.dataNota)}</td>
                    <td>${escapeHtml(l.numeroNota)}</td>
                    <td>${escapeHtml(l.motorista) || '—'}</td>
                    <td>${fmtL3(item.qtd)}</td>
                    <td>${fmtR4(item.valor)}</td>
                    <td>${fmtR(item.total ?? item.qtd * item.valor)}</td>
                </tr>`;
            }).join('')}
            </tbody></table>
        </div>`;

    return `
        <div class="dash-comb-kpis">
            <div class="dash-comb-kpi">
                <div class="dash-comb-kpi-val">${r.notas}</div>
                <div class="dash-comb-kpi-label">Notas</div>
            </div>
            <div class="dash-comb-kpi verde">
                <div class="dash-comb-kpi-val">${fmtL(r.litros)}</div>
                <div class="dash-comb-kpi-label">Litros</div>
            </div>
            <div class="dash-comb-kpi laranja">
                <div class="dash-comb-kpi-val">${fmtR(r.gasto)}</div>
                <div class="dash-comb-kpi-label">Gasto</div>
            </div>
            <div class="dash-comb-kpi roxo">
                <div class="dash-comb-kpi-val">${fmtR4(custoMedio)}</div>
                <div class="dash-comb-kpi-label">Custo Médio/L ${variacaoHTML}</div>
            </div>
        </div>
        <div style="margin-top:4px">
            <span class="dica" style="font-size:0.78rem">
                Últimas entradas de <strong>${escapeHtml(nomeComb)}</strong> no período · ordenadas por descarga
            </span>
        </div>
        ${tabelaHTML}`;
}

function renderComparativoMeses() {
    const container = document.getElementById("dashComparativoContainer");
    if (!container) return;

    const hoje = new Date();
    const meses = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        meses.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }

    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);
    if (combustiveis.length === 0) { container.innerHTML = ''; return; }

    const dadosMeses = meses.map(mes => {
        const lans = db.lancamentos.filter(l => {
            if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
            return l.dataNota && l.dataNota.startsWith(mes);
        });
        const porComb = {};
        combustiveis.forEach(c => {
            const itens = lans.flatMap(l => l.itens.filter(i => i.tipo === c.nome));
            porComb[c.nome] = {
                litros: itens.reduce((s, i) => s + _litrosItem(i), 0),
                gasto:  itens.reduce((s, i) => s + (i.total ?? i.qtd * i.valor), 0),
            };
        });
        const totalLitros = Object.values(porComb).reduce((s, v) => s + v.litros, 0);
        const totalGasto  = Object.values(porComb).reduce((s, v) => s + v.gasto,  0);
        return { mes, porComb, totalLitros, totalGasto };
    });

    const tbody = dadosMeses.map(d => {
        const custMedio = d.totalLitros > 0 ? d.totalGasto / d.totalLitros : 0;
        const combCells = combustiveis.map(c =>
            `<td>${d.porComb[c.nome].litros > 0 ? fmtL(d.porComb[c.nome].litros) : '—'}</td>`
        ).join('');
        const isAtual = d.mes === meses[meses.length - 1];
        return `<tr ${isAtual ? 'class="linha-mes-atual"' : ''}>
            <td><strong>${nomeMes(d.mes)}</strong></td>
            ${combCells}
            <td><strong>${fmtL(d.totalLitros)}</strong></td>
            <td>${fmtR(d.totalGasto)}</td>
            <td>${custMedio > 0 ? fmtR4(custMedio) : '—'}</td>
        </tr>`;
    }).join('');

    const combHeaders = combustiveis.map(c => `<th>${escapeHtml(c.nome)}</th>`).join('');

    container.innerHTML = `
        <div class="tabela-container" style="overflow-x:auto">
            <table>
                <thead><tr>
                    <th>Mês</th>
                    ${combHeaders}
                    <th>Total Litros</th>
                    <th>Total Gasto</th>
                    <th>Custo Médio/L</th>
                </tr></thead>
                <tbody>${tbody}</tbody>
            </table>
        </div>`;
}

function renderGraficoPizzaDashboard(lancamentosMes) {
    // Se não foi passado o array, usa o período do mês atual como fallback
    if (!lancamentosMes) {
        const hoje = new Date();
        const inicioMesStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
        lancamentosMes = db.lancamentos.filter(l => {
            if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
            return (l.dataNota || '') >= inicioMesStr;
        });
    }

    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);
    if (combustiveis.length === 0) return;

    const dados = combustiveis.map(c => {
        const gasto = lancamentosMes.reduce((acc, l) => {
            const item = l.itens.find(i => i.tipo === c.nome);
            return acc + (item ? (item.total ?? item.qtd * item.valor) : 0);
        }, 0);
        return { nome: c.nome, valor: gasto };
    }).filter(d => d.valor > 0);

    if (dados.length === 0) return;

    const pizzaContainer = document.createElement('div');
    pizzaContainer.id = 'graficoPizzaDashboard';
    pizzaContainer.style.marginTop = '28px';
    pizzaContainer.innerHTML = `
        <h3>Distribuição de Gastos no Período</h3>
        <div class="grafico-wrapper" style="max-width:400px; margin:0 auto">
            <canvas id="canvasPizzaDash" height="220"></canvas>
        </div>`;

    const comparativo = document.getElementById("dashComparativoContainer");
    if (comparativo) comparativo.insertAdjacentElement('afterend', pizzaContainer);

    const canvas = document.getElementById('canvasPizzaDash');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window._dashPizzaChart) { window._dashPizzaChart.destroy(); window._dashPizzaChart = null; }
    const colors = getChartColors();
    const backgroundColors = ['#a02828', '#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#64748b'];

    window._dashPizzaChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: dados.map(d => d.nome),
            datasets: [{
                data: dados.map(d => d.valor),
                backgroundColor: backgroundColors.slice(0, dados.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: colors.text, padding: 16 } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${fmtR(ctx.raw)}`
                    }
                }
            }
        }
    });
}

// fecharDetalhes — função canônica definida em relatorios.js (limpa _detalheInlineAberto).
// (removida daqui para evitar duplicação e inconsistência de estado)

function _verDetalheDashboard(id) {
    const l = db.lancamentos.find(x => x.id === id);
    if (!l) return;

    const anterior = document.getElementById('_modalDetalheDash');
    if (anterior) anterior.remove();

    const div = document.createElement('div');
    div.id = '_modalDetalheDash';
    div.className = 'modal-overlay';
    div.style.display = 'flex';

    const conteudo = typeof _buildConteudoDetalhe === 'function'
        ? _buildConteudoDetalhe(l)
        : `<p>Nota: <strong>${escapeHtml(l.numeroNota)}</strong> — ${escapeHtml(l.empresa) || '—'} — ${fmtR(l.total)}</p>`;

    div.innerHTML = `
        <div class="modal" style="max-width:680px;width:100%;max-height:85vh;overflow-y:auto;">
            <h3 style="margin:0 0 16px">Detalhes da Entrada</h3>
            ${conteudo}
            <div class="modal-acoes" style="margin-top:16px">
                <button class="btn-secundario" onclick="document.getElementById('_modalDetalheDash').remove()">Fechar</button>
            </div>
        </div>`;

    document.body.appendChild(div);
    div.addEventListener('click', e => { if (e.target === div) div.remove(); });
    document.addEventListener('keydown', function _escDash(e) {
        if (e.key === 'Escape') { div.remove(); document.removeEventListener('keydown', _escDash); }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(solicitarPermissaoNotificacoes, 1000);
});
