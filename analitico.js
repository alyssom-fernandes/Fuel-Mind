/*=================================================
  ANALÍTICO
=================================================*/
const CORES = [
    "#1a3a5c","#27a85f","#d97706","#7e3fb3","#c0392b",
    "#2980b9","#16a085","#8e44ad","#d35400","#27ae60"
];

// Cache dos dados calculados — necessário para re-renderizar gráficos ao trocar aba
let _dadosAnaliticoAtual = null;

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
}

function calcularDadosAnalitico(lancamentos, filtroCombustivel) {
    const mensal = {}, porMotorista = {}, porVeiculo = {}, porCombustivel = {};
    let totalGasto = 0, totalLitros = 0;
    const numNotas = lancamentos.length;

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
        });
    });

    return {
        totalGasto, totalLitros, numNotas,
        custoMedio: totalLitros > 0 ? totalGasto / totalLitros : 0,
        mensal:         Object.values(mensal).sort((a, b) => a.mes.localeCompare(b.mes)),
        porMotorista:   Object.values(porMotorista).sort((a, b) => b.gasto - a.gasto),
        porVeiculo:     Object.values(porVeiculo).sort((a, b) => b.gasto - a.gasto),
        porCombustivel: Object.values(porCombustivel).sort((a, b) => b.litros - a.litros)
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
    desenharBarras(document.getElementById("graficoMensal"), {
        labels: meses.map(m => nomeMes(m.mes)), valores: meses.map(m => m.gasto),
        cor: CORES[0], titulo: "Gasto Total por Mês (R$)", formatarValor: v => "R$"+v.toFixed(0)
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
    desenharBarras(document.getElementById("graficoMotoristas"), {
        labels: lista.map(m => m.nome), valores: lista.map(m => m.gasto),
        cor: CORES[1], titulo: "Gasto por Motorista (R$)", formatarValor: v => "R$"+v.toFixed(0)
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
    desenharBarras(document.getElementById("graficoVeiculos"), {
        labels: lista.map(v => v.nome), valores: lista.map(v => v.gasto),
        cor: CORES[2], titulo: "Gasto por Veículo (R$)", formatarValor: v => "R$"+v.toFixed(0)
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
    desenharBarrasHoriz(document.getElementById("graficoCombustivel"), {
        labels: lista.map(c => c.nome), valores: lista.map(c => c.litros),
        cores: CORES, titulo: "Litros por Tipo de Combustível", formatarValor: v => v.toFixed(0)+"L"
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
    desenharLinha(document.getElementById("graficoComparativo"), {
        labels: meses.map(m => nomeMes(m.mes)), valores: custosMedias,
        cor: CORES[3], titulo: "Custo Médio por Litro (R$/L) — evolução mensal",
        formatarValor: v => "R$ "+v.toFixed(4)
    });

    const ultimo   = custosMedias[custosMedias.length - 1] || 0;
    const anterior = custosMedias[custosMedias.length - 2] || 0;
    const alerta   = document.getElementById("alertaComparativo");

    if (ultimo > 0 && anterior > 0) {
        const diff = (ultimo - anterior) / anterior * 100;
        if (Math.abs(diff) >= 1) {
            alerta.style.display = "block";
            if (diff > 0) {
                alerta.innerHTML = `⚠️ <strong>Atenção:</strong> O custo médio subiu <strong>${diff.toFixed(1)}%</strong> no último mês.`;
                alerta.style.cssText = "display:block;background:#f8d7da;border-color:#f5c6c6;color:#721c24;border-radius:6px;padding:10px 14px;margin-top:12px;";
            } else {
                alerta.innerHTML = `✅ <strong>Boa notícia:</strong> O custo médio caiu <strong>${Math.abs(diff).toFixed(1)}%</strong> no último mês.`;
                alerta.style.cssText = "display:block;background:#d4edda;border-color:#b2dfcb;color:#155724;border-radius:6px;padding:10px 14px;margin-top:12px;";
            }
        } else {
            alerta.style.display = "none";
        }
    } else {
        alerta.style.display = "none";
    }
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
    // Re-renderiza gráficos após o bloco ficar visível (canvas precisa de largura real)
    if (_dadosAnaliticoAtual) {
        requestAnimationFrame(() => {
            if (nomeAba === "mensal")      renderAbaMensal(_dadosAnaliticoAtual);
            if (nomeAba === "motoristas")  renderAbaMotoristas(_dadosAnaliticoAtual);
            if (nomeAba === "veiculos")    renderAbaVeiculos(_dadosAnaliticoAtual);
            if (nomeAba === "combustivel") renderAbaCombustivel(_dadosAnaliticoAtual);
            if (nomeAba === "comparativo") renderAbaComparativo(_dadosAnaliticoAtual);
        });
    }
}

function _canvasWidth(canvas) {
    const el = canvas.parentElement;
    return (el.clientWidth || el.offsetWidth || 600) - 32;
}
function desenharBarras(canvas, { labels, valores, cor, titulo, formatarValor }) {
    if (!canvas || labels.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = _canvasWidth(canvas);
    const H = parseInt(canvas.getAttribute("height")) || 280;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
    const PAD_TOP=30, PAD_BOTTOM=60, PAD_LEFT=70, PAD_RIGHT=20;
    const areaW=W-PAD_LEFT-PAD_RIGHT, areaH=H-PAD_TOP-PAD_BOTTOM;
    const maxVal=Math.max(...valores,1);
    const gap=areaW/labels.length;
    const barW=Math.max(8, gap*0.6);
    ctx.fillStyle="#1a3a5c"; ctx.font="bold 11px Segoe UI, Arial"; ctx.textAlign="center";
    ctx.fillText(titulo, W/2, 16);
    ctx.strokeStyle="#e0e8f0"; ctx.lineWidth=1;
    for(let i=0;i<=5;i++){
        const y=PAD_TOP+areaH-(areaH/5)*i;
        ctx.beginPath(); ctx.moveTo(PAD_LEFT,y); ctx.lineTo(PAD_LEFT+areaW,y); ctx.stroke();
        ctx.fillStyle="#999"; ctx.font="10px Segoe UI, Arial"; ctx.textAlign="right";
        ctx.fillText(formatarValor((maxVal/5)*i), PAD_LEFT-6, y+4);
    }
    ctx.strokeStyle="#aac"; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(PAD_LEFT,PAD_TOP); ctx.lineTo(PAD_LEFT,PAD_TOP+areaH); ctx.lineTo(PAD_LEFT+areaW,PAD_TOP+areaH); ctx.stroke();
    valores.forEach((val,idx)=>{
        const barH=(val/maxVal)*areaH;
        const x=PAD_LEFT+gap*idx+gap/2-barW/2;
        const y=PAD_TOP+areaH-barH;
        ctx.shadowColor="rgba(0,0,0,0.08)"; ctx.shadowBlur=4;
        ctx.fillStyle=cor;
        ctx.beginPath();
        if(ctx.roundRect) ctx.roundRect(x,y,barW,barH,[4,4,0,0]); else ctx.rect(x,y,barW,barH);
        ctx.fill(); ctx.shadowBlur=0;
        if(val>0){ctx.fillStyle="#1a3a5c";ctx.font="bold 9px Segoe UI, Arial";ctx.textAlign="center";ctx.fillText(formatarValor(val),x+barW/2,y-4);}
        ctx.fillStyle="#555"; ctx.font="10px Segoe UI, Arial"; ctx.textAlign="center";
        const lt=labels[idx].length>10?labels[idx].slice(0,10)+"…":labels[idx];
        ctx.save(); ctx.translate(x+barW/2,PAD_TOP+areaH+10); ctx.rotate(-0.4); ctx.fillText(lt,0,0); ctx.restore();
    });
}

function desenharBarrasHoriz(canvas, { labels, valores, cores, titulo, formatarValor }) {
    if (!canvas || labels.length === 0) return;
    const dpr=window.devicePixelRatio||1;
    const W=_canvasWidth(canvas);
    const barHeight=28, PAD_TOP=30, PAD_BOTTOM=10, PAD_LEFT=120, PAD_RIGHT=80;
    const H=PAD_TOP+labels.length*(barHeight+10)+PAD_BOTTOM;
    canvas.width=W*dpr; canvas.height=H*dpr;
    canvas.style.width=W+"px"; canvas.style.height=H+"px";
    canvas.setAttribute("height",H);
    const ctx=canvas.getContext("2d");
    ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
    const areaW=W-PAD_LEFT-PAD_RIGHT;
    const maxVal=Math.max(...valores,1);
    ctx.fillStyle="#1a3a5c"; ctx.font="bold 11px Segoe UI, Arial"; ctx.textAlign="center";
    ctx.fillText(titulo,W/2,16);
    labels.forEach((label,idx)=>{
        const val=valores[idx];
        const barW=(val/maxVal)*areaW;
        const y=PAD_TOP+idx*(barHeight+10);
        ctx.fillStyle=cores[idx%cores.length];
        ctx.shadowColor="rgba(0,0,0,0.07)"; ctx.shadowBlur=3;
        ctx.beginPath();
        if(ctx.roundRect) ctx.roundRect(PAD_LEFT,y,barW,barHeight,[0,4,4,0]); else ctx.rect(PAD_LEFT,y,barW,barHeight);
        ctx.fill(); ctx.shadowBlur=0;
        ctx.fillStyle="#333"; ctx.font="11px Segoe UI, Arial"; ctx.textAlign="right";
        const lt=label.length>14?label.slice(0,14)+"…":label;
        ctx.fillText(lt,PAD_LEFT-8,y+barHeight/2+4);
        if(val>0){ctx.fillStyle="#1a3a5c";ctx.font="bold 10px Segoe UI, Arial";ctx.textAlign="left";ctx.fillText(formatarValor(val),PAD_LEFT+barW+6,y+barHeight/2+4);}
    });
}

function desenharLinha(canvas, { labels, valores, cor, titulo, formatarValor }) {
    if (!canvas || labels.length < 2) return;
    const dpr=window.devicePixelRatio||1;
    const W=_canvasWidth(canvas);
    const H=parseInt(canvas.getAttribute("height"))||300;
    canvas.width=W*dpr; canvas.height=H*dpr;
    canvas.style.width=W+"px"; canvas.style.height=H+"px";
    const ctx=canvas.getContext("2d");
    ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
    const PAD_TOP=36,PAD_BOTTOM=60,PAD_LEFT=74,PAD_RIGHT=20;
    const areaW=W-PAD_LEFT-PAD_RIGHT, areaH=H-PAD_TOP-PAD_BOTTOM;
    const valsPos=valores.filter(v=>v>0);
    const maxVal=valsPos.length>0?Math.max(...valsPos):1;
    const minVal=valsPos.length>0?Math.min(...valsPos):0;
    const escalaMax=maxVal*1.12, escalaMin=Math.max(0,minVal*0.88);
    const escalaRange=escalaMax-escalaMin||1;
    const n=labels.length, xStep=areaW/(n-1);
    ctx.fillStyle="#1a3a5c"; ctx.font="bold 11px Segoe UI, Arial"; ctx.textAlign="center";
    ctx.fillText(titulo,W/2,18);
    ctx.strokeStyle="#e0e8f0"; ctx.lineWidth=1;
    for(let i=0;i<=5;i++){
        const y=PAD_TOP+(areaH/5)*i;
        ctx.beginPath(); ctx.moveTo(PAD_LEFT,y); ctx.lineTo(PAD_LEFT+areaW,y); ctx.stroke();
        const vY=escalaMax-(escalaRange/5)*i;
        ctx.fillStyle="#999"; ctx.font="9px Segoe UI, Arial"; ctx.textAlign="right";
        ctx.fillText(formatarValor(vY),PAD_LEFT-6,y+4);
    }
    ctx.strokeStyle="#aac"; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(PAD_LEFT,PAD_TOP); ctx.lineTo(PAD_LEFT,PAD_TOP+areaH); ctx.lineTo(PAD_LEFT+areaW,PAD_TOP+areaH); ctx.stroke();
    const pontos=valores.map((val,idx)=>({
        x:PAD_LEFT+idx*xStep,
        y:val>0?PAD_TOP+areaH-((val-escalaMin)/escalaRange)*areaH:PAD_TOP+areaH
    }));
    ctx.beginPath(); ctx.moveTo(pontos[0].x,PAD_TOP+areaH);
    pontos.forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.lineTo(pontos[pontos.length-1].x,PAD_TOP+areaH);
    ctx.closePath(); ctx.fillStyle=cor+"22"; ctx.fill();
    ctx.beginPath(); ctx.strokeStyle=cor; ctx.lineWidth=2.5; ctx.lineJoin="round";
    pontos.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
    ctx.stroke();
    pontos.forEach((p,idx)=>{
        const val=valores[idx];
        ctx.beginPath(); ctx.arc(p.x,p.y,5,0,Math.PI*2);
        ctx.fillStyle="white"; ctx.fill(); ctx.strokeStyle=cor; ctx.lineWidth=2; ctx.stroke();
        if(val>0){ctx.fillStyle="#1a3a5c";ctx.font="bold 9px Segoe UI, Arial";ctx.textAlign="center";ctx.fillText(formatarValor(val),p.x,p.y-10);}
        ctx.fillStyle="#555"; ctx.font="10px Segoe UI, Arial"; ctx.textAlign="center";
        ctx.save(); ctx.translate(p.x,PAD_TOP+areaH+10); ctx.rotate(-0.4); ctx.fillText(labels[idx],0,0); ctx.restore();
    });
}