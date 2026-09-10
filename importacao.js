/*=================================================
  IMPORTAÇÃO DE HISTÓRICO VIA EXCEL / CSV
  Permite importar lançamentos históricos de
  planilhas .xlsx, .xls ou .csv.
  Não remove dados existentes — apenas acrescenta.
  
  Formatos suportados:
  - Padrão sistema (uma linha por combustível)
  - TRR Fabiandra (DATA NF / DATA ENTRADA/SAÍDA / NFE / PRODUTO...)
  - Posto Rosário (wide: múltiplas colunas de combustível)
=================================================*/

/*─────────────────────────────────────────────
  ESTADO DA IMPORTAÇÃO
─────────────────────────────────────────────*/
let importacaoLinhas      = [];
let importacaoMapeamento  = {};
let importacaoArquivoNome = "";
let _importacaoNovasPendentes      = [];
let _importacaoDuplicatasPendentes = [];

/*─────────────────────────────────────────────
  CAMPOS DO SISTEMA (para mapeamento manual)
─────────────────────────────────────────────*/
const CAMPOS_IMPORTACAO = [
    { id: "dataNota",      label: "Data da Nota *",          obrigatorio: true  },
    { id: "dataDescarga",  label: "Data da Descarga",        obrigatorio: false },
    { id: "numeroNota",    label: "Número da Nota *",        obrigatorio: true  },
    { id: "base",          label: "Base (Distribuidora)",    obrigatorio: false },
    { id: "empresa",       label: "Empresa / Fornecedor",    obrigatorio: false },
    { id: "motorista",     label: "Motorista *",             obrigatorio: true  },
    { id: "placa",         label: "Placa do Veículo *",      obrigatorio: true  },
    { id: "combustivel",   label: "Tipo de Combustível *",   obrigatorio: true  },
    { id: "qtd",           label: "Quantidade (Litros) *",   obrigatorio: true  },
    { id: "qtdDescargada", label: "Qtd Descargada (L)",      obrigatorio: false },
    { id: "valor",         label: "Valor Unitário (R$/L) *", obrigatorio: true  },
    { id: "observacoes",   label: "Observações",             obrigatorio: false },
];

/*─────────────────────────────────────────────
  SINÔNIMOS — inclui colunas Fabiandra e Rosário
─────────────────────────────────────────────*/
const SINONIMOS_IMPORTACAO = {
    dataNota:      ["data nota","data da nota","data nf","data_nota","datanota","data"],
    dataDescarga:  ["data descarga","data da descarga","descarga","data_descarga",
                    "data entrada","data entrada/saida","data entrada/saída",
                    "data saida","data saída","entrada/saida","entrada saida"],
    numeroNota:    ["numero nota","número nota","nf","nota","n nota","num nota",
                    "numero_nota","numnota","nf-e","numero","nfe","chave nf"],
    base:          ["base","distribuidora","origem"],
    empresa:       ["empresa","fornecedor","posto","trr","empresa/fornecedor","trr/posto"],
    motorista:     ["motorista","driver","condutor"],
    placa:         ["placa","veiculo","veículo","placa veiculo","placa do veiculo"],
    combustivel:   ["combustivel","combustível","produto","tipo","tipo combustivel",
                    "tipo de combustivel","descricao","descrição"],
    qtd:           ["qtd","litros","quantidade","litros nota","qtd litros","qtd carga",
                    "quantidade litros","carga","volume","qtde"],
    qtdDescargada: ["qtd descarga","descargada","qtd descargada","descarga litros","litros descarga"],
    valor:         ["valor","preco","preço","valor unit","valor unitario","valor unitário",
                    "r$/l","preco unitario","preço unitário","r$ unit","vl unit","vl unitario"],
    observacoes:   ["obs","observacao","observação","observacoes","observações","notas"],
};

/*─────────────────────────────────────────────
  IDENTIDADE DE UMA NOTA NA IMPORTAÇÃO
─────────────────────────────────────────────*/
/**
 * Chave que diz se duas notas são a mesma nota, para a importação.
 *
 * **A empresa faz parte da identidade.** Sem ela, uma nota legítima de
 * outra empresa com o mesmo número e a mesma placa era classificada como
 * duplicata — e, ao ser marcada para reimportar, o filtro que remove as
 * duplicatas varria o `db.lancamentos` inteiro (que tem em memória os
 * lançamentos de todas as empresas que o usuário enxerga) e apagava a
 * nota da outra empresa junto, de forma permanente e silenciosa.
 *
 * Usa `normalizarTexto` pelo mesmo motivo que a checagem de duplicata de
 * cadastro passou a usar: "José" e "Jose" são a mesma pessoa, e "abc1d23"
 * é a mesma placa que "ABC1D23".
 */
function _chaveNotaImportacao(n) {
    return [n.empresa, n.numeroNota, n.dataNota, n.placa]
        .map(v => normalizarTexto(String(v ?? "")))
        .join("||");
}

/*─────────────────────────────────────────────
  NORMALIZAR NOME DE COLUNA
─────────────────────────────────────────────*/
function _normCol(str) {
    return String(str || "")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s\/]/g, "")
        .trim();
}

/*─────────────────────────────────────────────
  DETECTAR FORMATO DA PLANILHA
─────────────────────────────────────────────*/
function _detectarFormato(cabecalho) {
    const cols = cabecalho.map(_normCol);

    // Formato Fabiandra: tem "nfe" ou "data entrada" e colunas simples
    const temNFE       = cols.some(c => c === "nfe" || c === "nf-e");
    const temEntrada   = cols.some(c => c.includes("entrada") || c.includes("saida") || c.includes("saída"));
    const temProduto   = cols.some(c => c === "produto" || c === "descricao" || c === "descricão");
    const temValorNota = cols.some(c => c.includes("valor nota") || c.includes("vl nota") || c.includes("total nota"));

    if ((temNFE || temEntrada) && temProduto) return "fabiandra";

    // Formato wide (Posto Rosário): tem colunas "d. s-500", "d-s 10", "gas", "etanol"
    const temColunaWide = cols.some(c =>
        c.includes("s-500") || c.includes("s 500") ||
        c.includes("s-10")  || c.includes("s 10")  ||
        c.includes("gasolina") || c.includes("etanol")
    );
    if (temColunaWide) return "wide";

    return "padrao";
}

/*─────────────────────────────────────────────
  LEITURA DO ARQUIVO
─────────────────────────────────────────────*/
function importacaoLerArquivo(input) {
    const file = input.files[0];
    if (!file) return;

    importacaoArquivoNome = file.name;
    const ext = file.name.split(".").pop().toLowerCase();

    if (!["xlsx","xls","csv"].includes(ext)) {
        mostrarToast("Selecione um arquivo .xlsx, .xls ou .csv", "aviso", 4000);
        input.value = "";
        return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            let linhas = [];

            if (ext === "csv") {
                linhas = importacaoLerCSV(e.target.result);
            } else {
                // Lê células de data como texto puro (raw:true) para evitar
                // que o XLSX interprete e inverta DD/MM em datas com dia <= 12.
                // Datas Excel (serial numérico) são convertidas manualmente no normalizador.
                const workbook = XLSX.read(e.target.result, { type: "binary", cellDates: false, cellText: false });
                const aba = workbook.Sheets[workbook.SheetNames[0]];

                // Converte seriais numéricos de data (40000-60000) para "DD/MM/YYYY"
                // manualmente — evita que o XLSX inverta dia/mês.
                // ATENÇÃO: só converte colunas cujo cabeçalho indica data.
                // Colunas de quantidade e valor unitário ficam intactas, pois
                // valores como 45000 L caem no mesmo intervalo de datas e seriam
                // erroneamente convertidos (ex: 45000 → "14/03/2023" → parseFloat = 14).
                const _serialParaData = (n) => {
                    const d = new Date(Math.round((n - 25569) * 86400000));
                    return String(d.getUTCDate()).padStart(2,"0") + "/" +
                           String(d.getUTCMonth()+1).padStart(2,"0") + "/" +
                           d.getUTCFullYear();
                };
                const range = XLSX.utils.decode_range(aba["!ref"] || "A1");

                // Identifica quais colunas são de data pelo cabeçalho (linha 0)
                const _colunasData = new Set();
                for (let C = range.s.c; C <= range.e.c; C++) {
                    const addrCab = XLSX.utils.encode_cell({ r: range.s.r, c: C });
                    const cabCell = aba[addrCab];
                    if (!cabCell) continue;
                    const cabNorm = String(cabCell.v || "").toLowerCase()
                        .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
                        .replace(/[^a-z0-9\s]/g,"").trim();
                    // Cabeçalhos que indicam data — nunca quantidade ou valor
                    if (cabNorm.includes("data") || cabNorm.includes("date") ||
                        cabNorm === "dt" || cabNorm.includes("vencimento") ||
                        cabNorm.includes("emissao") || cabNorm.includes("entrada") ||
                        cabNorm.includes("saida") || cabNorm.includes("descarga")) {
                        _colunasData.add(C);
                    }
                }

                for (let R = range.s.r + 1; R <= range.e.r; R++) {
                    for (const C of _colunasData) {
                        const addr = XLSX.utils.encode_cell({ r: R, c: C });
                        const cell = aba[addr];
                        if (!cell) continue;
                        if (cell.t === "n" && cell.v > 40000 && cell.v < 60000) {
                            cell.t = "s";
                            cell.v = _serialParaData(cell.v);
                            cell.w = cell.v;
                            delete cell.z;
                        }
                    }
                }

                linhas = XLSX.utils.sheet_to_json(aba, { header: 1, defval: "", raw: false });
            }

            // Remove linhas completamente vazias
            linhas = linhas.filter(l => l.some(c => String(c || "").trim() !== ""));

            if (!linhas || linhas.length < 2) {
                mostrarToast("O arquivo está vazio ou só tem cabeçalho.", "aviso", 4000);
                input.value = "";
                return;
            }

            importacaoLinhas     = linhas;
            importacaoMapeamento = {};

            const formato = _detectarFormato(linhas[0]);

            if (formato === "wide") {
                // Converte automaticamente para o formato padrão antes de exibir
                importacaoLinhas = _converterWideParaPadrao(linhas);
                mostrarToast("Formato Posto Rosário detectado — convertido automaticamente ✓", "info", 5000);
            } else if (formato === "fabiandra") {
                mostrarToast("Formato TRR Fabiandra detectado — mapeamento automático ✓", "info", 4000);
            }

            importacaoRenderizarEtapa1();
            importacaoRenderizarEtapa2(importacaoLinhas[0]);

            const resultado = document.getElementById("importacaoResultado");
            const etapas    = document.getElementById("importacaoEtapas");
            if (resultado) resultado.style.display = "none";
            if (etapas)    etapas.style.display    = "block";

            mostrarToast(`"${file.name}" lido — ${importacaoLinhas.length - 1} linha(s) de dados`, "info");

        } catch(err) {
            mostrarToast("Erro ao ler o arquivo: " + err.message, "erro", 5000);
        }
        input.value = "";
    };

    if (ext === "csv") reader.readAsText(file, "UTF-8");
    else               reader.readAsBinaryString(file);
}

function importacaoLerCSV(texto) {
    const linhas = texto.split(/\r?\n/).filter(l => l.trim() !== "");
    return linhas.map(linha => {
        const sep = linha.includes(";") ? ";" : ",";
        return linha.split(sep).map(c => c.replace(/^"|"$/g, "").trim());
    });
}

/*─────────────────────────────────────────────
  CONVERTER WIDE (Posto Rosário) → PADRÃO
  Detecta todas as colunas pelo nome — robusto
  a mudanças de posição e novas colunas.
─────────────────────────────────────────────*/
/**
 * Converte planilha no formato "wide" (Posto Rosário) para o formato padrão
 * linha-por-combustível usado internamente pelo sistema.
 *
 * No formato wide, cada linha representa uma nota fiscal e as quantidades +
 * valores de cada combustível ocupam colunas adjacentes (ex: coluna "D. S-10"
 * seguida de coluna "R$/unit S-10"). Este conversor:
 *
 * 1. Localiza colunas fixas (data NF, NF, base, empresa, placa, motorista)
 *    pelo nome — insensível a posição e a variações de grafia.
 * 2. Detecta pares [qtd, valor] de cada combustível varrendo o cabeçalho,
 *    cruzando com mapa de abreviações conhecido e com `db.combustiveis`
 *    para obter o nome canônico cadastrado.
 * 3. Expande cada linha original em N linhas padrão (uma por combustível
 *    com qtd > 0 e valor > 0).
 * 4. Normaliza datas: "28-jan-26", "02/01/2026", serial Excel, etc.
 * 5. Normaliza números: remove separadores de milhar BR, converte vírgula
 *    decimal para ponto, ignora prefixos "R$".
 *
 * @param {Array<Array<string>>} linhas - Matriz lida pelo SheetJS onde
 *   `linhas[0]` é o cabeçalho e `linhas[1..n]` são os dados.
 * @returns {Array<Array<string>>} Nova matriz no formato padrão (cabeçalho
 *   em [0], uma linha por combustível por nota nas demais posições).
 */
function _converterWideParaPadrao(linhas) {
    const cabecalho = linhas[0];
    const cols      = cabecalho.map(_normCol);

    // ── Localiza colunas fixas pelo nome ─────────────────────────
    const _find = (...termos) => cols.findIndex(c => termos.some(t => c === t || c.includes(t)));

    const idxDataNota  = _find("data nf", "datanf");
    const idxDataDesc  = _find("data descarga", "descarga");
    const idxNF        = _find("nf", "nfe", "numero nota", "num nota");
    const idxBase      = _find("base");
    const idxEmpresa   = _find("empresa", "fornecedor", "posto", "trr");
    const idxPlaca     = _find("placa");
    const idxMotorista = _find("motorista");

    // ── Detecta pares [qtd, valor] de cada combustível ───────────
    // Estratégia: varre o cabeçalho buscando nomes de combustíveis.
    // A coluna seguinte (que contém "unit", "r$", "$" ou está vazia) é o valor.
    // O nome final do combustível é buscado no cadastro do sistema para evitar
    // criar duplicatas — se não encontrar, usa o nome da coluna como fallback.

    function _nomeCombustivelDaColuna(colNorm) {
        const cc = colNorm.replace(/[^a-z0-9]/g,"");

        // ── 1. Mapa fixo de abreviações conhecidas → nome canônico ───
        // Resolve casos como "D. S-500"→"ds500", "D-S 10"→"ds10",
        // "Gas. V power"→"gasvpower", "Gasolina C"→"gasolinac"
        const MAPA = [
            { termos: ["ds500","s500","diesel500","ds-500"],                    canon: "Diesel S-500"     },
            { termos: ["ds10","s10","diesel10","ds-10","dsel10"],               canon: "Diesel S-10"      },
            // V-Power ANTES de Gasolina Comum: "gasolina" está contido em "gasolinavpower",
            // então se Gasolina Comum vier primeiro ela engole a V-Power.
            { termos: ["gasvpower","gasvp","gasolinav","vpower","vpow",
                       "gasolinaaditivada","gasolinapremium"],                  canon: "Gasolina V-Power" },
            // "gasolina" puro removido dos termos — tratado como fallback após o loop
            // para não casar falsamente com "gasolinavpower".
            { termos: ["gasolinac","gasolinacomum","gascomum"],                 canon: "Gasolina Comum"   },
            { termos: ["etanol","alcool","ethanol","aehc"],                     canon: "Etanol"           },
        ];

        // Primeiro tenta casar pelo mapa fixo para obter o nome canônico
        let nomeCanon = null;
        for (const { termos, canon } of MAPA) {
            if (termos.some(t => cc === t || cc.includes(t) || t.includes(cc))) {
                nomeCanon = canon;
                break;
            }
        }

        // Fallback: "gasolina" puro (sem sufixo v/vpower) → Gasolina Comum
        // Só chega aqui se não casou com V-Power nem com os termos específicos acima.
        if (!nomeCanon && cc.includes("gasolina") && !cc.includes("vpower") && !cc.includes("vpow") && !cc.includes("gasolinav")) {
            nomeCanon = "Gasolina Comum";
        }

        // ── 2. Com o nome canônico, busca o cadastro do sistema ───────
        // Isso garante que "Gasolina VP" casa com o que estiver cadastrado
        // (seja "Gasolina VP", "Gasolina V-Power", "Gas. V-Power", etc.)
        if (nomeCanon) {
            const cnCanon = nomeCanon.replace(/[^a-z0-9]/g,"");
            const cadastrado = db.combustiveis.find(cad => {
                const cn = _normCol(cad.nome).replace(/[^a-z0-9]/g,"");
                return cn === cnCanon || cn.includes(cnCanon) || cnCanon.includes(cn);
            });
            if (cadastrado) return cadastrado.nome;
            return nomeCanon; // usa o canônico mesmo sem cadastro
        }

        // ── 3. Fallback: tenta casar direto com qualquer cadastrado ──
        const cadastrado = db.combustiveis.find(cad => {
            const cn = _normCol(cad.nome).replace(/[^a-z0-9]/g,"");
            return cn === cc || cn.includes(cc) || cc.includes(cn);
        });
        if (cadastrado) return cadastrado.nome;

        return null; // coluna não reconhecida — ignora
    }

    // Índices das colunas que são "R$/unit" (para não confundi-las com qtd)
    const idxsValor = new Set();
    const combustiveisCols = [];

    cols.forEach((c, i) => {
        // Pula colunas já marcadas como valor, colunas fixas e colunas não-combustível
        const cn = c.replace(/[^a-z0-9]/g,"");
        const ehFixa = [idxDataNota,idxDataDesc,idxNF,idxBase,idxEmpresa,idxPlaca,idxMotorista].includes(i);
        const ehValorOuIgnorada = idxsValor.has(i) || ehFixa ||
            cn === "" || cn.includes("lts") || cn.includes("perca") ||
            cn.includes("compl") || cn.includes("qtde") || cn.includes("qtd");
        if (ehValorOuIgnorada) return;

        // Verifica se a próxima coluna parece ser valor unitário
        const prox = cols[i + 1] || "";
        const proxCn = prox.replace(/[^a-z0-9]/g,"");
        const proxEhValor = prox.includes("unit") || prox.includes("r$") ||
                            prox.includes("$")    || proxCn === "";

        if (!proxEhValor || i + 1 >= cols.length) return;

        const nomeComb = _nomeCombustivelDaColuna(c);
        if (!nomeComb) return;
        if (combustiveisCols.some(x => x.nome === nomeComb)) return; // evita duplicar

        combustiveisCols.push({ nome: nomeComb, idxQtd: i, idxValor: i + 1 });
        idxsValor.add(i + 1);
    });

    // ── Normaliza datas "28-jan-26", "02/01/2026", etc. ──────────
    const MESES_PT = {
        jan:"01",fev:"02",mar:"03",abr:"04",mai:"05",jun:"06",
        jul:"07",ago:"08",set:"09",out:"10",nov:"11",dez:"12"
    };
    function normData(val) {
        if (!val || String(val).trim() === "") return "";
        const v = String(val).trim().toLowerCase();
        // "28-jan-26" ou "1-fev-26"
        const mPT = v.match(/^(\d{1,2})[-\/]([a-z]{3})[-\/](\d{2,4})$/);
        if (mPT) {
            const dia = mPT[1].padStart(2,"0");
            const mes = MESES_PT[mPT[2]] || "01";
            const ano = mPT[3].length === 2 ? "20"+mPT[3] : mPT[3];
            return `${ano}-${mes}-${dia}`;
        }
        return importacaoNormalizarData(val);
    }

    // ── Limpa número (milhar e decimal BR) + remove "R$" ─────────
    function limparNum(val) {
        let s = String(val || "").replace(/R\$/gi,"").replace(/\s/g,"").trim();
        if (s.includes(",")) {
            s = s.replace(/\./g,"").replace(",",".");
        } else if ((s.match(/\./g)||[]).length === 1) {
            const p = s.split(".");
            if (p[1] && p[1].length === 3) s = s.replace(".","");
        }
        return s;
    }

    // ── Monta linhas no formato padrão ───────────────────────────
    const novoCabecalho = [
        "Data Nota","Data Descarga","Numero Nota","Base",
        "Empresa","Motorista","Placa",
        "Combustivel","Qtd Litros","Qtd Descargada","Valor Unitario","Observacoes"
    ];
    const novasLinhas = [novoCabecalho];

    linhas.slice(1).forEach(linha => {
        if (linha.every(c => String(c||"").trim() === "")) return;

        const g = idx => idx >= 0 ? String(linha[idx]||"").trim() : "";

        const dataNota    = normData(g(idxDataNota));
        const dataDescarg = normData(g(idxDataDesc));
        const nf          = g(idxNF).replace(/\./g,"").replace(/,/g,"");
        const base        = g(idxBase);
        const empresa     = g(idxEmpresa);
        const placa       = g(idxPlaca).toUpperCase();
        const motorista   = g(idxMotorista);

        if (!nf || !placa || !motorista) return;

        combustiveisCols.forEach(({ nome, idxQtd, idxValor }) => {
            const qtd = parseFloat(limparNum(linha[idxQtd]));
            const vl  = parseFloat(limparNum(linha[idxValor]));
            if (!qtd || qtd <= 0 || !vl || vl <= 0) return;

            novasLinhas.push([
                dataNota, dataDescarg,
                nf, base, empresa, motorista, placa,
                nome,
                String(qtd), "", String(vl.toFixed(4)),
                ""
            ]);
        });
    });

    return novasLinhas;
}

/*─────────────────────────────────────────────
  ETAPA 1 — Preview do arquivo
─────────────────────────────────────────────*/
function importacaoRenderizarEtapa1() {
    const preview = document.getElementById("importacaoPreview");
    if (!preview) return;

    const cabecalho = importacaoLinhas[0];
    const amostra   = importacaoLinhas.slice(1, 4);

    preview.innerHTML = `
        <p class="dica" style="margin-bottom:8px">
            <strong>${importacaoLinhas.length - 1}</strong> linha(s) encontradas em
            <strong>${escapeHtml(importacaoArquivoNome)}</strong>.
            Abaixo, uma amostra das primeiras linhas:
        </p>
        <div style="overflow-x:auto">
            <table class="tabela-preview">
                <thead>
                    <tr>${cabecalho.map((c,i) => `<th>Col ${i+1}<br><small>${escapeHtml(String(c).substring(0,20))}</small></th>`).join("")}</tr>
                </thead>
                <tbody>
                    ${amostra.map(linha =>
                        `<tr>${cabecalho.map((_,i) => `<td>${escapeHtml(String(linha[i] || "").substring(0,25))}</td>`).join("")}</tr>`
                    ).join("")}
                </tbody>
            </table>
        </div>
    `;
}

/*─────────────────────────────────────────────
  ETAPA 2 — Mapeamento de colunas
─────────────────────────────────────────────*/
function importacaoRenderizarEtapa2(cabecalho) {
    const container = document.getElementById("importacaoMapeamento");
    if (!container) return;

    const autoMap = {};
    cabecalho.forEach((col, idx) => {
        const colNorm = _normCol(col);
        for (const [campo, termos] of Object.entries(SINONIMOS_IMPORTACAO)) {
            if (termos.some(t => colNorm.includes(t) || t.includes(colNorm))) {
                if (autoMap[campo] === undefined) autoMap[campo] = idx;
            }
        }
    });

    const opcoes = `<option value="">-- Não importar --</option>` +
        cabecalho.map((c,i) => `<option value="${i}">Col ${i+1}: ${escapeHtml(String(c).substring(0,30))}</option>`).join("");

    container.innerHTML = `
        <p class="dica" style="margin-bottom:12px">
            Relacione cada coluna da planilha com o campo correspondente.
            Campos com <strong>*</strong> são obrigatórios.<br>
            O sistema mapeou automaticamente o que reconheceu — confira e ajuste se necessário.
        </p>
        <div class="mapeamento-grid">
            ${CAMPOS_IMPORTACAO.map(campo => `
                <div class="mapeamento-linha">
                    <label class="mapeamento-label ${campo.obrigatorio ? "obrigatorio" : ""}">
                        ${campo.label}
                    </label>
                    <select id="map_${campo.id}" class="mapeamento-select">
                        ${opcoes}
                    </select>
                </div>
            `).join("")}
        </div>
        <div class="importacao-aviso" id="importacaoAvisoMap" style="display:none"></div>
    `;

    Object.entries(autoMap).forEach(([campo, idx]) => {
        const sel = document.getElementById(`map_${campo}`);
        if (sel) sel.value = String(idx);
    });

    const qtdMapeados = Object.keys(autoMap).length;
    if (qtdMapeados > 0) {
        mostrarToast(`${qtdMapeados} coluna(s) mapeadas automaticamente — confira`, "info", 4000);
    }
}

/*─────────────────────────────────────────────
  ETAPA 3 — PROCESSAR
─────────────────────────────────────────────*/
function importacaoProcessar() {
    const btnProcessar = document.querySelector('button[onclick="importacaoProcessar()"]');
    if (btnProcessar) mostrarSpinner(btnProcessar, btnProcessar.innerText);
    const mapa = {};
    CAMPOS_IMPORTACAO.forEach(campo => {
        const sel = document.getElementById(`map_${campo.id}`);
        const val = sel ? sel.value : "";
        if (val !== "") mapa[campo.id] = parseInt(val);
    });

    const faltando = CAMPOS_IMPORTACAO
        .filter(c => c.obrigatorio && mapa[c.id] === undefined)
        .map(c => c.label.replace(" *",""));

    if (faltando.length > 0) {
        const aviso = document.getElementById("importacaoAvisoMap");
        if (aviso) {
            aviso.style.display = "block";
            aviso.innerHTML = `Mapeie os campos obrigatórios antes de continuar: <strong>${faltando.join(", ")}</strong>`;
        }
        if (btnProcessar) esconderSpinner(btnProcessar);
        return;
    }

    const aviso = document.getElementById("importacaoAvisoMap");
    if (aviso) aviso.style.display = "none";

    const linhasDados = importacaoLinhas.slice(1);
    const notas  = {};
    const erros  = [];

    linhasDados.forEach((linha, idx) => {
        const linhaNum = idx + 2;
        if (linha.every(c => String(c || "").trim() === "")) return;

        const get = (campo) => {
            const i = mapa[campo];
            return i !== undefined ? String(linha[i] || "").trim() : "";
        };

        const dataNota     = importacaoNormalizarData(get("dataNota"));
        const dataDescarga = importacaoNormalizarData(get("dataDescarga"));
        const numeroNota   = get("numeroNota").replace(/\./g,"").replace(/,/g,""); // remove pontos de milhar do NF
        const base         = get("base");
        const empresa      = get("empresa") || empresaFiltroGlobal || "";
        const motorista    = get("motorista");
        const placa        = get("placa").toUpperCase();
        const combustivel  = _normalizarNomeCombustivel(get("combustivel"));
        const _parseNum = (val) => {
            let s = String(val || "").replace(/R\$/gi,"").replace(/\s/g,"").trim();
            if (!s || s === "-") return "0";
            const nVirgulas = (s.match(/,/g)||[]).length;
            const nPontos   = (s.match(/\./g)||[]).length;
            if (nVirgulas >= 1) {
                s = s.replace(/\./g,"").replace(",",".");
            } else if (nPontos > 1) {
                s = s.replace(/\./g,"");
            } else if (nPontos === 1) {
                const [intPart, decPart] = s.split(".");
                const vi = parseInt(intPart.replace("-","")) || 0;
                if (decPart.length === 3) {
                    if (intPart.replace("-","").length >= 4) s = s.replace(".","");
                    else if (vi >= 100) s = s.replace(".","");
                    else if (decPart.endsWith("00")) s = s.replace(".","");
                }
            }
            return s;
        };
        const qtdStr     = _parseNum(get("qtd"));
        const qtdDescStr = _parseNum(get("qtdDescargada"));
        const valorStr   = _parseNum(get("valor"));
        const observacoes  = get("observacoes");

        if (!dataNota)    { erros.push(`Linha ${linhaNum}: Data da Nota inválida ("${get("dataNota")}")`); return; }
        if (!numeroNota)  { erros.push(`Linha ${linhaNum}: Número da Nota vazio`); return; }
        if (!motorista)   { erros.push(`Linha ${linhaNum}: Motorista vazio`); return; }
        if (!placa)       { erros.push(`Linha ${linhaNum}: Placa vazia`); return; }
        if (!combustivel) { erros.push(`Linha ${linhaNum}: Combustível vazio`); return; }

        const qtd   = parseNumeroBR(qtdStr);
        // `?? 0` e não `|| 0`: descarga vazia é zero de verdade, mas
        // descarga ilegível precisa continuar sendo erro, não virar zero.
        const qtdD  = parseNumeroBR(qtdDescStr) ?? 0;
        const valor = parseNumeroBR(valorStr);

        if (qtd === null || qtd <= 0)     { erros.push(`Linha ${linhaNum}: Quantidade inválida ("${qtdStr}")`); return; }
        if (valor === null || valor <= 0)  { erros.push(`Linha ${linhaNum}: Valor unitário inválido ("${valorStr}")`); return; }

        // A empresa entra na chave de agrupamento pelo mesmo motivo que
        // entra na de duplicidade: sem ela, duas notas de mesmo número e
        // placa em empresas diferentes viravam uma só linha importada.
        const chave = `${empresa}||${dataNota}||${numeroNota}||${motorista}||${placa}`;

        if (!notas[chave]) {
            notas[chave] = {
                dataNota, dataDescarga, numeroNota, base,
                empresa, motorista, placa, observacoes,
                itens: [], total: 0
            };
        }

        const itemTotal = qtd * valor;
        notas[chave].itens.push({ tipo: combustivel, qtd, qtdDescargada: qtdD, valor, total: itemTotal });
        notas[chave].total += itemTotal;
    });

    const notasParaAnalisar = Object.values(notas);
    if (notasParaAnalisar.length === 0 && erros.length === 0) {
        mostrarToast("Nenhuma linha válida encontrada no arquivo.", "aviso", 4000);
        return;
    }

    // Separa novas de duplicatas
    const duplicatas = [];
    const novasNotas = [];
    notasParaAnalisar.forEach(nota => {
        const chaveNota = _chaveNotaImportacao(nota);
        // Nota excluída não conta como duplicata: reimportar a planilha é
        // um dos caminhos de correção de quem excluiu por engano. Uma
        // cancelada conta, e o operador decide na tela de duplicatas.
        const jaExiste = db.lancamentos.some(l =>
            l.estado !== 'excluido' && _chaveNotaImportacao(l) === chaveNota);
        if (jaExiste) duplicatas.push(nota);
        else novasNotas.push(nota);
    });

    if (btnProcessar) esconderSpinner(btnProcessar);
    importacaoMostrarResumo(novasNotas, duplicatas, erros);
}

/*─────────────────────────────────────────────
  NORMALIZAR NOME DO COMBUSTÍVEL
─────────────────────────────────────────────*/
function _normalizarNomeCombustivel(raw) {
    if (!raw) return "";
    const v = raw.trim();
    const norm = v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");

    if (norm.includes("s-500") || norm.includes("s 500") || norm.includes("500"))  return "Diesel S-500";
    if (norm.includes("s-10")  || norm.includes("s 10")  || norm.includes("s10"))  return "Diesel S-10";
    if (norm.includes("diesel")) return v; // mantém o original se não reconhecer o tipo
    // V-Power ANTES de Gasolina Comum: checar sufixos específicos primeiro para não
    // cair no catch-all "gasolina" abaixo (ex: "gasolina v-power" contém "gasolina").
    if (norm.includes("v-power") || norm.includes("v power") || norm.includes("vpower") ||
        norm.includes("aditivada") || norm.includes("premium")) return "Gasolina V-Power";
    if (norm.includes("gasolina")) return "Gasolina Comum";
    if (norm.includes("etanol") || norm.includes("alcool") || norm.includes("álcool")) return "Etanol";

    // Tenta casar com combustível já cadastrado
    const match = db.combustiveis.find(c =>
        c.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").includes(norm) ||
        norm.includes(c.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""))
    );
    return match ? match.nome : v;
}

/*─────────────────────────────────────────────
  RESUMO ANTES DE SALVAR — com duplicatas clicáveis
─────────────────────────────────────────────*/
function importacaoMostrarResumo(novas, duplicatas, erros) {
    const container = document.getElementById("importacaoResultado");
    if (!container) return;

    const etapas = document.getElementById("importacaoEtapas");
    if (etapas) etapas.style.display = "none";
    container.style.display = "block";

    _importacaoNovasPendentes      = novas;
    _importacaoDuplicatasPendentes = duplicatas;

    const empresasNovas     = [...new Set(novas.map(n => n.empresa).filter(Boolean))].filter(e => !db.empresas.some(x => x.nome.toLowerCase() === e.toLowerCase()));
    const motoristasNovos   = [...new Set(novas.map(n => n.motorista))].filter(m => !db.motoristas.some(x => x.nome.toLowerCase() === m.toLowerCase()));
    const placasNovas       = [...new Set(novas.map(n => n.placa))].filter(p => !db.veiculos.some(x => x.nome.toUpperCase() === p.toUpperCase()));
    const combustiveisNovos = [...new Set(novas.flatMap(n => n.itens.map(i => i.tipo)))].filter(c => !db.combustiveis.some(x => x.nome.toLowerCase() === c.toLowerCase()));
    const temNovos = empresasNovas.length || motoristasNovos.length || placasNovas.length || combustiveisNovos.length;

    container.innerHTML = `
        <h3>Resumo da Importação</h3>

        <div class="resumo-cards">
            <div class="resumo-card verde">
                <div class="resumo-valor">${novas.length}</div>
                <div class="resumo-label">Nota(s) para importar</div>
            </div>
            <div class="resumo-card laranja">
                <div class="resumo-valor">${novas.reduce((s,n) => s + n.itens.length, 0)}</div>
                <div class="resumo-label">Item(ns) de combustível</div>
            </div>
            ${duplicatas.length > 0 ? `
            <div class="resumo-card cinza">
                <div class="resumo-valor">${duplicatas.length}</div>
                <div class="resumo-label">Nota(s) duplicada(s)</div>
            </div>` : ""}
            ${erros.length > 0 ? `
            <div class="resumo-card vermelho">
                <div class="resumo-valor">${erros.length}</div>
                <div class="resumo-label">Erro(s) de validação</div>
            </div>` : ""}
        </div>

        ${temNovos ? `
        <div class="importacao-aviso aviso-novos">
            <strong>Cadastros que serão criados automaticamente:</strong>
            ${empresasNovas.length     ? `<div>• <strong>Empresas:</strong> ${empresasNovas.join(", ")}</div>`         : ""}
            ${motoristasNovos.length   ? `<div>• <strong>Motoristas:</strong> ${motoristasNovos.join(", ")}</div>`     : ""}
            ${placasNovas.length       ? `<div>• <strong>Veículos:</strong> ${placasNovas.join(", ")}</div>`           : ""}
            ${combustiveisNovos.length ? `<div>• <strong>Combustíveis:</strong> ${combustiveisNovos.join(", ")}</div>` : ""}
            <small>Você poderá ajustar esses cadastros depois na tela de Cadastros.</small>
        </div>` : ""}

        ${duplicatas.length > 0 ? `
        <details class="detalhes-resumo" open style="margin-top:12px">
            <summary>${duplicatas.length} nota(s) já existem no sistema — escolha o que fazer</summary>
            <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
                <button class="btn-secundario" style="font-size:0.78rem" onclick="importacaoSelecionarTodasDuplicatas(true)">Marcar todas para reimportar</button>
                <button class="btn-secundario" style="font-size:0.78rem" onclick="importacaoSelecionarTodasDuplicatas(false)">Desmarcar todas (ignorar)</button>
            </div>
            <div style="overflow-x:auto">
                <table class="tabela-preview" style="font-size:0.8rem">
                    <thead><tr>
                        <th style="width:36px">Reimportar?</th>
                        <th>Nº Nota</th><th>Data Nota</th><th>Motorista</th><th>Placa</th><th>Itens</th><th>Total</th>
                    </tr></thead>
                    <tbody>
                        ${duplicatas.map((n, i) => `
                        <tr>
                            <td style="text-align:center">
                                <input type="checkbox" id="dup_${i}" style="width:auto; accent-color:var(--primary)">
                            </td>
                            <td>${escapeHtml(n.numeroNota)}</td>
                            <td>${formatarData(n.dataNota)}</td>
                            <td>${escapeHtml(n.motorista)}</td>
                            <td>${escapeHtml(n.placa)}</td>
                            <td>${n.itens.length} item(ns)</td>
                            <td>${fmtR(n.total)}</td>
                        </tr>`).join("")}
                    </tbody>
                </table>
            </div>
            <p class="dica" style="margin-top:8px; font-size:0.78rem">
                Notas marcadas serão reimportadas e substituirão os registros existentes com o mesmo número, data e placa.
            </p>
        </details>` : ""}

        ${erros.length > 0 ? `
        <details class="detalhes-resumo erro" style="margin-top:8px">
            <summary>Ver erros de validação (${erros.length})</summary>
            <ul style="margin-top:8px; padding-left:20px; font-size:0.85rem; color:var(--danger)">
                ${erros.map(e => `<li>${escapeHtml(e)}</li>`).join("")}
            </ul>
        </details>` : ""}

        ${novas.length > 0 ? `
        <details class="detalhes-resumo" style="margin-top:8px">
            <summary>Pré-visualizar notas novas a importar (${novas.length})</summary>
            <div style="overflow-x:auto; margin-top:8px">
                <table class="tabela-preview" style="font-size:0.8rem">
                    <thead><tr>
                        <th>Data Nota</th><th>Nº Nota</th><th>Motorista</th>
                        <th>Placa</th><th>Itens</th><th>Total</th>
                    </tr></thead>
                    <tbody>
                        ${novas.slice(0,50).map(n => `
                        <tr>
                            <td>${formatarData(n.dataNota)}</td>
                            <td>${escapeHtml(n.numeroNota)}</td>
                            <td>${escapeHtml(n.motorista)}</td>
                            <td>${escapeHtml(n.placa)}</td>
                            <td>${n.itens.length} item(ns)</td>
                            <td>${fmtR(n.total)}</td>
                        </tr>`).join("")}
                        ${novas.length > 50 ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">... e mais ${novas.length - 50} nota(s)</td></tr>` : ""}
                    </tbody>
                </table>
            </div>
        </details>` : ""}

        <div style="margin-top:20px; display:flex; gap:12px; flex-wrap:wrap">
            ${novas.length > 0 || duplicatas.length > 0 ? `
            <button class="btn-primario" onclick="importacaoConfirmar()">
                Confirmar e Importar
            </button>` : ""}
            <button class="btn-secundario" onclick="importacaoReiniciar()">↩ Voltar e Ajustar</button>
            <button class="btn-cancelar"   onclick="importacaoCancelar()">Cancelar</button>
        </div>
    `;
}

function importacaoSelecionarTodasDuplicatas(marcar) {
    _importacaoDuplicatasPendentes.forEach((_, i) => {
        const cb = document.getElementById(`dup_${i}`);
        if (cb) cb.checked = marcar;
    });
}

/*─────────────────────────────────────────────
  CONFIRMAR E SALVAR
─────────────────────────────────────────────*/
function importacaoConfirmar() {
    const btnConfirmar = document.querySelector('#importacaoResultado .btn-primario[onclick="importacaoConfirmar()"]')
                      || document.querySelector('button[onclick="importacaoConfirmar()"]');
    if (btnConfirmar) mostrarSpinner(btnConfirmar, btnConfirmar.innerText);

    const novas = [..._importacaoNovasPendentes];

    // Adiciona duplicatas que o usuário marcou para reimportar
    const dupSelecionadas = [];
    _importacaoDuplicatasPendentes.forEach((nota, i) => {
        const cb = document.getElementById(`dup_${i}`);
        if (cb && cb.checked) dupSelecionadas.push(nota);
    });

    if (novas.length === 0 && dupSelecionadas.length === 0) {
        mostrarToast("Nenhuma nota selecionada para importar.", "aviso", 4000);
        return;
    }

    // Remove duplicatas selecionadas em operação atômica única.
    //
    // A chave inclui a empresa. Sem ela, este filtro rodava sobre o
    // `db.lancamentos` inteiro — que tem em memória os lançamentos de
    // TODAS as empresas que o usuário enxerga — e apagava a nota homônima
    // de outra empresa junto. `_montarPayloads` gravava então o documento
    // daquela outra empresa já sem ela: perda permanente e silenciosa.
    //
    // A nota substituída vira lápide, não some. Este era o terceiro
    // caminho de destruição do sistema, e o mais silencioso dos três:
    // reimportar uma planilha apagava o lançamento antigo com o histórico
    // dele e criava outro no lugar, com id novo — quem tivesse o id
    // anterior (a lista da sessão, um detalhe aberto, um rascunho em
    // edição) passava a apontar para nada. Agora a substituída fica,
    // marcada, fora de todas as contas, e o histórico dela diz o que
    // aconteceu.
    if (dupSelecionadas.length > 0) {
        const chavesDup = new Set(dupSelecionadas.map(_chaveNotaImportacao));
        db.lancamentos.forEach(l => {
            if (!lancamentoAtivo(l)) return;
            if (!chavesDup.has(_chaveNotaImportacao(l))) return;
            l.estado = 'excluido';
            if (!Array.isArray(l.logs)) l.logs = [];
            l.logs.push({
                acao:    'Substituído por reimportação de planilha',
                ts:      new Date().toISOString(),
                usuario: window._usuarioAtual?.nome || '—'
            });
        });
    }

    const todasParaSalvar = [...novas, ...dupSelecionadas];
    const agora = new Date().toLocaleString("pt-BR");

    todasParaSalvar.forEach(nota => {
        // Cria cadastros automaticamente se não existirem
        if (nota.empresa && !db.empresas.some(e => e.nome.toLowerCase() === nota.empresa.toLowerCase())) {
            db.empresas.push({ id: gerarId(), nome: nota.empresa, ativo: true });
        }
        if (!db.motoristas.some(m => m.nome.toLowerCase() === nota.motorista.toLowerCase())) {
            db.motoristas.push({ id: gerarId(), nome: nota.motorista, ativo: true });
        }
        if (!db.veiculos.some(v => v.nome.toUpperCase() === nota.placa.toUpperCase())) {
            db.veiculos.push({ id: gerarId(), nome: nota.placa, ativo: true });
        }
        nota.itens.forEach(item => {
            if (!db.combustiveis.some(c => c.nome.toLowerCase() === item.tipo.toLowerCase())) {
                db.combustiveis.push({ id: gerarId(), nome: item.tipo, perda: 0, ativo: true });
            }
        });

        db.lancamentos.push({
            id:           gerarId(),
            dataNota:     nota.dataNota,
            dataDescarga: nota.dataDescarga || nota.dataNota,
            numeroNota:   nota.numeroNota,
            base:         nota.base,
            empresa:      nota.empresa,
            motorista:    nota.motorista,
            placa:        nota.placa,
            itens:        nota.itens,
            total:        nota.total,
            observacoes:  nota.observacoes || "",
            anexos:       [],
            logs:         [`Importado via planilha em ${agora}${dupSelecionadas.includes(nota) ? " (reimportado)" : ""}`]
        });
    });

    if (btnConfirmar) esconderSpinner(btnConfirmar);
    salvarDB();
    atualizarListas();
    _importacaoNovasPendentes      = [];
    _importacaoDuplicatasPendentes = [];

    const totalImportado = todasParaSalvar.length;
    const totalItens     = todasParaSalvar.reduce((s,n) => s + n.itens.length, 0);

    const container = document.getElementById("importacaoResultado");
    if (container) {
        container.innerHTML = `
            <div class="importacao-sucesso">
                
                <h3>Importação concluída!</h3>
                <p><strong>${totalImportado}</strong> nota(s) importadas com sucesso.</p>
                ${dupSelecionadas.length > 0 ? `<p><strong>${dupSelecionadas.length}</strong> nota(s) reimportadas (substituíram registros anteriores).</p>` : ""}
                <p><strong>${totalItens}</strong> item(ns) de combustível registrados.</p>
                <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top:16px">
                    <button class="btn-primario" onclick="mostrarTela('relatorios')"> Ver Relatórios</button>
                    <button class="btn-secundario" onclick="importacaoReiniciar()"> Importar outro arquivo</button>
                </div>
            </div>
        `;
    }

    mostrarToast(`${totalImportado} nota(s) importadas com sucesso!`, "sucesso", 5000);
}

/*─────────────────────────────────────────────
  UTILITÁRIOS
─────────────────────────────────────────────*/
function importacaoNormalizarData(valor) {
    if (valor === null || valor === undefined || String(valor).trim() === "") return "";

    const v = String(valor).trim();

    // Já está no formato correto YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

    // DD/MM/YYYY ou DD/MM/YY — formato brasileiro (prioridade)
    // Cobre: "28/01/2026", "28/01/26", "28-01-2026"
    const matchBR = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (matchBR) {
        let [, p1, p2, ano] = matchBR;
        let dia = parseInt(p1), mes = parseInt(p2);
        // Se p2 > 12 e p1 <= 12: está invertido (MM/DD) — corrige
        if (mes > 12 && dia <= 12) { [dia, mes] = [mes, dia]; }
        if (ano.length === 2) ano = "20" + ano;
        if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return "";
        return `${ano}-${String(mes).padStart(2,"0")}-${String(dia).padStart(2,"0")}`;
    }

    // Serial numérico do Excel (fallback para CSVs ou células não formatadas)
    const num = parseFloat(v);
    if (!isNaN(num) && num > 40000 && num < 60000) {
        const data = new Date(Math.round((num - 25569) * 86400000));
        if (!isNaN(data.getTime())) {
            return `${data.getUTCFullYear()}-${String(data.getUTCMonth()+1).padStart(2,"0")}-${String(data.getUTCDate()).padStart(2,"0")}`;
        }
    }

    return "";
}

function importacaoReiniciar() {
    importacaoLinhas              = [];
    importacaoMapeamento          = {};
    importacaoArquivoNome         = "";
    _importacaoNovasPendentes     = [];
    _importacaoDuplicatasPendentes = [];

    const arquivo   = document.getElementById("importacaoArquivo");
    const etapas    = document.getElementById("importacaoEtapas");
    const resultado = document.getElementById("importacaoResultado");
    const preview   = document.getElementById("importacaoPreview");
    const mapa      = document.getElementById("importacaoMapeamento");

    if (arquivo)   arquivo.value           = "";
    if (etapas)    etapas.style.display    = "none";
    if (resultado) resultado.style.display = "none";
    if (preview)   preview.innerHTML       = "";
    if (mapa)      mapa.innerHTML          = "";
}

function importacaoCancelar() {
    importacaoReiniciar();
}

/*─────────────────────────────────────────────
  DOWNLOAD DO MODELO DE PLANILHA
  (formato Fabiandra — o mais simples e universal)
─────────────────────────────────────────────*/
function baixarModeloPlanilha() {
    const cabecalho = [
        "DATA NF", "DATA ENTRADA/SAÍDA", "NFE", "BASE",
        "PLACA", "MOTORISTA", "PRODUTO",
        "QUANTIDADE", "R$ UNIT", "VALOR NOTA", "OBSERVACOES"
    ];

    const exemplos = [
        ["28/01/2026","02/02/2026","1252935","BMAD","RDR5H38","RICARDO X","DIESEL S-10","60000","5,234","314020,80",""],
        ["29/01/2026","02/02/2026","1253151","BMAD","RDK5E85","REGINALDO","DIESEL S-500","60000","5,164","309820,80",""],
        ["28/01/2026","02/02/2026","1252985","BMAD","NTV9A58","EVERALDO","DIESEL S-10","60000","5,234","314020,80","Carga extra"],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...exemplos]);
    ws["!cols"] = cabecalho.map(() => ({ wch: 20 }));

    XLSX.utils.book_append_sheet(wb, ws, "Lançamentos");
    XLSX.writeFile(wb, "modelo-importacao-fuelcontrol.xlsx");
    mostrarToast("Modelo baixado!", "sucesso");
}