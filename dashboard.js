/*=================================================
  DASHBOARD
=================================================*/
function carregarDashboard() {
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const lancamentosMes = db.lancamentos.filter(l => new Date(l.dataNota) >= inicioMes);

    const totalNotas = lancamentosMes.length;
    const totalLitros = lancamentosMes.reduce((sum, l) => sum + l.itens.reduce((s, i) => s + i.qtd, 0), 0);
    const totalGasto = lancamentosMes.reduce((sum, l) => sum + l.total, 0);
    const custoMedio = totalLitros > 0 ? totalGasto / totalLitros : 0;

    document.getElementById("kpiDashboard").innerHTML = `
        <div class="kpi-card">
            <div class="kpi-valor">${totalNotas}</div>
            <div class="kpi-label">Notas no Mês</div>
        </div>
        <div class="kpi-card verde">
            <div class="kpi-valor">${fmtL(totalLitros)}</div>
            <div class="kpi-label">Litros no Mês</div>
        </div>
        <div class="kpi-card laranja">
            <div class="kpi-valor">${fmtR(totalGasto)}</div>
            <div class="kpi-label">Gasto no Mês</div>
        </div>
        <div class="kpi-card roxo">
            <div class="kpi-valor">${fmtR4(custoMedio)}</div>
            <div class="kpi-label">Custo Médio / L</div>
        </div>
    `;

    // Alertas preço fora média
    const alertas = [];
    lancamentosMes.forEach(l => {
        l.itens.forEach(i => {
            const media = calcularMediaPreco(i.tipo);
            if (media > 0 && Math.abs(i.valor - media) / media > 0.1) {
                alertas.push(`Alerta: Preço de ${i.tipo} na nota ${l.numeroNota} fora da média.`);
            }
        });
    });
    document.getElementById("alertasDashboard").innerHTML = alertas.length === 0 ? '<p class="dica">Nenhum alerta.</p>' : alertas.map(a => `<div class="alerta-card">${a}</div>`).join('');

    // Últimas entradas
    const ultimas = db.lancamentos.sort((a, b) => new Date(b.dataNota) - new Date(a.dataNota)).slice(0, 5);
    document.getElementById("ultimasEntradasBody").innerHTML = ultimas.map(l => `
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
                <button class="btn-secundario" onclick="mostrarDetalhes(${l.id}, 'dashboard')">Ver</button>
            </td>
        </tr>
    `).join('');
}

function fecharDetalhes(contexto) {
    document.getElementById(`painelDetalhes${contexto.charAt(0).toUpperCase() + contexto.slice(1)}`).style.display = "none";
}