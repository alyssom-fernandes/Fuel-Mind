/*=================================================
  DASHBOARD v3.2
  - KPIs com filtro de período (inputs + botões rápidos)
  - Duas bases, cada bloco com a sua (rodada 11): volume pela descarga,
    compra pela emissão
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

function _mediaVolumePorNota(nomeCombustivel, idIgnorar) {
    const volumes = db.lancamentos
        .filter(l => lancamentoAtivo(l) && (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal)
                  && (!idIgnorar || l.id !== idIgnorar))
        .flatMap(l => l.itens.filter(i => i.tipo === nomeCombustivel && i.qtd > 0))
        .map(i => i.qtd);
    if (volumes.length === 0) return 0;
    return volumes.reduce((s, v) => s + v, 0) / volumes.length;
}

// ─── Filtros rápidos do Dashboard ───────────────────────────────────────────
// Datas pelo relógio do computador: `toISOString` é UTC e, no horário de
// Brasília, vira o dia seguinte a partir das 21h.
function dashFiltroRapido(periodo) {
    const hoje = new Date();
    let inicio, fim;
    if (periodo === 'mes') {
        inicio = _isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
        fim    = _hojeISO();
    } else if (periodo === 'mes_anterior') {
        inicio = _isoLocal(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1));
        fim    = _isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 0));
    } else if (periodo === 'ano') {
        inicio = `${hoje.getFullYear()}-01-01`;
        fim    = _hojeISO();
    }
    const i = document.getElementById('dashInicio');
    const f = document.getElementById('dashFim');
    if (i) i.value = inicio;
    if (f) f.value = fim;
    recalcularTela('dashboard', carregarDashboard);
}

// ─── Garante filtros de período no DOM (cria se ainda não existir) ───────────
function _garantirFiltrosDashboard() {
    if (document.getElementById('dashFiltrosPeriodo')) return;

    const hoje = new Date();
    const inicioMesStr = _isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    const fimHojeStr   = _hojeISO();

    const filtrosDiv = document.createElement('div');
    filtrosDiv.id = 'dashFiltrosPeriodo';
    filtrosDiv.className = 'dash-filtros';
    filtrosDiv.innerHTML = `
        <div class="campo campo-data">
            <label for="dashInicio">Período — início</label>
            <input type="date" id="dashInicio" value="${inicioMesStr}" onchange="recalcularTela('dashboard', carregarDashboard)">
        </div>
        <div class="campo campo-data">
            <label for="dashFim">Período — fim</label>
            <input type="date" id="dashFim" value="${fimHojeStr}" onchange="recalcularTela('dashboard', carregarDashboard)">
        </div>
        <div class="dash-filtros-rapidos">
            <span class="filtros-rapidos-sep">Rápido:</span>
            <button class="btn-filtro-rapido" onclick="dashFiltroRapido('mes')">Este mês</button>
            <button class="btn-filtro-rapido" onclick="dashFiltroRapido('mes_anterior')">Mês anterior</button>
            <button class="btn-filtro-rapido" onclick="dashFiltroRapido('ano')">Este ano</button>
        </div>
    `;
    // A tela mostra as duas bases, e diz qual é qual logo abaixo do período.
    const dica = document.createElement('p');
    dica.id = 'dashBaseDica';
    dica.className = 'dica dica--pequena mb-5';
    dica.innerHTML = 'Notas e litros <strong>descarregados</strong> contam pela <strong>data da descarga</strong> — '
        + 'é o que entrou nos tanques. Gasto e preço médio contam pela <strong>data de emissão</strong> e sobre os '
        + '<strong>litros faturados</strong> na nota — é o preço que o fornecedor cobrou. Quando a descarga foi '
        + 'informada, o custo por litro recebido aparece ao lado, dizendo em quantas notas ele se apoia.';

    const dashEl = document.getElementById('dashboard');
    const kpiEl  = document.getElementById('kpiDashboard');
    if (dashEl && kpiEl) {
        dashEl.insertBefore(filtrosDiv, kpiEl);
        dashEl.insertBefore(dica, kpiEl);
    }
}

/* O Dashboard mostra as duas bases, cada bloco com a sua (rodada 11, decisão
   do dono). A regra é não misturar dentro de um número: o custo médio divide
   o gasto pelos litros DAS MESMAS notas, as emitidas no período. Com os reais
   da emissão e os litros da descarga, agosto no modo demo dava R$ 5,7232/L —
   um preço que não é de nota nenhuma. */
function _lancamentosDoPeriodo(inicio, fim, dataDe) {
    return db.lancamentos.filter(l => {
        if (!lancamentoAtivo(l)) return false;
        if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
        const d = dataDe(l);
        return d >= inicio && d <= fim;
    });
}

function _totaisCompra(lancs, nomeComb) {
    const itens = lancs.flatMap(l => l.itens.filter(i => !nomeComb || i.tipo === nomeComb));
    const m     = metricasPreco(itens);
    const notas = nomeComb ? lancs.filter(l => l.itens.some(i => i.tipo === nomeComb)).length : lancs.length;
    // `custo` é o preço médio de compra (sobre a carga faturada), decisão de
    // 17/09/2026. `litros` aqui são os FATURADOS, os mesmos do denominador —
    // quem dividir um pelo outro chega ao número mostrado ao lado.
    return {
        gasto: m.gasto, litros: m.litrosNota, notas,
        custo: m.precoCompra,
        litrosRecebidos: m.litrosRecebidos, custoRecebido: m.custoRecebido,
        itensMedidos: m.itensMedidos, itensTotal: m.itensTotal,
        metricas: m
    };
}

/* ── FRETE NO DASHBOARD (17/09/2026) ────────────────────────────────
   O objetivo da ferramenta é controle de frete, e nem a palavra "frete"
   aparecia nas duas telas de número. O cálculo é o mesmo da tela de
   Fretes: quantidade da nota (a carga, decisão do dono) vezes a taxa que
   valia na data da descarga. */
function _freteDoPeriodo(lancsPorDescarga) {
    let total = 0, litros = 0, semTaxa = 0;
    (lancsPorDescarga || []).forEach(l => {
        const emp  = db.empresas.find(e => e.id === (typeof _empresaIdDoLancamento === 'function' ? _empresaIdDoLancamento(l) : null))
                  || db.empresas.find(e => e.nome === l.empresa) || null;
        const taxa = typeof _taxaFreteDaEmpresaNaData === 'function'
            ? _taxaFreteDaEmpresaNaData(emp, dataDescargaDe(l))
            : 0;
        if (!(taxa > 0)) semTaxa++;
        (l.itens || []).forEach(i => {
            const q = Number(i.qtd) || 0;
            litros += q;
            total  += q * taxa;
        });
    });
    return { total, litros, semTaxa, porLitro: litros > 0 ? total / litros : 0 };
}

function carregarDashboard() {
    _garantirFiltrosDashboard();

    const hoje = new Date();
    const inputI = document.getElementById('dashInicio');
    const inputF = document.getElementById('dashFim');
    const inicio = inputI?.value || _isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    const fim    = inputF?.value || _hojeISO();

    // "Mostrar os outros alertas" vale só para o período em que foi pedido.
    const elAlertas = document.getElementById("alertasDashboard");
    if (elAlertas && elAlertas.dataset.periodo !== `${inicio}|${fim}`) {
        elAlertas.dataset.periodo = `${inicio}|${fim}`;
        elAlertas.dataset.todos   = "";
    }

    // O Dashboard não tem funil único como as outras telas: são várias
    // leituras independentes de db.lancamentos, e cada uma repete o teste de
    // estado. Aqui são dois conjuntos, um por base.
    const lancDescarga = _lancamentosDoPeriodo(inicio, fim, dataDescargaDe);
    const lancEmissao  = _lancamentosDoPeriodo(inicio, fim, dataEmissaoDe);

    const totalNotas  = lancDescarga.length;
    const totalLitros = lancDescarga.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0);
    const compra      = _totaisCompra(lancEmissao);
    const frete       = _freteDoPeriodo(lancDescarga);

    // O mesmo recorte no período anterior, para cada card dizer se subiu
    // ou desceu (18/09/2026). Cada número compara com a MESMA base de data.
    const antK         = _periodoAnterior(inicio, fim);
    const rotAnt       = `${formatarData(antK.inicio).slice(0, 5)} a ${formatarData(antK.fim).slice(0, 5)}`;
    const descAnt      = _lancamentosDoPeriodo(antK.inicio, antK.fim, dataDescargaDe);
    const emisAnt      = _lancamentosDoPeriodo(antK.inicio, antK.fim, dataEmissaoDe);
    const litrosAnt    = descAnt.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0);
    const compraAntK   = _totaisCompra(emisAnt);
    const freteAnt     = _freteDoPeriodo(descAnt);

    document.getElementById("kpiDashboard").innerHTML = `
        <div class="kpi-card kpi-clicavel" onclick="mostrarTela('fretes')" title="Abre o Resumo de Fretes, que também conta pela data da descarga.">
            <div class="kpi-valor">${totalNotas}</div>
            <div class="kpi-label">Notas Descarregadas</div>
            <div class="kpi-base">pela data da descarga</div>
            ${htmlVariacao(totalNotas, descAnt.length, rotAnt, false)}
        </div>
        <div class="kpi-card verde kpi-clicavel" onclick="mostrarTela('fretes')" title="Abre o Resumo de Fretes, que também conta pela data da descarga.">
            <div class="kpi-valor">${fmtL(totalLitros)}</div>
            <div class="kpi-label">Litros Descarregados</div>
            <div class="kpi-base">pela data da descarga</div>
            ${htmlVariacao(totalLitros, litrosAnt, rotAnt, false)}
        </div>
        <div class="kpi-card laranja kpi-clicavel" onclick="irParaRelatorioFiltrado({inicio:'${inicio}', fim:'${fim}'})" title="Abre o Relatório com este mesmo período — que lá também é pela emissão.">
            <div class="kpi-valor">${fmtR(compra.gasto)}</div>
            <div class="kpi-label">Gasto em Compras</div>
            <div class="kpi-base">pela data de emissão · ${compra.notas} ${compra.notas === 1 ? 'nota' : 'notas'}</div>
            ${htmlVariacao(compra.gasto, compraAntK.gasto, rotAnt, true)}
        </div>
        <div class="kpi-card roxo kpi-clicavel" onclick="irParaRelatorioFiltrado({inicio:'${inicio}', fim:'${fim}'})" title="${escapeHtml(explicacaoPrecoCompra(compra.metricas))}">
            <div class="kpi-valor">${fmtR4(compra.custo)}</div>
            <div class="kpi-label">Preço Médio de Compra / L</div>
            <div class="kpi-base">pela data de emissão · ${fmtL(compra.litros)} faturados</div>
            ${htmlVariacao(compra.custo, compraAntK.custo, rotAnt, true)}
            ${compra.custoRecebido > 0 ? `<div class="kpi-base" title="Valor das notas com descarga informada ÷ litros medidos na descarga.">${escapeHtml(textoCustoRecebido(compra.metricas))}</div>` : ''}
        </div>
        <div class="kpi-card kpi-clicavel" onclick="mostrarTela('fretes')" title="Quantidade das notas descarregadas no período vezes a taxa que valia na data de cada descarga. Detalhe por placa, motorista, empresa e conjunto na tela Fretes.">
            <div class="kpi-valor">${fmtR(frete.total)}</div>
            <div class="kpi-label">Frete do Período</div>
            <div class="kpi-base">pela data da descarga · ${fmtR4(frete.porLitro)}/L</div>
            ${htmlVariacao(frete.total, freteAnt.total, rotAnt, true)}
            ${frete.semTaxa ? `<div class="kpi-base kpi-base--alerta">${frete.semTaxa} nota(s) sem taxa</div>` : ''}
        </div>
    `;

    if (typeof injetarIconesKPI === 'function') injetarIconesKPI();
    _renderAlertas(lancDescarga, lancEmissao);
    renderDashCombustiveis(lancDescarga, lancEmissao, inicio, fim);
    renderComparativoMeses();
    // Destrói pizza anterior para redesenhar com período correto
    const pizzaAnterior = document.getElementById('graficoPizzaDashboard');
    if (pizzaAnterior) pizzaAnterior.remove();
    renderGraficoPizzaDashboard(lancEmissao);

    // "Últimas Entradas": o que entrou nos tanques por último, pela descarga.
    const ultimas = [...db.lancamentos]
        .filter(l => lancamentoAtivo(l) && (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal))
        .sort((a, b) => dataDescargaDe(b).localeCompare(dataDescargaDe(a)))
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
                <td class="celula-num">${totalLitros.toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits:0})}</td>
                <td>${fmtR(l.total)}</td>
                <td class="no-print">
                    <button class="btn-secundario" data-id="${l.id}" onclick="_verDetalheDashboard(this.dataset.id)">Ver</button>
                </td>
            </tr>`;
        }).join('');
}

/* ── PRÉ-ÍNDICE DOS ALERTAS (18/09/2026) ────────────────────────────
   Cada item do período chamava `referenciaPrecoCombustivel` e
   `_mediaVolumePorNota`, e cada uma dessas varria o vetor inteiro de
   lançamentos — todas as empresas, todos os meses — para achar meia dúzia
   de notas. Com um período de seis meses isso eram centenas de varreduras
   completas por abertura do Dashboard.

   Aqui o vetor é varrido UMA vez: as notas de cada empresa e combustível
   ficam separadas, na mesma ordem do banco. As duas perguntas continuam
   com a mesma regra e a mesma ordem de soma e de ordenação — por isso o
   resultado é idêntico (conferido lado a lado em 12 casos antes da
   troca), só que perguntado a uma lista curta. */
function _criarIndiceAlertas() {
    const cfg = configAlertas();
    const precos  = new Map();   // "empresa|combustível" -> [{ e, v, id }]
    const volumes = new Map();   // "combustível"          -> [{ q, id }]
    (db.lancamentos || []).forEach(l => {
        if (!lancamentoAtivo(l)) return;
        const emissao = dataEmissaoDe(l);
        const daAtiva = !empresaFiltroGlobal || l.empresa === empresaFiltroGlobal;
        (l.itens || []).forEach(i => {
            if (i.valor > 0) {
                const k = `${l.empresa}|${i.tipo}`;
                if (!precos.has(k)) precos.set(k, []);
                precos.get(k).push({ e: emissao, v: i.valor, id: l.id });
            }
            if (daAtiva && i.qtd > 0) {
                if (!volumes.has(i.tipo)) volumes.set(i.tipo, []);
                volumes.get(i.tipo).push({ q: i.qtd, id: l.id });
            }
        });
    });
    return {
        // Mesma regra de `referenciaPrecoCombustivel` (utils.js).
        refPreco(comb, fimISO, idIgnorar, empresa) {
            const empresaRegua = empresa || empresaFiltroGlobal;
            const dias   = cfg.precoPeriodoDias;
            const fim    = fimISO || _hojeISO();
            const inicio = _somarDiasISO(fim, -(Math.max(1, dias) - 1));
            // Sem empresa nenhuma a régua junta todas, como na função original.
            const lista  = empresaRegua
                ? (precos.get(`${empresaRegua}|${comb}`) || [])
                : [...precos.entries()].filter(([k]) => k.endsWith(`|${comb}`)).flatMap(([, v]) => v);
            const vals = lista.filter(x => (!idIgnorar || x.id !== idIgnorar) && x.e >= inicio && x.e <= fim)
                              .map(x => x.v).sort((a, b) => a - b);
            if (!vals.length) return { mediana: 0, amostras: 0, dias, fim };
            const meio = Math.floor(vals.length / 2);
            const mediana = vals.length % 2 ? vals[meio] : (vals[meio - 1] + vals[meio]) / 2;
            return { mediana, amostras: vals.length, dias, fim };
        },
        // Mesma regra de `_mediaVolumePorNota`.
        mediaVolume(comb, idIgnorar) {
            const vols = (volumes.get(comb) || []).filter(x => !idIgnorar || x.id !== idIgnorar).map(x => x.q);
            if (!vols.length) return 0;
            return vols.reduce((s2, v) => s2 + v, 0) / vols.length;
        }
    };
}

function _renderAlertas(lancDescarga, lancEmissao) {
    const indice    = _criarIndiceAlertas();
    const cfg       = configAlertas();
    const ignorados = alertasIgnorados();
    const hoje      = new Date(); hoje.setHours(0,0,0,0);
    const alertas   = [];

    // Preço: notas EMITIDAS no período, cada uma julgada pela mesma régua do
    // lançamento — mediana dos dias que terminam na emissão dela, sem ela
    // mesma, para cima ou para baixo (`referenciaPrecoCombustivel` e
    // `julgarPreco`, em utils.js). Volume e data suspeita: notas
    // DESCARREGADAS no período.
    lancEmissao.forEach(l => {
        l.itens.forEach(i => {
            // Pelo id da nota: pelo número, confirmar o alerta de uma nota calava
            // o de outra nota com o mesmo número (outra empresa, outro fornecedor).
            const chavePreco = `preco|${l.id}|${i.tipo}`;
            if (!cfg.precoAtivo || !(i.valor > 0) || ignorados[chavePreco]) return;
            const ref   = indice.refPreco(i.tipo, dataEmissaoDe(l), l.id, l.empresa);
            const juizo = julgarPreco(i.valor, ref.mediana);
            if (!juizo) return;
            const sentido = juizo.acima ? 'acima' : 'abaixo';
            const difTxt  = fmtR4(Math.abs(juizo.diferenca));
            alertas.push({
                tipo: 'preco', chave: chavePreco,
                icone: '', cor: 'laranja',
                titulo: `Preço ${juizo.acima ? 'alto' : 'baixo'} — ${escapeHtml(i.tipo)}`,
                msg: `Nota <strong>${escapeHtml(l.numeroNota)}</strong> (${formatarData(l.dataNota)}): ` +
                     `<strong>${fmtR4(i.valor)}/L</strong> — ` +
                     `${difTxt.replace(' ', '&nbsp;')}/L ${sentido} da referência dos ${ref.dias} dias até a emissão ` +
                     `(${fmtR4(ref.mediana)}/L, ${ref.amostras} ${ref.amostras === 1 ? 'nota' : 'notas'})`,
                id: l.id,
                notificacao: `Preço ${juizo.acima ? 'alto' : 'baixo'} em ${l.numeroNota}: ${fmtR4(i.valor)}/L (${difTxt}/L ${sentido} da referência)`
            });
        });
    });

    lancDescarga.forEach(l => {
        l.itens.forEach(i => {
            const chaveVol   = `vol|${l.id}|${i.tipo}`;
            if (cfg.volumeAtivo && i.qtd > 0 && !ignorados[chaveVol]) {
                const mediaVol = indice.mediaVolume(i.tipo, l.id);
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
            const chaveData = `data|${l.id}`;
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

    // Poucos por vez, os mais graves primeiro (18/09/2026). Com seis meses no
    // filtro a tela desenhava mais de 300 cartões: é custo de desenho e,
    // pior, é ruído — alerta demais ensina a não ler alerta nenhum. Data
    // suspeita antes de preço e de volume; o resto fica atrás de um botão,
    // com a contagem por tipo, e nada some sem aviso.
    const ordemTipo = { data: 0, preco: 1, volume: 2 };
    alertas.sort((a, b) => (ordemTipo[a.tipo] ?? 9) - (ordemTipo[b.tipo] ?? 9));
    const LIMITE = 12;
    const mostrarTodos = el.dataset.todos === "1";
    const visiveis = mostrarTodos ? alertas : alertas.slice(0, LIMITE);
    const escondidos = alertas.length - visiveis.length;
    const porTipo = alertas.reduce((acc, a) => { acc[a.tipo] = (acc[a.tipo] || 0) + 1; return acc; }, {});
    const nomesTipo = { data: "data suspeita", preco: "preço", volume: "volume" };
    const resumoTipos = Object.entries(porTipo).map(([t, n]) => `${n} de ${nomesTipo[t] || t}`).join(", ");

    el.innerHTML = `<p class="dica alertas-resumo">${alertas.length} alerta(s) no período: ${escapeHtml(resumoTipos)}.</p>` + visiveis.map(a => {
        const { icone, cor, titulo, msg, chave, id, confirmarLabel } = a;
        return `
        <div class="alerta-card alerta-card--${cor} alerta-clicavel">
            <div class="alerta-corpo"
                 onclick="editarLancamento('${escapeJsAttr(id)}')"
                 title="Clique para editar o lançamento">
                ${icone} <strong class="alerta-titulo">${titulo}</strong> —
                <span class="alerta-msg">${msg}</span>
                <span class="alerta-link">Ver →</span>
            </div>
            <button class="alerta-ignorar"
                    onclick="ignorarAlerta('${escapeJsAttr(chave)}'); carregarDashboard();"
                    title="Marcar como verificado e não exibir mais">
                ✓ ${confirmarLabel || 'Confirmar'}
            </button>
        </div>`;
    }).join('') + (escondidos > 0
        ? `<button class="btn-secundario alertas-mais" onclick="dashAlternarAlertas(true)">Mostrar os outros ${escondidos} alerta(s)</button>`
        : (mostrarTodos && alertas.length > LIMITE
            ? `<button class="btn-secundario alertas-mais" onclick="dashAlternarAlertas(false)">Mostrar só os ${LIMITE} primeiros</button>`
            : ""));
}

// Mostrar todos vale só para o período em que foi pedido: `carregarDashboard`
// volta ao limite quando o período muda.
function dashAlternarAlertas(todos) {
    const el = document.getElementById("alertasDashboard");
    if (!el) return;
    el.dataset.todos = todos ? "1" : "";
    carregarDashboard();
}

function renderDashCombustiveis(lancDescarga, lancEmissao, inicio, fim) {
    const container = document.getElementById("dashCombustiveisContainer");
    if (!container) return;

    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);
    if (combustiveis.length === 0) {
        container.innerHTML = '<p class="dica">Cadastre combustíveis para ver o detalhamento.</p>';
        return;
    }

    if (lancDescarga.length === 0 && lancEmissao.length === 0) {
        container.innerHTML = '<p class="dica">Nenhum lançamento no período selecionado.</p>';
        return;
    }

    if (!dashAbaAtiva || !combustiveis.find(c => c.nome === dashAbaAtiva)) {
        dashAbaAtiva = combustiveis[0].nome;
    }

    // A variação compara com o período anterior ao ESCOLHIDO, e não com o
    // mês anterior a hoje: com agosto escolhido em setembro, comparava agosto
    // com agosto e mostrava "▲ 0.1%" onde a variação real era +1,4 %.
    const anterior     = _periodoAnterior(inicio, fim);
    const lancAnterior = _lancamentosDoPeriodo(anterior.inicio, anterior.fim, dataEmissaoDe);

    const resumo = {};
    combustiveis.forEach(c => {
        const itensDesc = lancDescarga.flatMap(l => l.itens.filter(i => i.tipo === c.nome));
        resumo[c.nome] = {
            notasDescarga: lancDescarga.filter(l => l.itens.some(i => i.tipo === c.nome)).length,
            litros:        itensDesc.reduce((s, i) => s + _litrosItem(i), 0),
            compra:        _totaisCompra(lancEmissao, c.nome),
            compraAnt:     _totaisCompra(lancAnterior, c.nome),
        };
    });

    const abas = combustiveis.map(c => `
        <button class="aba-btn ${c.nome === dashAbaAtiva ? 'ativa' : ''}">
            ${escapeHtml(c.nome)}
            ${resumo[c.nome].litros > 0 ? `<span class="badge-aba">${fmtL(resumo[c.nome].litros)}</span>` : ''}
        </button>
    `).join('');

    const desenhar = () => _renderConteudoCombustivel(dashAbaAtiva, resumo[dashAbaAtiva], lancDescarga, anterior);

    container.innerHTML = `
        <div class="analitico-abas mb-3">${abas}</div>
        <div id="dashCombConteudo">${desenhar()}</div>
    `;

    // Liga o clique de cada aba pelo índice (evita ambiguidade entre nomes de
    // combustível que compartilham prefixo, ex: "Diesel" e "Diesel S10").
    container.querySelectorAll('.aba-btn').forEach((btn, idx) => {
        btn.onclick = function() {
            dashAbaAtiva = combustiveis[idx].nome;
            container.querySelectorAll('.aba-btn').forEach(b => b.classList.remove('ativa'));
            this.classList.add('ativa');
            document.getElementById('dashCombConteudo').innerHTML = desenhar();
        };
    });
}

function _renderConteudoCombustivel(nomeComb, r, lancDescarga, anterior) {
    if (!r || (r.litros === 0 && r.compra.notas === 0)) {
        return `<p class="dica">Nenhum lançamento de <strong>${escapeHtml(nomeComb)}</strong> no período.</p>`;
    }

    let variacaoHTML = '';
    if (r.compra.custo > 0 && r.compraAnt.custo > 0) {
        const vp    = ((r.compra.custo - r.compraAnt.custo) / r.compraAnt.custo) * 100;
        const sinal = vp > 0 ? '▲' : '▼';
        const cls   = vp > 0 ? 'danger' : 'success';
        const ref   = `${formatarData(anterior.inicio).slice(0, 5)} a ${formatarData(anterior.fim).slice(0, 5)}`;
        variacaoHTML = `<span class="variacao-mini variacao-mini--${cls}" title="Preço médio de compra das notas emitidas de ${formatarData(anterior.inicio)} a ${formatarData(anterior.fim)}: ${fmtR4(r.compraAnt.custo)}/L">${sinal} ${Math.abs(vp).toFixed(1).replace('.', ',')}% vs ${ref}</span>`;
    }

    const lancsComb = lancDescarga
        .filter(l => l.itens.some(i => i.tipo === nomeComb))
        .sort((a, b) => dataDescargaDe(b).localeCompare(dataDescargaDe(a)))
        .slice(0, 10);

    const tabelaHTML = lancsComb.length === 0 ? '' : `
        <div class="tabela-container mt-3">
            <table><thead><tr>
                <th>Descarga</th><th>Nota</th><th>Motorista</th>
                <th>Qtd (L)</th><th>R$/L</th><th>Total</th>
            </tr></thead><tbody>
            ${lancsComb.map(l => {
                const item = l.itens.find(i => i.tipo === nomeComb);
                return `<tr>
                    <td>${formatarData(dataDescargaDe(l))}</td>
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
                <div class="dash-comb-kpi-val">${r.notasDescarga}</div>
                <div class="dash-comb-kpi-label">Notas descarregadas</div>
            </div>
            <div class="dash-comb-kpi verde">
                <div class="dash-comb-kpi-val">${fmtL(r.litros)}</div>
                <div class="dash-comb-kpi-label">Litros descarregados</div>
            </div>
            <div class="dash-comb-kpi laranja">
                <div class="dash-comb-kpi-val">${fmtR(r.compra.gasto)}</div>
                <div class="dash-comb-kpi-label">Gasto · pela emissão</div>
            </div>
            <div class="dash-comb-kpi roxo" title="${escapeHtml(explicacaoPrecoCompra(r.compra.metricas))}">
                <div class="dash-comb-kpi-val">${fmtR4(r.compra.custo)}</div>
                <div class="dash-comb-kpi-label">Preço médio/L · faturado, pela emissão ${variacaoHTML}</div>
                ${r.compra.custoRecebido > 0 ? `<div class="dash-comb-kpi-label dash-comb-kpi-label--nota">${escapeHtml(textoCustoRecebido(r.compra.metricas))}</div>` : ''}
            </div>
        </div>
        ${lancsComb.length ? `<div class="mt-1">
            <span class="dica dica--pequena">
                Últimas descargas de <strong>${escapeHtml(nomeComb)}</strong> no período
            </span>
        </div>` : ''}
        ${tabelaHTML}`;
}

/* Duas tabelas, uma por base. Numa só — litros pela descarga e custo pela
   emissão na mesma linha — quem dividisse o gasto pelos litros da linha
   chegaria a um custo diferente do que está ao lado. Na tabela de compras,
   os litros são os das notas emitidas no mês, e o custo é essa divisão. */
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

    const doMes = (mes, dataDe) => db.lancamentos.filter(l => {
        if (!lancamentoAtivo(l)) return false;
        if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
        return dataDe(l).startsWith(mes);
    });

    const mesAtual = meses[meses.length - 1];

    const linhasDescarga = meses.map(mes => {
        const lans = doMes(mes, dataDescargaDe);
        const porComb = combustiveis.map(c =>
            lans.flatMap(l => l.itens.filter(i => i.tipo === c.nome)).reduce((s, i) => s + _litrosItem(i), 0));
        const total = porComb.reduce((s, v) => s + v, 0);
        return `<tr ${mes === mesAtual ? 'class="linha-mes-atual"' : ''}>
            <td><strong>${nomeMes(mes)}</strong></td>
            ${porComb.map(v => `<td>${v > 0 ? fmtL(v) : '—'}</td>`).join('')}
            <td><strong>${fmtL(total)}</strong></td>
        </tr>`;
    }).join('');

    const linhasCompra = meses.map(mes => {
        const c = _totaisCompra(doMes(mes, dataEmissaoDe));
        return `<tr ${mes === mesAtual ? 'class="linha-mes-atual"' : ''}>
            <td><strong>${nomeMes(mes)}</strong></td>
            <td>${c.notas}</td>
            <td>${c.litros > 0 ? fmtL(c.litros) : '—'}</td>
            <td>${fmtR(c.gasto)}</td>
            <td>${c.custo > 0 ? fmtR4(c.custo) : '—'}</td>
        </tr>`;
    }).join('');

    const combHeaders = combustiveis.map(c => `<th>${escapeHtml(c.nome)}</th>`).join('');

    // Uma linha responde "está subindo ou caindo" melhor que doze números;
    // as tabelas ficam logo abaixo, para quem confere valor a valor
    // (18/09/2026).
    const serieLitros = meses.map(mes => doMes(mes, dataDescargaDe)
        .reduce((s, l) => s + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0));
    const serieCompra = meses.map(mes => _totaisCompra(doMes(mes, dataEmissaoDe)).gasto);

    container.innerHTML = `
        <div class="grafico-wrapper grafico-wrapper--comparativo"><canvas id="graficoComparativoDash"></canvas></div>
        <p class="dica dica--pequena dica--legenda">Litros descarregados — pela <strong>data da descarga</strong></p>
        <div class="tabela-container mb-5">
            <table>
                <thead><tr><th>Mês</th>${combHeaders}<th>Total Litros</th></tr></thead>
                <tbody>${linhasDescarga}</tbody>
            </table>
        </div>
        <p class="dica dica--pequena dica--legenda">Compras — pela <strong>data de emissão</strong>, com os litros <strong>faturados</strong> na nota</p>
        <div class="tabela-container">
            <table>
                <thead><tr><th>Mês</th><th>Notas</th><th>Litros Faturados</th><th>Total Gasto</th><th>Preço Médio/L</th></tr></thead>
                <tbody>${linhasCompra}</tbody>
            </table>
        </div>`;

    if (typeof Chart !== "undefined") {
        const cores = getChartColors();
        if (window._chartComparativoDash) window._chartComparativoDash.destroy();
        window._chartComparativoDash = new Chart(document.getElementById("graficoComparativoDash").getContext("2d"), {
            type: "line",
            data: {
                labels: meses.map(nomeMes),
                datasets: [
                    { label: "Litros descarregados", data: serieLitros, yAxisID: "yL",
                      borderColor: cores.success, backgroundColor: "transparent", tension: 0.25, pointRadius: 3 },
                    { label: "Gasto em compras (R$)", data: serieCompra, yAxisID: "yR",
                      borderColor: cores.primary, backgroundColor: "transparent", tension: 0.25, pointRadius: 3, borderDash: [5, 4] }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { labels: { color: cores.text } },
                    tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === "yR"
                        ? `${ctx.dataset.label}: ${fmtR(ctx.raw)}` : `${ctx.dataset.label}: ${fmtL(ctx.raw)}` } }
                },
                scales: {
                    x:  { ticks: { color: cores.text }, grid: { color: cores.grid } },
                    yL: { position: "left",  ticks: { color: cores.text, callback: v => fmtL(v) }, grid: { color: cores.grid } },
                    yR: { position: "right", ticks: { color: cores.text, callback: v => fmtR(v) }, grid: { display: false } }
                }
            }
        });
    }
}

function renderGraficoPizzaDashboard(lancamentosMes) {
    // Se não foi passado o array, usa o período do mês atual como fallback
    if (!lancamentosMes) {
        const hoje = new Date();
        const inicioMesStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
        lancamentosMes = db.lancamentos.filter(l => {
            if (!lancamentoAtivo(l)) return false;
            if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
            return dataEmissaoDe(l) >= inicioMesStr;
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

    if (dados.length === 0) {
        // Antes a função saía sem desenhar nada, e quem olhava a tela não
        // sabia se o gráfico não carregou ou se não havia gasto (17/09/2026).
        const aviso = document.createElement("div");
        aviso.id = "graficoPizzaDashboard";
        aviso.className = "mt-7";
        aviso.innerHTML = `<h3>Distribuição de Gastos no Período <small class="titulo-nota">· pela data de emissão</small></h3>
            <p class="grafico-vazio">Nenhuma compra emitida neste período.</p>`;
        const compar = document.getElementById("dashComparativoContainer");
        if (compar) compar.insertAdjacentElement("afterend", aviso);
        return;
    }

    const pizzaContainer = document.createElement('div');
    pizzaContainer.id = 'graficoPizzaDashboard';
    pizzaContainer.className = 'mt-7';
    pizzaContainer.innerHTML = `
        <h3>Distribuição de Gastos no Período <small class="titulo-nota">· pela data de emissão</small></h3>
        <div class="grafico-wrapper grafico-wrapper--pizza">
            <canvas id="canvasPizzaDash" height="220"></canvas>
        </div>`;

    const comparativo = document.getElementById("dashComparativoContainer");
    if (comparativo) comparativo.insertAdjacentElement('afterend', pizzaContainer);

    const canvas = document.getElementById('canvasPizzaDash');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window._dashPizzaChart) { window._dashPizzaChart.destroy(); window._dashPizzaChart = null; }
    const colors = getChartColors();
    // Cor fixa por combustível, a mesma de todas as telas (18/09/2026).
    const backgroundColors = dados.map(d => corDoCombustivel(d.nome));

    window._dashPizzaChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: dados.map(d => d.nome),
            datasets: [{
                data: dados.map(d => d.valor),
                backgroundColor: backgroundColors,
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
        <div class="modal modal--detalhe">
            <h3 class="mt-0 mb-4">Detalhes da Entrada</h3>
            ${conteudo}
            <div class="modal-acoes mt-4">

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
