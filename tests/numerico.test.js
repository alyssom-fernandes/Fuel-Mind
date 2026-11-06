/*  O CAMPO NUMÉRICO NÃO PODE PERDER DÍGITO DO PREÇO
 *  ==================================================
 *  Rodar:  node --test tests
 *
 *  O texto do campo é o que vira o número gravado. Até 06/11/2026 ele era
 *  reescrito com quatro casas ao sair do campo: R$ 5,8763456789 virava
 *  5,8763, o resumo seguia certo e a nota gravava outro total. Estes testes
 *  percorrem os eventos que reescrevem o texto, com um `document` mínimo,
 *  porque o `numerico.js` só se liga à página por delegação de eventos.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ouvintes = {};
globalThis.document = {
    readyState: "complete",
    addEventListener(tipo, fn) { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); },
    querySelectorAll() { return []; }
};
globalThis.mostrarToast = () => {};
globalThis.db = { lancamentos: [], empresas: [], configAlertas: {} };
globalThis.empresaFiltroGlobal = "";
for (const arquivo of ["utils.js", "numerico.js"]) {
    const codigo = fs.readFileSync(path.join(__dirname, "..", "src", "shared", arquivo), "utf8");
    vm.runInThisContext(codigo, { filename: arquivo });
}

function campo(classes, value = "") {
    const classList = Object.assign(classes.split(" "), { contains(c) { return this.includes(c); } });
    return { id: "", classList, value, select() {}, dispatchEvent() {} };
}
const disparar = (tipo, evento) => ouvintes[tipo].forEach(fn => fn(evento));
const sairDoCampo = el => {
    disparar("change", { target: el });
    disparar("focusout", { target: el });
};

test("sair do campo não corta o preço, e preço curto continua com quatro casas", () => {
    const el = campo("valor fm-numero", "5,8763456789");
    sairDoCampo(el);
    assert.equal(el.value, "5,8763456789");
    assert.equal(parseNumeroBR(el.value), 5.8763456789);

    const curto = campo("valor fm-numero", "5,89");
    sairDoCampo(curto);
    assert.equal(curto.value, "5,8900");
});

test("voltar ao campo mostra o preço inteiro para edição", () => {
    const el = campo("valor fm-numero", "5,8763456789");
    disparar("focusin", { target: el });
    assert.equal(el.value, "5,8763456789");
});

test("colar o preço da nota não corta os dígitos", () => {
    const el = campo("valor fm-numero");
    const colagem = { target: el, preventDefault() {}, clipboardData: { getData: () => "5,8763456789" } };
    globalThis.Event = class { constructor(tipo) { this.type = tipo; } };
    disparar("paste", colagem);
    assert.equal(el.value, "5,8763456789");
});

test("campo preparado com o preço do rascunho mantém os dígitos", () => {
    const el = campo("valor", "5,8763456789");
    el.dataset = {};
    el.setAttribute = () => {};
    el.removeAttribute = () => {};
    el.classList.add = c => el.classList.push(c);
    fmNumericoPreparar(el);
    assert.equal(el.value, "5,8763456789");
});

test("o total da carga sai igual ao da nota com o preço inteiro", () => {
    const el = campo("valor fm-numero", "5,8763456789");
    sairDoCampo(el);
    const total = Math.round(60000 * parseNumeroBR(el.value) * 100) / 100;
    assert.equal(total, 352580.74);
});

test("litros e taxa de frete seguem com as casas de sempre", () => {
    const litros = campo("qtd fm-numero", "12345,6789");
    sairDoCampo(litros);
    assert.equal(litros.value, "12.345,679");

    const taxa = campo("vigencia-taxa fm-numero", "0,1");
    sairDoCampo(taxa);
    assert.equal(taxa.value, "0,10");
});

test('"5.900" no campo de preço continua sendo R$ 5,90', () => {
    const el = campo("valor fm-numero", "5.900");
    sairDoCampo(el);
    assert.equal(el.value, "5,9000");
});
