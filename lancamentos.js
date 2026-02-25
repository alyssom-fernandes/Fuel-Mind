/*=================================================
  IMPORTAÇÃO DE XML DA NF-e
  Lê o arquivo XML da nota fiscal eletrônica e
  pré-preenche o formulário de lançamento.
  O usuário confere e salva — sem obrigatoriedade.
=================================================*/

function importarXMLNFe(input) {
    const file = input.files[0];
    if (!file) return;

    // Valida extensão
    if (!file.name.toLowerCase().endsWith(".xml")) {
        alert("Selecione um arquivo .xml de NF-e.");
        input.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(e.target.result, "text/xml");

            // Verifica se é NF-e
            const infNFe = xml.querySelector("infNFe");
            if (!infNFe) throw new Error("Arquivo não parece ser uma NF-e válida.");

            // ── Campos da NF-e ───────────────────────────
            const get = (tag) => xml.querySelector(tag)?.textContent?.trim() || "";

            // Número e data da nota
            const nNF    = get("nNF");
            const dhEmi  = get("dhEmi") || get("dEmi"); // dhEmi = com hora, dEmi = antigo
            const dataNota = dhEmi ? dhEmi.slice(0, 10) : "";

            // Emitente — será usado como Base
            const xNomeEmit = get("emit > xNome") || get("emit xNome");

            // Destinatário — tentativa de cruzar com empresas cadastradas
            const xNomeDest = get("dest > xNome") || get("dest xNome");

            // Transportadora — motorista e placa
            const xNomeTransp = get("transporta xNome") || get("xNome") || "";
            const placaTransp = get("veicTransp placa") || get("placa") || "";

            // Itens de combustível
            // Em NF-e de distribuidoras, cada <det> é um produto
            const dets = xml.querySelectorAll("det");
            const itensPossiveis = [];

            dets.forEach(det => {
                const xProd = det.querySelector("xProd")?.textContent?.trim() || "";
                const qCom  = parseFloat(det.querySelector("qCom")?.textContent || "0");
                const vUnCom = parseFloat(det.querySelector("vUnCom")?.textContent || "0");
                const vProd = parseFloat(det.querySelector("vProd")?.textContent || "0");

                // Tenta identificar combustível pelo nome do produto
                const combustivelCadastrado = db.combustiveis.find(c =>
                    xProd.toLowerCase().includes(c.nome.toLowerCase())
                );

                itensPossiveis.push({
                    nomeProduto: xProd,
                    tipo: combustivelCadastrado?.nome || "",
                    qtd: qCom,
                    valor: vUnCom,
                    total: vProd
                });
            });

            // ── Preenche o formulário ────────────────────
            // Data da nota
            if (dataNota) document.getElementById("dataNota").value = dataNota;

            // Número da nota
            if (nNF) document.getElementById("numeroNota").value = nNF;

            // Base (emitente da nota)
            if (xNomeEmit) document.getElementById("baseEntrada").value = xNomeEmit;

            // Empresa (destinatária — tenta cruzar com cadastro)
            if (xNomeDest) {
                const empCadastrada = db.empresas.find(e =>
                    e.ativo !== false &&
                    (xNomeDest.toLowerCase().includes(e.nome.toLowerCase()) ||
                     e.nome.toLowerCase().includes(xNomeDest.toLowerCase()))
                );
                if (empCadastrada) {
                    atualizarListas();
                    setTimeout(() => {
                        document.getElementById("empresaSelect").value = empCadastrada.nome;
                    }, 50);
                }
            }

            // Motorista (tenta cruzar com cadastro)
            if (xNomeTransp) {
                const motorCadastrado = db.motoristas.find(m =>
                    m.ativo !== false &&
                    xNomeTransp.toLowerCase().includes(m.nome.toLowerCase().split(" ")[0])
                );
                if (motorCadastrado) {
                    setTimeout(() => {
                        document.getElementById("motoristaSelect").value = motorCadastrado.nome;
                    }, 50);
                }
            }

            // Placa (tenta cruzar com cadastro — remove traço, espaço)
            if (placaTransp) {
                const placaNorm = placaTransp.replace(/[-\s]/g, "").toUpperCase();
                const veiculoCadastrado = db.veiculos.find(v =>
                    v.ativo !== false &&
                    v.nome.replace(/[-\s]/g, "").toUpperCase() === placaNorm
                );
                if (veiculoCadastrado) {
                    setTimeout(() => {
                        document.getElementById("placaSelect").value = veiculoCadastrado.nome;
                    }, 50);
                }
            }

            // Limpa itens anteriores e adiciona os do XML
            document.getElementById("combustiveisNota").innerHTML = "";
            itensPossiveis.forEach(item => {
                adicionarCombustivelNota({
                    tipo:  item.tipo,
                    qtd:   item.qtd,
                    valor: item.valor
                });
            });

            // Exibe banner de resultado
            const camposPreenchidos = [
                dataNota ? "Data" : null,
                nNF ? "Nº Nota" : null,
                xNomeEmit ? "Base" : null,
                itensPossiveis.length > 0 ? `${itensPossiveis.length} item(ns)` : null
            ].filter(Boolean);

            const naoCruzados = [];
            if (xNomeDest && !db.empresas.find(e => e.ativo !== false && xNomeDest.toLowerCase().includes(e.nome.toLowerCase()))) naoCruzados.push(`Empresa "${xNomeDest}"`);
            if (xNomeTransp && !db.motoristas.find(m => m.ativo !== false && xNomeTransp.toLowerCase().includes(m.nome.toLowerCase().split(" ")[0]))) naoCruzados.push(`Motorista "${xNomeTransp}"`);
            if (placaTransp && !db.veiculos.find(v => v.ativo !== false && v.nome.replace(/[-\s]/g,"").toUpperCase() === placaTransp.replace(/[-\s]/g,"").toUpperCase())) naoCruzados.push(`Placa "${placaTransp}"`);
            const avisoNaoCruzados = naoCruzados.length > 0
                ? `<br><small>⚠ Não encontrado(s) no cadastro — preencha manualmente: ${naoCruzados.join(", ")}</small>`
                : "";

            const itensSemTipo = itensPossiveis.filter(i => !i.tipo);
            const avisoTipos = itensSemTipo.length > 0
                ? `<br><small>⚠ ${itensSemTipo.length} produto(s) sem combustível identificado — verifique os nomes: ${itensSemTipo.map(i => `"${i.nomeProduto}"`).join(", ")}</small>`
                : "";

            const banner = document.getElementById("bannerXML");
            banner.style.display = "block";
            banner.innerHTML = `✅ XML importado — campos pré-preenchidos: <strong>${camposPreenchidos.join(", ")}</strong>.
                Confira todos os dados antes de salvar.${avisoNaoCruzados}${avisoTipos}`;

        } catch (err) {
            alert("Erro ao ler o XML da NF-e:\n" + err.message);
        }

        // Limpa input para permitir novo upload do mesmo arquivo
        input.value = "";
    };
    reader.readAsText(file, "UTF-8");
}

/*=================================================
  CÁLCULO DE PERDA
=================================================*/
function calcularPerdaBadge(nomeCombustivel, qtd, qtdDescargada) {
    const cad = db.combustiveis.find(c => c.nome === nomeCombustivel);
    if (!cad || !qtd || qtd <= 0) return "";

    const perdaToleravel = qtd * (cad.perda / 100);

    if (!qtdDescargada || isNaN(qtdDescargada) || qtdDescargada <= 0) {
        if (cad.perda <= 0) return "";
        return `<span class="badge-perda ok">Tol.: ${perdaToleravel.toFixed(3)} L (${cad.perda}%)</span>`;
    }

    const perdaReal    = qtd - qtdDescargada;
    const percentReal  = (perdaReal / qtd * 100).toFixed(3);

    if (perdaReal < 0)
        return `<span class="badge-perda alerta">⚠ Descarga > Carga?</span>`;
    if (cad.perda <= 0)
        return `<span class="badge-perda alerta">Perda: ${perdaReal.toFixed(3)} L (${percentReal}%)</span>`;
    if (perdaReal <= perdaToleravel)
        return `<span class="badge-perda ok">✔ Perda: ${perdaReal.toFixed(3)} L (${percentReal}%)</span>`;
    return `<span class="badge-perda excesso">✖ Perda: ${perdaReal.toFixed(3)} L (${percentReal}%) — Acima do tolerado (${cad.perda}%)</span>`;
}

/*=================================================
  TOTALIZADOR EM TEMPO REAL — Melhoria 4
  Recalcula e exibe total de litros e valor da nota
  sempre que qualquer campo de combustível muda.
=================================================*/
function atualizarTotalizadorNota() {
    const linhas = document.querySelectorAll(".linha-combustivel");
    let totalLitros = 0;
    let totalValor  = 0;
    let temDados    = false;

    linhas.forEach(linha => {
        const qtd   = parseFloat(linha.querySelector(".qtd")?.value)   || 0;
        const valor = parseFloat(linha.querySelector(".valor")?.value) || 0;
        if (qtd > 0) {
            totalLitros += qtd;
            totalValor  += qtd * valor;
            temDados = true;
        }
    });

    const el = document.getElementById("totalizadorNota");
    if (!el) return;

    if (!temDados || linhas.length === 0) {
        el.style.display = "none";
        return;
    }

    el.style.display = "flex";
    el.innerHTML = `
        <span class="total-item">
            <span class="total-label">Total Litros</span>
            <span class="total-valor">${fmtL3(totalLitros)}</span>
        </span>
        <span class="total-sep">|</span>
        <span class="total-item">
            <span class="total-label">Total da Nota</span>
            <span class="total-valor total-destaque">${fmtR(totalValor)}</span>
        </span>
    `;
}

/*=================================================
  ADICIONAR LINHA DE COMBUSTÍVEL
=================================================*/
function adicionarCombustivelNota(dadosIniciais = null) {
    const container = document.getElementById("combustiveisNota");
    const div = document.createElement("div");
    div.className = "linha-combustivel";

    const opcoesCombustiveis = db.combustiveis.map(c =>
        `<option value="${c.nome}" ${dadosIniciais?.tipo === c.nome ? "selected" : ""}>${c.nome}</option>`
    ).join("");

    div.innerHTML = `
        <select class="tipo" onchange="atualizarBadgePerda(this); marcarFormularioSujo(); atualizarTotalizadorNota();">
            <option value="">-- Combustível --</option>
            ${opcoesCombustiveis}
        </select>
        <input type="number" class="qtd" placeholder="Qtd carga (L)" min="0" step="0.001"
               value="${dadosIniciais?.qtd || ""}"
               oninput="atualizarTotalizadorNota(); marcarFormularioSujo();"
               onblur="atualizarBadgePerda(this.closest('.linha-combustivel').querySelector('.tipo'))">
        <input type="number" class="qtdDescargada" placeholder="Qtd descarga (L)" min="0" step="0.001"
               value="${dadosIniciais?.qtdDescargada || ""}"
               oninput="marcarFormularioSujo();"
               onblur="atualizarBadgePerda(this.closest('.linha-combustivel').querySelector('.tipo'))">
        <input type="number" class="valor" placeholder="Valor unit. (R$)" min="0" step="0.0001"
               value="${dadosIniciais?.valor || ""}"
               oninput="atualizarTotalizadorNota(); marcarFormularioSujo();">
        <div class="badge-wrapper"></div>
        <button class="btn-excluir" onclick="this.parentElement.remove(); atualizarTotalizadorNota();">Remover</button>
    `;

    container.appendChild(div);
    if (dadosIniciais?.tipo) atualizarBadgePerda(div.querySelector(".tipo"));
    atualizarTotalizadorNota();
    marcarFormularioSujo();
}

function atualizarBadgePerda(selectTipo) {
    const linha = selectTipo.closest(".linha-combustivel");
    const tipo  = selectTipo.value;
    const qtd   = parseFloat(linha.querySelector(".qtd").value);
    const qtdD  = parseFloat(linha.querySelector(".qtdDescargada").value);
    linha.querySelector(".badge-wrapper").innerHTML = calcularPerdaBadge(tipo, qtd, qtdD);
}

/*=================================================
  CÁLCULO DE MÉDIA DE PREÇO
=================================================*/
function calcularMediaPreco(nomeCombustivel) {
    const precos = db.lancamentos.flatMap(l => l.itens.filter(i => i.tipo === nomeCombustivel).map(i => i.valor));
    if (precos.length === 0) return 0;
    return precos.reduce((sum, p) => sum + p, 0) / precos.length;
}

/*=================================================
  SALVAR / ATUALIZAR LANÇAMENTO
=================================================*/
let lancamentoEditandoId = null;
let isClonando = false;

function salvarOuAtualizar() {
    const dataNota = document.getElementById("dataNota").value;
    const dataDescarga = document.getElementById("dataDescarga").value;
    const numeroNota = document.getElementById("numeroNota").value.trim();
    const base = document.getElementById("baseEntrada").value.trim();
    const empresa = document.getElementById("empresaSelect").value;
    const motorista = document.getElementById("motoristaSelect").value;
    const placa = document.getElementById("placaSelect").value;
    const observacoes = document.getElementById("observacoes").value.trim();

    if (!dataNota) return alert("Data da nota fiscal é obrigatória.");
    if (!empresa) return alert("Selecione a empresa.");
    if (!motorista) return alert("Selecione o motorista.");
    if (!placa) return alert("Selecione a placa.");

    const itens = [];
    let total = 0;
    document.querySelectorAll(".linha-combustivel").forEach(linha => {
        const tipo = linha.querySelector(".tipo").value;
        const qtd = parseFloat(linha.querySelector(".qtd").value) || 0;
        const qtdDescargada = parseFloat(linha.querySelector(".qtdDescargada").value) || 0;
        const valor = parseFloat(linha.querySelector(".valor").value) || 0;

        if (tipo && qtd > 0) {
            const media = calcularMediaPreco(tipo);
            if (media > 0 && Math.abs(valor - media) / media > 0.1) {
                if (!confirm(`O valor unitário de ${tipo} está mais de 10% acima/abaixo da média histórica. Continuar?`)) return;
            }
            const itemTotal = qtd * valor;
            itens.push({ tipo, qtd, qtdDescargada, valor, total: itemTotal });
            total += itemTotal;
        }
    });

    if (itens.length === 0) return alert("Adicione pelo menos um combustível.");

    const notaFile = document.getElementById("notaFiscalFile").files[0];
    let notaBase64 = null;
    const reader = new FileReader();
    reader.onload = function(e) {
        notaBase64 = e.target.result;
        salvarLancamentoFinal(dataNota, dataDescarga, numeroNota, base, empresa, motorista, placa, itens, total, observacoes, notaBase64);
    };
    if (notaFile) {
        reader.readAsDataURL(notaFile);
    } else {
        salvarLancamentoFinal(dataNota, dataDescarga, numeroNota, base, empresa, motorista, placa, itens, total, observacoes, notaBase64);
    }
}

function salvarLancamentoFinal(dataNota, dataDescarga, numeroNota, base, empresa, motorista, placa, itens, total, observacoes, notaBase64) {
    const lancamento = {
        id: lancamentoEditandoId || Date.now(),
        dataNota, dataDescarga, numeroNota, base, empresa, motorista, placa, itens, total, observacoes, notaFile: notaBase64,
        logs: lancamentoEditandoId ? (db.lancamentos.find(l => l.id === lancamentoEditandoId).logs || []) : []
    };

    const logAcao = lancamentoEditandoId ? (isClonando ? "Clonado" : "Editado") : "Criado";
    lancamento.logs.push(`${logAcao} em ${new Date().toLocaleString('pt-BR')}`);

    if (lancamentoEditandoId && !isClonando) {
        const idx = db.lancamentos.findIndex(l => l.id === lancamentoEditandoId);
        db.lancamentos[idx] = lancamento;
        mostrarToast("Lançamento atualizado com sucesso!", "sucesso");
    } else {
        db.lancamentos.push(lancamento);
        mostrarToast("Lançamento salvo com sucesso!", "sucesso");
    }

    salvarDB();
    limparFormulario();
    mostrarTela('relatorios');
    carregarRelatorio();
}

/*=================================================
  EDITAR / CLONAR / LIMPAR
=================================================*/
function editarLancamento(id) {
    const l = db.lancamentos.find(x => x.id === id);
    if (!l) return;

    lancamentoEditandoId = id;
    isClonando = false;

    document.getElementById("dataNota").value = l.dataNota;
    document.getElementById("dataDescarga").value = l.dataDescarga || "";
    document.getElementById("numeroNota").value = l.numeroNota;
    document.getElementById("baseEntrada").value = l.base || "";
    document.getElementById("observacoes").value = l.observacoes || "";

    atualizarListas();
    setTimeout(() => {
        document.getElementById("empresaSelect").value = l.empresa || "";
        document.getElementById("motoristaSelect").value = l.motorista || "";
        document.getElementById("placaSelect").value = l.placa || "";
    }, 0);

    document.getElementById("combustiveisNota").innerHTML = "";
    l.itens.forEach(item => adicionarCombustivelNota(item));

    document.getElementById("tituloLancamento").textContent = "✏️ Editando Lançamento";
    document.getElementById("btnSalvarLancamento").textContent = "💾 Atualizar Entrada";

    const banner = document.getElementById("bannerEdicao");
    banner.style.display = "block";
    banner.innerHTML = `✏️ Editando nota <strong>${l.numeroNota}</strong> — <a href="#" onclick="limparFormulario(); return false;">Cancelar edição</a>`;

    mostrarTela("lancamentos");
}

function clonarLancamento(id) {
    const l = db.lancamentos.find(x => x.id === id);
    if (!l) return;

    lancamentoEditandoId = null;
    isClonando = true;

    document.getElementById("dataNota").value = "";
    document.getElementById("dataDescarga").value = l.dataDescarga || "";
    document.getElementById("numeroNota").value = "";
    document.getElementById("baseEntrada").value = l.base || "";
    document.getElementById("observacoes").value = l.observacoes || "";

    atualizarListas();
    setTimeout(() => {
        document.getElementById("empresaSelect").value = l.empresa || "";
        document.getElementById("motoristaSelect").value = l.motorista || "";
        document.getElementById("placaSelect").value = l.placa || "";
    }, 0);

    document.getElementById("combustiveisNota").innerHTML = "";
    l.itens.forEach(item => adicionarCombustivelNota(item));

    document.getElementById("tituloLancamento").textContent = "📋 Novo Lançamento (Clonado)";
    document.getElementById("btnSalvarLancamento").textContent = "💾 Salvar Entrada";

    const banner = document.getElementById("bannerEdicao");
    banner.style.display = "none";

    mostrarTela("lancamentos");
}

function limparFormulario() {
    lancamentoEditandoId = null;
    isClonando = false;

    ["dataNota","dataDescarga","numeroNota","baseEntrada","observacoes","notaFiscalFile"].forEach(id => {
        document.getElementById(id).value = "";
    });
    document.getElementById("empresaSelect").value = "";
    document.getElementById("motoristaSelect").value = "";
    document.getElementById("placaSelect").value = "";
    document.getElementById("combustiveisNota").innerHTML = "";

    document.getElementById("tituloLancamento").textContent = "Lançamento de Entrada";
    document.getElementById("btnSalvarLancamento").textContent = "💾 Salvar Entrada";

    const banner = document.getElementById("bannerEdicao");
    banner.style.display = "none";

    const bannerXML = document.getElementById("bannerXML");
    if (bannerXML) bannerXML.style.display = "none";

    // Limpa indicador de formulário sujo
    limparFormularioSujo();

    // Limpa totalizador
    atualizarTotalizadorNota();
}

/*=================================================
  EXCLUIR LANÇAMENTO
=================================================*/
function excluirLancamento(id, contexto = 'relatorio') {
    if (!confirm("Excluir esta entrada permanentemente?")) return;
    db.lancamentos = db.lancamentos.filter(l => l.id !== id);
    salvarDB();
    if (contexto === 'relatorio') carregarRelatorio();
    else carregarHistorico();
}