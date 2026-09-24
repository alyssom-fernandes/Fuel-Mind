/*=================================================
  BASE-NFE.JS: Fuel Mind
  Que base do cadastro emitiu uma NF-e (item 10, decisão do dono,
  23/09/2026).

  Até aqui o XML comparava o NOME do emitente com o nome da base. Com as
  bases no padrão do dono, "FORNECEDOR · CIDADE" ("RAIZEN · S. F. CONDE"),
  o emitente ("RAIZEN S.A.") nunca casava, e a nota ficava com o nome cru
  do emitente, fora do cadastro.

  O plano original era cadastrar o CNPJ de cada base. O dono achou
  burocracia demais, e com razão: a nota já traz o que o nome da base
  diz, o fornecedor no nome do emitente e a cidade no endereço dele
  (`enderEmit > xMun`). Casar por fornecedor mais cidade também respeita
  o que ele fez no cadastro: duas unidades do mesmo fornecedor na mesma
  cidade viraram UMA base (LARCO · CANDEIAS), e é isso que o casamento
  por cidade devolve.

  O CNPJ ainda aparece, mas só como memória: quando a tela pergunta de
  qual base é uma nota e a pessoa responde, o CNPJ do emitente fica
  guardado na base (`cnpjsNfe`), e a próxima nota da mesma unidade vem
  resolvida. Ninguém digita CNPJ.

  A ordem da leitura:
    1. o CNPJ que alguém já ligou a uma base;
    2. fornecedor e cidade;
    3. para base sem cidade no nome, o nome inteiro dentro do emitente,
       como era antes;
    4. nada disso: a tela pergunta.

  Funções puras: recebem a lista de bases e os dados da nota, não leem
  `db`. São elas que os testes conferem.
=================================================*/

/* Nome de empresa para comparar: sem acento, sem pontuação e sem as
   terminações societárias, que o cadastro às vezes tem e o XML às vezes
   não. Veio de lancamentos.js, onde casa o destinatário da nota com a
   empresa; mora aqui porque a base usa a mesma regra. */
function _nomeEmpresaComparavel(nome) {
    return normalizarTexto(nome || "")
        .replace(/[.,/\-]/g, " ")
        .replace(/\b(ltda|me|epp|eireli|s a|sa|cia|companhia|comercio|com)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/* Tudo o que não é letra nem número vira espaço: o apóstrofo reto, o
   curvo e o acento solto de "D'OESTE", "D’OESTE" e "D´OESTE". */
function _cidadeComparavel(t) {
    return normalizarTexto(t || "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const _CONECTIVOS_CIDADE = new Set(["de", "da", "do", "das", "dos", "e"]);

/** `{fornecedor, cidade}` de um nome "FORNECEDOR · CIDADE", ou null. */
function _partesDaBase(nome) {
    const partes = String(nome || "").split("·");
    if (partes.length !== 2) return null;
    const fornecedor = partes[0].trim(), cidade = partes[1].trim();
    return fornecedor && cidade ? { fornecedor, cidade } : null;
}

/**
 * A cidade do nome da base é a cidade da nota?
 *
 * Igual, sem acento e sem caixa, é o caso comum. As duas abreviações que
 * o cadastro do dono tem também valem, sem que ele precise mudar nome
 * nenhum:
 *  - iniciais: "S. F. CONDE" é "Sao Francisco do Conde" (cada palavra da
 *    base é o começo da palavra da nota, na mesma ordem, e a última é
 *    inteira, para "S. PAULO" não virar "Salvador");
 *  - sigla: "LEM" é "Luis Eduardo Magalhaes".
 */
function cidadeDaNotaBate(cidadeBase, cidadeNota) {
    const a = _cidadeComparavel(cidadeBase).split(" ").filter(Boolean);
    const b = _cidadeComparavel(cidadeNota).split(" ").filter(Boolean);
    if (!a.length || !b.length) return false;
    if (a.join(" ") === b.join(" ")) return true;
    const as = a.filter(w => !_CONECTIVOS_CIDADE.has(w));
    const bs = b.filter(w => !_CONECTIVOS_CIDADE.has(w));
    if (!as.length || !bs.length) return false;
    if (as.join(" ") === bs.join(" ")) return true;
    // "SANTA BARBARA DOESTE" e "SANTA BARBARA D OESTE": o mesmo sem espaço.
    if (as.join("") === bs.join("")) return true;
    if (as.length === 1 && as[0].length >= 2 && bs.length >= 2 && as[0] === bs.map(w => w[0]).join("")) return true;
    return as.length >= 2 && as.length === bs.length
        && as.every((w, i) => bs[i].startsWith(w))
        && as[as.length - 1] === bs[bs.length - 1];
}

/**
 * O fornecedor do nome da base aparece, em palavras inteiras, no nome do
 * emitente ou no fantasia?
 *
 * Fornecedor feito só de palavras genéricas ("COMERCIAL", "AUTO POSTO",
 * "DE") não conta: uma base "COMERCIAL · CANDEIAS" pegaria calada a nota
 * de "VIBRA COMERCIAL S.A." da mesma cidade.
 */
function fornecedorDaNotaBate(fornecedorBase, nomesDaNota) {
    const f = _nomeEmpresaComparavel(fornecedorBase);
    if (!f || !_temPalavraPropria(f)) return false;
    return (nomesDaNota || []).some(n => {
        const e = _nomeEmpresaComparavel(n);
        return !!e && ` ${e} `.includes(` ${f} `);
    });
}

/* O CNPJ sem máscara, em maiúsculas. Desde julho de 2026 a Receita emite
   CNPJ alfanumérico (letras nas doze primeiras posições, dígitos
   verificadores numéricos): tirar tudo que não é dígito o destruía. */
function _cnpjNormalizado(t) {
    return String(t || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function _cnpjValido(t) {
    return /^[0-9A-Z]{12}[0-9]{2}$/.test(_cnpjNormalizado(t));
}

/** "10.000.000/0001-91" (ou "12.ABC.345/01DE-35"); o que não é CNPJ volta como veio. */
function formatarCnpj(t) {
    const c = _cnpjNormalizado(t);
    return _cnpjValido(c) ? c.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5") : String(t || "");
}

/**
 * A base de uma NF-e.
 *
 * @param {Array} bases - o cadastro de bases
 * @param {{cnpj?: string, xNome?: string, xFant?: string, xMun?: string}} emit - o emitente da nota
 * @returns {{tipo: 'vinculo'|'fornecedorCidade'|'nome'|'ambigua'|'nenhuma',
 *            base: object|null, candidatas: Array, mesmoFornecedor: Array}}
 *   `candidatas` são as bases que empataram (tipo 'ambigua');
 *   `mesmoFornecedor` são as do fornecedor em outras cidades, para a
 *   pergunta sugerir primeiro.
 */
function resolverBaseDaNFe(bases, emit) {
    const e = emit || {};
    const ativas = (bases || []).filter(b => b && b.nome && b.ativo !== false);
    const resultado = (tipo, lista, motivo) => ({
        tipo, base: lista.length === 1 ? lista[0] : null,
        candidatas: lista.length > 1 ? lista : [], mesmoFornecedor: [], motivo: motivo || tipo
    });
    const nomes = [e.xNome, e.xFant].filter(Boolean);
    const bateFornecedorECidade = b => {
        const p = _partesDaBase(b.nome);
        return !!p && fornecedorDaNotaBate(p.fornecedor, nomes) && cidadeDaNotaBate(p.cidade, e.xMun);
    };

    const cnpj = _cnpjNormalizado(e.cnpj);
    if (_cnpjValido(cnpj)) {
        const ligadas = ativas.filter(b => Array.isArray(b.cnpjsNfe) && b.cnpjsNfe.includes(cnpj));
        if (ligadas.length === 1) return resultado("vinculo", ligadas);
        // Duas pessoas ligaram o mesmo CNPJ a bases diferentes ao mesmo
        // tempo (a mesclagem guarda as duas): fornecedor e cidade desempatam,
        // e se não desempatarem a pergunta diz o motivo de verdade.
        if (ligadas.length > 1) {
            const certa = ligadas.filter(bateFornecedorECidade);
            if (certa.length === 1) return resultado("vinculo", certa);
            return resultado("ambigua", ligadas, "cnpjEmVarias");
        }
    }

    const doFornecedor = ativas.filter(b => {
        const p = _partesDaBase(b.nome);
        return p && fornecedorDaNotaBate(p.fornecedor, nomes);
    });
    const naCidade = doFornecedor.filter(bateFornecedorECidade);
    if (naCidade.length === 1) return resultado("fornecedorCidade", naCidade);
    if (naCidade.length > 1) return resultado("ambigua", naCidade);

    // Base sem cidade no nome ("Base Paulínia", "BMAD"): a regra de antes,
    // o nome inteiro da base, em palavras inteiras, dentro do emitente.
    const porNome = ativas.filter(b => {
        if (_partesDaBase(b.nome)) return false;
        const nb = _nomeEmpresaComparavel(b.nome);
        return nb && nomes.some(n => ` ${_nomeEmpresaComparavel(n)} `.includes(` ${nb} `));
    });
    if (porNome.length === 1) return resultado("nome", porNome);
    if (porNome.length > 1) return resultado("ambigua", porNome);

    return { tipo: "nenhuma", base: null, candidatas: [], mesmoFornecedor: doFornecedor, motivo: "nenhuma" };
}

/**
 * A base, ATIVA OU NÃO, que já é deste emitente: o nome digitado igual a
 * um nome ou apelido, ou o mesmo fornecedor na mesma cidade. É a checagem
 * antes de cadastrar uma base nova: a leitura da nota ignora as inativas,
 * e sem isto "RAIZEN · S. F. CONDE" inativa ganhava uma gêmea
 * "RAIZEN · SAO FRANCISCO DO CONDE", e o relatório por base partia o
 * mesmo lugar em duas linhas.
 */
function baseJaCadastradaDoEmitente(bases, emit, nomeDigitado) {
    const e = emit || {};
    const nomes = [e.xNome, e.xFant].filter(Boolean);
    const lista = (bases || []).filter(b => b && b.nome);
    const alvo = normalizarTexto(nomeDigitado || "");
    const porNome = alvo ? lista.find(b => normalizarTexto(b.nome) === alvo) : null;
    if (porNome) return porNome;
    const porApelido = typeof _cadastroPorNomeOuApelido === "function" && nomeDigitado
        ? _cadastroPorNomeOuApelido(lista, nomeDigitado) : null;
    if (porApelido) return porApelido;
    return lista.find(b => {
        const p = _partesDaBase(b.nome);
        return p && fornecedorDaNotaBate(p.fornecedor, nomes) && cidadeDaNotaBate(p.cidade, e.xMun);
    }) || null;
}

/* Palavras que não dizem QUAL fornecedor é: terminam o nome curto
   ("RAIZEN COMBUSTIVEIS" é RAIZEN, "ROYAL FIC DISTRIBUIDORA DE DERIVADOS"
   é ROYAL FIC), são puladas no começo ("AUTO POSTO IPIRANGA" é IPIRANGA),
   e um fornecedor feito só delas não casa com nota nenhuma. */
const _PALAVRAS_GENERICAS_FORNECEDOR = new Set([
    "distribuidora", "distribuicao", "distribuidor", "comercial", "produtos", "derivados",
    "petroleo", "combustiveis", "combustivel", "energia", "transportes", "transportadora",
    "auto", "posto", "postos", "rede", "grupo", "empresa", "industria", "industrial",
    "de", "da", "do", "das", "dos", "e"
]);

function _temPalavraPropria(comparavel) {
    return String(comparavel || "").split(" ").some(p => p && !_PALAVRAS_GENERICAS_FORNECEDOR.has(p));
}

/**
 * O nome que a pergunta sugere para uma base nova, no padrão do dono:
 * "RAIZEN · SAO FRANCISCO DO CONDE". Só sugestão: a pessoa edita antes
 * de cadastrar.
 */
function nomeSugeridoDaBase(emit) {
    const e = emit || {};
    const palavras = _nomeEmpresaComparavel(e.xNome || e.xFant || "").split(" ").filter(Boolean);
    const curtas = [];
    for (const p of palavras) {
        const generica = _PALAVRAS_GENERICAS_FORNECEDOR.has(p);
        // Genérica no começo é pulada; depois da primeira palavra própria,
        // encerra o nome. "INDUSTRIA" é a exceção que o cadastro do dono
        // tem: "SP INDUSTRIA" fica inteiro.
        if (!curtas.length && generica) continue;
        if (curtas.length && generica && p !== "industria") break;
        curtas.push(p);
        if (curtas.length === 2) break;
    }
    const fornecedor = curtas.join(" ").toUpperCase();
    const cidade = normalizarTexto(e.xMun || "").toUpperCase();
    if (fornecedor && cidade) return `${fornecedor} · ${cidade}`;
    return fornecedor || cidade;
}
