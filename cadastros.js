/*=================================================
  CADASTROS.JS – com logs, município, ícones, datalists,
  validação de formato de placa, atualização do filtro global,
  conversão Mercosul e conjuntos de veículos
  FIX: IDs com aspas em todos os onclick inline
  FIX: alert() de validação substituídos por mostrarToast
  FIX v2: converterPlacaMercosul corrigida (último dígito não era cortado)
  Empresa usa datalist (dlEmpresas); motorista, placa e base usam o
  combobox de combobox.js
          + validação blur nos campos de lançamento
  FIX v4: toggleAtivo e excluirCadastro agora usam String(id) na busca,
          corrigindo falha silenciosa quando IDs vinham do Firestore
=================================================*/

/*=================================================
  CONVERSÃO DE PLACA — FORMATO MERCOSUL
=================================================*/
/**
 * Converte uma placa do formato antigo (ABC-1234 ou ABC1234)
 * para o formato Mercosul (ABC1D23).
 * Retorna null se a placa já for Mercosul ou não reconhecida.
 */
window.converterPlacaMercosul = function(placa) {
    if (!placa) return null;
    const limpa = placa.replace(/[-\s]/g, "").toUpperCase();

    // Já está no formato Mercosul (ABC1D23)
    if (/^[A-Z]{3}\d[A-Z]\d{2}$/.test(limpa)) return null;

    // Formato antigo: ABC1234
    if (/^[A-Z]{3}\d{4}$/.test(limpa)) {
        const MAP = { "0":"A","1":"B","2":"C","3":"D","4":"E","5":"F","6":"G","7":"H","8":"I","9":"J" };
        const letras    = limpa.slice(0, 3);
        const d1        = limpa[3];
        const letraMerc = MAP[limpa[4]];
        const resto     = limpa.slice(5);
        return `${letras}${d1}${letraMerc}${resto}`;
    }

    return null;
};

/**
 * Normaliza placa removendo hífen/espaço e uppercase.
 * Tenta converter para Mercosul, senão retorna limpa.
 */
window.normalizarPlaca = function(placa) {
    if (!placa) return placa;
    const limpa = placa.replace(/[-\s]/g, "").toUpperCase();
    return converterPlacaMercosul(limpa) || limpa;
};

/*=================================================
  CONJUNTOS DE VEÍCULOS
=================================================*/
const CONJUNTOS_INICIAIS = [
    ["RDF9F67","RDK5E85","RDK0G28"],
    ["QTX8J26","ONX1J94","ONX2C24"],
    ["SJX6H35","SKA4B87","SKA7H81"],
    ["SJM5C49","RDR5I68","RDR2I76"],
    ["QTX0H24","NWE8C87","NWE8D87"],
    ["RPP9F60","OGO9C52","OGO9C82"],
    ["QTX2F47","QTZ9F09","QTZ0C85"],
    ["RPH8H71","PJV4E84","PJV0F20"],
    ["RPS4E25","RDR5H38","RDR1H63"],
    ["SJR2D37","SJR4G23","SJR9A84"],
    ["SJR4F35","SJR7E95","SJR1E09"],
    ["SJR5C80","SJT3A18","SJT9D31"],
    ["SJR3C66","SJT3C48","SJT4J16"],
    ["RPS9G84","SKB9E49","SKB3H46"],
    ["SJX5E42","SKA3F54","SKA3H33"],
    ["RPU6D11","PLH4A38","PLH5B73"],
    ["SJX5E42","SKR8I44","SKR7H57"],
    ["THG3H49","THG6I26","THG4B90"],
    ["QTX1J32","OMP4G31","OMI0C31"],
    ["PLJ0549","NTV9A58","NTV9A64"],
    ["RDE5G40","RDE9G15","RDE2G60"],
    ["RPI2B47","PLO4I24","PLO5J23"],
    ["SJM5B04","SJL5A12","SJL3J68"],
    ["RDE2A93","RDE9B12","RDE2A47"],
    ["RDE9B17","RDE9C02","RDE1C54"],
    ["RDF5D84","RDE4J97","RDE3C35"],
    ["RDF7E97","RDE2D36","RDE5A11"],
    ["RDF0G41","OMI0C61","OMI0C81"],
    ["RDE7C80","RDC7H98","RDC4D65"],
    ["SKK5J82","SJL2J96","SJL9H10"],
    ["RPU5A11","RCP1I85","RCP1C59"],
    ["QTX7H56","SKA8H11","SKA2A31"],
    ["SJX4J75","SKK0D20","SKK7G07"],
    ["OKU0A94","RPY3H95"],
];

function garantirConjuntos() {
    if (!db.conjuntosVeiculos) {
        db.conjuntosVeiculos = [];
        CONJUNTOS_INICIAIS.forEach(placas => {
            db.conjuntosVeiculos.push({
                id: gerarId(),
                nome: "",
                composicaoAtual: placas.slice(),
                historico: [{
                    placas: placas.slice(),
                    vigenciaDe: "2000-01-01",
                    vigenciaAte: null
                }],
                ativo: true,
                logs: [`Criado automaticamente em ${new Date().toLocaleString('pt-BR')}`]
            });
        });
        salvarDB();
    }
}
garantirConjuntos();

/**
 * Dado uma placa e uma data (YYYY-MM-DD), retorna o conjunto
 * que continha essa placa naquela data (respeitando vigência).
 */
window.resolverConjuntoPorPlaca = function(placa, data) {
    if (!placa || !db.conjuntosVeiculos) return null;
    const placaNorm = normalizarPlaca(placa);
    const dataRef = data || "9999-12-31";

    for (const conj of db.conjuntosVeiculos) {
        if (conj.ativo === false) continue;
        const hist = [...(conj.historico || [])].reverse();
        for (const h of hist) {
            if (h.vigenciaDe > dataRef) continue;
            if (h.vigenciaAte && h.vigenciaAte < dataRef) continue;
            const placasNorm = (h.placas || []).map(p => normalizarPlaca(p));
            if (placasNorm.includes(placaNorm)) return conj;
        }
    }
    return null;
};

// ========== MODAL DE EDIÇÃO ==========
let modalContexto = null;

function abrirModal(titulo, label, valorAtual, lista, id, perdaAtual = null, municipioAtual = '', taxaFreteAtual = '') {
    modalContexto = { lista, id };
    document.getElementById("modalTitulo").textContent = titulo;
    document.getElementById("modalLabel").textContent = label;
    document.getElementById("modalInput").value = valorAtual;

    // O wrapper de empresas e o de perda sao estaticos no index.html; aqui so
    // alternamos a visibilidade e preenchemos os valores do item em edicao.
    const wrapperMunicipio = document.getElementById("modalCampoMunicipioWrapper");
    if (lista === "empresas" && wrapperMunicipio) {
        wrapperMunicipio.style.display = "flex";
        document.getElementById("modalInputMunicipio").value = municipioAtual;
        // Campo de texto agora: o número precisa entrar já em português,
        // senão "0.28" apareceria com ponto e voltaria mal interpretado.
        fmNumericoDefinir(document.getElementById("modalInputTaxaFrete"), taxaFreteAtual === "" ? null : taxaFreteAtual);
    } else if (wrapperMunicipio) {
        wrapperMunicipio.style.display = "none";
    }

    const wrapperPerda = document.getElementById("modalCampoPerdaWrapper");
    if (lista === "combustiveis") {
        wrapperPerda.style.display = "flex";
        fmNumericoDefinir(document.getElementById("modalInputPerda"), perdaAtual ?? 0);
    } else {
        if (wrapperPerda) wrapperPerda.style.display = "none";
    }

    const item = db[lista].find(i => String(i.id) === String(id));
    const logsDiv = document.getElementById("modalLogs");
    if (logsDiv) {
        logsDiv.innerHTML = item?.logs ?
            `<div style="margin-top:12px; border-top:1px solid var(--border); padding-top:8px; font-size:0.75rem; color:var(--text-muted);">
                <strong>Histórico:</strong>
                <ul style="margin-top:4px; list-style:none; padding-left:0;">
                    ${item.logs.map(log => `<li>• ${escapeHtml(log)}</li>`).join('')}
                </ul>
            </div>` : '';
    }

    document.getElementById("modalOverlay").style.display = "flex";
    document.getElementById("modalInput").focus();
}

function fecharModal() {
    document.getElementById("modalOverlay").style.display = "none";
    modalContexto = null;
}

/* ── CADASTRO RÁPIDO, SEM SAIR DO LANÇAMENTO ────────────────────────
   Quando o combobox não encontra o que foi digitado, ele oferece
   "Cadastrar X" e chama isto. Reaproveita o mesmo modal da edição, que
   já tem título, rótulo e um campo de texto — para motorista, placa e
   base é exatamente o que se precisa, e o alerta de uma das pesquisas
   sobre formulário de cadastro grande demais não se aplica.

   O que muda em relação à edição: `id` nulo significa criar. O botão
   Salvar continua chamando `confirmarEdicao`, que desvia no início.
   ────────────────────────────────────────────────────────────────── */
const _CADASTRO_RAPIDO = {
    motoristas: { titulo: "Cadastrar motorista", label: "Nome do motorista" },
    veiculos:   { titulo: "Cadastrar veículo",   label: "Placa" },
    bases:      { titulo: "Cadastrar base",      label: "Nome da base / distribuidora" }
};

function abrirModalCadastroRapido(lista, valorInicial, aoConcluir) {
    const conf = _CADASTRO_RAPIDO[lista];
    if (!conf) return;

    modalContexto = { lista, id: null, aoConcluir };
    document.getElementById("modalTitulo").textContent = conf.titulo;
    document.getElementById("modalLabel").textContent  = conf.label;
    document.getElementById("modalInput").value        = valorInicial || "";

    // Nenhum dos três usa os campos extras de empresa ou combustível.
    const wm = document.getElementById("modalCampoMunicipioWrapper");
    if (wm) wm.style.display = "none";
    const wp = document.getElementById("modalCampoPerdaWrapper");
    if (wp) wp.style.display = "none";
    const logs = document.getElementById("modalLogs");
    if (logs) logs.innerHTML = "";

    document.getElementById("modalOverlay").style.display = "flex";
    const inp = document.getElementById("modalInput");
    inp.focus();
    inp.select();
}

function _confirmarCadastroRapido() {
    const { lista, aoConcluir } = modalContexto;
    let nome = document.getElementById("modalInput").value.trim();
    if (!nome) {
        mostrarToast("O campo não pode ficar vazio.", "erro", 4000);
        return;
    }

    if (lista === "veiculos") {
        const limpa = nome.toUpperCase().replace(/[-\s]/g, "");
        nome = (typeof converterPlacaMercosul === "function" && converterPlacaMercosul(limpa)) || limpa;
    }

    if (db[lista].some(i => normalizarTexto(i.nome) === normalizarTexto(nome))) {
        mostrarToast("Já existe um cadastro com esse nome.", "erro", 4000);
        return;
    }

    const item = {
        id: gerarId(),
        nome,
        ativo: true,
        logs: [`Cadastrado pelo formulário de lançamento em ${new Date().toLocaleString("pt-BR")}`]
    };
    if (lista === "bases") item.municipio = "";
    db[lista].push(item);

    salvarDB();
    atualizarListas();
    fecharModal();
    mostrarToast(`${nome} cadastrado.`, "sucesso");
    if (typeof aoConcluir === "function") aoConcluir(nome);
}

function confirmarEdicao() {
    if (!modalContexto) return;
    // `id` nulo é criação, vinda do combobox do lançamento.
    if (modalContexto.id === null) return _confirmarCadastroRapido();
    const { lista, id } = modalContexto;
    const novoValor = document.getElementById("modalInput").value.trim();
    if (!novoValor) {
        mostrarToast("O campo não pode ficar vazio.", "erro", 4000);
        return;
    }
    const item = db[lista].find(i => String(i.id) === String(id));
    if (!item) return;
    // normalizarTexto e não toLowerCase: com toLowerCase, "José" e "Jose"
    // passavam como cadastros distintos e o relatório os agrupava separado.
    const duplicado = db[lista].some(i => String(i.id) !== String(id) && normalizarTexto(i.nome) === normalizarTexto(novoValor));
    if (duplicado) {
        mostrarToast("Já existe um cadastro com esse nome.", "erro", 4000);
        return;
    }

    const nomeAntigo = item.nome;
    if (nomeAntigo !== novoValor) {
        if (!item.logs) item.logs = [];
        item.logs.push(`Nome alterado de "${nomeAntigo}" para "${novoValor}" em ${new Date().toLocaleString('pt-BR')}`);
    }
    item.nome = lista === "veiculos" ? novoValor.toUpperCase() : novoValor;

    if (lista === "empresas") {
        const munInput = document.getElementById("modalInputMunicipio");
        if (munInput) {
            const novoMun = munInput.value.trim();
            if (item.municipio !== novoMun) {
                if (!item.logs) item.logs = [];
                item.logs.push(`Município alterado de "${item.municipio || 'vazio'}" para "${novoMun || 'vazio'}" em ${new Date().toLocaleString('pt-BR')}`);
                item.municipio = novoMun;
            }
        }

        const taxaInput = document.getElementById("modalInputTaxaFrete");
        if (taxaInput) {
            const parsed = parseNumeroBR(taxaInput.value);
            const novaTaxa = parsed === null || parsed < 0 ? 0 : parsed;
            const taxaAntiga = _taxaFreteDaEmpresa(item);
            if (taxaAntiga !== novaTaxa) {
                if (!item.logs) item.logs = [];
                item.logs.push(`Taxa de frete alterada de R$ ${taxaAntiga.toFixed(4)}/L para R$ ${novaTaxa.toFixed(4)}/L em ${new Date().toLocaleString('pt-BR')}`);
                item.taxaFrete = novaTaxa;
            }
        }
    }

    if (lista === "combustiveis") {
        const perdaInput = parseNumeroBR(document.getElementById("modalInputPerda").value) ?? 0;
        const perdaAntiga = item.perda;
        if (perdaAntiga !== perdaInput) {
            if (!item.logs) item.logs = [];
            item.logs.push(`% perda alterada de ${perdaAntiga}% para ${perdaInput}% em ${new Date().toLocaleString('pt-BR')}`);
        }
        item.perda = isNaN(perdaInput) ? 0 : perdaInput;
    }

    const nomeNovo = item.nome;
    let propagados = 0;
    if (nomeAntigo !== nomeNovo) {
        db.lancamentos.forEach(l => {
            if (lista === "empresas"   && l.empresa   === nomeAntigo) { l.empresa   = nomeNovo; propagados++; }
            if (lista === "motoristas" && l.motorista === nomeAntigo) { l.motorista = nomeNovo; propagados++; }
            if (lista === "veiculos"   && l.placa     === nomeAntigo) { l.placa     = nomeNovo; propagados++; }
            if (lista === "bases"      && l.base      === nomeAntigo) { l.base      = nomeNovo; propagados++; }
            if (lista === "combustiveis") {
                l.itens.forEach(i => {
                    if (i.tipo === nomeAntigo) { i.tipo = nomeNovo; propagados++; }
                });
            }
        });
    }

    salvarDB();
    fecharModal();
    atualizarListas();

    if (propagados > 0) {
        mostrarToast(`Renomeado e atualizado em ${propagados} lançamento(s).`, "sucesso", 5000);
    }
}

document.addEventListener("keydown", e => { if (e.key === "Escape") fecharModal(); });

// ========== MOTORISTAS ==========
function salvarMotorista() {
    const input = document.getElementById("nomeMotorista");
    const nome = input.value.trim();
    if (!nome) {
        mostrarToast("Digite o nome do motorista.", "erro", 4000);
        return;
    }
    if (db.motoristas.some(m => normalizarTexto(m.nome) === normalizarTexto(nome))) {
        mostrarToast("Esse motorista já está cadastrado.", "erro", 4000);
        return;
    }
    db.motoristas.push({
        id: gerarId(),
        nome,
        ativo: true,
        logs: [`Criado em ${new Date().toLocaleString('pt-BR')}`]
    });
    input.value = "";
    salvarDB();
    atualizarListas();
    setTimeout(() => {
        const ul = document.getElementById("listaMotoristas");
        if (ul && ul.lastElementChild) {
            ul.lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, 100);
}

// ========== VEÍCULOS (com validação de placa) ==========
function validarPlaca(placa) {
    const regexAntiga   = /^[A-Z]{3}-\d{4}$/;
    const regexAntiga2  = /^[A-Z]{3}\d{4}$/;
    const regexMercosul = /^[A-Z]{3}\d[A-Z]\d{2}$/;
    return regexAntiga.test(placa) || regexAntiga2.test(placa) || regexMercosul.test(placa);
}

async function salvarVeiculo() {
    const input = document.getElementById("placaVeiculo");
    const placaRaw = input.value.trim().toUpperCase();
    if (!placaRaw) {
        mostrarToast("Digite a placa do veículo.", "erro", 4000);
        return;
    }

    const placaConvertida = converterPlacaMercosul(placaRaw.replace(/[-\s]/g, ""));
    const placa = placaConvertida || placaRaw.replace(/[-\s]/g, "");

    if (!validarPlaca(placa)) {
        if (!await fmConfirm({ titulo: "Placa com formato inválido", msg: `A placa "${placa}" não segue o padrão esperado (ABC1234 ou ABC1D23).\n\nDeseja salvar mesmo assim?`, confirmTxt: "Salvar mesmo assim", tipo: "aviso" })) return;
    }
    if (db.veiculos.some(v => v.nome === placa)) {
        mostrarToast("Essa placa já está cadastrada.", "erro", 4000);
        return;
    }
    db.veiculos.push({
        id: gerarId(),
        nome: placa,
        ativo: true,
        logs: [`Criado em ${new Date().toLocaleString('pt-BR')}`]
    });
    input.value = "";
    salvarDB();
    atualizarListas();
    setTimeout(() => {
        const ul = document.getElementById("listaVeiculos");
        if (ul && ul.lastElementChild) ul.lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
}

/**
 * Abre modal de confirmação listando todas as placas que serão
 * convertidas para Mercosul e realiza a conversão após confirmação.
 */
async function converterTodasPlacasMercosul() {
    const paraConverter = db.veiculos.map(v => {
        const conv = converterPlacaMercosul(v.nome.replace(/[-\s]/g, ""));
        return conv ? { veiculo: v, antiga: v.nome, nova: conv } : null;
    }).filter(Boolean);

    if (paraConverter.length === 0) {
        mostrarToast("Todas as placas já estão no formato Mercosul.", "info");
        return;
    }

    const lista = paraConverter.map(p => `  ${p.antiga}  →  ${p.nova}`).join("\n");
    if (!await fmConfirm({ titulo: `Converter ${paraConverter.length} placa(s) para Mercosul?`, msg: `${lista}`, confirmTxt: "Converter", tipo: "aviso" })) return;

    let propagados = 0;
    paraConverter.forEach(({ veiculo, antiga, nova }) => {
        if (!veiculo.logs) veiculo.logs = [];
        veiculo.logs.push(`Placa convertida de "${antiga}" para "${nova}" (Mercosul) em ${new Date().toLocaleString('pt-BR')}`);
        veiculo.nome = nova;

        db.lancamentos.forEach(l => {
            if (l.placa === antiga) { l.placa = nova; propagados++; }
        });

        if (db.conjuntosVeiculos) {
            db.conjuntosVeiculos.forEach(conj => {
                conj.composicaoAtual = conj.composicaoAtual.map(p => p === antiga ? nova : p);
                conj.historico.forEach(h => {
                    h.placas = h.placas.map(p => p === antiga ? nova : p);
                });
            });
        }
    });

    salvarDB();
    atualizarListas();
    mostrarToast(`${paraConverter.length} placa(s) convertida(s) para Mercosul.${propagados > 0 ? ` ${propagados} lançamento(s) atualizado(s).` : ""}`, "sucesso", 6000);
}

// ========== EMPRESAS (com município) ==========
function migrarEmpresas() {
    if (db.empresas.length > 0 && typeof db.empresas[0] === "string") {
        db.empresas = db.empresas.map(nome => ({
            id: gerarId(),
            nome,
            municipio: '',
            ativo: true,
            logs: [`Criado em ${new Date().toLocaleString('pt-BR')}`]
        }));
        salvarDB();
    }
}
migrarEmpresas();

function salvarEmpresa() {
    const input = document.getElementById("nomeEmpresa");
    const inputMun = document.getElementById("municipioEmpresa");
    const inputTaxa = document.getElementById("taxaFreteEmpresa");
    const nome = input.value.trim();
    const municipio = inputMun ? inputMun.value.trim() : '';
    const taxaParsed = parseNumeroBR(inputTaxa ? inputTaxa.value : '');
    const taxaFrete = taxaParsed === null || taxaParsed < 0 ? 0 : taxaParsed;
    if (!nome) {
        mostrarToast("Digite o nome da empresa.", "erro", 4000);
        return;
    }
    if (db.empresas.some(e => normalizarTexto(e.nome) === normalizarTexto(nome))) {
        mostrarToast("Essa empresa já está cadastrada.", "erro", 4000);
        return;
    }
    db.empresas.push({
        id: gerarId(),
        nome,
        municipio,
        taxaFrete,
        ativo: true,
        logs: [`Criado em ${new Date().toLocaleString('pt-BR')}`]
    });
    input.value = "";
    if (inputMun) inputMun.value = "";
    if (inputTaxa) inputTaxa.value = "";
    salvarDB();
    atualizarListas();
    setTimeout(() => {
        const ul = document.getElementById("listaEmpresas");
        if (ul && ul.lastElementChild) ul.lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
}

// ========== COMBUSTÍVEIS ==========
function salvarCombustivel() {
    const inputNome  = document.getElementById("nomeCombustivel");
    const inputPerda = document.getElementById("perdaCombustivel");
    const nome  = inputNome.value.trim();
    const perda = parseNumeroBR(inputPerda.value) ?? 0;
    if (!nome) {
        mostrarToast("Digite o tipo de combustível.", "erro", 4000);
        return;
    }
    if (db.combustiveis.some(c => normalizarTexto(c.nome) === normalizarTexto(nome))) {
        mostrarToast("Esse combustível já está cadastrado.", "erro", 4000);
        return;
    }
    db.combustiveis.push({
        id: gerarId(),
        nome,
        perda,
        ativo: true,
        logs: [`Criado em ${new Date().toLocaleString('pt-BR')}`]
    });
    inputNome.value = ""; inputPerda.value = "";
    salvarDB();
    atualizarListas();
    setTimeout(() => {
        const ul = document.getElementById("listaCombustiveis");
        if (ul && ul.lastElementChild) ul.lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
}

// ========== BASES ==========
function garantirBases() {
    if (!db.bases) {
        db.bases = [];
        salvarDB();
    }
}
garantirBases();

function salvarBase() {
    garantirBases();
    const input = document.getElementById("nomeBase");
    const nome  = input.value.trim();
    if (!nome) {
        mostrarToast("Digite o nome da base.", "erro", 4000);
        return;
    }
    if (db.bases.some(b => normalizarTexto(b.nome) === normalizarTexto(nome))) {
        mostrarToast("Essa base já está cadastrada.", "erro", 4000);
        return;
    }
    db.bases.push({
        id: gerarId(),
        nome,
        ativo: true,
        logs: [`Criado em ${new Date().toLocaleString('pt-BR')}`]
    });
    input.value = "";
    salvarDB();
    atualizarListas();
    setTimeout(() => {
        const ul = document.getElementById("listaBases");
        if (ul && ul.lastElementChild) ul.lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
}

// ========== INATIVAR / REATIVAR ==========
// FIX v4: String(i.id) === String(id) para garantir comparação correta
//         independente de como o ID chegou do Firestore
async function toggleAtivo(lista, id) {
    const item = db[lista].find(i => String(i.id) === String(id));
    if (!item) return;
    const acao = item.ativo !== false ? "inativar" : "reativar";
    if (!await fmConfirm({ titulo: `${acao.charAt(0).toUpperCase()+acao.slice(1)} "${item.nome}"?`, confirmTxt: acao.charAt(0).toUpperCase()+acao.slice(1), tipo: "aviso" })) return;
    item.ativo = item.ativo !== false ? false : true;
    if (!item.logs) item.logs = [];
    item.logs.push(`${acao === 'inativar' ? 'Inativado' : 'Reativado'} em ${new Date().toLocaleString('pt-BR')}`);
    salvarDB();
    atualizarListas();
}

// ========== VERIFICAÇÃO DE VÍNCULOS ==========
function temVinculoEmLancamentos(lista, item) {
    if (lista === "motoristas")   return db.lancamentos.some(l => l.motorista === item.nome);
    if (lista === "veiculos")     return db.lancamentos.some(l => l.placa === item.nome);
    if (lista === "empresas")     return db.lancamentos.some(l => l.empresa === item.nome);
    if (lista === "combustiveis") return db.lancamentos.some(l => l.itens.some(i => i.tipo === item.nome));
    return false;
}

// ========== EXCLUIR COM VERIFICAÇÃO ==========
// FIX v4: String(i.id) === String(id) para garantir comparação correta
//         independente de como o ID chegou do Firestore
async function excluirCadastro(lista, id) {
    const item = db[lista].find(i => String(i.id) === String(id));
    if (!item) return;
    if (temVinculoEmLancamentos(lista, item)) {
        mostrarToast(`Não é possível excluir "${item.nome}" — existem lançamentos vinculados. Use "Inativar".`, "erro", 5000);
        return;
    }
    if (!await fmConfirm({ titulo: `Excluir "${item.nome}"?`, msg: "Esta ação não pode ser desfeita.", confirmTxt: "Excluir", tipo: "perigo" })) return;
    db[lista] = db[lista].filter(i => String(i.id) !== String(id));
    salvarDB();
    atualizarListas();
}

/*=================================================
  CONJUNTOS DE VEÍCULOS — CRUD
=================================================*/

let _conjuntoEditandoId = null;

function renderizarConjuntos() {
    const container = document.getElementById("listaConjuntos");
    if (!container) return;

    garantirConjuntos();
    const lista = db.conjuntosVeiculos.filter(c => c.ativo !== false);
    const listaComInativos = db.conjuntosVeiculos;
    const showInat = document.getElementById("mostrarInativosConjuntos")?.checked;
    const exibir = showInat ? listaComInativos : lista;

    if (exibir.length === 0) {
        container.innerHTML = `<p class="vazio" style="padding:12px;color:var(--text-muted);">Nenhum conjunto cadastrado.</p>`;
        return;
    }

    container.innerHTML = exibir.map(c => {
        const placasStr = c.composicaoAtual.map(escapeHtml).join(", ");
        const nomeExib = c.nome ? `<strong>${escapeHtml(c.nome)}</strong>` : `<em style="color:var(--text-muted);">(sem nome)</em>`;
        const inativoTag = c.ativo === false ? ' <em class="tag-inativo">inativo</em>' : '';
        return `
        <li class="conjunto-item ${c.ativo === false ? 'inativo' : ''}">
            <div class="conjunto-info">
                <div class="conjunto-nome">${nomeExib}${inativoTag}</div>
                <div class="conjunto-placas" style="font-size:0.82rem;color:var(--text-muted);margin-top:3px;">
                     ${placasStr}
                </div>
            </div>
            <div class="acoes-lista">
                <button class="btn-editar" onclick="abrirEditarConjunto('${c.id}')">Editar</button>
                <button class="btn-inativar" onclick="toggleAtivoConjunto('${c.id}')">${c.ativo !== false ? "Inativar" : "Reativar"}</button>
                <button class="btn-excluir" onclick="excluirConjunto('${c.id}')">Excluir</button>
            </div>
        </li>`;
    }).join("");
}

async function toggleAtivoConjunto(id) {
    const conj = db.conjuntosVeiculos.find(c => String(c.id) === String(id));
    if (!conj) return;
    const acao = conj.ativo !== false ? "inativar" : "reativar";
    if (!await fmConfirm({ titulo: `${acao.charAt(0).toUpperCase()+acao.slice(1)} conjunto?`, confirmTxt: acao.charAt(0).toUpperCase()+acao.slice(1), tipo: "aviso" })) return;
    conj.ativo = conj.ativo !== false ? false : true;
    if (!conj.logs) conj.logs = [];
    conj.logs.push(`${conj.ativo ? 'Reativado' : 'Inativado'} em ${new Date().toLocaleString('pt-BR')}`);
    salvarDB();
    renderizarConjuntos();
}

async function excluirConjunto(id) {
    if (!await fmConfirm({ titulo: "Excluir conjunto?", msg: "Esta ação não pode ser desfeita.", confirmTxt: "Excluir", tipo: "perigo" })) return;
    db.conjuntosVeiculos = db.conjuntosVeiculos.filter(c => String(c.id) !== String(id));
    salvarDB();
    renderizarConjuntos();
}

function abrirEditarConjunto(id) {
    _conjuntoEditandoId = id;
    const conj = db.conjuntosVeiculos.find(c => String(c.id) === String(id));
    if (!conj) return;

    document.getElementById("conjuntoNomeInput").value = conj.nome || "";
    _renderizarPlacasConjunto(conj.composicaoAtual.slice());

    const histDiv = document.getElementById("conjuntoHistorico");
    if (histDiv && conj.historico && conj.historico.length > 0) {
        histDiv.innerHTML = `
            <p style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Histórico de composições:</p>
            ${conj.historico.map((h, i) => {
                const de = h.vigenciaDe || "—";
                const ate = h.vigenciaAte || "atual";
                return `<div style="font-size:0.78rem;color:var(--text-muted);padding:3px 0;">
                    <strong>${i+1}.</strong> ${h.placas.map(escapeHtml).join(", ")}
                    <span style="margin-left:6px;opacity:0.7;">(${de} → ${ate})</span>
                </div>`;
            }).join("")}
        `;
        histDiv.style.display = "block";
    }

    document.getElementById("conjuntoFormOverlay").style.display = "flex";
}

function abrirNovoConjunto() {
    _conjuntoEditandoId = null;
    document.getElementById("conjuntoNomeInput").value = "";
    _renderizarPlacasConjunto([""]);
    const histDiv = document.getElementById("conjuntoHistorico");
    if (histDiv) histDiv.style.display = "none";
    document.getElementById("conjuntoFormOverlay").style.display = "flex";
}

function fecharFormConjunto() {
    document.getElementById("conjuntoFormOverlay").style.display = "none";
    _conjuntoEditandoId = null;
}

let _placasTemp = [];

function _renderizarPlacasConjunto(placas) {
    _placasTemp = placas.slice();
    const container = document.getElementById("conjuntoPlacasList");
    if (!container) return;
    container.innerHTML = _placasTemp.map((p, i) => `
        <div class="form-linha" style="gap:8px;margin-bottom:6px;" data-idx="${i}">
            <input type="text" value="${escapeHtml(p)}" maxlength="8" placeholder="Ex: ABC1D23"
                   style="text-transform:uppercase;flex:1;"
                   oninput="this.value=this.value.toUpperCase().replace(/[-\\s]/g,''); _placasTemp[${i}]=this.value;">
            <button class="btn-excluir" style="padding:4px 10px;" onclick="_removerPlacaConjunto(${i})">✕</button>
        </div>
    `).join("");
}

function _removerPlacaConjunto(idx) {
    _placasTemp.splice(idx, 1);
    _renderizarPlacasConjunto(_placasTemp);
}

function adicionarPlacaConjunto() {
    _placasTemp.push("");
    _renderizarPlacasConjunto(_placasTemp);
}

async function salvarConjunto() {
    const nome = document.getElementById("conjuntoNomeInput").value.trim();
    const dataVigencia = document.getElementById("conjuntoDataVigencia")?.value || null;

    const inputs = document.querySelectorAll("#conjuntoPlacasList input[type=text]");
    const placas = Array.from(inputs).map(i => i.value.trim().toUpperCase().replace(/[-\s]/g, "")).filter(Boolean);

    if (placas.length < 2) {
        mostrarToast("Um conjunto precisa ter pelo menos 2 placas.", "erro", 4000);
        return;
    }

    const outrosConjuntos = db.conjuntosVeiculos.filter(c => String(c.id) !== String(_conjuntoEditandoId) && c.ativo !== false);
    for (const p of placas) {
        for (const outro of outrosConjuntos) {
            if (outro.composicaoAtual.map(x => normalizarPlaca(x)).includes(normalizarPlaca(p))) {
                if (!await fmConfirm({ titulo: `Placa ${p} já está em outro conjunto`, msg: `Pertence ao conjunto "${outro.nome || outro.id.slice(0,8)}".\n\nDeseja continuar mesmo assim?`, confirmTxt: "Continuar", tipo: "aviso" })) return;
                break;
            }
        }
    }

    const agora = new Date().toLocaleString('pt-BR');

    if (_conjuntoEditandoId) {
        const conj = db.conjuntosVeiculos.find(c => String(c.id) === String(_conjuntoEditandoId));
        if (!conj) return;

        const composicaoMudou = JSON.stringify(conj.composicaoAtual.sort()) !== JSON.stringify(placas.slice().sort());
        if (composicaoMudou) {
            if (!dataVigencia) {
                mostrarToast("Ao alterar as placas de um conjunto, informe a data de vigência da nova composição.", "erro", 4000);
                return;
            }
            if (conj.historico.length > 0) {
                const ultimo = conj.historico[conj.historico.length - 1];
                if (!ultimo.vigenciaAte) ultimo.vigenciaAte = dataVigencia;
            }
            conj.historico.push({
                placas: placas.slice(),
                vigenciaDe: dataVigencia,
                vigenciaAte: null
            });
            if (!conj.logs) conj.logs = [];
            conj.logs.push(`Composição alterada em ${agora} (vigência: ${dataVigencia})`);
        }
        conj.nome = nome;
        conj.composicaoAtual = placas;
        mostrarToast("Conjunto atualizado com sucesso!", "sucesso");
    } else {
        db.conjuntosVeiculos.push({
            id: gerarId(),
            nome,
            composicaoAtual: placas,
            historico: [{
                placas: placas.slice(),
                vigenciaDe: dataVigencia || new Date().toISOString().slice(0, 10),
                vigenciaAte: null
            }],
            ativo: true,
            logs: [`Criado em ${agora}`]
        });
        mostrarToast("Conjunto cadastrado com sucesso!", "sucesso");
    }

    salvarDB();
    fecharFormConjunto();
    renderizarConjuntos();
}

/*=================================================
  ATUALIZAR LISTAS, SELECTS, DATALISTS E FILTRO GLOBAL
  Preenche os selects espelho, o datalist de empresas e os filtros do
          relatorio. Motorista, placa e base saíram daqui: quem lê o
          cadastro agora é o combobox, na hora de renderizar.
=================================================*/
function atualizarListas() {
    // MOTORISTAS
    const ulM = document.getElementById("listaMotoristas");
    if (ulM) {
        const showInat = document.getElementById("mostrarInativos")?.checked;
        const lista = showInat ? db.motoristas : db.motoristas.filter(m => m.ativo !== false);
        ulM.innerHTML = lista.length === 0 ? `<li class="vazio">Nenhum cadastro ainda.</li>`
            : lista.map(m => `
                <li class="${m.ativo !== false ? "" : "inativo"}">
                    <span>${escapeHtml(m.nome)}${m.ativo !== false ? "" : ' <em class="tag-inativo">inativo</em>'}</span>
                    <div class="acoes-lista">
                        <button class="btn-editar"   data-acao="editar"   data-lista="motoristas" data-id="${m.id}">Editar</button>
                        <button class="btn-inativar" data-acao="toggle"   data-lista="motoristas" data-id="${m.id}">${m.ativo !== false ? "Inativar" : "Reativar"}</button>
                        <button class="btn-excluir"  data-acao="excluir"  data-lista="motoristas" data-id="${m.id}">Excluir</button>
                    </div>
                </li>`).join("");
    }

    // VEÍCULOS
    const ulV = document.getElementById("listaVeiculos");
    if (ulV) {
        const showInat = document.getElementById("mostrarInativosVeiculos")?.checked;
        const lista = showInat ? db.veiculos : db.veiculos.filter(v => v.ativo !== false);
        ulV.innerHTML = lista.length === 0 ? `<li class="vazio">Nenhum cadastro ainda.</li>`
            : lista.map(v => `
                <li class="${v.ativo !== false ? "" : "inativo"}">
                    <span>${escapeHtml(v.nome)}${v.ativo !== false ? "" : ' <em class="tag-inativo">inativo</em>'}</span>
                    <div class="acoes-lista">
                        <button class="btn-editar"   data-acao="editar"   data-lista="veiculos" data-id="${v.id}">Editar</button>
                        <button class="btn-inativar" data-acao="toggle"   data-lista="veiculos" data-id="${v.id}">${v.ativo !== false ? "Inativar" : "Reativar"}</button>
                        <button class="btn-excluir"  data-acao="excluir"  data-lista="veiculos" data-id="${v.id}">Excluir</button>
                    </div>
                </li>`).join("");
    }

    // EMPRESAS
    const ulE = document.getElementById("listaEmpresas");
    if (ulE) {
        const showInat = document.getElementById("mostrarInativosEmpresas")?.checked;
        const lista = showInat ? db.empresas : db.empresas.filter(e => e.ativo !== false);
        ulE.innerHTML = lista.length === 0 ? `<li class="vazio">Nenhum cadastro ainda.</li>`
            : lista.map(e => `
                <li class="${e.ativo !== false ? "" : "inativo"}">
                    <span>
                        ${escapeHtml(e.nome)} ${e.municipio ? `- ${escapeHtml(e.municipio)}` : ''}
                        ${_taxaFreteDaEmpresa(e) > 0 ? `<em class="tag-perda">Frete: ${fmtR4(_taxaFreteDaEmpresa(e))}/L</em>` : ''}
                        ${e.ativo !== false ? "" : ' <em class="tag-inativo">inativo</em>'}
                    </span>
                    <div class="acoes-lista">
                        <button class="btn-editar"   data-acao="editar"   data-lista="empresas" data-id="${e.id}">Editar</button>
                        <button class="btn-inativar" data-acao="toggle"   data-lista="empresas" data-id="${e.id}">${e.ativo !== false ? "Inativar" : "Reativar"}</button>
                        <button class="btn-excluir"  data-acao="excluir"  data-lista="empresas" data-id="${e.id}">Excluir</button>
                    </div>
                </li>`).join("");
    }

    // COMBUSTÍVEIS
    const ulC = document.getElementById("listaCombustiveis");
    if (ulC) {
        const showInat = document.getElementById("mostrarInativos_combustiveis")?.checked;
        const lista = showInat ? db.combustiveis : db.combustiveis.filter(c => c.ativo !== false);
        ulC.innerHTML = lista.length === 0 ? `<li class="vazio">Nenhum cadastro ainda.</li>`
            : lista.map(c => `
                <li class="${c.ativo !== false ? "" : "inativo"}">
                    <span>
                        ${escapeHtml(c.nome)}
                        ${c.perda > 0 ? `<em class="tag-perda">Perda: ${c.perda}%</em>` : ""}
                        ${c.ativo !== false ? "" : '<em class="tag-inativo">inativo</em>'}
                    </span>
                    <div class="acoes-lista">
                        <button class="btn-editar"   data-acao="editar"   data-lista="combustiveis" data-id="${c.id}">Editar</button>
                        <button class="btn-inativar" data-acao="toggle"   data-lista="combustiveis" data-id="${c.id}">${c.ativo !== false ? "Inativar" : "Reativar"}</button>
                        <button class="btn-excluir"  data-acao="excluir"  data-lista="combustiveis" data-id="${c.id}">Excluir</button>
                    </div>
                </li>`).join("");
    }

    // BASES
    const ulB = document.getElementById("listaBases");
    if (ulB) {
        const showInat = document.getElementById("mostrarInativosBases")?.checked;
        const lista = showInat ? db.bases : db.bases.filter(b => b.ativo !== false);
        ulB.innerHTML = lista.length === 0 ? `<li class="vazio">Nenhuma base cadastrada ainda.</li>`
            : lista.map(b => `
                <li class="${b.ativo !== false ? "" : "inativo"}">
                    <span>${escapeHtml(b.nome)}${b.ativo !== false ? "" : ' <em class="tag-inativo">inativo</em>'}</span>
                    <div class="acoes-lista">
                        <button class="btn-editar"   data-acao="editar"   data-lista="bases" data-id="${b.id}">Editar</button>
                        <button class="btn-inativar" data-acao="toggle"   data-lista="bases" data-id="${b.id}">${b.ativo !== false ? "Inativar" : "Reativar"}</button>
                        <button class="btn-excluir"  data-acao="excluir"  data-lista="bases" data-id="${b.id}">Excluir</button>
                    </div>
                </li>`).join("");
    }

    // CONJUNTOS
    renderizarConjuntos();

    // ── SELECTS OCULTOS (usados por lancamentos.js via .value) ──
    const empresasAtivas   = db.empresas.filter(e => e.ativo !== false);
    const motoristasAtivos = db.motoristas.filter(m => m.ativo !== false);
    const veiculosAtivos   = db.veiculos.filter(v => v.ativo !== false);
    const basesAtivas      = db.bases.filter(b => b.ativo !== false);

    preencherSelect("empresaSelect",      empresasAtivas.map(e => ({ valor: e.nome, texto: e.nome + (e.municipio ? ` (${e.municipio})` : '') })), "Selecione a empresa");
    preencherSelect("motoristaSelect",    motoristasAtivos.map(m => ({ valor: m.nome, texto: m.nome })), "Selecione o motorista");
    preencherSelect("placaSelect",        veiculosAtivos.map(v => ({ valor: v.nome, texto: v.nome })), "Selecione a placa");
    preencherSelect("baseEntradaSelect",  basesAtivas.map(b => ({ valor: b.nome, texto: b.nome })), "Selecione a base");

    // ── DATALISTS DO FORMULÁRIO DE LANÇAMENTOS ──
    // FIX v3: usam os IDs corretos dl* definidos no index.html
    const dlEmpresas = document.getElementById("dlEmpresas");
    if (dlEmpresas) {
        dlEmpresas.innerHTML = empresasAtivas
            .map(e => `<option value="${escapeHtml(e.nome)}">${e.municipio ? escapeHtml(e.nome) + ' (' + escapeHtml(e.municipio) + ')' : ''}</option>`)
            .join('');
    }

    // Motorista, Placa e Base não usam mais `<datalist>`: passaram para o
    // combobox de `combobox.js`, que lê `db` direto na hora de renderizar.
    // Não há índice a atualizar aqui. Empresa segue no datalist acima.

    // FILTROS DE RELATÓRIO
    preencherSelect("filtroMotorista",   db.motoristas.map(m => ({ valor: m.nome, texto: m.nome + (m.ativo !== false ? "" : " (inativo)") })), "Todos");
    preencherSelect("filtroPlaca",       db.veiculos.map(v => ({ valor: v.nome, texto: v.nome + (v.ativo !== false ? "" : " (inativo)") })), "Todas");
    preencherSelect("filtroCombustivel", db.combustiveis.map(c => ({ valor: c.nome, texto: c.nome + (c.ativo !== false ? "" : " (inativo)") })), "Todos");

    if (typeof atualizarFiltroEmpresaGlobal === 'function') {
        atualizarFiltroEmpresaGlobal();
    }
}

/*=================================================
  VALIDAÇÃO DE BLUR NOS CAMPOS DO FORMULÁRIO
  Avisa quando o valor digitado não existe no cadastro.
  Não bloqueia — apenas orienta o usuário.
=================================================*/

/**
 * Verifica se o valor digitado existe na lista fornecida, ignorando caixa
 * e acento. Retorna o item encontrado ou null.
 */
function _buscarCadastro(lista, valor) {
    if (!valor) return null;
    // Sem acento: digitar "jose silva" encontra "José Silva" e o aviso de
    // "não encontrado no cadastro" deixa de disparar por causa de um acento.
    const v = normalizarTexto(valor);
    return lista.find(i => i.ativo !== false && normalizarTexto(i.nome) === v) || null;
}

/**
 * Registra os handlers de blur nos campos de lançamento.
 * Chamado uma única vez após o DOM estar pronto.
 */
function _registrarValidacaoBlurLancamentos() {
    // Antes, cada um destes avisos era um `mostrarToast` que sumia em cinco
    // segundos, longe do campo. Agora usam a mesma mensagem inline da
    // validação do lançamento: fica visível junto do campo até ser resolvida,
    // e some sozinha quando o valor passa a existir no cadastro.
    const avisar = (id, texto) => {
        if (typeof _msgCampo === 'function') _msgCampo(id, texto, 'alerta');
        else mostrarToast(texto, 'aviso', 5000);
    };
    const limpar = id => { if (typeof _limparMsgCampo === 'function') _limparMsgCampo(id); };

    const ligar = (id, lista, rotulo, aba) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('blur', function () {
            const val = this.value.trim();
            // Não limpa mensagem de bloqueio posta pela validação do lançamento.
            const msg = this.closest('.campo')?.querySelector('.msg-validacao');
            if (msg && msg.dataset.tipo === 'bloqueio' && msg.style.display !== 'none') return;
            if (!val) { limpar(id); return; }
            if (_buscarCadastro(db[lista], val)) limpar(id);
            else avisar(id, `${rotulo} "${val}" não está no cadastro. Use a lista para cadastrar, ou confira em Cadastros → ${aba}.`);
        });
    };

    ligar('empresaInput',      'empresas',  'Empresa',   'Empresas');
    ligar('motoristaInput',    'motoristas','Motorista', 'Motoristas');
    ligar('baseEntradaInput',  'bases',     'Base',      'Bases');

    // Placa tem regra própria: compara já no formato Mercosul, para
    // ABC-1234 e ABC1D23 não parecerem cadastros diferentes.
    const placaInput = document.getElementById('placaInput');
    if (placaInput) {
        placaInput.addEventListener('blur', function () {
            const val = this.value.trim().toUpperCase().replace(/[-\s]/g, '');
            const msg = this.closest('.campo')?.querySelector('.msg-validacao');
            if (msg && msg.dataset.tipo === 'bloqueio' && msg.style.display !== 'none') return;
            if (!val) { limpar('placaInput'); return; }
            const placaNorm = normalizarPlaca(val);
            const encontrou = db.veiculos.some(v => v.ativo !== false && normalizarPlaca(v.nome) === placaNorm);
            if (encontrou) limpar('placaInput');
            else avisar('placaInput', `Placa "${val}" não está no cadastro. Use a lista para cadastrar, ou confira em Cadastros → Veículos.`);
        });
    }
}

// ========== EVENT DELEGATION — LISTAS DE CADASTRO ==========
document.addEventListener('click', function(e) {
    const btn = e.target.closest('button[data-acao]');
    if (!btn) return;

    const acao  = btn.dataset.acao;
    const lista = btn.dataset.lista;
    const id    = btn.dataset.id;
    if (!lista || !id) return;

    const item = db[lista].find(i => String(i.id) === String(id));
    if (!item) return;

    if (acao === 'toggle') {
        toggleAtivo(lista, id);
    } else if (acao === 'excluir') {
        excluirCadastro(lista, id);
    } else if (acao === 'editar') {
        if (lista === 'motoristas') abrirModal('Editar Motorista',  'Nome',  item.nome, lista, id);
        else if (lista === 'veiculos')    abrirModal('Editar Veículo',    'Placa', item.nome, lista, id);
        else if (lista === 'empresas')    abrirModal('Editar Empresa',    'Nome',  item.nome, lista, id, null, item.municipio || '', item.taxaFrete ?? '');
        else if (lista === 'combustiveis') abrirModal('Editar Combustível','Nome',  item.nome, lista, id, item.perda);
        else if (lista === 'bases')       abrirModal('Editar Base',       'Nome',  item.nome, lista, id);
    }
});

// ========== SINCRONIZAÇÃO DOS INPUTS COM HIDDEN ==========
document.addEventListener('input', function(e) {
    if (e.target.id === 'empresaInput') {
        document.getElementById('empresaSelect').value = e.target.value;
    } else if (e.target.id === 'motoristaInput') {
        document.getElementById('motoristaSelect').value = e.target.value;
    } else if (e.target.id === 'placaInput') {
        document.getElementById('placaSelect').value = e.target.value;
    } else if (e.target.id === 'baseEntradaInput') {
        document.getElementById('baseEntrada').value = e.target.value;
    }
});

// sincronizarBaseEntrada: função canônica com flag anti-duplicata em ui.js

// ========== INICIALIZAÇÃO ==========
function _inicializarCamposLancamento() {
    if (typeof sincronizarBaseEntrada === 'function') sincronizarBaseEntrada();
    _registrarValidacaoBlurLancamentos();
    // Depois dos ouvintes de blur: o combobox envolve o input num wrapper, e
    // os ouvintes ficam no input, não no wrapper, então a ordem não importa
    // para eles — mas importa que o combobox rode uma vez só.
    if (typeof fmComboboxAplicarLancamento === 'function') fmComboboxAplicarLancamento();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _inicializarCamposLancamento);
} else {
    _inicializarCamposLancamento();
}
