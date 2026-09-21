/*=================================================
  VALIDACAO.JS — o operador descobre o problema onde ele nasce,
  não numa fila de confirmações depois de digitar tudo.

  Por que existe (tema 04 da pesquisa): o salvamento abria até cinco
  confirmações de julgamento em sequência — data futura na nota, data
  futura na descarga, descarga antes da nota, nota duplicada e preço
  fora da média, esta uma por linha de combustível. Uma nota com três
  combustíveis fora da média e uma data errada abria seis janelas antes
  da conferência final. O efeito, descrito em quatro das cinco
  pesquisas, é o operador aprender a apertar Enter sem ler: a segurança
  fica formal e a atenção desaparece.

  As três ideias que sustentam este arquivo:

  1. Modal não é severidade, é mecanismo. A pergunta certa não é "esta
     regra é importante?", e sim "esta regra impede gravar?". Se impede,
     é bloqueio: mensagem no campo, faixa acima dos botões, foco, e a
     gravação não acontece. Se não impede, é alerta: mensagem que fica
     visível e não interrompe.

  2. Nem a cada tecla, nem só no salvar. Cada regra fala no momento em
     que existe informação suficiente para julgá-la — no `change` do
     campo. Datas são `<input type="date">` e não passam por estados
     intermediários; texto avisa ao sair do campo. Campo vazio só é
     cobrado depois de uma tentativa de salvar, senão a tela acusaria o
     operador antes de ele ter chance de preencher.

  3. O botão nunca é desabilitado. Um botão cinza não diz por quê. O
     clique é o que permite ao sistema levar o operador ao problema.
=================================================*/

/* Estado transitório. Nunca vai para o Firestore: validação é estado de
   interface, não dado fiscal. O que fica registrado é o log de quem
   aceitou os alertas, em `salvarLancamentoFinal`. */
let _validacao = { bloqueios: [], alertas: [] };

/* Campo vazio só vira cobrança depois de tentar salvar. */
let _tentouSalvar = false;

const _CAMPOS_VALIDADOS = [
    "dataNota", "dataDescarga", "numeroNota",
    "empresaInput", "motoristaInput", "placaInput"
];

/* ── REFERÊNCIA DE PREÇO ─────────────────────────────────────────────
   Mediana, não média.

   A média aritmética é contaminada pelo próprio valor extremo que se
   quer detectar: em 5,70 · 5,72 · 5,71 · 5,73 · 5,70 · 9,90 a média já
   sobe o bastante para achar que 9,90 é quase normal. A mediana ignora
   o extremo.

   Janela padrão de sete dias, e não de trinta (decisão do dono, tema 06,
   confirmada em 16/09). Combustível reajusta na refinaria: com trinta
   dias, uma alta de 15% deixa a régua velha por semanas e o sistema passa
   a repreender lançamento correto — que é o caminho mais curto para o
   operador aprender a ignorar o aviso. Os dias e a diferença (em R$/L,
   padrão R$ 0,25) são configuráveis, iguais para todos.

   E o sistema nunca cala: basta uma nota no histórico (também decisão
   do dono). O custo conhecido é que a segunda nota de um combustível
   novo tende a sair com aviso, porque a régua se apoia num valor só.
   Por isso o badge da linha mostra em quantas notas ela se apoia: é
   quem está olhando a nota que decide o peso de "1 nota" contra
   "14 notas", não o sistema.

   A semana é a DA NOTA, pela data de emissão (rodada 11, decisão do dono).
   Preço é fato da compra, e a compra é datada pela emissão. E a janela
   termina na data da nota que está no formulário, não em hoje: uma nota
   de três meses atrás, de um período de crise do petróleo, era comparada
   com os preços desta semana. Sem data da nota ainda, a janela termina
   hoje. Nota posterior à data da nota não entra.

   A conta em si mora em `utils.js` (`referenciaPrecoCombustivel` e
   `julgarPreco`), porque o Dashboard usa a mesma: uma régua só, com janela
   e diferença em R$/L configuradas em Sistema › Ajustar Alertas.
   ────────────────────────────────────────────────────────────────── */

/** Último dia da janela da referência: a data da nota no formulário, ou hoje. */
function _fimJanelaPreco() {
    const el = document.getElementById("dataNota");
    return (el && el.value) || _hojeISO();
}

/** A referência da nota que está no formulário, sem ela mesma numa edição. */
function referenciaPreco(nomeCombustivel) {
    return referenciaPrecoCombustivel(nomeCombustivel, _fimJanelaPreco(), lancamentoEditandoId);
}

function _plural(n, singular, plural) {
    return `${n} ${n === 1 ? singular : plural}`;
}

/* ── A RÉGUA, VISÍVEL ANTES DO ERRO ─────────────────────────────────
   Até o tema 06 o sistema calculava a referência, julgava por ela e
   nunca a mostrava: o operador só descobria que ela existia quando era
   repreendido. O badge aparece assim que o combustível é escolhido,
   antes de haver preço digitado, e traz sempre a janela e o número de
   notas — "R$ 5,90 · 1 nota" e "R$ 5,90 · 14 notas" são o mesmo número
   e não valem a mesma coisa.

   Fica na `.badge-wrapper`, que já é a célula do grid da linha: não
   desloca nada e convive com o badge de perda e com o aviso de preço.
   É informação, não julgamento — daí a classe própria e o tom discreto.
   ────────────────────────────────────────────────────────────────── */
function _desenharReferenciaPreco(linha, tipo) {
    const wrapper = linha.querySelector(".badge-wrapper");
    if (!wrapper) return;

    const antigo = wrapper.querySelector(".ref-preco");
    if (antigo) antigo.remove();
    if (!tipo) return;

    const { mediana, amostras, dias, fim } = referenciaPreco(tipo);
    const ref = document.createElement("span");
    ref.className = "ref-preco";
    // Quando a janela não termina hoje, o badge diz onde ela termina: sem
    // isso, "7 dias" numa nota antiga seria lido como a última semana.
    const ate = fim === _hojeISO() ? "" : ` até ${formatarData(fim).slice(0, 5)}`;
    ref.textContent = mediana
        ? `referência ${fmtRL(mediana)}/L · ${dias} dias${ate} · ${_plural(amostras, "nota", "notas")}`
        : `sem histórico nos ${dias} dias${ate || " anteriores"}`;
    // Antes do aviso de preço, quando os dois estiverem na célula: a
    // régua vem primeiro, o julgamento depois.
    wrapper.insertBefore(ref, wrapper.querySelector(".aviso-preco"));
}

/* ── MENSAGEM JUNTO DO CAMPO ────────────────────────────────────────
   A mensagem é anexada ao `.campo`, não logo depois do input: motorista,
   placa e base estão dentro do wrapper do combobox, e a lista de
   sugestões é posicionada de forma absoluta em cima dele.
   ────────────────────────────────────────────────────────────────── */
function _msgCampo(id, texto, tipo) {
    const input = document.getElementById(id);
    if (!input) return;
    const campo = input.closest(".campo") || input.parentNode;

    let msg = campo.querySelector(".msg-validacao");
    if (!msg) {
        msg = document.createElement("div");
        msg.className = "msg-validacao";
        msg.id = id + "-msg";
        campo.appendChild(msg);
    }
    msg.textContent = texto;
    msg.dataset.tipo = tipo;
    msg.style.display = "block";

    input.classList.toggle("campo-bloqueio", tipo === "bloqueio");
    input.classList.toggle("campo-alerta",   tipo === "alerta");
    // `aria-invalid` só em bloqueio: alerta não é campo inválido.
    if (tipo === "bloqueio") input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    input.setAttribute("aria-describedby", msg.id);
}

function _limparMsgCampo(id) {
    const input = document.getElementById(id);
    if (!input) return;
    const campo = input.closest(".campo") || input.parentNode;
    const msg = campo.querySelector(".msg-validacao");
    if (msg) msg.style.display = "none";
    input.classList.remove("campo-bloqueio", "campo-alerta");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
}

/** Apaga toda a marcação de validação da tela. */
function limparValidacao() {
    _validacao = { bloqueios: [], alertas: [] };
    _tentouSalvar = false;
    _CAMPOS_VALIDADOS.forEach(_limparMsgCampo);
    document.querySelectorAll(".linha-combustivel").forEach(l => {
        const av = l.querySelector(".aviso-preco");
        if (av) av.remove();
        l.querySelectorAll(".qtd, .qtdDescargada, .valor").forEach(c => {
            c.classList.remove("campo-bloqueio");
            c.removeAttribute("aria-invalid");
        });
    });
    const faixa = document.getElementById("faixaValidacao");
    if (faixa) faixa.style.display = "none";
}

/* ── AS REGRAS ──────────────────────────────────────────────────────*/
/* `_hojeISO()` mudou para utils.js na rodada 11: o Dashboard e o Relatório
   passaram a usá-la nos períodos rápidos. */

/**
 * Recalcula tudo e redesenha as mensagens. É chamada no `change` de cada
 * campo e, obrigatoriamente, depois de qualquer preenchimento por script
 * — XML, rascunho restaurado, clonar e editar não disparam eventos de
 * usuário, e sem esta chamada a tela ficaria muda justamente nos casos
 * em que o operador não digitou nada.
 *
 * @returns {{bloqueios: Array, alertas: Array}}
 */
function validarLancamento() {
    const val = id => (document.getElementById(id)?.value || "").trim();
    const bloqueios = [];
    const alertas   = [];
    const porCampo  = {};   // id -> {texto, tipo}

    const marcar = (campo, texto, tipo) => {
        const item = { campo, texto, tipo };
        (tipo === "bloqueio" ? bloqueios : alertas).push(item);
        // Um campo mostra uma mensagem por vez, e bloqueio tem prioridade
        // sobre alerta: acusar duas coisas no mesmo lugar não ajuda a
        // corrigir nenhuma.
        if (!porCampo[campo] || (tipo === "bloqueio" && porCampo[campo].tipo === "alerta")) {
            porCampo[campo] = { texto, tipo };
        }
    };

    const dataNota     = val("dataNota");
    const dataDescarga = val("dataDescarga");
    const numeroNota   = val("numeroNota");
    const empresa      = val("empresaInput");
    const motorista    = val("motoristaInput");
    const placa        = val("placaInput");
    const hoje         = _hojeISO();

    // ── Obrigatórios: só depois de tentar salvar ──
    if (_tentouSalvar) {
        if (!dataNota)  marcar("dataNota",       "Informe a data da nota fiscal.", "bloqueio");
        // Obrigatória desde a rodada 11 (decisão do dono): a descarga é o dia
        // em que o combustível entrou nos tanques, e controlar essa entrada é
        // o objetivo da ferramenta. Fretes, Conferência e os litros do
        // Dashboard se apoiam nela.
        if (!dataDescarga) marcar("dataDescarga", "Informe a data da descarga.",  "bloqueio");
        if (!empresa)   marcar("empresaInput",   "Informe a empresa.",             "bloqueio");
        if (!motorista) marcar("motoristaInput", "Informe o motorista.",           "bloqueio");
        if (!placa)     marcar("placaInput",     "Informe a placa.",               "bloqueio");
    }

    // ── Empresa que não vira documento ──
    // O lançamento guarda o NOME da empresa, e o documento de destino é
    // resolvido por nome EXATO (`_empresaIdDoLancamento`). Um nome que não
    // bate — a empresa ativa que foi renomeada, ou "transportadora aurora"
    // digitado numa edição — fazia a nota não entrar em documento nenhum:
    // ela sumia no próximo carregamento, com o toast dizendo que salvou e a
    // pílula dizendo sincronizado. Testado na rodada 10. Agora é bloqueio.
    // A nota é da empresa ativa. O campo fica travado, e isto é a garantia
    // de que nada — edição antiga, rascunho, script — grava em outra.
    if (empresa && typeof empresaFiltroGlobal !== "undefined" && empresaFiltroGlobal && empresa !== empresaFiltroGlobal) {
        marcar("empresaInput", `A empresa ativa é "${empresaFiltroGlobal}". A nota só pode ser salva nela.`, "bloqueio");
    }
    // NF-e de outra empresa (decisão do dono, 17/09/2026): o destinatário do
    // XML corresponde, sem ambiguidade, a outra empresa cadastrada.
    if (typeof _xmlEmpresaDestino !== "undefined" && _xmlEmpresaDestino && empresa
        && _xmlEmpresaDestino.nome !== empresa) {
        marcar("empresaInput",
            `Esta NF-e é de "${_xmlEmpresaDestino.nome}" (destinatário no XML: ${_xmlEmpresaDestino.xNome}). `
            + `Nota de outra empresa não dá entrada aqui: troque a empresa ativa e importe de novo.`,
            "bloqueio");
    }

    if (empresa && typeof _empresaIdDoLancamento === "function") {
        const idEmpresa  = _empresaIdDoLancamento({ empresa });
        const permitidas = typeof _empresaIdsPermitidos === "function" ? _empresaIdsPermitidos() : null;
        if (!idEmpresa) {
            const parecida = (db.empresas || []).find(e =>
                normalizarTexto(e.nome) === normalizarTexto(empresa));
            marcar("empresaInput", parecida
                ? `A empresa está cadastrada como "${parecida.nome}". Escreva o nome exatamente assim.`
                : `"${empresa}" não é uma empresa cadastrada. A nota não teria onde ser gravada.`,
                "bloqueio");
        } else if (permitidas && !permitidas.includes(idEmpresa)) {
            marcar("empresaInput", `Você não tem acesso à empresa "${empresa}".`, "bloqueio");
        }
    }

    // ── Edição de uma nota que não está mais aqui ──
    // Um restore de backup, por exemplo, pode tirar do vetor a nota que
    // está aberta em edição. Salvar gravava em `db.lancamentos[-1]` — uma
    // propriedade solta, fora do vetor — e mostrava "Lançamento atualizado".
    if (typeof lancamentoEditandoId !== "undefined" && lancamentoEditandoId
        && !(typeof isClonando !== "undefined" && isClonando)
        && !(db.lancamentos || []).some(l => l.id === lancamentoEditandoId)) {
        marcar(null, "A nota em edição não existe mais neste computador. Cancele a edição e abra a nota de novo pelo relatório.", "bloqueio");
    }

    // ── Datas ──
    // Futuro é alerta: pode ser engano de digitação, pode ser relógio da
    // máquina, e a nota é de terceiro. Bloquear seria caro se errado.
    if (dataNota && dataNota > hoje) {
        marcar("dataNota", `Data da nota é ${formatarData(dataNota)}, no futuro. Confira.`, "alerta");
    }
    if (dataDescarga && dataDescarga > hoje) {
        marcar("dataDescarga", `Data da descarga é ${formatarData(dataDescarga)}, no futuro. Confira.`, "alerta");
    }
    // Descarga antes da nota é bloqueio por decisão do dono: o caminhão
    // não sai antes de a nota existir, então isso é sempre digitação
    // errada, e deixar passar produz um lançamento impossível.
    if (dataNota && dataDescarga && dataDescarga < dataNota) {
        marcar("dataDescarga",
            `Descarga em ${formatarData(dataDescarga)} é anterior à nota de ${formatarData(dataNota)}.`,
            "bloqueio");
    }

    // ── Duplicidade ──
    // Duas forças diferentes. A chave de acesso identifica a NF-e sem
    // ambiguidade, então a mesma chave duas vezes é a mesma nota: bloqueia
    // e não há "salvar mesmo assim". Já número mais empresa mais data é
    // só coincidência forte — número de nota se repete entre emitentes —
    // e por isso continua sendo alerta.
    //
    // O estado do lançamento encontrado muda a resposta, e aqui isso não é
    // refinamento: se a chave de uma nota EXCLUÍDA continuasse bloqueando,
    // quem lançou a NF-e errada e a excluiu nunca mais conseguiria lançá-la
    // do jeito certo — o bloqueio impediria a correção do próprio engano,
    // apontando para uma nota que não aparece em relatório nenhum. Já a
    // chave de uma nota CANCELADA continua bloqueando, e a mensagem diz por
    // quê: aquela NF-e não vale mais, e relançá-la não é o caminho.
    const chave = (typeof _chaveAcessoAtual !== "undefined" && _chaveAcessoAtual) || null;
    if (chave) {
        const jaLancada = (db.lancamentos || []).find(l =>
            l.chaveAcesso === chave && l.id !== lancamentoEditandoId && l.estado !== 'excluido');
        if (jaLancada && jaLancada.estado === 'cancelado') {
            marcar("numeroNota",
                "Esta NF-e já foi lançada e está marcada como cancelada na origem.",
                "bloqueio");
        } else if (jaLancada) {
            marcar("numeroNota", "Esta NF-e já foi lançada. A chave de acesso é a mesma.", "bloqueio");
        }
    }
    // Número, empresa e data valem SEMPRE, com ou sem chave: uma nota
    // digitada à mão não tem chave, e a mesma NF-e importada depois por XML
    // passava sem nenhum aviso.
    if (!porCampo["numeroNota"] && numeroNota && empresa && dataNota &&
               verificarDuplicidadeNota(numeroNota, empresa, dataNota, lancamentoEditandoId)) {
        marcar("numeroNota",
            `Já existe um lançamento da nota ${numeroNota} de ${empresa} em ${formatarData(dataNota)}.`,
            "alerta");
    }

    // ── Itens ──
    let temItemValido = false;
    const numerosInvalidos = [];
    document.querySelectorAll(".linha-combustivel").forEach(linha => {
        const tipo  = linha.querySelector(".tipo").value;
        // Texto que não é número devolve null aqui, e vira bloqueio abaixo.
        // Antes disto, `parseFloat(...) || 0` truncava "1,23" para 1 e o
        // lançamento saía com uma quantidade plausível e errada.
        const qtdTxt   = linha.querySelector(".qtd").value.trim();
        const descTxt  = linha.querySelector(".qtdDescargada").value.trim();
        const valorTxt = linha.querySelector(".valor").value.trim();
        const qtd   = parseNumeroBR(qtdTxt);
        const valor = parseNumeroBR(valorTxt);
        const temAlgo = !!(tipo || qtdTxt || descTxt || valorTxt);

        [["Quantidade", ".qtd", qtdTxt, qtd],
         ["Quantidade descarregada", ".qtdDescargada", descTxt, parseNumeroBR(descTxt)],
         ["Valor unitário", ".valor", valorTxt, valor]].forEach(([rotulo, sel, txt, num]) => {
            const campo = linha.querySelector(sel);
            const ruim = txt !== "" && num === null;
            // O campo em si fica marcado, e não só a faixa lá embaixo: o
            // erro precisa aparecer onde o número foi digitado.
            campo.classList.toggle("campo-bloqueio", ruim);
            if (ruim) {
                campo.setAttribute("aria-invalid", "true");
                numerosInvalidos.push(`${rotulo} "${txt}" não é um número.`);
            } else {
                campo.removeAttribute("aria-invalid");
            }
        });

        if (tipo && qtd > 0) temItemValido = true;

        // Linha começada e não terminada não some mais em silêncio: antes a
        // linha sem combustível ou sem quantidade era descartada ao salvar, e
        // os litros dela não existiam em lugar nenhum. E preço vazio, zero ou
        // negativo não existe (decisão do dono, 17/09/2026).
        if (_tentouSalvar && temAlgo) {
            const n = [...document.querySelectorAll(".linha-combustivel")].indexOf(linha) + 1;
            if (!tipo) numerosInvalidos.push(`Linha ${n}: escolha o combustível (ou remova a linha).`);
            if (qtd === null && !qtdTxt) numerosInvalidos.push(`Linha ${n}: informe a quantidade.`);
            else if (qtd !== null && qtd <= 0) numerosInvalidos.push(`Linha ${n}: a quantidade precisa ser maior que zero.`);
            if (valor === null && !valorTxt) numerosInvalidos.push(`Linha ${n}: informe o valor unitário.`);
            else if (valor !== null && valor <= 0) numerosInvalidos.push(`Linha ${n}: o valor unitário precisa ser maior que zero.`);
            const desc = parseNumeroBR(descTxt);
            if (desc !== null && desc < 0) numerosInvalidos.push(`Linha ${n}: a quantidade descarregada não pode ser negativa.`);
        }

        _desenharReferenciaPreco(linha, tipo);

        const antigo = linha.querySelector(".aviso-preco");
        if (antigo) antigo.remove();
        if (!tipo || !valor) return;

        const { mediana, amostras } = referenciaPreco(tipo);
        // Sem nota na janela, ou alerta de preço desligado: nada a julgar.
        const juizo = julgarPreco(valor, mediana);
        if (!juizo) return;

        const texto = `${fmtRL(valor)}/L está ${fmtRL(Math.abs(juizo.diferenca))}/L `
                    + `${juizo.acima ? "acima" : "abaixo"} da referência `
                    + `(${fmtRL(mediana)}, ${_plural(amostras, "nota", "notas")})`;
        const aviso = document.createElement("span");
        aviso.className = "aviso-preco";
        aviso.textContent = texto;
        linha.querySelector(".badge-wrapper").appendChild(aviso);
        alertas.push({ campo: null, texto: `${tipo}: ${texto}`, tipo: "alerta" });
    });
    if (_tentouSalvar && !temItemValido) {
        bloqueios.push({ campo: null, texto: "Adicione pelo menos um combustível com quantidade.", tipo: "bloqueio" });
    }
    // Número irreconhecível bloqueia sempre, mesmo antes de tentar salvar:
    // não há leitura possível daquele texto, e deixar passar é o caminho
    // que corrompia o lançamento em silêncio.
    numerosInvalidos.forEach(texto => {
        bloqueios.push({ campo: null, texto, tipo: "bloqueio" });
    });

    // ── Desenha ──
    _CAMPOS_VALIDADOS.forEach(id => {
        if (porCampo[id]) _msgCampo(id, porCampo[id].texto, porCampo[id].tipo);
        else _limparMsgCampo(id);
    });

    _validacao = { bloqueios, alertas };
    _renderFaixaValidacao();
    return _validacao;
}

/* ── A FAIXA ────────────────────────────────────────────────────────
   Fica acima dos botões, e não no topo da tela: a tela é uma só, e o
   botão é para onde o operador olha na hora de salvar. Só aparece
   quando há bloqueio, ou quando já houve uma tentativa de salvar.
   ────────────────────────────────────────────────────────────────── */
function _renderFaixaValidacao() {
    const faixa = document.getElementById("faixaValidacao");
    if (!faixa) return;

    const { bloqueios, alertas } = _validacao;
    if (!bloqueios.length && !(_tentouSalvar && alertas.length)) {
        faixa.style.display = "none";
        return;
    }

    const lista = bloqueios.length ? bloqueios : alertas;
    const titulo = bloqueios.length
        ? `${bloqueios.length === 1 ? "1 erro impede o salvamento" : bloqueios.length + " erros impedem o salvamento"}`
        : `${alertas.length === 1 ? "1 ponto para conferir" : alertas.length + " pontos para conferir"}`;

    faixa.className = "faixa-validacao " + (bloqueios.length ? "faixa-bloqueio" : "faixa-alerta");
    faixa.innerHTML =
        `<strong>${escapeHtml(titulo)}</strong><ul>`
        + lista.map(i => i.campo
            ? `<li><a href="#" onclick="_focarCampoValidacao('${escapeHtml(i.campo)}'); return false;">${escapeHtml(i.texto)}</a></li>`
            : `<li>${escapeHtml(i.texto)}</li>`).join("")
        + `</ul>`;
    faixa.style.display = "block";
}

function _focarCampoValidacao(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
}

/* ── GATILHOS ───────────────────────────────────────────────────────*/
function _registrarValidacaoLancamento() {
    _CAMPOS_VALIDADOS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", validarLancamento);
    });

    // Delegação para as linhas de combustível, que nascem e morrem: o
    // ouvinte fica no container e sobrevive a `innerHTML = ""`.
    const container = document.getElementById("combustiveisNota");
    if (container) {
        container.addEventListener("change", e => {
            if (e.target.matches(".tipo, .valor, .qtd, .qtdDescargada")) validarLancamento();
        });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _registrarValidacaoLancamento);
} else {
    _registrarValidacaoLancamento();
}
