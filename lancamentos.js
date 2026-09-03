/*=================================================
  LANÇAMENTOS.JS – com autocomplete, múltiplos anexos,
  spinner, validação de duplicidade de nota
  e conversão automática de placa para Mercosul
  FIX: manter filtros do relatório após salvar edição
=================================================*/

let lancamentoEditandoId = null;
let isClonando = false;

/*=================================================
  IMPORTAÇÃO DE XML DA NF-e
=================================================*/
function importarXMLNFe(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xml")) {
        mostrarToast("Selecione um arquivo .xml de NF-e.", "aviso");
        input.value = "";
        return;
    }
    const reader = new FileReader();
    reader.onload = async function (e) {
        // A importação sobrescreve os campos e zera as linhas de combustível.
        // Era mais um caminho de perda silenciosa: quem tinha meia nota
        // digitada e importava o XML por engano perdia tudo sem aviso.
        if (_formularioSujo) {
            if (!await fmConfirm({
                titulo: "Substituir o que está preenchido?",
                msg: "O XML vai sobrescrever os campos e as linhas de combustível desta tela.",
                confirmTxt: "Substituir pelo XML",
                cancelTxt: "Manter o que está",
                tipo: "aviso"
            })) { input.value = ""; return; }
        }
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(e.target.result, "text/xml");
            const infNFe = xml.querySelector("infNFe");
            if (!infNFe) throw new Error("Arquivo não parece ser uma NF-e válida.");
            const get = (tag) => xml.querySelector(tag)?.textContent?.trim() || "";
            const nNF         = get("nNF");
            const dhEmi       = get("dhEmi") || get("dEmi");
            const dataNota    = dhEmi ? dhEmi.slice(0, 10) : "";
            const xNomeEmit   = get("emit > xNome") || get("emit xNome");
            const xNomeDest   = get("dest > xNome") || get("dest xNome");
            const xNomeTransp = get("transporta xNome") || get("xNome") || "";
            const placaTransp = get("veicTransp placa") || get("placa") || "";

            const EQUIV_COMBUSTIVEL = [
                { termos: ["s-10","s10","diesel s10","diesel b s10","oleo diesel b s10","diesel s-10"], nome: "Diesel S-10" },
                { termos: ["s-500","s500","diesel s500","diesel s-500","diesel b s500","oleo diesel b s500"], nome: "Diesel S-500" },
                { termos: ["gasolina comum","gasolina c","gas com","gasolina aditivada","gas. comum"], nome: "Gasolina Comum" },
                { termos: ["gasolina vpremium","gasolina v-power","gasolina podium","gas v","vpower","v power","gasolina v"], nome: "Gasolina V-Power" },
                { termos: ["etanol","alcool","alcool hidratado","aehc"], nome: "Etanol" },
            ];
            function identificarCombustivel(xProd) {
                const norm = normalizarTexto(xProd);
                for (const eq of EQUIV_COMBUSTIVEL) {
                    if (eq.termos.some(t => norm.includes(t))) {
                        const cad = db.combustiveis.find(c => c.nome === eq.nome);
                        return cad ? cad.nome : eq.nome;
                    }
                }
                const direto = db.combustiveis.find(c => {
                    const cn = normalizarTexto(c.nome);
                    return norm.includes(cn) || cn.includes(norm);
                });
                return direto?.nome || "";
            }

            const dets = xml.querySelectorAll("det");
            const itensPossiveis = [];
            dets.forEach(det => {
                const xProd  = det.querySelector("xProd")?.textContent?.trim() || "";
                const qCom   = parseFloat(det.querySelector("qCom")?.textContent  || "0");
                const vUnCom = parseFloat(det.querySelector("vUnCom")?.textContent || "0");
                const vProd  = parseFloat(det.querySelector("vProd")?.textContent  || "0");
                itensPossiveis.push({ nomeProduto: xProd, tipo: identificarCombustivel(xProd), qtd: qCom, valor: vUnCom, total: vProd });
            });

            let baseParaPreencher = "";
            if (xNomeEmit) {
                const baseCadastrada = db.bases?.find(b =>
                    normalizarTexto(xNomeEmit).includes(normalizarTexto(b.nome)) ||
                    normalizarTexto(b.nome).includes(normalizarTexto(xNomeEmit).split(" ")[0])
                );
                baseParaPreencher = baseCadastrada?.nome || xNomeEmit;
            }

            if (dataNota) document.getElementById("dataNota").value = dataNota;
            if (nNF)      document.getElementById("numeroNota").value = nNF;

            // ── usa setBase() para garantir sincronização dos três campos ──
            if (baseParaPreencher) setBase(baseParaPreencher);

            // A empresa ativa desabilita o campo na interface, mas `disabled`
            // não impede atribuição por script: até aqui o XML sobrescrevia a
            // empresa em silêncio e a nota era salva na empresa do arquivo,
            // com o campo cinza exibindo outro nome. Agora, quando há empresa
            // ativa e o destinatário do XML é outro, o campo não é tocado e a
            // divergência aparece no banner e num aviso.
            let avisoEmpresaDivergente = "";
            if (xNomeDest) {
                const empCadastrada = db.empresas.find(e =>
                    e.ativo !== false &&
                    (normalizarTexto(xNomeDest).includes(normalizarTexto(e.nome)) ||
                     normalizarTexto(e.nome).includes(normalizarTexto(xNomeDest)))
                );
                if (empCadastrada) {
                    if (empresaFiltroGlobal && empCadastrada.nome !== empresaFiltroGlobal) {
                        avisoEmpresaDivergente =
                            `<br><small><strong>Empresa não alterada.</strong> O XML é de `
                            + `"${escapeHtml(empCadastrada.nome)}" e a empresa ativa é `
                            + `"${escapeHtml(empresaFiltroGlobal)}". Para lançar na outra, `
                            + `troque a empresa ativa no cabeçalho e importe de novo.</small>`;
                        mostrarToast(
                            `O XML é da empresa "${empCadastrada.nome}", diferente da empresa ativa. `
                            + `A empresa do lançamento não foi alterada.`,
                            "aviso", 7000
                        );
                    } else {
                        document.getElementById("empresaInput").value  = empCadastrada.nome;
                        document.getElementById("empresaSelect").value = empCadastrada.nome;
                    }
                }
            }
            if (xNomeTransp) {
                const motorCadastrado = db.motoristas.find(m =>
                    m.ativo !== false &&
                    normalizarTexto(xNomeTransp).includes(normalizarTexto(m.nome).split(" ")[0])
                );
                if (motorCadastrado) {
                    document.getElementById("motoristaInput").value  = motorCadastrado.nome;
                    document.getElementById("motoristaSelect").value = motorCadastrado.nome;
                }
            }
            if (placaTransp) {
                const placaNorm = placaTransp.replace(/[-\s]/g, "").toUpperCase();
                const veiculoCadastrado = db.veiculos.find(v =>
                    v.ativo !== false && v.nome.replace(/[-\s]/g, "").toUpperCase() === placaNorm
                );
                if (veiculoCadastrado) {
                    document.getElementById("placaInput").value  = veiculoCadastrado.nome;
                    document.getElementById("placaSelect").value = veiculoCadastrado.nome;
                }
            }

            document.getElementById("combustiveisNota").innerHTML = "";
            itensPossiveis.forEach(item => adicionarCombustivelNota({ tipo: item.tipo, qtd: item.qtd, valor: item.valor }));

            const camposPreenchidos = [
                dataNota ? "Data" : null, nNF ? "Nº Nota" : null,
                baseParaPreencher ? "Base" : null,
                itensPossiveis.length > 0 ? `${itensPossiveis.length} item(ns)` : null
            ].filter(Boolean);

            const naoCruzados = [];
            if (xNomeDest && !db.empresas.find(e => e.ativo !== false && normalizarTexto(xNomeDest).includes(normalizarTexto(e.nome))))
                naoCruzados.push(`Empresa "${escapeHtml(xNomeDest)}"`);
            if (xNomeTransp && !db.motoristas.find(m => m.ativo !== false && normalizarTexto(xNomeTransp).includes(normalizarTexto(m.nome).split(" ")[0])))
                naoCruzados.push(`Motorista "${escapeHtml(xNomeTransp)}"`);
            if (placaTransp && !db.veiculos.find(v => v.ativo !== false && v.nome.replace(/[-\s]/g,"").toUpperCase() === placaTransp.replace(/[-\s]/g,"").toUpperCase()))
                naoCruzados.push(`Placa "${escapeHtml(placaTransp)}"`);
            const avisoNaoCruzados = naoCruzados.length > 0
                ? `<br><small>Não encontrado(s) no cadastro: ${naoCruzados.join(", ")}</small>` : "";
            const itensSemTipo = itensPossiveis.filter(i => !i.tipo);
            const avisoTipos = itensSemTipo.length > 0
                ? `<br><small>${itensSemTipo.length} produto(s) sem combustível identificado: ${itensSemTipo.map(i => `"${escapeHtml(i.nomeProduto)}"`).join(", ")}</small>` : "";

            const banner = document.getElementById("bannerXML");
            banner.style.display = "block";
            banner.innerHTML = `XML importado — campos pré-preenchidos: <strong>${camposPreenchidos.join(", ")}</strong>. Confira todos os dados antes de salvar.${avisoEmpresaDivergente}${avisoNaoCruzados}${avisoTipos}`;
        } catch (err) {
            mostrarToast("Erro ao ler o XML da NF-e: " + err.message, "erro", 5000);
        }
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
    const perdaReal   = qtd - qtdDescargada;
    const percentReal = (perdaReal / qtd * 100).toFixed(3);
    if (perdaReal < 0)               return `<span class="badge-perda alerta">Descarga > Carga?</span>`;
    if (cad.perda <= 0)              return `<span class="badge-perda alerta">Perda: ${perdaReal.toFixed(3)} L (${percentReal}%)</span>`;
    if (perdaReal <= perdaToleravel) return `<span class="badge-perda ok">Perda: ${perdaReal.toFixed(3)} L (${percentReal}%)</span>`;
    return `<span class="badge-perda excesso">Perda: ${perdaReal.toFixed(3)} L (${percentReal}%) — Acima do tolerado (${cad.perda}%)</span>`;
}

/*=================================================
  TOTALIZADOR EM TEMPO REAL
=================================================*/
function atualizarTotalizadorNota() {
    const linhas = document.querySelectorAll(".linha-combustivel");
    let totalLitros = 0, totalValor = 0, temDados = false;
    linhas.forEach(linha => {
        const qtd   = parseFloat(linha.querySelector(".qtd")?.value)   || 0;
        const valor = parseFloat(linha.querySelector(".valor")?.value) || 0;
        if (qtd > 0) { totalLitros += qtd; totalValor += qtd * valor; temDados = true; }
    });
    const el = document.getElementById("totalizadorNota");
    if (!el) return;
    if (!temDados || linhas.length === 0) { el.style.display = "none"; return; }
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
        </span>`;
}

/*=================================================
  ADICIONAR LINHA DE COMBUSTÍVEL
=================================================*/
function adicionarCombustivelNota(dadosIniciais = null) {
    const container = document.getElementById("combustiveisNota");
    const div = document.createElement("div");
    div.className = "linha-combustivel";
    const opcoesCombustiveis = db.combustiveis.map(c =>
        `<option value="${escapeHtml(c.nome)}" ${dadosIniciais?.tipo === c.nome ? "selected" : ""}>${escapeHtml(c.nome)}</option>`
    ).join("");
    div.innerHTML = `
        <select class="tipo" onchange="atualizarBadgePerda(this); marcarFormularioSujo(); atualizarTotalizadorNota();">
            <option value="">-- Combustível --</option>${opcoesCombustiveis}
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
        <button class="btn-excluir" onclick="this.parentElement.remove(); atualizarTotalizadorNota();">Remover</button>`;
    container.appendChild(div);
    if (dadosIniciais?.tipo) atualizarBadgePerda(div.querySelector(".tipo"));
    atualizarTotalizadorNota();
    marcarFormularioSujo();
}

function atualizarBadgePerda(selectTipo) {
    const linha = selectTipo.closest(".linha-combustivel");
    linha.querySelector(".badge-wrapper").innerHTML = calcularPerdaBadge(
        selectTipo.value,
        parseFloat(linha.querySelector(".qtd").value),
        parseFloat(linha.querySelector(".qtdDescargada").value)
    );
}

/*=================================================
  CÁLCULO DE MÉDIA DE PREÇO
=================================================*/
/**
 * Calcula o preço médio por litro de um combustível nos últimos 30 dias,
 * com base nos lançamentos da empresa ativa (`empresaFiltroGlobal`).
 *
 * Exclui o lançamento atualmente em edição (`lancamentoEditandoId`) para não
 * contaminar a própria média com o valor que está sendo validado.
 *
 * Usado para alertar quando um novo valor está mais de 10% fora da média.
 *
 * @param {string} nomeCombustivel - Nome do tipo de combustível
 * @returns {number} Preço médio em R$/L, ou `0` se não houver histórico nos últimos 30 dias
 */
function calcularMediaPreco(nomeCombustivel) {
    const limite = new Date();
    limite.setDate(limite.getDate() - 30);
    const limiteStr = limite.toISOString().slice(0, 10);

    const precos = db.lancamentos
        .filter(l => {
            if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
            // Ignora o próprio lançamento em edição para não distorcer a média
            if (lancamentoEditandoId && l.id === lancamentoEditandoId) return false;
            // Considera apenas os últimos 30 dias pela data de referência
            const dataRef = l.dataDescarga || l.dataNota || '';
            return dataRef >= limiteStr;
        })
        .flatMap(l => l.itens
            .filter(i => i.tipo === nomeCombustivel && i.valor > 0)
            .map(i => i.valor)
        );

    if (precos.length === 0) return 0;
    return precos.reduce((sum, p) => sum + p, 0) / precos.length;
}

/*=================================================
  VALIDAÇÃO DE DUPLICIDADE DE NOTA
=================================================*/
/**
 * Verifica se já existe um lançamento com a mesma nota fiscal,
 * empresa e data de nota (ignora o próprio lançamento em edição).
 *
 * @param {string}      numeroNota    - Número da nota fiscal
 * @param {string}      empresa       - Nome da empresa
 * @param {string}      dataNota      - `"YYYY-MM-DD"`
 * @param {string|null} idIgnorar     - ID do lançamento sendo editado (para não
 *   flagrar como duplicata de si mesmo)
 * @returns {boolean} `true` se houver duplicata
 */
function verificarDuplicidadeNota(numeroNota, empresa, dataNota, idIgnorar = null) {
    return db.lancamentos.some(l =>
        l.numeroNota === numeroNota && l.empresa === empresa && l.dataNota === dataNota &&
        (idIgnorar === null || l.id !== idIgnorar)
    );
}

/*=================================================
  SALVAR / ATUALIZAR LANÇAMENTO
=================================================*/
/**
 * Valida e salva ou atualiza um lançamento a partir do formulário da tela.
 *
 * Fluxo:
 * 1. Lê e normaliza todos os campos do formulário
 * 2. Converte placa para formato Mercosul se necessário
 * 3. Valida datas (futuras, descarga anterior à nota)
 * 4. Verifica duplicidade de nota
 * 5. Valida preço médio por combustível (alerta se > 10% da média)
 * 6. Mostra a conferência final, quando o operador vai continuar lançando
 * 7. Chama `salvarLancamentoFinal` com todos os dados validados
 *
 * @param {'proxima'|'sair'} [modo='proxima'] - o que fazer depois de gravar.
 *   `proxima` mantém o operador na tela, com o contexto do lote preservado;
 *   `sair` leva ao relatório, como era antes. Salvar deixou de decidir
 *   sozinho qual é o próximo trabalho: quem lança um bolo de notas continua
 *   lançando, e ir ao relatório a cada nota custava tempo e foco.
 * @returns {Promise<void>}
 */
async function salvarOuAtualizar(modo = 'proxima') {
    const btn = document.getElementById(modo === 'sair' ? "btnSalvarSair" : "btnSalvarLancamento");
    mostrarSpinner(btn, btn.innerText);

    const dataNota     = document.getElementById("dataNota").value;
    const dataDescarga = document.getElementById("dataDescarga").value;
    const numeroNota   = document.getElementById("numeroNota").value.trim();
    const base         = document.getElementById("baseEntradaInput").value.trim();
    const empresa      = document.getElementById("empresaInput").value.trim();
    const motorista    = document.getElementById("motoristaInput").value.trim();
    const observacoes  = document.getElementById("observacoes").value.trim();

    // ── Captura e normaliza placa (converte para Mercosul se necessário) ──
    const placaDigitada = document.getElementById("placaInput").value.trim().toUpperCase();
    const placaLimpa    = placaDigitada.replace(/[-\s]/g, "");
    const placaConv     = typeof converterPlacaMercosul === 'function' ? converterPlacaMercosul(placaLimpa) : null;
    const placa         = placaConv || placaLimpa;

    if (placaConv && placaConv !== placaLimpa) {
        document.getElementById("placaInput").value  = placaConv;
        document.getElementById("placaSelect").value = placaConv;
        mostrarToast(`Placa convertida para o formato Mercosul: ${placaDigitada} → ${placaConv}`, "info", 5000);
    }

    if (!dataNota) { esconderSpinner(btn); mostrarToast("Data da nota fiscal é obrigatória.", "aviso"); return; }

    // ── Validação de datas futuras ──
    const hoje   = new Date(); hoje.setHours(0,0,0,0);
    const dtNota = new Date(dataNota + "T00:00:00");
    const dtDesc = dataDescarga ? new Date(dataDescarga + "T00:00:00") : null;
    if (dtNota > hoje) {
        if (!await fmConfirm({ titulo: "Data da Nota no futuro", msg: `A Data da Nota (${formatarData(dataNota)}) é uma data futura.\nHoje é ${hoje.toLocaleDateString("pt-BR")}.\n\nIsso pode ser um erro de digitação.`, confirmTxt: "Salvar mesmo assim", tipo: "aviso" }))
            { esconderSpinner(btn); return; }
    }
    if (dtDesc && dtDesc > hoje) {
        if (!await fmConfirm({ titulo: "Data de Descarga no futuro", msg: `A Data de Descarga (${formatarData(dataDescarga)}) é uma data futura.`, confirmTxt: "Salvar mesmo assim", tipo: "aviso" }))
            { esconderSpinner(btn); return; }
    }
    if (dtDesc && dtNota && dtDesc < dtNota) {
        if (!await fmConfirm({ titulo: "Data de Descarga anterior à Nota", msg: `Descarga: ${formatarData(dataDescarga)}\nNota: ${formatarData(dataNota)}\n\nA descarga não pode ocorrer antes da emissão da nota.`, confirmTxt: "Salvar mesmo assim", tipo: "aviso" }))
            { esconderSpinner(btn); return; }
    }

    if (!empresa)   { esconderSpinner(btn); mostrarToast("Digite ou selecione a empresa.", "aviso"); return; }
    if (!motorista) { esconderSpinner(btn); mostrarToast("Digite ou selecione o motorista.", "aviso"); return; }
    if (!placa)     { esconderSpinner(btn); mostrarToast("Digite ou selecione a placa.", "aviso"); return; }

    if (verificarDuplicidadeNota(numeroNota, empresa, dataNota, lancamentoEditandoId)) {
        if (!await fmConfirm({ titulo: "Nota possivelmente duplicada", msg: `Já existe um lançamento com a nota ${numeroNota} de ${empresa} na data ${formatarData(dataNota)}.\n\nDeseja salvar mesmo assim?`, confirmTxt: "Salvar mesmo assim", tipo: "aviso" }))
            { esconderSpinner(btn); return; }
    }

    const itens = [];
    let total = 0, confirmouMedia = true;
    for (const linha of document.querySelectorAll(".linha-combustivel")) {
        const tipo          = linha.querySelector(".tipo").value;
        const qtd           = parseFloat(linha.querySelector(".qtd").value) || 0;
        const qtdDescargada = parseFloat(linha.querySelector(".qtdDescargada").value) || 0;
        const valor         = parseFloat(linha.querySelector(".valor").value) || 0;
        if (tipo && qtd > 0) {
            const media = calcularMediaPreco(tipo);
            if (media > 0 && Math.abs(valor - media) / media > 0.1) {
                if (!await fmConfirm({ titulo: "Valor fora da média", msg: `O valor unitário de ${tipo} está mais de 10% acima/abaixo da média histórica.\n\nDeseja continuar?`, confirmTxt: "Continuar", tipo: "aviso" }))
                    { confirmouMedia = false; }
            }
            const itemTotal = qtd * valor;
            itens.push({ tipo, qtd, qtdDescargada, valor, total: itemTotal });
            total += itemTotal;
        }
    }

    if (!confirmouMedia) { esconderSpinner(btn); return; }
    if (itens.length === 0) { esconderSpinner(btn); mostrarToast("Adicione pelo menos um combustível.", "aviso"); return; }

    // ── Conferência final ──
    // Só no caminho "salvar e lançar próxima", e só para nota nova. É o
    // preço do trade-off declarado pelo dono, segurança primeiro: quem
    // continua na tela não passa pelo relatório, então esta é a única
    // oportunidade de olhar a nota inteira antes de ela existir. Quem
    // escolhe "salvar e sair" cai no relatório e confere lá.
    if (modo === 'proxima' && !lancamentoEditandoId) {
        const litros = itens.reduce((s, i) => s + (parseFloat(i.qtd) || 0), 0);
        const resumo =
            `Empresa: ${empresa}\n`
            + `Base: ${base || "—"}\n`
            + `Data da nota: ${formatarData(dataNota)}${dataDescarga ? `   Descarga: ${formatarData(dataDescarga)}` : ""}\n`
            + `Nota: ${numeroNota || "—"}\n`
            + `Motorista: ${motorista}   Placa: ${placa}\n`
            + `${itens.length} combustível(is), ${fmtL3(litros)}\n`
            + `Total: ${fmtR(total)}`;
        if (!await fmConfirm({
            titulo: "Confirmar lançamento",
            msg: resumo,
            confirmTxt: "Confirmar e lançar próxima",
            cancelTxt: "Voltar e corrigir",
            tipo: "info"
        })) { esconderSpinner(btn); return; }
    }

    salvarLancamentoFinal(dataNota, dataDescarga, numeroNota, base, empresa,
                          motorista, placa, itens, total, observacoes, [], undefined, modo);
    esconderSpinner(btn);
}

/**
 * Persiste o lançamento no `db` e aciona `salvarDB`.
 *
 * Separada de `salvarOuAtualizar` por clareza: aquela valida e monta os
 * itens, esta persiste.
 *
 * Se `lancamentoIdPreGerado` for fornecido (caso com anexos), usa esse ID.
 * Caso contrário, usa `lancamentoEditandoId` (edição sem novos anexos)
 * ou gera um novo ID via `gerarId()`.
 *
 * Depois de gravar, o destino depende do `modo`:
 * - `proxima`: fica na tela, limpa só o que pertence à nota e devolve o
 *   foco à Data da Nota. É o caminho normal de quem lança um bolo de notas.
 * - `sair`: vai ao relatório, preservando os filtros quando era edição.
 *
 * @param {string} dataNota
 * @param {string} dataDescarga
 * @param {string} numeroNota
 * @param {string} base
 * @param {string} empresa
 * @param {string} motorista
 * @param {string} placa
 * @param {Array}  itens              - Array de `{ tipo, qtd, qtdDescargada, valor, total }`
 * @param {number} total              - Total calculado da nota
 * @param {string} observacoes
 * @param {Array}  arquivos           - Sempre `[]`; anexo de nota foi descontinuado
 * @param {string} [lancamentoIdPreGerado] - ID pré-gerado quando há upload de anexos
 * @param {'proxima'|'sair'} [modo='proxima'] - destino depois de gravar
 */
function salvarLancamentoFinal(dataNota, dataDescarga, numeroNota, base, empresa, motorista, placa, itens, total, observacoes, arquivos, lancamentoIdPreGerado, modo = 'proxima') {
    // Detecta se é edição ou novo/clone — para decidir como recarregar o relatório
    const eraEdicao = !!(lancamentoEditandoId && !isClonando);

    const lancamento = {
        id: lancamentoIdPreGerado || lancamentoEditandoId || gerarId(),
        dataNota, dataDescarga, numeroNota, base, empresa, motorista, placa, itens, total, observacoes,
        anexos: arquivos,
        logs: lancamentoEditandoId ? (db.lancamentos.find(l => l.id === lancamentoEditandoId)?.logs || []) : []
    };
    const logAcao = lancamentoEditandoId ? (isClonando ? "Clonado" : "Editado") : "Criado";
    // Log estruturado: objeto {acao, ts, usuario} — compatível com logs antigos (string)
    // que são exibidos normalmente em _buildConteudoDetalhe via typeof check
    lancamento.logs.push({
        acao:    logAcao,
        ts:      new Date().toISOString(),
        usuario: window._usuarioAtual?.nome || '—'
    });

    if (lancamentoEditandoId && !isClonando) {
        const idx = db.lancamentos.findIndex(l => l.id === lancamentoEditandoId);
        db.lancamentos[idx] = lancamento;
        mostrarToast("Lançamento atualizado com sucesso!", "sucesso");
    } else {
        db.lancamentos.push(lancamento);
        mostrarToast("Lançamento salvo com sucesso!", "sucesso");
    }
    salvarDB();

    // O rascunho é apagado AQUI, depois de o lançamento entrar na memória e
    // no backup local, e não depois da confirmação do Firestore. `salvarDB`
    // pode passar meio minuto tentando de novo; nesse intervalo o rascunho
    // ainda existiria e reapareceria depois como uma nota fantasma.
    if (typeof fmRascunhoApagar === 'function') fmRascunhoApagar();

    // O contador de uso sobe só agora: passar por um nome na lista e escolher
    // outro não pode virar sinal de frequência.
    if (typeof fmUsoRegistrar === 'function') {
        fmUsoRegistrar('motorista', motorista);
        fmUsoRegistrar('placa', placa);
        fmUsoRegistrar('base', base);
    }

    if (!eraEdicao) _sessaoRegistrar(lancamento);

    if (modo === 'sair') {
        limparFormulario();
        // `mostrarTela('relatorios')` já chama carregarRelatorio() internamente —
        // por isso não há um segundo carregarRelatorio() aqui. Havia, e todo
        // salvamento renderizava a tabela duas vezes.
        mostrarTela('relatorios');

        // Após edição, reaplica os filtros que o usuário tinha montado em vez de
        // deixar o recarregamento padrão zerá-los.
        if (eraEdicao && typeof recarregarRelatorioSemZerarFiltros === 'function') {
            setTimeout(() => recarregarRelatorioSemZerarFiltros(), 0);
        }
        return;
    }

    // modo 'proxima': o operador continua onde está.
    if (eraEdicao) {
        // Correção em cadeia: a nota corrigida continua na tela para o caso de
        // haver mais de um erro nela.
        limparFormularioSujo();
        _sessaoRenderizar();
        return;
    }
    limparFormularioParcial();
}

/*=================================================
  RESET PARCIAL — o contexto do lote fica, a nota vai
=================================================*/
/**
 * Prepara a tela para a próxima nota do mesmo bolo.
 *
 * A divisão entre o que fica e o que sai é explícita de propósito. A lição
 * das ferramentas que erram isso (o "criar outro" do Jira é o exemplo
 * citado por quatro das cinco pesquisas) é que preservar campo errado em
 * silêncio gera registro errado que ninguém vê.
 *
 * Fica: Empresa (já travada pela empresa ativa), Base e Data da Descarga.
 * Sai:  Data da Nota, Número, Motorista, Placa, Observações e os itens.
 *
 * Motorista e Placa saem por decisão do dono: numa sequência de notas o
 * caminhão às vezes muda, e o custo dos dois erros é diferente. Limpar
 * quando devia preservar custa segundos de digitação; preservar quando
 * devia limpar produz nota com motorista errado que só aparece na
 * conferência. A sugestão cruzada em `combobox.js` devolve a velocidade
 * sem herdar nada.
 */
function limparFormularioParcial() {
    lancamentoEditandoId = null;
    isClonando = false;

    ["dataNota", "numeroNota", "observacoes"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
    });
    ["motoristaInput", "motoristaSelect", "placaInput", "placaSelect"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
    });
    document.getElementById("motoristaInput")?.classList.remove("campo-sugerido");
    document.getElementById("placaInput")?.classList.remove("campo-sugerido");
    document.getElementById("combustiveisNota").innerHTML = "";

    const bannerXML = document.getElementById("bannerXML");
    if (bannerXML) { bannerXML.style.display = "none"; bannerXML.innerHTML = ""; }
    document.getElementById("bannerEdicao").style.display = "none";
    document.getElementById("tituloLancamentos").textContent  = "Lançamento de Entrada";
    document.getElementById("btnSalvarLancamento").textContent = "Salvar e lançar próxima";
    const btnSair = document.getElementById("btnSalvarSair");
    if (btnSair) btnSair.textContent = "Salvar e sair";

    // A data da descarga fica, mas marcada: economizar oito dígitos não vale
    // um erro de data que passa em silêncio. A marca sai no primeiro toque.
    const marca = document.getElementById("marcaHerdada");
    if (marca) marca.style.display = document.getElementById("dataDescarga").value ? "inline-block" : "none";

    limparFormularioSujo();
    atualizarTotalizadorNota();
    _sessaoRenderizar();

    // O primeiro campo realmente novo é a Data da Nota, porque ela deixou de
    // ser herdada. O foco ir para lá é o que permite lançar sem tocar no mouse.
    const foco = document.getElementById("dataNota");
    if (foco) foco.focus();
}

function _limparMarcaHerdada() {
    const marca = document.getElementById("marcaHerdada");
    if (marca) marca.style.display = "none";
}

/*=================================================
  LANÇADAS NESTA SESSÃO
=================================================*/
/**
 * Lista as notas gravadas desde que a tela foi aberta.
 *
 * Existe porque salvar sem sair do lugar tira do operador a única prova que
 * ele tinha de que a nota entrou: a tabela do relatório. Sem prova visível,
 * ele vai conferir de qualquer forma e o ganho desaparece. É também a rede
 * de segurança do campo que ficou preenchido por engano — o erro aparece
 * na linha, não semanas depois.
 *
 * Guarda id e hora: o lançamento em si vive em `db.lancamentos`, e ler de lá
 * na hora de renderizar evita mostrar dado velho depois de uma edição. A hora
 * é anotada aqui, e não deduzida do log, porque log antigo é string sem
 * carimbo de tempo e daria hora errada.
 */
let _idsSessao = [];

function _sessaoRegistrar(lancamento) {
    _idsSessao.unshift({
        id: lancamento.id,
        hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    });
    _sessaoRenderizar();
}

function _sessaoRenderizar() {
    const bloco = document.getElementById("sessaoBloco");
    const lista = document.getElementById("sessaoLista");
    if (!bloco || !lista) return;

    const presentes = _idsSessao
        .map(reg => {
            const l = (db.lancamentos || []).find(x => x.id === reg.id);
            return l ? { l, hora: reg.hora } : null;
        })
        .filter(Boolean);

    if (!presentes.length) { bloco.style.display = "none"; lista.innerHTML = ""; return; }

    bloco.style.display = "block";
    const contador = document.getElementById("sessaoContador");
    if (contador) contador.textContent = `${presentes.length} nota${presentes.length > 1 ? "s" : ""}`;

    lista.innerHTML = presentes.map(({ l, hora }) => {
        const litros = (l.itens || []).reduce((s, i) => s + (parseFloat(i.qtd) || 0), 0);
        return `<div class="sessao-item">
            <span class="sessao-hora">${escapeHtml(hora)}</span>
            <span class="sessao-nota">${escapeHtml(l.numeroNota || "sem número")}</span>
            <span class="sessao-empresa">${escapeHtml(l.empresa || "")}</span>
            <span class="sessao-base">${escapeHtml(l.base || "—")}</span>
            <span class="sessao-litros">${fmtL3(litros)}</span>
            <span class="sessao-total">${fmtR(l.total || 0)}</span>
            <button class="btn-excluir" title="Desfazer este lançamento"
                    onclick="_sessaoDesfazer('${l.id}')">Desfazer</button>
        </div>`;
    }).join("");
}

async function _sessaoDesfazer(id) {
    const l = (db.lancamentos || []).find(x => x.id === id);
    if (!l) return;
    if (!await fmConfirm({
        titulo: "Desfazer o lançamento?",
        msg: `${l.numeroNota ? `Nota ${l.numeroNota}` : "Lançamento"} de ${l.empresa}.\n\nEle será apagado.`,
        confirmTxt: "Desfazer",
        tipo: "perigo"
    })) return;
    db.lancamentos = db.lancamentos.filter(x => x.id !== id);
    _idsSessao = _idsSessao.filter(x => x.id !== id);
    salvarDB();
    _sessaoRenderizar();
    mostrarToast("Lançamento desfeito.", "info");
}

/*=================================================
  EDITAR LANÇAMENTO
=================================================*/
/**
 * Abre o formulário de lançamento preenchido com os dados de um lançamento existente.
 * Define `lancamentoEditandoId` e `isClonando = false`.
 *
 * @param {string} id - ID do lançamento a editar
 */
function editarLancamento(id) {
    const l = db.lancamentos.find(x => x.id === id);
    if (!l) { console.warn('[editarLancamento] não encontrou id:', id); return; }

    lancamentoEditandoId = id;
    isClonando = false;
    mostrarTela("lancamentos");

    setTimeout(() => {
        document.getElementById("dataNota").value     = l.dataNota;
        document.getElementById("dataDescarga").value = l.dataDescarga || "";
        document.getElementById("numeroNota").value   = l.numeroNota;
        document.getElementById("observacoes").value  = l.observacoes || "";

        // ── usa setBase() para garantir sincronização dos três campos ──
        setBase(l.base || "");

        atualizarListas();
        const empresaInput = document.getElementById('empresaInput');
        if (empresaInput) empresaInput.disabled = false;
        document.getElementById("empresaInput").value    = l.empresa || "";
        document.getElementById("empresaSelect").value   = l.empresa || "";
        document.getElementById("motoristaInput").value  = l.motorista || "";
        document.getElementById("motoristaSelect").value = l.motorista || "";
        document.getElementById("placaInput").value      = l.placa || "";
        document.getElementById("placaSelect").value     = l.placa || "";
        document.getElementById("combustiveisNota").innerHTML = "";
        l.itens.forEach(item => adicionarCombustivelNota(item));

        const banner = document.getElementById("bannerEdicao");
        banner.style.display = "block";
        let bannerHtml = `Editando nota <strong>${escapeHtml(l.numeroNota)}</strong> — <a href="#" onclick="limparFormulario(); return false;">Cancelar edição</a>`;
        if (l.anexos && l.anexos.length > 0)
            bannerHtml += `<br><small>Este lançamento possui ${l.anexos.length} anexo(s). Você pode substituí-los ao salvar.</small>`;
        banner.innerHTML = bannerHtml;
        document.getElementById("tituloLancamentos").textContent  = "Editando Lançamento";
        _aplicarMarcadorSujo();   // trocar o texto do título apagava o marcador
        // Na edição o primário fica sendo só "Salvar", para correção em
        // cadeia: uma nota com dois erros não obriga a reabrir a tela.
        document.getElementById("btnSalvarLancamento").textContent = "Salvar";
        const btnSairEd = document.getElementById("btnSalvarSair");
        if (btnSairEd) btnSairEd.textContent = "Salvar e voltar";
        const marcaEd = document.getElementById("marcaHerdada");
        if (marcaEd) marcaEd.style.display = "none";
    }, 0);
}

/*=================================================
  CLONAR LANÇAMENTO
=================================================*/
/**
 * Abre o formulário preenchido com os dados de um lançamento existente,
 * mas tratado como novo (gera novo ID ao salvar).
 * Define `isClonando = true` para que `salvarLancamentoFinal` crie um registro novo.
 *
 * @param {string} id - ID do lançamento a clonar
 */
function clonarLancamento(id) {
    const l = db.lancamentos.find(x => x.id === id);
    if (!l) return;
    lancamentoEditandoId = null;
    isClonando = true;
    document.getElementById("dataNota").value     = "";
    document.getElementById("dataDescarga").value = l.dataDescarga || "";
    document.getElementById("numeroNota").value   = "";
    document.getElementById("observacoes").value  = l.observacoes || "";

    // ── usa setBase() para garantir sincronização dos três campos ──
    setBase(l.base || "");

    atualizarListas();
    document.getElementById("empresaInput").value    = l.empresa || "";
    document.getElementById("empresaSelect").value   = l.empresa || "";
    document.getElementById("motoristaInput").value  = l.motorista || "";
    document.getElementById("motoristaSelect").value = l.motorista || "";
    document.getElementById("placaInput").value      = l.placa || "";
    document.getElementById("placaSelect").value     = l.placa || "";
    document.getElementById("combustiveisNota").innerHTML = "";
    l.itens.forEach(item => adicionarCombustivelNota(item));
    document.getElementById("tituloLancamentos").textContent  = "Novo Lançamento (Clonado)";
    _aplicarMarcadorSujo();   // idem: o clone já nasce sujo
    document.getElementById("btnSalvarLancamento").textContent = "Salvar e lançar próxima";
    const btnSairCl = document.getElementById("btnSalvarSair");
    if (btnSairCl) btnSairCl.textContent = "Salvar e sair";
    document.getElementById("bannerEdicao").style.display = "none";
    mostrarTela("lancamentos");
}

/*=================================================
  LIMPAR FORMULÁRIO
=================================================*/
function limparFormulario() {
    lancamentoEditandoId = null;
    isClonando = false;
    ["dataNota","dataDescarga","numeroNota","observacoes"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
    });

    // ── usa setBase() para limpar os três campos de uma vez ──
    setBase("");

    document.getElementById("empresaInput").value     = "";
    document.getElementById("empresaSelect").value    = "";
    document.getElementById("motoristaInput").value   = "";
    document.getElementById("motoristaSelect").value  = "";
    document.getElementById("placaInput").value       = "";
    document.getElementById("placaSelect").value      = "";
    document.getElementById("combustiveisNota").innerHTML = "";
    document.getElementById("motoristaInput").classList.remove("campo-sugerido");
    document.getElementById("placaInput").classList.remove("campo-sugerido");
    document.getElementById("tituloLancamentos").textContent  = "Lançamento de Entrada";
    document.getElementById("btnSalvarLancamento").textContent = "Salvar e lançar próxima";
    const btnSairLimpo = document.getElementById("btnSalvarSair");
    if (btnSairLimpo) btnSairLimpo.textContent = "Salvar e sair";
    document.getElementById("bannerEdicao").style.display = "none";
    const bannerXML = document.getElementById("bannerXML");
    if (bannerXML) bannerXML.style.display = "none";
    const marca = document.getElementById("marcaHerdada");
    if (marca) marca.style.display = "none";
    limparFormularioSujo();
    if (typeof fmRascunhoApagar === 'function') fmRascunhoApagar();
    atualizarTotalizadorNota();
}

/**
 * O botão Cancelar, agora com pergunta.
 *
 * `limparFormulario` apagava a tela inteira num clique, sem confirmar, e era
 * um dos caminhos de perda real de trabalho preenchido. Agora só pergunta
 * quando há algo a perder.
 */
async function descartarFormulario() {
    if (_formularioSujo) {
        if (!await fmConfirm({
            titulo: "Descartar o que está preenchido?",
            msg: "O lançamento em andamento será apagado desta tela.",
            confirmTxt: "Descartar",
            cancelTxt: "Continuar preenchendo",
            tipo: "perigo"
        })) return;
    }
    limparFormulario();
}

/*=================================================
  EXCLUIR LANÇAMENTO
=================================================*/
/**
 * Exclui um lançamento após confirmação do usuário via `fmConfirm`.
 *
 * @param {string} id                          - ID do lançamento
 * @param {'relatorio'} [contexto='relatorio'] - Tela de origem (para rerenderizar após exclusão)
 * @returns {Promise<void>}
 */
async function excluirLancamento(id, contexto = 'relatorio') {
    const l = db.lancamentos.find(x => x.id === id);
    if (!l) return;

    const descricao = [
        l.numeroNota ? `Nota ${l.numeroNota}` : null,
        l.empresa    ? `de ${l.empresa}`       : null,
        l.dataNota   ? `(${formatarData(l.dataNota)})` : null
    ].filter(Boolean).join(" ");

    if (!await fmConfirm({ titulo: `Excluir lançamento?`, msg: `${descricao}\n\nEsta ação não pode ser desfeita.`, confirmTxt: "Excluir", tipo: "perigo" })) return;

    db.lancamentos = db.lancamentos.filter(x => x.id !== id);
    salvarDB();
    recarregarRelatorioSemZerarFiltros();
}
