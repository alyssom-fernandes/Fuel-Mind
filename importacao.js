/*=================================================
  IMPORTAÇÃO DE HISTÓRICO VIA EXCEL / CSV
  Permite importar lançamentos históricos de
  planilhas .xlsx, .xls ou .csv.
  Acrescenta notas novas. Uma nota que já existe só é substituída se o
  operador marcar "Reimportar": a antiga fica registrada como excluída.
  A empresa de cada linha precisa estar cadastrada e liberada para quem
  importa — a importação não cria empresa.
  
  Formatos suportados:
  - Padrão sistema (uma linha por combustível)
  - Por produto (DATA NF / DATA ENTRADA/SAÍDA / NFE / PRODUTO...): uma
    linha por produto da nota
  - Largo (uma coluna por combustível, uma linha por dia)
=================================================*/

/*─────────────────────────────────────────────
  ESTADO DA IMPORTAÇÃO
─────────────────────────────────────────────*/
let importacaoLinhas      = [];
// Os valores crus das células (número continua número), na mesma ordem de
// `importacaoLinhas`. Ler só o texto formatado fazia "5,234" de uma célula
// numérica virar 5234 em alguns caminhos.
let importacaoLinhasRaw   = null;
let importacaoMapeamento  = {};
let importacaoArquivoNome = "";
let _importacaoNovasPendentes      = [];
let _importacaoDuplicatasPendentes = [];
// A empresa ativa no momento do processamento. As notas sem coluna de
// empresa recebem essa, e uma troca entre Processar e Confirmar as gravaria
// numa empresa que a tela já não mostrava.
let _importacaoEmpresa = null;

/*─────────────────────────────────────────────
  CAMPOS DO SISTEMA (para mapeamento manual)
─────────────────────────────────────────────*/
const CAMPOS_IMPORTACAO = [
    // Sem "*" no texto: o asterisco vermelho vem do CSS (.obrigatorio), e os
    // dois juntos apareciam como "Data da Nota * *" (18/09/2026).
    { id: "dataNota",      label: "Data da nota",            obrigatorio: true  },
    { id: "dataDescarga",  label: "Data da descarga",        obrigatorio: true  },
    { id: "numeroNota",    label: "Número da nota",          obrigatorio: true  },
    { id: "base",          label: "Base (distribuidora)",    obrigatorio: false },
    { id: "empresa",       label: "Empresa / fornecedor",    obrigatorio: false },
    { id: "motorista",     label: "Motorista",               obrigatorio: true  },
    { id: "placa",         label: "Placa do veículo",        obrigatorio: true  },
    { id: "combustivel",   label: "Tipo de combustível",     obrigatorio: true  },
    { id: "qtd",           label: "Quantidade (litros)",     obrigatorio: true  },
    { id: "qtdDescargada", label: "Quantidade descarregada (L)", obrigatorio: false },
    { id: "valor",         label: "Valor unitário (R$/L)",   obrigatorio: true  },
    { id: "observacoes",   label: "Observações",             obrigatorio: false },
];

/*─────────────────────────────────────────────
  SINÔNIMOS — inclui as colunas dos dois formatos de origem
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
    return [n.empresa, _numeroNotaComparavel(n.numeroNota), n.dataNota,
            typeof normalizarPlaca === "function" ? normalizarPlaca(String(n.placa ?? "")) : n.placa]
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

    // Formato por produto: tem "nfe" ou "data entrada" e colunas simples
    const temNFE       = cols.some(c => c === "nfe" || c === "nf-e");
    const temEntrada   = cols.some(c => c.includes("entrada") || c.includes("saida") || c.includes("saída"));
    const temProduto   = cols.some(c => c === "produto" || c === "descricao" || c === "descricão");
    const temValorNota = cols.some(c => c.includes("valor nota") || c.includes("vl nota") || c.includes("total nota"));

    if ((temNFE || temEntrada) && temProduto) return "porProduto";

    // Formato largo: tem colunas "d. s-500", "d-s 10", "gas", "etanol"
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
    if (adiarAteBibliotecas(["xlsx"], () => importacaoLerArquivo(input))) return;
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
            let linhasRaw = null;

            if (ext === "csv") {
                linhas = importacaoLerCSV(_decodificarTexto(e.target.result));
            } else {
                // Lê as células formatadas (raw:false) e, à parte, os valores crus; evita
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
                    // "Qtd Descarga" e "Litros Descarga" são quantidade, não
                    // data: antes 44.850 L viravam 17/10/2022 e depois zero.
                    const ehQuantidade = /\b(qtd|qtde|litros|lts|quantidade|volume)\b/.test(cabNorm);
                    if (!ehQuantidade && (cabNorm.includes("data") || cabNorm.includes("date") ||
                        cabNorm === "dt" || cabNorm.includes("vencimento") ||
                        cabNorm.includes("emissao") || cabNorm.includes("entrada") ||
                        cabNorm.includes("saida") || cabNorm.includes("descarga"))) {
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
                linhasRaw = XLSX.utils.sheet_to_json(aba, { header: 1, defval: "", raw: true });
            }

            // Remove linhas completamente vazias (as duas matrizes juntas)
            const manter = linhas.map(l => l.some(c => String(c || "").trim() !== ""));
            linhas = linhas.filter((_, i) => manter[i]);
            if (linhasRaw) linhasRaw = linhasRaw.filter((_, i) => manter[i]);

            if (!linhas || linhas.length < 2) {
                mostrarToast("O arquivo está vazio ou só tem cabeçalho.", "aviso", 4000);
                input.value = "";
                return;
            }

            importacaoLinhas     = linhas;
            importacaoLinhasRaw  = linhasRaw;
            importacaoMapeamento = {};

            const formato = _detectarFormato(linhas[0]);

            if (formato === "wide") {
                // Converte automaticamente para o formato padrão antes de exibir
                importacaoLinhas = _converterWideParaPadrao(linhas, linhasRaw);
                importacaoLinhasRaw = null;
                mostrarToast("Formato largo detectado — convertido automaticamente ✓", "info", 5000);
            } else if (formato === "porProduto") {
                mostrarToast("Formato por produto detectado — mapeamento automático ✓", "info", 4000);
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

    if (ext === "csv") reader.readAsArrayBuffer(file);
    else               reader.readAsBinaryString(file);
}

/**
 * Texto de um CSV em UTF-8 ou, se não for UTF-8 válido, em Windows-1252 —
 * que é como o Excel em português salva "CSV (separado por vírgulas)".
 * Antes o arquivo era lido sempre como UTF-8, "JOSÉ" virava "JOS�" e a
 * importação criava um motorista com esse nome.
 */
function _decodificarTexto(buffer) {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
    } catch (_) {
        return new TextDecoder("windows-1252").decode(buffer);
    }
}

/**
 * CSV com aspas: separador decidido UMA vez, pelo cabeçalho, e vírgula ou
 * ponto e vírgula dentro de aspas não divide a célula. Antes o separador
 * era escolhido linha a linha e "5,234" entre aspas virava duas colunas.
 */
function importacaoLerCSV(texto) {
    const primeira = (texto.split(/\r?\n/).find(l => l.trim() !== "") || "");
    const contar = ch => { let n = 0, dentro = false; for (const c of primeira) { if (c === '"') dentro = !dentro; else if (c === ch && !dentro) n++; } return n; };
    const sep = contar(";") >= contar(",") && contar(";") > 0 ? ";" : (contar(",") > 0 ? "," : (contar("\t") > 0 ? "\t" : ";"));

    const linhas = [];
    let linha = [], campo = "", dentro = false;
    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        if (dentro) {
            if (c === '"') {
                if (texto[i + 1] === '"') { campo += '"'; i++; }
                else dentro = false;
            } else campo += c;
        } else if (c === '"') {
            dentro = true;
        } else if (c === sep) {
            linha.push(campo.trim()); campo = "";
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && texto[i + 1] === "\n") i++;
            linha.push(campo.trim()); campo = "";
            if (linha.some(x => x !== "")) linhas.push(linha);
            linha = [];
        } else {
            campo += c;
        }
    }
    linha.push(campo.trim());
    if (linha.some(x => x !== "")) linhas.push(linha);
    return linhas;
}

/*─────────────────────────────────────────────
  CONVERTER FORMATO LARGO → PADRÃO
  Detecta todas as colunas pelo nome — robusto
  a mudanças de posição e novas colunas.
─────────────────────────────────────────────*/
/**
 * Converte planilha no formato largo (uma coluna por combustível) para o padrão
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
function _converterWideParaPadrao(linhas, linhasRaw) {
    const cabecalho = linhas[0];
    const cols      = cabecalho.map(_normCol);

    // ── Localiza colunas fixas pelo nome ─────────────────────────
    // Igualdade primeiro; só então o termo como palavra inteira. Com
    // "contém" puro, "nf" achava a coluna "Data NF" quando ela vinha antes
    // da "NF", e o número da nota virava a data.
    const _find = (...termos) => {
        const exata = cols.findIndex(c => termos.includes(c));
        if (exata >= 0) return exata;
        return cols.findIndex(c => termos.some(t => ` ${c} `.includes(` ${t} `)));
    };

    const idxDataNota  = _find("data nf", "datanf", "data nota");
    const idxDataDesc  = _find("data descarga", "descarga");
    const idxNF        = (() => {
        const i = _find("nf", "nfe", "numero nota", "num nota");
        return i >= 0 && /\bdata\b/.test(cols[i]) ? -1 : i;
    })();
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
        jul:"07",ago:"08",set:"09",out:"10",nov:"11",dez:"12",
        feb:"02",apr:"04",may:"05",aug:"08",sep:"09",oct:"10",dec:"12"
    };
    function normData(val) {
        if (!val || String(val).trim() === "") return "";
        const v = String(val).trim().toLowerCase();
        // "28-jan-26" ou "1-fev-26"
        const mPT = v.match(/^(\d{1,2})[-\/]([a-z]{3})[-\/](\d{2,4})$/);
        if (mPT) {
            const dia = mPT[1].padStart(2,"0");
            // Mês desconhecido é data inválida, e não janeiro.
            const mes = MESES_PT[mPT[2]];
            if (!mes) return "";
            const ano = mPT[3].length === 2 ? "20"+mPT[3] : mPT[3];
            return `${ano}-${mes}-${dia}`;
        }
        return importacaoNormalizarData(val);
    }

    // ── Número da célula: o valor cru quando a célula é numérica, senão o
    // texto lido em português. O limpador antigo tirava o ponto de qualquer
    // número com três casas: R$ 5,234 guardado como número virava 5.234,00.
    function numeroCelula(linha, idxLinha, idx) {
        const cru = linhasRaw && linhasRaw[idxLinha] ? linhasRaw[idxLinha][idx] : undefined;
        if (typeof cru === "number" && Number.isFinite(cru)) return cru;
        return parseNumeroBR(String(linha[idx] || "").replace(/R\$/gi, "").trim());
    }
    const textoNumero = n => String(n).replace(".", ",");

    // ── Monta linhas no formato padrão ───────────────────────────
    const novoCabecalho = [
        "Data Nota","Data Descarga","Numero Nota","Base",
        "Empresa","Motorista","Placa",
        "Combustivel","Qtd Litros","Qtd Descargada","Valor Unitario","Observacoes"
    ];
    const novasLinhas = [novoCabecalho];

    linhas.slice(1).forEach((linha, i) => {
        const idxLinha = i + 1;
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
            const qtd = numeroCelula(linha, idxLinha, idxQtd);
            const vl  = numeroCelula(linha, idxLinha, idxValor);
            if (!(qtd > 0) || !(vl > 0)) return;

            novasLinhas.push([
                dataNota, dataDescarg,
                nf, base, empresa, motorista, placa,
                nome,
                textoNumero(qtd), "", textoNumero(vl),
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
        <p class="dica mb-2">
            <strong>${importacaoLinhas.length - 1}</strong> linha(s) encontradas em
            <strong>${escapeHtml(importacaoArquivoNome)}</strong>.
            Abaixo, uma amostra das primeiras linhas:
        </p>
        <div class="rolagem-x">
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

    // Mapeamento em duas passadas. Primeiro, cabeçalho IGUAL a um sinônimo;
    // depois, o sinônimo como palavra inteira dentro do cabeçalho — e uma
    // coluna serve a um campo só. Antes valia "contém" nos dois sentidos,
    // e o próprio modelo do sistema mapeava "DATA NF" como Número da Nota
    // (por causa de "nf"); cabeçalho vazio casava com todos os campos.
    const autoMap = {};
    const cols = cabecalho.map(_normCol);
    const sin  = Object.fromEntries(Object.entries(SINONIMOS_IMPORTACAO).map(([c, t]) => [c, t.map(_normCol).filter(Boolean)]));
    const usadas = new Set();
    const ordem = ["dataNota","dataDescarga","numeroNota","qtdDescargada","qtd","valor","base","empresa","motorista","placa","combustivel","observacoes"];
    const ehData = c => /\b(data|date|dt|emissao|entrada|saida)\b/.test(c);
    const ehQtd  = c => /\b(qtd|qtde|litros|lts|quantidade|volume)\b/.test(c);
    const podeUsar = (campo, c) => {
        if (!c) return false;
        if (campo === "dataNota" || campo === "dataDescarga") return !ehQtd(c);
        return !ehData(c);
    };
    ordem.forEach(campo => {
        const idx = cols.findIndex((c, i) => !usadas.has(i) && podeUsar(campo, c) && sin[campo].includes(c));
        if (idx >= 0) { autoMap[campo] = idx; usadas.add(idx); }
    });
    ordem.forEach(campo => {
        if (autoMap[campo] !== undefined) return;
        const idx = cols.findIndex((c, i) => !usadas.has(i) && podeUsar(campo, c)
            && sin[campo].some(t => t.length >= 3 && ` ${c} `.includes(` ${t} `)));
        if (idx >= 0) { autoMap[campo] = idx; usadas.add(idx); }
    });

    const opcoes = `<option value="">-- Não importar --</option>` +
        cabecalho.map((c,i) => `<option value="${i}">Col ${i+1}: ${escapeHtml(String(c).substring(0,30))}</option>`).join("");

    container.innerHTML = `
        <p class="dica mb-3">
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
    const permitidas = new Set(_empresaIdsPermitidos());
    const empresaAtivaCad = (db.empresas || []).find(e => e.nome === empresaFiltroGlobal) || null;
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
        // Número: o valor cru da célula quando ela é numérica.
        const getNum = (campo) => {
            const i = mapa[campo];
            if (i === undefined) return null;
            const cru = importacaoLinhasRaw && importacaoLinhasRaw[idx + 1] ? importacaoLinhasRaw[idx + 1][i] : undefined;
            if (typeof cru === "number" && Number.isFinite(cru)) return cru;
            const txt = String(linha[i] || "").replace(/R\$/gi, "").trim();
            if (txt === "" || txt === "-") return null;
            // Litros não têm três casas decimais numa planilha brasileira:
            // "59.850" numa coluna de quantidade é 59.850 litros, e não 59,85.
            // No preço, "5.234" continua sendo R$ 5,234.
            if ((campo === "qtd" || campo === "qtdDescargada") && /^\d{1,3}(\.\d{3})+$/.test(txt)) {
                return Number(txt.replace(/\./g, ""));
            }
            return parseNumeroBR(txt);
        };

        const dataNota     = importacaoNormalizarData(get("dataNota"));
        const dataDescarga = importacaoNormalizarData(get("dataDescarga"));
        const numeroNota   = get("numeroNota").replace(/\./g,"").replace(/,/g,""); // remove pontos de milhar do NF
        const baseTxt      = get("base");
        const base         = (db.bases || []).find(b => normalizarTexto(b.nome) === normalizarTexto(baseTxt))?.nome || baseTxt;
        // Empresa pelo cadastro, sem acento e sem caixa: "TRANSPORTADORA X" é
        // o cadastro "Transportadora X". Empresa que não existe ou que quem importa
        // não acessa vira erro da linha — antes a nota era aceita com um nome
        // que não resolvia para documento nenhum e sumia da nuvem.
        const empresaTxt   = get("empresa");
        const empresaCad   = empresaTxt
            ? ((db.empresas || []).find(e => normalizarTexto(e.nome) === normalizarTexto(empresaTxt))
               || (typeof _empresaDoDestinatario === "function" ? _empresaDoDestinatario(empresaTxt) : null))
            : empresaAtivaCad;
        const empresa      = empresaCad ? empresaCad.nome : "";
        const motoristaTxt = get("motorista");
        const motorista    = (db.motoristas || []).find(m => normalizarTexto(m.nome) === normalizarTexto(motoristaTxt))?.nome || motoristaTxt;
        const placaTxt     = get("placa").toUpperCase();
        const placa        = (db.veiculos || []).find(v => normalizarPlaca(v.nome) === normalizarPlaca(placaTxt))?.nome
                             || (placaTxt ? normalizarPlaca(placaTxt) : "");
        const combustivel  = _normalizarNomeCombustivel(get("combustivel"));
        const observacoes  = get("observacoes");

        if (!dataNota)    { erros.push(`Linha ${linhaNum}: Data da Nota inválida ("${get("dataNota")}")`); return; }
        // A descarga é obrigatória, como no lançamento (rodada 11, decisão do
        // dono): o lançamento só existe depois que o combustível entrou nos
        // tanques. Antes, a linha sem descarga recebia a data da nota, e a
        // entrada ficava com uma data que ninguém informou.
        if (!dataDescarga) { erros.push(`Linha ${linhaNum}: Data da Descarga ${get("dataDescarga") ? `inválida ("${get("dataDescarga")}")` : "vazia"}`); return; }
        if (dataDescarga < dataNota) { erros.push(`Linha ${linhaNum}: Data da Descarga (${formatarData(dataDescarga)}) anterior à Data da Nota (${formatarData(dataNota)})`); return; }
        if (!numeroNota)  { erros.push(`Linha ${linhaNum}: Número da Nota vazio`); return; }
        if (!motorista)   { erros.push(`Linha ${linhaNum}: Motorista vazio`); return; }
        if (!placa)       { erros.push(`Linha ${linhaNum}: Placa vazia`); return; }
        if (!combustivel) { erros.push(`Linha ${linhaNum}: Combustível vazio`); return; }
        if (!empresaCad) {
            erros.push(empresaTxt
                ? `Linha ${linhaNum}: empresa "${empresaTxt}" não está cadastrada (cadastre antes ou corrija a planilha)`
                : `Linha ${linhaNum}: sem empresa na planilha e sem empresa ativa`);
            return;
        }
        if (!permitidas.has(empresaCad.id)) { erros.push(`Linha ${linhaNum}: você não tem acesso à empresa "${empresaCad.nome}"`); return; }

        const qtd   = getNum("qtd");
        const valor = getNum("valor");
        // Descarga vazia é zero de verdade; descarga ilegível é erro da
        // linha. Antes as duas viravam zero.
        const qtdDTxt = get("qtdDescargada");
        const qtdD  = qtdDTxt === "" || qtdDTxt === "-" ? 0 : getNum("qtdDescargada");

        if (qtd === null || qtd <= 0)     { erros.push(`Linha ${linhaNum}: Quantidade inválida ("${get("qtd")}")`); return; }
        if (valor === null || valor <= 0)  { erros.push(`Linha ${linhaNum}: Valor unitário inválido ("${get("valor")}")`); return; }
        if (qtdD === null || qtdD < 0)     { erros.push(`Linha ${linhaNum}: Quantidade descarregada inválida ("${qtdDTxt}")`); return; }

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

        // O mesmo combustível duas vezes na mesma nota é linha repetida
        // (planilha colada duas vezes, meses sobrepostos), e não uma segunda
        // carga: antes os litros e o total dobravam sem aviso.
        if (notas[chave].itens.some(i => i.tipo === combustivel)) {
            erros.push(`Linha ${linhaNum}: repetida — a nota ${numeroNota} já tem ${combustivel} numa linha anterior`);
            return;
        }
        const itemTotal = Math.round(qtd * valor * 100) / 100;
        notas[chave].itens.push({ tipo: combustivel, qtd, qtdDescargada: qtdD, valor, total: itemTotal });
        notas[chave].total = Math.round((notas[chave].total + itemTotal) * 100) / 100;
    });

    const notasParaAnalisar = Object.values(notas);
    if (notasParaAnalisar.length === 0 && erros.length === 0) {
        if (btnProcessar) esconderSpinner(btnProcessar);
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
        const existente = db.lancamentos.find(l =>
            l.estado !== 'excluido' && _chaveNotaImportacao(l) === chaveNota);
        // A cancelada na origem não é oferecida para reimportar: substituir
        // uma nota cancelada por uma ativa desfaria o cancelamento em silêncio.
        if (existente && existente.estado === 'cancelado') {
            erros.push(`Nota ${nota.numeroNota} (${formatarData(nota.dataNota)}): já lançada e marcada como cancelada na origem — não reimportada`);
        } else if (existente) duplicatas.push(nota);
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

    // O cadastro primeiro. Antes o nome saía de uma tabela fixa, e com o
    // cadastro "Diesel S10" a planilha criava um segundo combustível
    // "Diesel S-10" — o analítico e a referência de preço ficavam divididos.
    const compacto = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g, "");
    const cv = compacto(v);
    const exato = (db.combustiveis || []).find(c => compacto(c.nome) === cv);
    if (exato) return exato.nome;
    const grupos = [
        { teste: n => /s-?\s?500|\b500\b/.test(n), chaves: ["dieselS500","dieselS-500","s500"] },
        { teste: n => /s-?\s?10\b|s10/.test(n),      chaves: ["dieselS10","dieselS-10","s10"] },
        { teste: n => /v-?\s?power|vpower|premium|podium/.test(n), chaves: ["gasolinavpower","gasolinav-power","vpower","gasolinapremium"] },
        { teste: n => /etanol|alcool/.test(n),         chaves: ["etanol","alcool"] },
    ];
    for (const g of grupos) {
        if (!g.teste(norm)) continue;
        const alvos = g.chaves.map(compacto);
        const cad = (db.combustiveis || []).find(c => alvos.some(a => compacto(c.nome) === a || compacto(c.nome).endsWith(a)));
        if (cad) return cad.nome;
    }

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
    _importacaoEmpresa             = empresaFiltroGlobal || null;

    const todas = novas.concat(duplicatas);
    const empresasNovas     = [];
    const motoristasNovos   = [...new Set(todas.map(n => n.motorista))].filter(m => !db.motoristas.some(x => normalizarTexto(x.nome) === normalizarTexto(m)));
    const placasNovas       = [...new Set(todas.map(n => n.placa))].filter(p => !db.veiculos.some(x => normalizarPlaca(x.nome) === normalizarPlaca(p)));
    const combustiveisNovos = [...new Set(todas.flatMap(n => n.itens.map(i => i.tipo)))].filter(c => !db.combustiveis.some(x => normalizarTexto(x.nome) === normalizarTexto(c)));
    const temNovos = empresasNovas.length || motoristasNovos.length || placasNovas.length || combustiveisNovos.length;

    container.innerHTML = `
        <h3>Resumo da importação</h3>

        <!-- Cor só onde pede atenção: itens de combustível em laranja pareciam
             aviso, e não são (18/09/2026). -->
        <div class="resumo-cards">
            <div class="resumo-card verde">
                <div class="resumo-valor">${novas.length}</div>
                <div class="resumo-label">Nota(s) para importar</div>
            </div>
            <div class="resumo-card cinza">
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
            ${empresasNovas.length     ? `<div>• <strong>Empresas:</strong> ${empresasNovas.map(escapeHtml).join(", ")}</div>`         : ""}
            ${motoristasNovos.length   ? `<div>• <strong>Motoristas:</strong> ${motoristasNovos.map(escapeHtml).join(", ")}</div>`     : ""}
            ${placasNovas.length       ? `<div>• <strong>Veículos:</strong> ${placasNovas.map(escapeHtml).join(", ")}</div>`           : ""}
            ${combustiveisNovos.length ? `<div>• <strong>Combustíveis:</strong> ${combustiveisNovos.map(escapeHtml).join(", ")}</div>` : ""}
            <small>Você poderá ajustar esses cadastros depois na tela de Cadastros.</small>
        </div>` : ""}

        ${duplicatas.length > 0 ? `
        <details class="detalhes-resumo mt-3" open>
            <summary>${duplicatas.length} nota(s) já existem no sistema — escolha o que fazer</summary>
            <div class="linha-acoes linha-acoes--apertada mt-3 mb-2">
                <button class="btn-secundario btn-pequeno" onclick="importacaoSelecionarTodasDuplicatas(true)">Marcar todas para reimportar</button>
                <button class="btn-secundario btn-pequeno" onclick="importacaoSelecionarTodasDuplicatas(false)">Desmarcar todas (ignorar)</button>
            </div>
            <div class="rolagem-x">
                <table class="tabela-preview tabela-preview--pequena">
                    <thead><tr>
                        <th class="coluna-marcar">Reimportar?</th>
                        <th>Nº Nota</th><th>Data Nota</th><th>Motorista</th><th>Placa</th><th>Itens</th><th>Total</th>
                    </tr></thead>
                    <tbody>
                        ${duplicatas.map((n, i) => `
                        <tr>
                            <td class="celula-centro">
                                <input type="checkbox" id="dup_${i}" class="caixa-marcar">
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
            <p class="dica dica--pequena mt-2">
                Notas marcadas serão reimportadas: a nota que já existe (mesma empresa, número, data e placa) fica registrada como excluída, e a da planilha entra no lugar.
            </p>
        </details>` : ""}

        ${erros.length > 0 ? `
        <details class="detalhes-resumo erro mt-2">
            <summary>Ver erros de validação (${erros.length})</summary>
            <ul class="lista-erros-importacao">
                ${erros.map(e => `<li>${escapeHtml(e)}</li>`).join("")}
            </ul>
        </details>` : ""}

        ${novas.length > 0 ? `
        <details class="detalhes-resumo mt-2">
            <summary>Pré-visualizar notas novas a importar (${novas.length})</summary>
            <div class="rolagem-x mt-2">
                <table class="tabela-preview tabela-preview--pequena">
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
                        ${novas.length > 50 ? `<tr><td colspan="6" class="celula-centro rotulo-suave">... e mais ${novas.length - 50} nota(s)</td></tr>` : ""}
                    </tbody>
                </table>
            </div>
        </details>` : ""}

        <div class="linha-acoes mt-5">
            ${novas.length > 0 || duplicatas.length > 0 ? `
            <button class="btn-primario" onclick="importacaoConfirmar()">
                Confirmar e importar
            </button>` : ""}
            <button class="btn-secundario" onclick="importacaoReiniciar()">↩ Voltar e ajustar</button>
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
async function importacaoConfirmar() {
    const btnConfirmar = document.querySelector('#importacaoResultado .btn-primario[onclick="importacaoConfirmar()"]')
                      || document.querySelector('button[onclick="importacaoConfirmar()"]');
    if (_importacaoEmpresa !== (empresaFiltroGlobal || null)) {
        mostrarToast(`A empresa ativa mudou desde o processamento (era ${_importacaoEmpresa || 'nenhuma'}). `
            + `Processe o arquivo de novo para importar em ${empresaFiltroGlobal || 'nenhuma'}.`, "erro", 8000);
        return;
    }
    if (btnConfirmar) mostrarSpinner(btnConfirmar, btnConfirmar.innerText);

    const novas = [..._importacaoNovasPendentes];

    // Adiciona duplicatas que o usuário marcou para reimportar
    const dupSelecionadas = [];
    _importacaoDuplicatasPendentes.forEach((nota, i) => {
        const cb = document.getElementById(`dup_${i}`);
        if (cb && cb.checked) dupSelecionadas.push(nota);
    });

    if (novas.length === 0 && dupSelecionadas.length === 0) {
        if (btnConfirmar) esconderSpinner(btnConfirmar);
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
        // Objetos novos, e não mudança no lugar (o cache da busca é por objeto).
        db.lancamentos = db.lancamentos.map(l => {
            if (!lancamentoAtivo(l)) return l;
            if (!chavesDup.has(_chaveNotaImportacao(l))) return l;
            return Object.assign({}, l, {
                estado: 'excluido',
                logs: (Array.isArray(l.logs) ? l.logs : []).concat([{
                    acao:    'Substituído por reimportação de planilha',
                    ts:      new Date().toISOString(),
                    usuario: window._usuarioAtual?.nome || '—'
                }])
            });
        });
    }

    const todasParaSalvar = [...novas, ...dupSelecionadas];
    const agora = new Date().toLocaleString("pt-BR");

    todasParaSalvar.forEach(nota => {
        // Cria os cadastros que faltam (empresa não: ela precisa existir).
        if (!db.motoristas.some(m => normalizarTexto(m.nome) === normalizarTexto(nota.motorista))) {
            db.motoristas.push({ id: gerarId(), nome: nota.motorista, ativo: true, logs: [`Criado pela importação de planilha em ${agora}`] });
        }
        if (!db.veiculos.some(v => normalizarPlaca(v.nome) === normalizarPlaca(nota.placa))) {
            db.veiculos.push({ id: gerarId(), nome: nota.placa, ativo: true, logs: [`Criado pela importação de planilha em ${agora}`] });
        }
        nota.itens.forEach(item => {
            if (!db.combustiveis.some(c => normalizarTexto(c.nome) === normalizarTexto(item.tipo))) {
                db.combustiveis.push({ id: gerarId(), nome: item.tipo, perda: 0, ativo: true, logs: [`Criado pela importação de planilha em ${agora}`] });
            }
        });
        const empresaId = (db.empresas || []).find(e => e.nome === nota.empresa)?.id;

        db.lancamentos.push({
            id:           gerarId(),
            dataNota:     nota.dataNota,
            dataDescarga: nota.dataDescarga,
            numeroNota:   nota.numeroNota,
            base:         nota.base,
            empresa:      nota.empresa,
            empresaId,
            motorista:    nota.motorista,
            placa:        nota.placa,
            itens:        nota.itens,
            total:        nota.total,
            observacoes:  nota.observacoes || "",
            anexos:       [],
            logs:         [{ acao: dupSelecionadas.includes(nota) ? "Reimportado via planilha" : "Importado via planilha",
                             ts: new Date().toISOString(), usuario: window._usuarioAtual?.nome || '—' }]
        });
    });

    if (btnConfirmar) esconderSpinner(btnConfirmar);
    atualizarListas();
    // A mensagem de conclusão diz a verdade sobre a nuvem.
    const confirmado = await _salvarEConfirmar(`${todasParaSalvar.length} nota(s) importada(s)`);
    _importacaoNovasPendentes      = [];
    _importacaoDuplicatasPendentes = [];

    const totalImportado = todasParaSalvar.length;
    const totalItens     = todasParaSalvar.reduce((s,n) => s + n.itens.length, 0);

    const container = document.getElementById("importacaoResultado");
    if (container) {
        container.innerHTML = `
            <div class="importacao-sucesso">
                
                <h3>${confirmado ? "Importação concluída!" : "Importação feita neste navegador — aguardando a nuvem"}</h3>
                <p><strong>${totalImportado}</strong> nota(s) importadas com sucesso.</p>
                ${dupSelecionadas.length > 0 ? `<p><strong>${dupSelecionadas.length}</strong> nota(s) reimportadas (as anteriores ficaram registradas como excluídas).</p>` : ""}
                ${confirmado ? "" : `<p class="texto-aviso">Não feche a aba até a pílula de sincronização sumir.</p>`}
                <p><strong>${totalItens}</strong> item(ns) de combustível registrados.</p>
                <div class="linha-acoes linha-acoes--centro mt-4">

                    <button class="btn-primario" onclick="mostrarTela('relatorios')"> Ver Relatórios</button>
                    <button class="btn-secundario" onclick="importacaoReiniciar()"> Importar outro arquivo</button>
                </div>
            </div>
        `;
    }

}

/*─────────────────────────────────────────────
  UTILITÁRIOS
─────────────────────────────────────────────*/
function importacaoNormalizarData(valor) {
    if (valor === null || valor === undefined || String(valor).trim() === "") return "";

    const v = String(valor).trim();

    // Uma data que existe no calendário: 31/02 é recusada, e não vira 03/03.
    const valida = (a, m, d) => {
        const dt = new Date(Number(a), Number(m) - 1, Number(d));
        return dt.getFullYear() === Number(a) && dt.getMonth() === Number(m) - 1 && dt.getDate() === Number(d);
    };

    // Já está no formato correto YYYY-MM-DD (com ou sem hora)
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (iso) return valida(iso[1], iso[2], iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";

    // DD/MM/YYYY ou DD/MM/YY — formato brasileiro (prioridade), com hora opcional
    // Cobre: "28/01/2026", "28/01/26", "28-01-2026", "28/01/2026 00:00"
    const matchBR = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
    if (matchBR) {
        let [, p1, p2, ano] = matchBR;
        let dia = parseInt(p1), mes = parseInt(p2);
        // Se p2 > 12 e p1 <= 12: está invertido (MM/DD) — corrige
        if (mes > 12 && dia <= 12) { [dia, mes] = [mes, dia]; }
        if (ano.length === 2) ano = "20" + ano;
        if (!valida(ano, mes, dia)) return "";
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
    importacaoLinhasRaw           = null;
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
  (formato por produto — o mais simples e universal)
─────────────────────────────────────────────*/
function baixarModeloPlanilha() {
    if (adiarAteBibliotecas(["xlsx"], () => baixarModeloPlanilha())) return;
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