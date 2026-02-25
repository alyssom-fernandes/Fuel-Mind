/*=================================================
  ESTOQUE — FASE 7
  Lógica: para cada combustível, para cada dia,
  calcula:
    Estoque = EstoqueAnterior + Entrada − Saída − Evaporação
  Entrada: soma dos qtdDescargada (ou qtd se não houver)
           dos lançamentos daquele combustível naquele dia
  Saída: digitada manualmente
  Evaporação: EstoqueAnterior × (% perda / 100)
  Veeder-Root: digitado manualmente
  Diferença: Estoque Calculado − Veeder
=================================================*/

/* ── Aba ativa no estoque ─────────────────────── */
let estoqueAbaAtiva = null;

/* ── Abrir tela de estoque ───────────────────────
   Chamado por mostrarTela("estoque") via app.js  */
function carregarEstoque() {
    const combustiveis = db.combustiveis;

    // Garante que db.medicoes existe
    if (!db.medicoes) { db.medicoes = {}; salvarDB(); }
    // Garante que db.estoqueInicial existe
    if (!db.estoqueInicial) { db.estoqueInicial = {}; salvarDB(); }

    const container = document.getElementById("estoqueAbas");
    const conteudo  = document.getElementById("estoqueConteudo");

    if (combustiveis.length === 0) {
        container.innerHTML = "";
        conteudo.innerHTML  = `<p class="dica" style="padding:20px">Nenhum combustível cadastrado. Vá em <strong>Combustíveis</strong> e cadastre primeiro.</p>`;
        return;
    }

    // Monta abas
    container.innerHTML = combustiveis.map((c, i) =>
        `<button class="aba-btn ${i === 0 ? "ativa" : ""}"
                 onclick="estoqueAbrirAba('${c.nome}', this)">
             ${c.nome}
         </button>`
    ).join("");

    // Abre a primeira aba (ou a que estava ativa)
    const primeiroNome = estoqueAbaAtiva && combustiveis.find(c => c.nome === estoqueAbaAtiva)
        ? estoqueAbaAtiva
        : combustiveis[0].nome;

    estoqueAbaAtiva = primeiroNome;

    // Atualiza botão ativo caso tenha voltado para tela
    container.querySelectorAll(".aba-btn").forEach(btn => {
        btn.classList.toggle("ativa", btn.textContent.trim() === `${primeiroNome}`);
    });

    estoqueRenderAba(primeiroNome);
}

/* ── Trocar aba ───────────────────────────────── */
function estoqueAbrirAba(nome, botao) {
    estoqueAbaAtiva = nome;
    document.querySelectorAll("#estoqueAbas .aba-btn").forEach(b => b.classList.remove("ativa"));
    botao.classList.add("ativa");
    estoqueRenderAba(nome);
}

/* ── Renderizar conteúdo de uma aba ──────────── */
function estoqueRenderAba(nomeCombustivel) {
    const conteudo = document.getElementById("estoqueConteudo");
    const cad = db.combustiveis.find(c => c.nome === nomeCombustivel);
    if (!cad) return;

    // Seletor de mês: padrão = mês atual
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    const mesSalvo = document.getElementById("estoqueSelectMes")?.value || mesAtual;

    // Estoque inicial deste combustível
    const estoqueInicialVal = db.estoqueInicial[nomeCombustivel] ?? 0;

    // Gera HTML completo da aba
    conteudo.innerHTML = `
        <!-- Saldo de abertura -->
        <div class="estoque-abertura">
            <label>Saldo de abertura (L) para <strong>${nomeCombustivel}</strong>:</label>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:6px">
                <input type="number" id="inputEstoqueInicial"
                       value="${estoqueInicialVal}"
                       min="0" step="0.001" style="max-width:160px"
                       placeholder="Ex: 15000">
                <button class="btn-primario" onclick="salvarEstoqueInicial('${nomeCombustivel}')">
                    Salvar saldo
                </button>
                <span class="dica" style="margin:0">
                    Este é o estoque antes do primeiro registro.
                </span>
            </div>
        </div>

        <!-- Seletor de mês -->
        <div style="display:flex; align-items:center; gap:10px; margin:16px 0 8px; flex-wrap:wrap">
            <label class="campo" style="flex-direction:row; align-items:center; gap:8px; font-size:0.85rem; font-weight:600; color:var(--text-muted); text-transform:uppercase">
                Mês:
            </label>
            <input type="month" id="estoqueSelectMes"
                   value="${mesSalvo}"
                   onchange="estoqueRenderAba('${nomeCombustivel}')"
                   style="max-width:180px">
            <button class="btn-secundario" onclick="estoqueAdicionarDia('${nomeCombustivel}')">
                Adicionar dia
            </button>
        </div>

        <!-- Tabela -->
        <div class="tabela-container">
            <table id="tabelaEstoque">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Entrada (L)</th>
                        <th>Saída (L)</th>
                        <th>Evaporação (L)</th>
                        <th>Estoque Calc. (L)</th>
                        <th>Veeder-Root (L)</th>
                        <th>Diferença (L)</th>
                        <th class="no-print">Ações</th>
                    </tr>
                </thead>
                <tbody id="tabelaEstoqueBody"></tbody>
            </table>
        </div>

        <!-- Resumo do mês -->
        <div id="estoqueResumoMes" class="resumo" style="margin-top:16px; display:none"></div>

        <!-- Gráfico de evolução mensal — Melhoria 7 -->
        <div id="estoqueGraficoBloco" class="estoque-grafico-bloco" style="display:none">
            <div class="estoque-grafico-header">
                <span class="estoque-grafico-titulo">Evolução Mensal do Estoque</span>
                <span class="estoque-grafico-sub">Estoque final calculado por mês · todos os registros</span>
            </div>
            <div class="grafico-wrapper" style="min-height:220px">
                <canvas id="canvasEstoqueEvolucao" height="220"></canvas>
            </div>
        </div>
    `;

    estoqueRenderTabela(nomeCombustivel);
}

/* ── Renderizar linhas da tabela ─────────────── */
function estoqueRenderTabela(nomeCombustivel) {
    const mes    = document.getElementById("estoqueSelectMes")?.value;
    const tbody  = document.getElementById("tabelaEstoqueBody");
    const resumo = document.getElementById("estoqueResumoMes");
    if (!tbody || !mes) return;

    const cad = db.combustiveis.find(c => c.nome === nomeCombustivel);
    const perdaPct = cad?.perda ?? 0;

    // Coleta todos os dias com dados: lançamentos do mês + medições salvas do mês
    const diasSet = new Set();

    // Dias com lançamentos deste combustível
    db.lancamentos.forEach(l => {
        if (!l.dataNota || !l.dataNota.startsWith(mes)) return;
        if (l.itens.some(i => i.tipo === nomeCombustivel)) diasSet.add(l.dataNota);
    });

    // Dias com medições salvas (saída ou veeder digitados)
    const medicoesComb = db.medicoes[nomeCombustivel] || {};
    Object.keys(medicoesComb).forEach(d => {
        if (d.startsWith(mes)) diasSet.add(d);
    });

    const dias = Array.from(diasSet).sort();

    if (dias.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="td-vazio">Nenhum dado para este mês. Use "Adicionar dia" para inserir uma saída manualmente, ou faça lançamentos de entrada.</td></tr>`;
        if (resumo) resumo.style.display = "none";
        return;
    }

    // Calcula estoque acumulado desde o início até o dia anterior ao mês selecionado
    // para que o estoque inicial do mês seja correto
    const estoqueBase = calcularEstoqueAteData(nomeCombustivel, mes + "-01", perdaPct);

    let estoqueAnterior = estoqueBase;
    let totalEntradaMes = 0, totalSaidaMes = 0, totalEvapoMes = 0;

    const linhas = dias.map(data => {
        const entrada   = calcularEntradaDia(nomeCombustivel, data);
        const med       = medicoesComb[data] || {};
        const saida     = med.saida  ?? 0;
        const veeder    = med.veeder ?? null;
        const evaporacao = estoqueAnterior > 0 ? estoqueAnterior * (perdaPct / 100) : 0;
        const estoqueCalc = estoqueAnterior + entrada - saida - evaporacao;

        totalEntradaMes += entrada;
        totalSaidaMes   += saida;
        totalEvapoMes   += evaporacao;

        // Badge de diferença
        let difHtml = `<span class="badge-pendente">Pendente</span>`;
        if (veeder !== null && veeder !== "") {
            const dif = estoqueCalc - veeder;
            const cls = Math.abs(dif) > 50 ? "badge-dif-alerta" : "badge-dif-ok";
            const sinal = dif > 0 ? "+" : "";
            difHtml = `<span class="${cls}">${sinal}${dif.toLocaleString("pt-BR", {minimumFractionDigits:1, maximumFractionDigits:1})} L</span>`;
        }

        const linha = `
            <tr class="${veeder === null ? "linha-pendente" : ""}">
                <td><strong>${formatarData(data)}</strong></td>
                <td>${entrada > 0 ? fmtL3(entrada) : "—"}</td>
                <td>
                    <input type="number" class="input-tabela" min="0" step="0.001"
                           value="${saida > 0 ? saida : ""}"
                           placeholder="0"
                           onchange="estoqueSalvarMedicao('${nomeCombustivel}', '${data}', 'saida', this.value)">
                </td>
                <td>${evaporacao > 0 ? fmtL3(evaporacao) : "—"}</td>
                <td><strong>${fmtL3(estoqueCalc)}</strong></td>
                <td>
                    <input type="number" class="input-tabela" min="0" step="0.001"
                           value="${veeder !== null ? veeder : ""}"
                           placeholder="Leitura"
                           onchange="estoqueSalvarMedicao('${nomeCombustivel}', '${data}', 'veeder', this.value)">
                </td>
                <td>${difHtml}</td>
                <td class="no-print">
                    <button class="btn-excluir" onclick="estoqueExcluirDia('${nomeCombustivel}', '${data}')">Excluir</button>
                </td>
            </tr>`;

        estoqueAnterior = estoqueCalc;
        return linha;
    });

    tbody.innerHTML = linhas.join("");

    // Resumo do mês
    if (resumo) {
        const estoqueAtualMes = estoqueAnterior;
        resumo.style.display = "block";
        resumo.innerHTML = `
            Estoque atual: <strong>${fmtL(estoqueAtualMes, 0)}</strong>
            &nbsp;|&nbsp; Entradas: <strong>${fmtL(totalEntradaMes, 0)}</strong>
            &nbsp;|&nbsp; Saídas: <strong>${fmtL(totalSaidaMes, 0)}</strong>
            &nbsp;|&nbsp; Evaporação: <strong>${fmtL3(totalEvapoMes)}</strong>
        `;
    }

    // Gráfico de evolução mensal
    estoqueRenderGrafico(nomeCombustivel);
}

/* ── Gráfico de evolução mensal do estoque ──────
   Calcula o estoque final de cada mês com dados
   e desenha um gráfico de linha+área com Canvas.
   Melhoria 7.
─────────────────────────────────────────────── */
function estoqueRenderGrafico(nomeCombustivel) {
    const bloco  = document.getElementById("estoqueGraficoBloco");
    const canvas = document.getElementById("canvasEstoqueEvolucao");
    if (!bloco || !canvas) return;

    const cad = db.combustiveis.find(c => c.nome === nomeCombustivel);
    const perdaPct = cad?.perda ?? 0;

    // ── Coleta todos os meses que têm qualquer dado ──────────────
    const mesesSet = new Set();
    db.lancamentos.forEach(l => {
        if (l.dataNota && l.itens.some(i => i.tipo === nomeCombustivel))
            mesesSet.add(l.dataNota.slice(0, 7));
    });
    const medicoes = db.medicoes[nomeCombustivel] || {};
    Object.keys(medicoes).forEach(d => mesesSet.add(d.slice(0, 7)));

    const meses = Array.from(mesesSet).sort();

    if (meses.length < 2) {
        // Menos de 2 meses: não faz sentido mostrar gráfico
        bloco.style.display = "none";
        return;
    }

    bloco.style.display = "block";

    // ── Para cada mês, calcula o estoque ao final do último dia ──
    // Usamos calcularEstoqueAteData até o 1º dia do MÊS SEGUINTE
    const valores = meses.map(mes => {
        const [ano, m] = mes.split("-").map(Number);
        // Primeiro dia do mês seguinte
        const proxMes = new Date(ano, m, 1); // JS: mês 0-indexed, então m já é correto
        const dataLimite = proxMes.toISOString().slice(0, 10);
        return calcularEstoqueAteData(nomeCombustivel, dataLimite, perdaPct);
    });

    const labels = meses.map(nomeMes);

    // ── Detecta css vars para respeitar tema claro/escuro ────────
    const style   = getComputedStyle(document.documentElement);
    const corLinha = style.getPropertyValue("--primary").trim()       || "#7a1f2e";
    const corTexto = style.getPropertyValue("--text-muted").trim()    || "#5c5a57";
    const corGrade = style.getPropertyValue("--border-light").trim()  || "#e8e5e0";
    const corFundo = style.getPropertyValue("--surface").trim()       || "#ffffff";

    // ── Desenha com Canvas 2D ────────────────────────────────────
    const dpr = window.devicePixelRatio || 1;
    const wrapper = canvas.parentElement;
    const W = (wrapper.clientWidth || wrapper.offsetWidth || 600) - 32;
    const H = 220;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + "px";
    canvas.style.height = H + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const PAD_TOP    = 30;
    const PAD_BOTTOM = 48;
    const PAD_LEFT   = 72;
    const PAD_RIGHT  = 16;
    const areaW = W - PAD_LEFT - PAD_RIGHT;
    const areaH = H - PAD_TOP  - PAD_BOTTOM;

    const maxVal = Math.max(...valores, 1);
    const minVal = Math.min(...valores, 0);
    // Escala com 10% de margem acima e abaixo para respirar
    const escMax = maxVal * 1.12;
    const escMin = Math.max(0, minVal * 0.88);
    const escRange = escMax - escMin || 1;

    const n = labels.length;
    const xStep = n > 1 ? areaW / (n - 1) : areaW;

    const xDe = (i) => PAD_LEFT + i * xStep;
    const yDe = (v) => PAD_TOP + areaH - ((v - escMin) / escRange) * areaH;

    // Linhas de grade horizontais
    const GRADES = 4;
    ctx.lineWidth = 1;
    for (let g = 0; g <= GRADES; g++) {
        const v = escMin + (escRange / GRADES) * g;
        const y = yDe(v);
        ctx.strokeStyle = corGrade;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT, y);
        ctx.lineTo(PAD_LEFT + areaW, y);
        ctx.stroke();

        // Label eixo Y
        ctx.fillStyle = corTexto;
        ctx.font = `10px 'JetBrains Mono', monospace`;
        ctx.textAlign = "right";
        const label = v >= 1000
            ? (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k"
            : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
        ctx.fillText(label + " L", PAD_LEFT - 6, y + 3);
    }

    // Eixos
    ctx.strokeStyle = corGrade;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP);
    ctx.lineTo(PAD_LEFT, PAD_TOP + areaH);
    ctx.lineTo(PAD_LEFT + areaW, PAD_TOP + areaH);
    ctx.stroke();

    // Pontos calculados
    const pontos = valores.map((v, i) => ({ x: xDe(i), y: yDe(v), v }));

    // Área preenchida sob a linha
    ctx.beginPath();
    ctx.moveTo(pontos[0].x, PAD_TOP + areaH);
    pontos.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pontos[pontos.length - 1].x, PAD_TOP + areaH);
    ctx.closePath();

    // Gradiente vertical para a área
    const grad = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + areaH);
    grad.addColorStop(0,   corLinha + "30");
    grad.addColorStop(1,   corLinha + "04");
    ctx.fillStyle = grad;
    ctx.fill();

    // Linha principal
    ctx.beginPath();
    ctx.strokeStyle = corLinha;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = "round";
    ctx.lineCap     = "round";
    pontos.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    // Pontos individuais + valores + labels de mês
    pontos.forEach((p, i) => {
        // Círculo branco com borda colorida
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle   = corFundo;
        ctx.strokeStyle = corLinha;
        ctx.lineWidth   = 2;
        ctx.fill();
        ctx.stroke();

        // Valor acima do ponto
        if (p.v > 0) {
            const label = p.v >= 1000
                ? (p.v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k L"
                : p.v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " L";
            ctx.fillStyle  = corLinha;
            ctx.font       = `bold 9px 'JetBrains Mono', monospace`;
            ctx.textAlign  = "center";
            ctx.fillText(label, p.x, p.y - 10);
        }

        // Label do mês (rotacionado -30°) no eixo X
        ctx.save();
        ctx.translate(p.x, PAD_TOP + areaH + 14);
        ctx.rotate(-0.52);
        ctx.fillStyle  = corTexto;
        ctx.font       = `10px Inter, system-ui, sans-serif`;
        ctx.textAlign  = "right";
        ctx.fillText(labels[i], 0, 0);
        ctx.restore();
    });

    // Linha de referência: estoque mínimo histórico (linha tracejada discreta)
    if (minVal > 0 && minVal !== maxVal) {
        const yMin = yDe(minVal);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = corTexto + "55";
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT, yMin);
        ctx.lineTo(PAD_LEFT + areaW, yMin);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = corTexto + "88";
        ctx.font      = `9px Inter, system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText("mín", PAD_LEFT + 4, yMin - 3);
    }
}

/* ── Calcular estoque acumulado ATÉ (exclusive) uma data ──
   Percorre todos os dias anteriores à dataLimite em ordem
   e aplica a fórmula dia a dia.                          */
function calcularEstoqueAteData(nomeCombustivel, dataLimite, perdaPct) {
    let estoque = db.estoqueInicial[nomeCombustivel] ?? 0;

    // Coleta todos os dias com dados ANTES da dataLimite
    const diasSet = new Set();
    db.lancamentos.forEach(l => {
        if (l.dataNota && l.dataNota < dataLimite && l.itens.some(i => i.tipo === nomeCombustivel))
            diasSet.add(l.dataNota);
    });
    const medicoes = db.medicoes[nomeCombustivel] || {};
    Object.keys(medicoes).forEach(d => { if (d < dataLimite) diasSet.add(d); });

    const dias = Array.from(diasSet).sort();
    dias.forEach(data => {
        const entrada    = calcularEntradaDia(nomeCombustivel, data);
        const saida      = medicoes[data]?.saida ?? 0;
        const evaporacao = estoque > 0 ? estoque * (perdaPct / 100) : 0;
        estoque = estoque + entrada - saida - evaporacao;
    });

    return estoque;
}

/* ── Soma entradas (litros descargados) de um combustível num dia ── */
function calcularEntradaDia(nomeCombustivel, data) {
    return db.lancamentos
        .filter(l => l.dataNota === data)
        .flatMap(l => l.itens.filter(i => i.tipo === nomeCombustivel))
        .reduce((soma, i) => {
            // Usa qtdDescargada se preenchida, senão qtd (carga)
            const litros = (i.qtdDescargada && i.qtdDescargada > 0) ? i.qtdDescargada : i.qtd;
            return soma + (litros || 0);
        }, 0);
}

/* ── Salvar saída ou leitura Veeder ──────────── */
function estoqueSalvarMedicao(nomeCombustivel, data, campo, valor) {
    if (!db.medicoes[nomeCombustivel]) db.medicoes[nomeCombustivel] = {};
    if (!db.medicoes[nomeCombustivel][data]) db.medicoes[nomeCombustivel][data] = {};

    const val = valor === "" ? null : parseFloat(valor);
    db.medicoes[nomeCombustivel][data][campo] = val;

    salvarDB();
    estoqueRenderTabela(nomeCombustivel); // re-renderiza para recalcular diferenças
}

/* ── Salvar saldo de abertura ────────────────── */
function salvarEstoqueInicial(nomeCombustivel) {
    const val = parseFloat(document.getElementById("inputEstoqueInicial").value) || 0;
    if (!db.estoqueInicial) db.estoqueInicial = {};
    db.estoqueInicial[nomeCombustivel] = val;
    salvarDB();
    estoqueRenderTabela(nomeCombustivel);
    alert(`Saldo de abertura de ${nomeCombustivel} salvo: ${fmtL3(val)}`);
}

/* ── Adicionar dia manualmente ───────────────── */
function estoqueAdicionarDia(nomeCombustivel) {
    const data = prompt("Digite a data (AAAA-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!data) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return alert("Formato inválido. Use AAAA-MM-DD.");

    if (!db.medicoes[nomeCombustivel]) db.medicoes[nomeCombustivel] = {};
    if (!db.medicoes[nomeCombustivel][data]) {
        db.medicoes[nomeCombustivel][data] = { saida: 0, veeder: null };
        salvarDB();
    }

    // Ajusta o seletor de mês para o mês do dia adicionado
    const mesDia = data.slice(0, 7);
    const sel = document.getElementById("estoqueSelectMes");
    if (sel) sel.value = mesDia;

    estoqueRenderTabela(nomeCombustivel);
}

/* ── Excluir dia ─────────────────────────────── */
function estoqueExcluirDia(nomeCombustivel, data) {
    // Verifica se tem entrada de lançamento neste dia
    const temEntrada = calcularEntradaDia(nomeCombustivel, data) > 0;
    if (temEntrada) {
        if (!confirm(`O dia ${formatarData(data)} tem entradas de lançamento vinculadas.\nSó as medições manuais (saída e Veeder) serão removidas. Confirmar?`)) return;
    } else {
        if (!confirm(`Remover o dia ${formatarData(data)} de ${nomeCombustivel}?`)) return;
    }

    if (db.medicoes[nomeCombustivel]?.[data]) {
        delete db.medicoes[nomeCombustivel][data];
        salvarDB();
    }
    estoqueRenderTabela(nomeCombustivel);
}