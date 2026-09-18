/*=================================================
  NUMERICO.JS — campos de número que entendem português.

  Por que existe (tema 05 da pesquisa): `<input type="number">` falha em
  silêncio no Chrome em pt-BR. Digitar vírgula esvazia o campo e a
  validação nativa ainda diz que está válido; a roda do mouse altera o
  valor de quem está com o campo focado; e o número que sai dali passava
  por `parseFloat(...) || 0`, que trunca em vez de zerar.

  A troca é conceitual: o campo passa a ser texto, e quem entende de
  número é o `parseNumeroBR` de `utils.js`. Em troca, este arquivo
  devolve o que o tipo nativo dava de graça — teclado numérico no
  celular, formatação e recusa de lixo.

  Três representações, e a confusão entre elas era metade do problema:

      EDITANDO   12345,678     vírgula, sem milhar, cursor livre
      PARADO     12.345,678    milhar, casas fixas, só leitura visual
      NO MODELO  12345.678     número JavaScript, o que é gravado

  Sem unidade e sem cifrão dentro do campo: eles ficam no rótulo. Um
  "R$" ou um "L" dentro do input obrigaria o parser a removê-los depois,
  e basta esquecer um para o valor voltar quebrado.
=================================================*/

/** Casas decimais por campo, na DIGITAÇÃO. Litros com três, preço e taxa
 *  com quatro (é como a NF-e traz; arredondar na entrada mudaria o total),
 *  percentual com dois. A EXIBIÇÃO do valor por litro é com três (`fmtRL`,
 *  18/09/2026): quem mostra arredonda, quem guarda não. */
const FM_CASAS = {
    qtd:                  3,
    qtdDescargada:        3,
    valor:                4,
    taxaFreteEmpresa:     4,
    perdaCombustivel:     2,
    modalInputTaxaFrete:  4,
    modalInputPerda:      2,
    _cfgPrecoDif:         2
};

function _fmCasasDe(el) {
    if (el.id && FM_CASAS[el.id] !== undefined) return FM_CASAS[el.id];
    for (const c of el.classList) if (FM_CASAS[c] !== undefined) return FM_CASAS[c];
    return 3;
}

/**
 * Transforma um input em campo numérico brasileiro.
 *
 * Não é preciso chamar por campo: `fmNumericoAtivar` faz isso por
 * delegação para tudo que tenha a classe `.fm-numero`, inclusive as
 * linhas de combustível, que nascem e morrem o tempo todo.
 */
function fmNumericoPreparar(el) {
    if (!el || el.dataset.fmNumero === "1") return;
    el.dataset.fmNumero = "1";
    el.type = "text";
    el.setAttribute("inputmode", "decimal");
    el.setAttribute("autocomplete", "off");
    el.classList.add("fm-numero");
    // `min` e `step` pertenciam ao tipo nativo e não valem mais nada aqui;
    // pior, deixariam o navegador marcar como inválido um texto legítimo.
    el.removeAttribute("min");
    el.removeAttribute("max");
    el.removeAttribute("step");
    // Guarda o valor já formatado para exibição, se veio preenchido.
    if (el.value !== "") {
        const n = parseNumeroBR(el.value);
        if (n !== null) el.value = fmtNumeroExibicao(n, _fmCasasDe(el));
    }
}

/** Lê o campo como número. `null` quando vazio ou irreconhecível. */
function fmNumericoValor(el) {
    if (!el) return null;
    return parseNumeroBR(el.value);
}

/** Escreve um número no campo, no formato de exibição. */
function fmNumericoDefinir(el, n) {
    if (!el) return;
    el.value = (n === null || n === undefined || n === "")
        ? ""
        : fmtNumeroExibicao(Number(n), _fmCasasDe(el));
}

function _fmEhNumerico(alvo) {
    return alvo && alvo.classList && alvo.classList.contains("fm-numero");
}

/* ── OS QUATRO COMPORTAMENTOS, POR DELEGAÇÃO ────────────────────────*/

/**
 * Ao entrar no campo, tira o separador de milhar. Editar "12.345,678"
 * com o ponto no meio é desconfortável, e apagar um dígito deixaria o
 * agrupamento errado até o próximo blur.
 */
document.addEventListener("focusin", function (e) {
    const el = e.target;
    if (!_fmEhNumerico(el)) return;
    const n = parseNumeroBR(el.value);
    if (n !== null) el.value = fmtNumeroEdicao(n, _fmCasasDe(el));
    // Seleciona tudo: em digitação repetitiva, o gesto quase sempre é
    // substituir o valor inteiro, não editar um dígito no meio.
    if (el.value) setTimeout(() => { try { el.select(); } catch (_) {} }, 0);
});

/**
 * Preço por litro não chega a centenas de reais: "5.900" no campo de valor
 * é R$ 5,90, e não R$ 5.900 como a heurística do ponto leria numa
 * quantidade. A troca acontece antes do `change` (fase de captura), para a
 * validação e o total já lerem o número certo.
 */
function _fmPontoDecimalNoPreco(el) {
    if (!el || !el.classList || !el.classList.contains("valor")) return;
    const t = el.value.trim();
    if (/^\d{1,2}\.\d{3,4}$/.test(t)) el.value = t.replace(".", ",");
}
document.addEventListener("change", e => _fmPontoDecimalNoPreco(e.target), true);

/**
 * Ao sair, formata. É também o retorno visível do que o sistema
 * entendeu: se alguém digitou "1.234" querendo mil duzentos e trinta e
 * quatro e o sistema leu um vírgula duzentos e trinta e quatro, isso
 * aparece aqui, antes de virar lançamento.
 *
 * Texto irreconhecível NÃO é apagado nem virado zero: fica na tela para
 * o operador ver o que digitou, e a validação marca o campo.
 */
document.addEventListener("focusout", function (e) {
    const el = e.target;
    if (!_fmEhNumerico(el)) return;
    if (el.value.trim() === "") { el.value = ""; return; }
    _fmPontoDecimalNoPreco(el);
    const n = parseNumeroBR(el.value);
    if (n === null) return;
    el.value = fmtNumeroExibicao(n, _fmCasasDe(el));
});

/**
 * A roda do mouse não mexe em número.
 *
 * Com o tipo nativo, rolar sobre o campo focado alterava o valor: 10000
 * litros viraram 9999,999 num teste de cinco cliques. O campo agora é
 * texto e não tem esse comportamento, mas o bloqueio fica como cinto de
 * segurança, e vale para os campos que ainda forem nativos.
 *
 * `preventDefault` e não `blur()`: quem rolou a página queria rolar a
 * página, e não deveria perder o campo em que estava digitando.
 */
document.addEventListener("wheel", function (e) {
    const el = e.target;
    if (!el || !el.matches) return;
    if (_fmEhNumerico(el) || (el.tagName === "INPUT" && el.type === "number")) {
        if (document.activeElement === el) e.preventDefault();
    }
}, { passive: false });

/**
 * Colar vem de planilha, e planilha brasileira traz "1.234,56". Passa
 * pelo mesmo parser da digitação e entra já normalizado, para o campo
 * nunca guardar um texto que só o Excel entende.
 */
document.addEventListener("paste", function (e) {
    const el = e.target;
    if (!_fmEhNumerico(el)) return;
    const texto = (e.clipboardData || window.clipboardData).getData("text");
    if (!texto) return;

    // Tabulação ou quebra de linha significam mais de uma célula. Um campo
    // guarda um número; colar duas células aqui não tem leitura possível, e
    // adivinhar qual delas o operador queria seria pior. Recusa e explica —
    // antes, "60000" ⇥ "5,234" virava 600.005,234 no campo, formatado e
    // plausível.
    if (/[\t\r\n]/.test(texto.trim())) {
        e.preventDefault();
        mostrarToast("Isso são várias células. Cole um valor de cada vez.", "aviso", 4000);
        return;
    }

    const n = parseNumeroBR(texto);
    if (n === null) return;   // deixa colar cru; a validação acusa depois
    e.preventDefault();
    el.value = fmtNumeroEdicao(n, _fmCasasDe(el));
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
});

/**
 * Prepara todos os campos numéricos presentes na tela. Chamado na carga
 * e sempre que uma linha de combustível nasce.
 */
function fmNumericoAtivar(raiz) {
    const escopo = raiz || document;
    escopo.querySelectorAll(".qtd, .qtdDescargada, .valor, " +
        "#taxaFreteEmpresa, #perdaCombustivel, #modalInputTaxaFrete, #modalInputPerda")
        .forEach(fmNumericoPreparar);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => fmNumericoAtivar());
} else {
    fmNumericoAtivar();
}
