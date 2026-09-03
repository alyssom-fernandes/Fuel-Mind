/*=================================================
  LANÇAMENTOS.JS – com autocomplete, múltiplos anexos,
  spinner, validação de duplicidade de nota
  e conversão automática de placa para Mercosul
  FIX: manter filtros do relatório após salvar edição
=================================================*/

let lancamentoEditandoId = null;
let isClonando = false;

/**
 * Chave de acesso da NF-e (44 dígitos) do lançamento em tela, quando ele
 * veio de um XML. Nunca é digitada nem exibida como campo: sai do atributo
 * `Id` de `infNFe` e serve só para reconhecer a mesma nota depois.
 */
let _chaveAcessoAtual = null;

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

            // A chave de acesso está no atributo `Id`, no formato "NFe" + 44
            // dígitos. É o identificador fiscal da nota; guardá-la não é
            // guardar o XML, e é o que permite bloquear a mesma NF-e lançada
            // duas vezes sem depender de número mais empresa mais data.
            const chaveBruta = (infNFe.getAttribute("Id") || "").replace(/^NFe/i, "").replace(/\D/g, "");
            _chaveAcessoAtual = chaveBruta.length === 44 ? chaveBruta : null;
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

            // O XML preenche seis campos por script, e preenchimento por
            // script não dispara `change`. Sem esta chamada, uma nota com
            // data ou chave repetida vinda de arquivo ficaria muda até o
            // operador tocar em algum campo.
            if (typeof validarLancamento === 'function') validarLancamento();
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
        const qtd   = parseNumeroBR(linha.querySelector(".qtd")?.value)   || 0;
        const valor = parseNumeroBR(linha.querySelector(".valor")?.value) || 0;
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
/**
 * Formata o valor que vai no atributo `value` de um campo numérico da
 * linha de combustível.
 *
 * O valor pode chegar como número (do XML, de um clone, de um lançamento
 * em edição) ou como o texto cru que o operador tinha digitado (do
 * rascunho restaurado). O texto cru é devolvido como está, porque
 * reinterpretá-lo aqui poderia mudar o que a pessoa escreveu; o número
 * sai no formato de exibição.
 *
 * O retorno passa por `escapeHtml` em quem chama: quando o campo era
 * `type="number"` o navegador garantia que só houvesse dígitos ali, e
 * essa garantia acabou junto com o tipo nativo.
 */
function _valorInicialNumero(v, casas) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") return fmtNumeroExibicao(v, casas);
    return String(v);
}

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
        <input type="text" inputmode="decimal" autocomplete="off" class="qtd fm-numero" placeholder="Qtd carga (L)"
               value="${escapeHtml(_valorInicialNumero(dadosIniciais?.qtd, 3))}"
               oninput="atualizarTotalizadorNota(); marcarFormularioSujo();"
               onblur="atualizarBadgePerda(this.closest('.linha-combustivel').querySelector('.tipo'))">
        <input type="text" inputmode="decimal" autocomplete="off" class="qtdDescargada fm-numero" placeholder="Qtd descarga (L)"
               value="${escapeHtml(_valorInicialNumero(dadosIniciais?.qtdDescargada, 3))}"
               oninput="marcarFormularioSujo();"
               onblur="atualizarBadgePerda(this.closest('.linha-combustivel').querySelector('.tipo'))">
        <input type="text" inputmode="decimal" autocomplete="off" class="valor fm-numero" placeholder="Valor unit. (R$)"
               value="${escapeHtml(_valorInicialNumero(dadosIniciais?.valor, 4))}"
               oninput="atualizarTotalizadorNota(); marcarFormularioSujo();">
        <div class="badge-wrapper"></div>
        <button class="btn-excluir" onclick="this.parentElement.remove(); atualizarTotalizadorNota();">Remover</button>`;
    container.appendChild(div);
    // A linha nasce depois da carga da página, então precisa ser preparada
    // aqui: é o que aplica teclado decimal, formatação e bloqueio da roda.
    if (typeof fmNumericoAtivar === 'function') fmNumericoAtivar(div);
    if (dadosIniciais?.tipo) atualizarBadgePerda(div.querySelector(".tipo"));
    atualizarTotalizadorNota();
    marcarFormularioSujo();
}

function atualizarBadgePerda(selectTipo) {
    const linha = selectTipo.closest(".linha-combustivel");
    linha.querySelector(".badge-wrapper").innerHTML = calcularPerdaBadge(
        selectTipo.value,
        parseNumeroBR(linha.querySelector(".qtd").value),
        parseNumeroBR(linha.querySelector(".qtdDescargada").value)
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

    // ── Validação ──
    // Os cinco `fmConfirm` de julgamento que existiam aqui — data futura na
    // nota, na descarga, descarga antes da nota, nota duplicada e preço fora
    // da média, este por linha — saíram. Uma nota com três combustíveis fora
    // da média e uma data errada abria seis janelas em fila, e o operador
    // aprendia a apertar Enter sem ler. Agora cada julgamento aparece no
    // campo que o produz, assim que há dado para julgá-lo, e este ponto só
    // consolida: bloqueio impede, alerta entra na conferência.
    _tentouSalvar = true;
    const { bloqueios, alertas } = validarLancamento();

    if (bloqueios.length) {
        esconderSpinner(btn);
        const primeiro = bloqueios.find(b => b.campo);
        if (primeiro) _focarCampoValidacao(primeiro.campo);
        else document.getElementById("faixaValidacao")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }

    const itens = [];
    let total = 0;
    for (const linha of document.querySelectorAll(".linha-combustivel")) {
        const tipo          = linha.querySelector(".tipo").value;
        // `parseNumeroBR` devolve null no que não entendeu, e a validação já
        // barrou esse caso antes de chegar aqui; o `?? 0` só cobre campo
        // vazio, que é zero de verdade.
        const qtd           = parseNumeroBR(linha.querySelector(".qtd").value) ?? 0;
        const qtdDescargada = parseNumeroBR(linha.querySelector(".qtdDescargada").value) ?? 0;
        const valor         = parseNumeroBR(linha.querySelector(".valor").value) ?? 0;
        if (tipo && qtd > 0) {
            const itemTotal = qtd * valor;
            itens.push({ tipo, qtd, qtdDescargada, valor, total: itemTotal });
            total += itemTotal;
        }
    }

    // ── Conferência final ──
    // É o único modal do caminho de salvar, e agora é também o lugar onde os
    // alertas são consolidados: em vez de uma janela por julgamento, uma
    // lista com todos, cada um com o valor concreto que o gerou.
    //
    // Em "lançar próxima" ela aparece sempre, porque o operador não passa
    // pelo relatório e esta é a única chance de olhar a nota inteira antes
    // de ela existir — é o trade-off de segurança escolhido pelo dono. Em
    // "salvar e sair" só aparece quando há alerta: quem sai cai no relatório
    // e confere lá, então perguntar por rotina seria um clique sem retorno.
    const precisaConferir = (modo === 'proxima' && !lancamentoEditandoId) || alertas.length > 0;
    if (precisaConferir) {
        const litros = itens.reduce((s, i) => s + (Number(i.qtd) || 0), 0);
        const cabecalho = alertas.length
            ? (alertas.length === 1 ? "1 ponto para conferir:\n" : `${alertas.length} pontos para conferir:\n`)
              + alertas.map(a => `  • ${a.texto}`).join("\n") + "\n\n"
            : "";
        const resumo = cabecalho
            + `Empresa: ${empresa}\n`
            + `Base: ${base || "—"}\n`
            + `Data da nota: ${formatarData(dataNota)}${dataDescarga ? `   Descarga: ${formatarData(dataDescarga)}` : ""}\n`
            + `Nota: ${numeroNota || "—"}\n`
            + `Motorista: ${motorista}   Placa: ${placa}\n`
            + `${itens.length} combustível(is), ${fmtL3(litros)}\n`
            + `Total: ${fmtR(total)}`;
        if (!await fmConfirm({
            titulo: alertas.length ? "Confirmar apesar dos alertas" : "Confirmar lançamento",
            msg: resumo,
            confirmTxt: modo === 'sair' ? "Confirmar e sair" : "Confirmar e lançar próxima",
            cancelTxt: "Voltar e corrigir",
            tipo: alertas.length ? "aviso" : "info"
        })) { esconderSpinner(btn); return; }
    }

    salvarLancamentoFinal(dataNota, dataDescarga, numeroNota, base, empresa,
                          motorista, placa, itens, total, observacoes, [], undefined, modo, alertas);
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
 * @param {Array} [alertas=[]] - alertas que o operador aceitou na conferência;
 *   viram uma linha de log, não um estado no lançamento
 */
function salvarLancamentoFinal(dataNota, dataDescarga, numeroNota, base, empresa, motorista, placa, itens, total, observacoes, arquivos, lancamentoIdPreGerado, modo = 'proxima', alertas = []) {
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

    // Chave de acesso da NF-e, quando a nota veio de XML. Nunca digitada:
    // é o identificador fiscal que permite dizer "esta nota já foi lançada"
    // com certeza, em vez de deduzir por número mais empresa mais data, que
    // é só coincidência forte — número de nota se repete entre emitentes.
    if (typeof _chaveAcessoAtual !== 'undefined' && _chaveAcessoAtual) {
        lancamento.chaveAcesso = _chaveAcessoAtual;
    }

    // Alertas aceitos viram log, não estado. Um campo `revisao` no lançamento
    // ficaria obsoleto assim que outra pessoa editasse a nota, e criaria um
    // estado distribuído para resolver. O log já é o lugar da auditoria.
    if (alertas && alertas.length) {
        lancamento.logs.push({
            acao:    "Salvo com alertas",
            ts:      new Date().toISOString(),
            usuario: window._usuarioAtual?.nome || '—',
            alertas: alertas.map(a => a.texto)
        });
    }

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

    // A chave pertencia à nota que acabou de ser gravada; a próxima começa
    // sem ela, mesmo que o contexto do lote continue.
    _chaveAcessoAtual = null;
    if (typeof limparValidacao === 'function') limparValidacao();
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
        const litros = (l.itens || []).reduce((s, i) => s + (Number(i.qtd) || 0), 0);
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
        _chaveAcessoAtual = l.chaveAcesso || null;
        if (typeof validarLancamento === 'function') validarLancamento();
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
    // O clone é outra nota: herdar a chave do original faria o sistema
    // acusar duplicidade da própria cópia, e ela nem é a mesma NF-e.
    _chaveAcessoAtual = null;
    mostrarTela("lancamentos");
    if (typeof validarLancamento === 'function') setTimeout(validarLancamento, 0);
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
    _chaveAcessoAtual = null;
    if (typeof limparValidacao === 'function') limparValidacao();
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
