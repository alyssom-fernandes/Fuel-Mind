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

/** Histórico de taxa de frete em texto, para o `title` da lista. */
function _historicoTaxaTexto(empresa) {
    const hist = Array.isArray(empresa && empresa.taxaHistorico) ? empresa.taxaHistorico : [];
    if (!hist.length) return "Taxa sem histórico: vale para todo o período.";
    return "Vigências da taxa:\n" + [...hist]
        .sort((a, b) => String(a.vigenciaDe).localeCompare(String(b.vigenciaDe)))
        .map(v => `${fmtRL(Number(v.taxa) || 0)}/L — de ${formatarData(v.vigenciaDe)}`
                + (v.vigenciaAte ? ` a ${formatarData(v.vigenciaAte)}` : " (atual)"))
        .join("\n");
}

/*=================================================
  CONJUNTOS DE VEÍCULOS
=================================================*/
/* Os conjuntos vivem só no banco. Até 17/09/2026 havia aqui 101 placas
   reais de 34 conjuntos, semeadas quando o banco não tinha a lista — e
   publicadas junto com o site. Saíram por decisão do dono: instalação nova
   nasce sem conjunto, e eles são cadastrados na aba Conjuntos. */
function garantirConjuntos() {
    if (!Array.isArray(db.conjuntosVeiculos)) db.conjuntosVeiculos = [];
}

/**
 * Dado uma placa e uma data (YYYY-MM-DD), retorna o conjunto
 * que continha essa placa naquela data (respeitando vigência).
 */
/* A composição que valia NAQUELA data decide — não o "ativo" de hoje.
   Antes um conjunto inativado (o caminho que a tela recomenda para
   cadastros) sumia também dos Fretes dos meses em que rodou, e o total por
   conjunto de um mês já fechado mudava. Inativar agora fecha a vigência na
   data da inativação; é ela que tira o conjunto dos meses seguintes. */
window.resolverConjuntoEPeriodo = function(placa, data) {
    if (!placa || !db.conjuntosVeiculos) return null;
    const placaNorm = normalizarPlaca(placa);
    const dataRef = data || "9999-12-31";

    for (const conj of db.conjuntosVeiculos) {
        if (!data && conj.ativo === false) continue;
        const hist = [...(conj.historico || [])].reverse();
        for (const h of hist) {
            if (h.vigenciaDe > dataRef) continue;
            if (h.vigenciaAte && h.vigenciaAte < dataRef) continue;
            const placasNorm = (h.placas || []).map(p => normalizarPlaca(p));
            if (placasNorm.includes(placaNorm)) return { conj, periodo: h };
        }
    }
    return null;
};

window.resolverConjuntoPorPlaca = function(placa, data) {
    return resolverConjuntoEPeriodo(placa, data)?.conj || null;
};

// ========== MODAL DE EDIÇÃO ==========
let modalContexto = null;

function abrirModal(titulo, label, valorAtual, lista, id, perdaAtual = null, municipioAtual = '', taxaFreteAtual = '') {
    modalContexto = { lista, id };
    document.getElementById("modalTitulo").textContent = titulo;
    const podeRenomear = typeof ehSupremoAtual === "function" ? ehSupremoAtual() : true;
    document.getElementById("modalLabel").textContent = podeRenomear ? label : `${label} (só o supremo renomeia)`;
    document.getElementById("modalInput").value = valorAtual;
    document.getElementById("modalInput").readOnly = !podeRenomear;

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
        // Sem linhas, nada: "Histórico:" sozinho aparecia em cadastro sem log.
        logsDiv.innerHTML = item?.logs?.length ?
            `<div class="historico-cadastro">
                <span class="historico-cadastro-titulo">Histórico</span>
                <ul class="lista-limpa log-list">
                    ${item.logs.map(log => `<li>${escapeHtml(log)}</li>`).join('')}
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
    document.getElementById("modalInput").readOnly     = false;

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

    const existente = db[lista].find(i => lista === "veiculos"
        ? normalizarPlaca(i.nome) === normalizarPlaca(nome)
        : normalizarTexto(i.nome) === normalizarTexto(nome));
    if (existente) {
        // Um cadastro inativo com o mesmo nome não aparecia na lista, e a
        // tela só dizia "já existe", sem dizer onde nem o que fazer.
        mostrarToast(existente.ativo === false
            ? `"${existente.nome}" já está cadastrado, mas inativo. Reative em Cadastros para usar.`
            : `"${existente.nome}" já está cadastrado.`, "erro", 7000);
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

    // Placa editada passa pelas mesmas regras de "Novo veículo": formato
    // Mercosul, e duplicidade comparando placas normalizadas.
    let valorFinal = novoValor;
    if (lista === "veiculos") {
        const limpa = novoValor.toUpperCase().replace(/[-\s]/g, "");
        valorFinal = converterPlacaMercosul(limpa) || limpa;
    }
    // normalizarTexto e não toLowerCase: com toLowerCase, "José" e "Jose"
    // passavam como cadastros distintos e o relatório os agrupava separado.
    const duplicado = db[lista].some(i => String(i.id) !== String(id) && (lista === "veiculos"
        ? normalizarPlaca(i.nome) === normalizarPlaca(valorFinal)
        : normalizarTexto(i.nome) === normalizarTexto(valorFinal)));
    if (duplicado) {
        mostrarToast("Já existe um cadastro com esse nome.", "erro", 4000);
        return;
    }

    const nomeAntigo = item.nome;
    // Renomear é do supremo (decisão do dono, 17/09/2026): o nome é
    // reescrito nas notas, e só o supremo carrega as notas de todas as
    // empresas — nas mãos de outro perfil, as empresas que ele não enxerga
    // ficavam com o nome velho.
    if (nomeAntigo !== valorFinal && typeof exigirPapel === "function" && !exigirPapel("supremo", "Renomear cadastro")) return;
    if (nomeAntigo !== valorFinal) {
        if (!item.logs) item.logs = [];
        item.logs.push(`Nome alterado de "${nomeAntigo}" para "${valorFinal}" em ${new Date().toLocaleString('pt-BR')}`);
    }
    item.nome = valorFinal;

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
                item.logs.push(`Taxa de frete alterada de ${fmtRL(taxaAntiga)}/L para ${fmtRL(novaTaxa)}/L em ${new Date().toLocaleString('pt-BR')}`);
                // ── VIGÊNCIA DA TAXA (17/09/2026) ───────────────────────
                // A taxa nova vale de hoje em diante; a anterior fica
                // fechada em ontem. Sem isso, mudar a taxa em outubro
                // reescrevia o frete de janeiro a setembro, já pago, sem
                // aviso nenhum — o único rastro era a linha de log acima.
                const hoje = _hojeISO();
                if (!Array.isArray(item.taxaHistorico)) item.taxaHistorico = [];
                if (!item.taxaHistorico.length && taxaAntiga > 0) {
                    // Primeira mudança de uma empresa antiga: o que valia
                    // até ontem é a taxa que estava no registro.
                    item.taxaHistorico.push({ taxa: taxaAntiga, vigenciaDe: "2000-01-01", vigenciaAte: _somarDiasISO(hoje, -1) });
                }
                item.taxaHistorico.forEach(v => { if (!v.vigenciaAte) v.vigenciaAte = _somarDiasISO(hoje, -1); });
                item.taxaHistorico = item.taxaHistorico.filter(v => String(v.vigenciaDe) <= String(v.vigenciaAte));
                item.taxaHistorico.push({ taxa: novaTaxa, vigenciaDe: hoje, vigenciaAte: null });
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
    let conjuntosTocados = 0;
    if (nomeAntigo !== nomeNovo) {
        // Toca TODOS os lançamentos, inclusive os excluídos e os
        // cancelados, e isto é de propósito: renomear é reescrever uma
        // referência, não somar. Pular uma lápide a deixaria com o nome
        // antigo da empresa — e aí `_empresaIdDoLancamento` (dados.js) não a
        // resolve mais, `_montarPayloads` a descarta em silêncio e ela
        // some da nuvem no próximo salvamento. Filtrar aqui não esconde a
        // lápide, destrói a lápide.
        // Objetos novos, e não mudança no lugar: o cache da busca rápida do
        // relatório é por objeto e ficava com o nome velho.
        const campo = { empresas: "empresa", motoristas: "motorista", veiculos: "placa", bases: "base" }[lista];
        db.lancamentos = db.lancamentos.map(l => {
            if (campo && l[campo] === nomeAntigo) {
                propagados++;
                return Object.assign({}, l, { [campo]: nomeNovo });
            }
            if (lista === "combustiveis" && (l.itens || []).some(i => i.tipo === nomeAntigo)) {
                propagados++;
                return Object.assign({}, l, { itens: l.itens.map(i => i.tipo === nomeAntigo ? Object.assign({}, i, { tipo: nomeNovo }) : i) });
            }
            return l;
        });

        // A placa também vive nos conjuntos de veículos, na composição
        // atual e em todo o histórico de vigências. Renomear só nos
        // lançamentos deixava o veículo fora do conjunto, e a tela de
        // fretes — que resolve o conjunto pela placa, na data de cada
        // lançamento — passava a mostrar todos os meses anteriores errados.
        // `converterTodasPlacasMercosul` já fazia certo; esta função, não.
        if (lista === "veiculos" && db.conjuntosVeiculos) {
            db.conjuntosVeiculos.forEach(conj => {
                const antes = JSON.stringify([conj.composicaoAtual, conj.historico]);
                conj.composicaoAtual = (conj.composicaoAtual || []).map(p => p === nomeAntigo ? nomeNovo : p);
                (conj.historico || []).forEach(h => {
                    h.placas = (h.placas || []).map(p => p === nomeAntigo ? nomeNovo : p);
                });
                if (JSON.stringify([conj.composicaoAtual, conj.historico]) !== antes) conjuntosTocados++;
            });
        }
    }

    salvarDB();
    fecharModal();
    atualizarListas();
    // Editar sem renomear não dizia nada: o modal fechava e só. A linha
    // editada pisca no lugar (18/09/2026).
    _destacarCadastro(lista, id);
    // Renomear a empresa que está ativa é uma troca de empresa que ninguém
    // pediu: sem isto a global ficava com o nome velho.
    if (lista === "empresas" && typeof _reconciliarEmpresaAtiva === "function") _reconciliarEmpresaAtiva();

    if (propagados > 0 || conjuntosTocados > 0) {
        const partes = [];
        if (propagados > 0)       partes.push(`${propagados} lançamento(s)`);
        if (conjuntosTocados > 0) partes.push(`${conjuntosTocados} conjunto(s)`);
        mostrarToast(`Renomeado e atualizado em ${partes.join(" e ")}.`, "sucesso", 5000);
    }
}

document.addEventListener("keydown", e => { if (e.key === "Escape") fecharModal(); });

/** A linha do cadastro que acabou de ser criado ou editado pisca, à vista. */
function _destacarCadastro(lista, id) {
    const btn = document.querySelector(`button[data-lista="${lista}"][data-id="${CSS.escape(String(id))}"]`);
    const linha = btn && btn.closest('li, tr');
    if (!linha) return;
    linha.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (typeof confirmarNoLocal === "function") confirmarNoLocal(linha);
}

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
    _destacarCadastro("motoristas", db.motoristas[db.motoristas.length - 1].id);
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
    if (db.veiculos.some(v => normalizarPlaca(v.nome) === normalizarPlaca(placa))) {
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
    _destacarCadastro("veiculos", db.veiculos[db.veiculos.length - 1].id);
}

/**
 * Abre modal de confirmação listando todas as placas que serão
 * convertidas para Mercosul e realiza a conversão após confirmação.
 */
async function converterTodasPlacasMercosul() {
    if (typeof exigirPapel === "function" && !exigirPapel("supremo", "Converter placas")) return;
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

        // Todos os lançamentos, inclusive os que não estão ativos — pelo
        // mesmo motivo de `confirmarEdicao`: uma placa não convertida
        // deixa a nota fora de qualquer conjunto em `resolverConjuntoPorPlaca`.
        db.lancamentos = db.lancamentos.map(l => {
            if (l.placa !== antiga) return l;
            propagados++;
            return Object.assign({}, l, { placa: nova });
        });

        if (db.conjuntosVeiculos) {
            db.conjuntosVeiculos.forEach(conj => {
                conj.composicaoAtual = (conj.composicaoAtual || []).map(p => p === antiga ? nova : p);
                (conj.historico || []).forEach(h => {
                    h.placas = (h.placas || []).map(p => p === antiga ? nova : p);
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
        // A vigência nasce junto: assim o frete de um mês passado nunca é
        // recalculado por uma taxa futura (17/09/2026).
        taxaHistorico: taxaFrete > 0 ? [{ taxa: taxaFrete, vigenciaDe: _hojeISO(), vigenciaAte: null }] : [],
        ativo: true,
        logs: [`Criado em ${new Date().toLocaleString('pt-BR')}`]
    });
    input.value = "";
    if (inputMun) inputMun.value = "";
    if (inputTaxa) inputTaxa.value = "";
    salvarDB();
    atualizarListas();
    _destacarCadastro("empresas", db.empresas[db.empresas.length - 1].id);
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
    _destacarCadastro("combustiveis", db.combustiveis[db.combustiveis.length - 1].id);
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
    _destacarCadastro("bases", db.bases[db.bases.length - 1].id);
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
    // Inativado com "mostrar inativos" desligado some da lista; aí o aviso
    // é o único rastro de que a ação aconteceu.
    if (acao === 'inativar' && !document.getElementById("mostrarInativos")?.checked) {
        mostrarToast(`"${item.nome}" inativado. Marque "mostrar inativos" para vê-lo.`, "info", 4000);
    } else {
        _destacarCadastro(lista, id);
    }
    if (lista === "empresas" && typeof _reconciliarEmpresaAtiva === "function") _reconciliarEmpresaAtiva();
}

/* Excluir cadastro é do supremo (decisão do dono, 17/09/2026): o admin e o
   operador só enxergam as notas das empresas deles, e excluir o que tem
   nota em outra empresa deixava histórico órfão. A regra do servidor
   recusa do mesmo jeito; o botão nem aparece. */
function _btnExcluirCadastro(lista, id) {
    if (!(typeof ehSupremoAtual === "function" && ehSupremoAtual())) return "";
    return `<button class="btn-icone btn-icone--excluir" data-acao="excluir" data-lista="${lista}" data-id="${escapeHtml(id)}" title="Excluir" aria-label="Excluir">${_ICONE.excluir}</button>`;
}

// ========== VERIFICAÇÃO DE VÍNCULOS ==========
/* Este é o único lugar do projeto em que o CADASTRO consulta o
   lançamento, e não o contrário — e é por isso que ele inverteria de
   comportamento sozinho quando a exclusão deixou de apagar o registro.
   Antes, "sumiu do vetor" significava "não há vínculo", e por isso
   excluir um motorista funcionava depois que as notas dele tinham sido
   apagadas. Sem o teste de estado, todo cadastro que um dia apareceu em
   qualquer nota apagada viraria ineliminável para sempre, com a tela
   dizendo "existem lançamentos vinculados" e o operador não achando
   nenhum no relatório. */
/* Empresa e combustível olham TODAS as notas, inclusive excluídas e
   canceladas: a empresa é o documento onde as lápides moram (excluí-la
   deixava o documento órfão, e as canceladas — que o relatório mostra
   sempre — sumiam), e o combustível é por onde o Dashboard monta os
   cartões. Motorista, placa e base olham só as que valem. */
function temVinculoEmLancamentos(lista, item) {
    const ativos = db.lancamentos.filter(lancamentoAtivo);
    if (lista === "motoristas")   return ativos.some(l => l.motorista === item.nome);
    if (lista === "veiculos")     return ativos.some(l => normalizarPlaca(l.placa) === normalizarPlaca(item.nome));
    if (lista === "bases")        return ativos.some(l => l.base === item.nome);
    if (lista === "empresas")     return db.lancamentos.some(l => l.empresa === item.nome || l.empresaId === item.id);
    if (lista === "combustiveis") return db.lancamentos.some(l => (l.itens || []).some(i => i.tipo === item.nome));
    return false;
}

// ========== EXCLUIR COM VERIFICAÇÃO ==========
// FIX v4: String(i.id) === String(id) para garantir comparação correta
//         independente de como o ID chegou do Firestore
async function excluirCadastro(lista, id) {
    if (typeof exigirPapel === "function" && !exigirPapel("supremo", "Excluir cadastro")) return;
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
    if (lista === "empresas" && typeof _reconciliarEmpresaAtiva === "function") _reconciliarEmpresaAtiva();
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
        container.innerHTML = `<p class="vazio vazio--conjuntos">Nenhum conjunto cadastrado.</p>`;
        return;
    }

    container.innerHTML = exibir.map(c => {
        const placasStr = c.composicaoAtual.map(escapeHtml).join(", ");
        const nomeExib = c.nome ? `<strong>${escapeHtml(c.nome)}</strong>` : `<em class="rotulo-suave">(sem nome)</em>`;
        const inativoTag = c.ativo === false ? ' <em class="tag-inativo">inativo</em>' : '';
        return `
        <li class="conjunto-item ${c.ativo === false ? 'inativo' : ''}">
            <div class="conjunto-info">
                <div class="conjunto-nome">${nomeExib}${inativoTag}</div>
                <div class="conjunto-placas" title="${placasStr}">
                     ${placasStr}
                </div>
            </div>
            <div class="acoes-lista">
                <button class="btn-icone btn-icone--editar" title="Editar" aria-label="Editar" onclick="abrirEditarConjunto('${escapeJsAttr(c.id)}')">${_ICONE.editar}</button>
                <button class="btn-icone btn-icone--inativar" title="${c.ativo !== false ? "Inativar" : "Reativar"}" aria-label="${c.ativo !== false ? "Inativar" : "Reativar"}" onclick="toggleAtivoConjunto('${escapeJsAttr(c.id)}')">${c.ativo !== false ? _ICONE.inativar : _ICONE.reativar}</button>
                ${(typeof ehSupremoAtual === "function" && ehSupremoAtual()) ? `<button class="btn-icone btn-icone--excluir" title="Excluir" aria-label="Excluir" onclick="excluirConjunto('${escapeJsAttr(c.id)}')">${_ICONE.excluir}</button>` : ""}
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
    // A vigência é o que decide os Fretes de cada data: inativar fecha a
    // composição hoje, e reativar reabre a que foi fechada pela inativação.
    const ultimo = (conj.historico || [])[conj.historico.length - 1];
    if (ultimo) {
        if (!conj.ativo && !ultimo.vigenciaAte) {
            ultimo.vigenciaAte = _hojeISO();
            ultimo.fechadaPorInativacao = true;
        } else if (conj.ativo && ultimo.fechadaPorInativacao) {
            ultimo.vigenciaAte = null;
            delete ultimo.fechadaPorInativacao;
        }
    }
    salvarDB();
    renderizarConjuntos();
}

async function excluirConjunto(id) {
    if (typeof exigirPapel === "function" && !exigirPapel("supremo", "Excluir conjunto")) return;
    const conj = db.conjuntosVeiculos.find(c => String(c.id) === String(id));
    if (!conj) return;
    // Conjunto que já rodou é parte dos Fretes dos meses passados: excluir
    // reescrevia esses meses sem volta. Esse é o caso de Inativar.
    const placas = new Set((conj.historico || []).flatMap(h => h.placas || []).map(normalizarPlaca));
    if (db.lancamentos.some(l => placas.has(normalizarPlaca(l.placa)))) {
        mostrarToast("Esse conjunto tem viagens lançadas e aparece nos Fretes dos meses passados. Use Inativar.", "erro", 7000);
        return;
    }
    if (!await fmConfirm({ titulo: "Excluir conjunto?", msg: "Esta ação não pode ser desfeita.", confirmTxt: "Excluir", tipo: "perigo" })) return;
    db.conjuntosVeiculos = db.conjuntosVeiculos.filter(c => String(c.id) !== String(id));
    salvarDB();
    renderizarConjuntos();
}

/* O modal é um só para criar e editar: título, rótulo da data e a própria
   data são postos a cada abertura. A data ficava com o valor da abertura
   anterior — uma data digitada num conjunto e cancelada era usada, sem
   aviso, como vigência do próximo conjunto alterado (18/09/2026). */
function _prepararFormConjunto(editando) {
    document.getElementById("conjuntoFormTitulo").textContent = editando ? "Editar conjunto" : "Novo conjunto de veículos";
    const data = document.getElementById("conjuntoDataVigencia");
    if (data) data.value = "";
    const rotulo = document.getElementById("conjuntoVigenciaRotulo");
    const dica = document.getElementById("conjuntoVigenciaDica");
    if (rotulo) rotulo.innerHTML = editando
        ? 'Vigência da nova composição <span class="rotulo-nota rotulo-nota--perigo">(obrigatória se mudar as placas)</span>'
        : 'Vale a partir de <span class="rotulo-nota">(em branco: hoje)</span>';
    if (dica) dica.textContent = editando
        ? "Lançamentos anteriores a essa data continuam na composição anterior."
        : "Lançamentos a partir dessa data entram neste conjunto.";
}

function abrirEditarConjunto(id) {
    _conjuntoEditandoId = id;
    const conj = db.conjuntosVeiculos.find(c => String(c.id) === String(id));
    if (!conj) return;

    _prepararFormConjunto(true);
    document.getElementById("conjuntoNomeInput").value = conj.nome || "";
    _renderizarPlacasConjunto(conj.composicaoAtual.slice());

    const histDiv = document.getElementById("conjuntoHistorico");
    if (histDiv && conj.historico && conj.historico.length > 0) {
        histDiv.innerHTML = `
            <p class="conjunto-historico-titulo">Histórico de composições</p>
            ${conj.historico.map((h, i) => {
                const de = h.vigenciaDe ? formatarData(h.vigenciaDe) : "—";
                const ate = h.vigenciaAte ? formatarData(h.vigenciaAte) : "hoje";
                return `<div class="conjunto-historico-item">
                    <strong>${i+1}.</strong> ${h.placas.map(escapeHtml).join(", ")}
                    <span class="conjunto-historico-vigencia">(${de} → ${ate})</span>
                </div>`;
            }).join("")}
        `;
        histDiv.style.display = "block";
    }

    document.getElementById("conjuntoFormOverlay").style.display = "flex";
}

function abrirNovoConjunto() {
    _conjuntoEditandoId = null;
    _prepararFormConjunto(false);
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
        <div class="form-linha form-linha--placa" data-idx="${i}">
            <input type="text" value="${escapeHtml(p)}" maxlength="8" placeholder="Ex: ABC1D23"
                   class="campo-placa"
                   oninput="this.value=this.value.toUpperCase().replace(/[-\\s]/g,''); _placasTemp[${i}]=this.value;">
            <button class="btn-icone btn-icone--excluir" title="Tirar a placa do conjunto" aria-label="Tirar a placa ${escapeHtml(p) || 'vazia'} do conjunto" onclick="_removerPlacaConjunto(${i})">✕</button>

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

        // `slice` antes do sort: ordenar no lugar mudava a composição salva,
        // e com ela o nome automático do conjunto.
        const composicaoMudou = JSON.stringify(conj.composicaoAtual.slice().sort()) !== JSON.stringify(placas.slice().sort());
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
                vigenciaDe: dataVigencia || _hojeISO(),
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
                        <button class="btn-icone btn-icone--editar" data-acao="editar" data-lista="motoristas" data-id="${m.id}" title="Editar" aria-label="Editar">${_ICONE.editar}</button>
                        <button class="btn-icone btn-icone--inativar" data-acao="toggle" data-lista="motoristas" data-id="${m.id}" title="${m.ativo !== false ? "Inativar" : "Reativar"}" aria-label="${m.ativo !== false ? "Inativar" : "Reativar"}">${m.ativo !== false ? _ICONE.inativar : _ICONE.reativar}</button>
                        ${_btnExcluirCadastro("motoristas", m.id)}
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
                        <button class="btn-icone btn-icone--editar" data-acao="editar" data-lista="veiculos" data-id="${v.id}" title="Editar" aria-label="Editar">${_ICONE.editar}</button>
                        <button class="btn-icone btn-icone--inativar" data-acao="toggle" data-lista="veiculos" data-id="${v.id}" title="${v.ativo !== false ? "Inativar" : "Reativar"}" aria-label="${v.ativo !== false ? "Inativar" : "Reativar"}">${v.ativo !== false ? _ICONE.inativar : _ICONE.reativar}</button>
                        ${_btnExcluirCadastro("veiculos", v.id)}
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
                        ${_taxaFreteDaEmpresa(e) > 0 ? `<em class="tag-perda" title="${escapeHtml(_historicoTaxaTexto(e))}">Frete: ${fmtRL(_taxaFreteDaEmpresa(e))}/L${(e.taxaHistorico || []).length > 1 ? ' · ' + (e.taxaHistorico.length) + ' vigências' : ''}</em>` : ''}
                        ${e.ativo !== false ? "" : ' <em class="tag-inativo">inativo</em>'}
                    </span>
                    <div class="acoes-lista">
                        <button class="btn-icone btn-icone--editar" data-acao="editar" data-lista="empresas" data-id="${e.id}" title="Editar" aria-label="Editar">${_ICONE.editar}</button>
                        <button class="btn-icone btn-icone--inativar" data-acao="toggle" data-lista="empresas" data-id="${e.id}" title="${e.ativo !== false ? "Inativar" : "Reativar"}" aria-label="${e.ativo !== false ? "Inativar" : "Reativar"}">${e.ativo !== false ? _ICONE.inativar : _ICONE.reativar}</button>
                        ${_btnExcluirCadastro("empresas", e.id)}
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
                        <button class="btn-icone btn-icone--editar" data-acao="editar" data-lista="combustiveis" data-id="${c.id}" title="Editar" aria-label="Editar">${_ICONE.editar}</button>
                        <button class="btn-icone btn-icone--inativar" data-acao="toggle" data-lista="combustiveis" data-id="${c.id}" title="${c.ativo !== false ? "Inativar" : "Reativar"}" aria-label="${c.ativo !== false ? "Inativar" : "Reativar"}">${c.ativo !== false ? _ICONE.inativar : _ICONE.reativar}</button>
                        ${_btnExcluirCadastro("combustiveis", c.id)}
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
                        <button class="btn-icone btn-icone--editar" data-acao="editar" data-lista="bases" data-id="${b.id}" title="Editar" aria-label="Editar">${_ICONE.editar}</button>
                        <button class="btn-icone btn-icone--inativar" data-acao="toggle" data-lista="bases" data-id="${b.id}" title="${b.ativo !== false ? "Inativar" : "Reativar"}" aria-label="${b.ativo !== false ? "Inativar" : "Reativar"}">${b.ativo !== false ? _ICONE.inativar : _ICONE.reativar}</button>
                        ${_btnExcluirCadastro("bases", b.id)}
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
        if (lista === 'motoristas') abrirModal('Editar motorista',  'Nome',  item.nome, lista, id);
        else if (lista === 'veiculos')    abrirModal('Editar veículo',    'Placa', item.nome, lista, id);
        else if (lista === 'empresas')    abrirModal('Editar empresa',    'Nome',  item.nome, lista, id, null, item.municipio || '', item.taxaFrete ?? '');
        else if (lista === 'combustiveis') abrirModal('Editar combustível','Nome',  item.nome, lista, id, item.perda);
        else if (lista === 'bases')       abrirModal('Editar base',       'Nome',  item.nome, lista, id);
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
