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
   Mediana, não média, e com amostra mínima.

   A média aritmética é contaminada pelo próprio valor extremo que se
   quer detectar: em 5,70 · 5,72 · 5,71 · 5,73 · 5,70 · 9,90 a média já
   sobe o bastante para achar que 9,90 é quase normal. A mediana ignora
   o extremo.

   E, abaixo de cinco observações, o sistema não fala. A regra anterior
   alertava com um único preço no histórico, o que é fabricar precisão:
   qualquer segunda nota do combustível saía como anomalia.
   ────────────────────────────────────────────────────────────────── */
const PRECO_AMOSTRA_MINIMA = 5;
const PRECO_TOLERANCIA     = 0.10;

function referenciaPreco(nomeCombustivel) {
    const limite = new Date();
    limite.setDate(limite.getDate() - 30);
    const limiteStr = limite.toISOString().slice(0, 10);

    const precos = (db.lancamentos || [])
        .filter(l => {
            if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;
            if (lancamentoEditandoId && l.id === lancamentoEditandoId) return false;
            const dataRef = l.dataDescarga || l.dataNota || "";
            return dataRef >= limiteStr;
        })
        .flatMap(l => (l.itens || [])
            .filter(i => i.tipo === nomeCombustivel && i.valor > 0)
            .map(i => i.valor))
        .sort((a, b) => a - b);

    if (precos.length < PRECO_AMOSTRA_MINIMA) {
        return { mediana: 0, amostras: precos.length };
    }
    const meio = Math.floor(precos.length / 2);
    const mediana = precos.length % 2
        ? precos[meio]
        : (precos[meio - 1] + precos[meio]) / 2;
    return { mediana, amostras: precos.length };
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
    });
    const faixa = document.getElementById("faixaValidacao");
    if (faixa) faixa.style.display = "none";
}

/* ── AS REGRAS ──────────────────────────────────────────────────────*/

function _hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
        if (!empresa)   marcar("empresaInput",   "Informe a empresa.",             "bloqueio");
        if (!motorista) marcar("motoristaInput", "Informe o motorista.",           "bloqueio");
        if (!placa)     marcar("placaInput",     "Informe a placa.",               "bloqueio");
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
    const chave = (typeof _chaveAcessoAtual !== "undefined" && _chaveAcessoAtual) || null;
    if (chave) {
        const jaExiste = (db.lancamentos || []).some(l =>
            l.chaveAcesso === chave && l.id !== lancamentoEditandoId);
        if (jaExiste) {
            marcar("numeroNota", "Esta NF-e já foi lançada. A chave de acesso é a mesma.", "bloqueio");
        }
    } else if (numeroNota && empresa && dataNota &&
               verificarDuplicidadeNota(numeroNota, empresa, dataNota, lancamentoEditandoId)) {
        marcar("numeroNota",
            `Já existe um lançamento da nota ${numeroNota} de ${empresa} em ${formatarData(dataNota)}.`,
            "alerta");
    }

    // ── Itens ──
    let temItemValido = false;
    document.querySelectorAll(".linha-combustivel").forEach(linha => {
        const tipo  = linha.querySelector(".tipo").value;
        const qtd   = parseFloat(linha.querySelector(".qtd").value) || 0;
        const valor = parseFloat(linha.querySelector(".valor").value) || 0;
        if (tipo && qtd > 0) temItemValido = true;

        const antigo = linha.querySelector(".aviso-preco");
        if (antigo) antigo.remove();
        if (!tipo || !valor) return;

        const { mediana, amostras } = referenciaPreco(tipo);
        if (!mediana) return;   // histórico curto demais: o sistema cala
        const desvio = (valor - mediana) / mediana;
        if (Math.abs(desvio) <= PRECO_TOLERANCIA) return;

        const pct = Math.round(Math.abs(desvio) * 100);
        const acima = desvio > 0 ? "acima" : "abaixo";
        const texto = `${fmtR4(valor)}/L está ${pct}% ${acima} da mediana de 30 dias `
                    + `(${fmtR4(mediana)}, ${amostras} notas)`;
        const aviso = document.createElement("span");
        aviso.className = "aviso-preco";
        aviso.textContent = texto;
        linha.querySelector(".badge-wrapper").appendChild(aviso);
        alertas.push({ campo: null, texto: `${tipo}: ${texto}`, tipo: "alerta" });
    });
    if (_tentouSalvar && !temItemValido) {
        bloqueios.push({ campo: null, texto: "Adicione pelo menos um combustível com quantidade.", tipo: "bloqueio" });
    }

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
