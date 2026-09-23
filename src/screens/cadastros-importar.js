/*=================================================
  IMPORTAÇÃO DE CADASTROS POR PLANILHA (22/09/2026)

  Cadastrar 128 veículos, 44 motoristas e 43 conjuntos um a um é meio dia
  de digitação e uma placa errada garantida. Esta tela lê uma planilha e
  grava tudo de uma vez.

  O formato NÃO é o da planilha de frota do dono: aquela tem células
  mescladas, cinco abas, numeração divergente entre documentos e o
  cabeçalho da coluna J diz "CONJUNTO" mas guarda o proprietário. Ensinar o
  sistema a entender aquilo seria transformar um acerto de dados num
  problema de software permanente. Em vez disso a planilha limpa é gerada
  fora, conferida pelo dono, e aqui só entra um layout simples e declarado:

      Veiculos    PLACA | PLACA ANTIGA
      Motoristas  NOME | APELIDOS
      Conjuntos   CONJUNTO | PLACA 1 | PLACA 2 | PLACA 3
      Bases       NOME | APELIDOS

  APELIDOS é opcional e serve à BUSCA: a base da Raízen em Madre de Deus
  chama-se "RAIZEN · MADRE DE DEUS" na lista, mas quem lança a nota digita
  "BMAD" há anos e precisa continuar achando.

  Colunas que o leitor não conhece são ignoradas de propósito: a planilha
  entregue traz marca, modelo, ano e o motorista de cada conjunto para o
  dono conferir, e nada disso tem lugar no cadastro.

  Nada é gravado antes da confirmação. O que já existe é contado e
  mostrado, nunca sobrescrito: reimportar a mesma planilha não duplica e
  não desfaz uma correção feita à mão depois.
=================================================*/

/*─────────────────────────────────────────────
  ABAS E COLUNAS RECONHECIDAS
─────────────────────────────────────────────*/
const CAD_IMP_ABAS = {
    veiculos:   { rotulo: "Veículos",   nomes: ["veiculos", "veiculo"] },
    motoristas: { rotulo: "Motoristas", nomes: ["motoristas", "motorista"] },
    conjuntos:  { rotulo: "Conjuntos",  nomes: ["conjuntos", "conjunto"] },
    bases:      { rotulo: "Bases",      nomes: ["bases", "base"] }
};

/** Vigência inicial dos conjuntos importados. Decisão do dono em
 *  22/09/2026: ele vai importar lançamentos de meses anteriores para
 *  conferir, e a composição precisa valer desde o começo do ano. */
const CAD_IMP_VIGENCIA = "2026-01-01";

/** O plano montado na leitura, esperando confirmação. */
let _cadImpPlano = null;

/*─────────────────────────────────────────────
  LEITURA DA PLANILHA
─────────────────────────────────────────────*/
function cadImportarLerArquivo(input) {
    const arquivo = input && input.files && input.files[0];
    if (!arquivo) return;
    if (typeof exigirPapel === "function" && !exigirPapel("admin", "Importar cadastros")) {
        input.value = "";
        return;
    }
    // A biblioteca de planilha só chega quando alguém precisa dela; aqui é
    // um desses momentos.
    if (adiarAteBibliotecas(["xlsx"], () => cadImportarLerArquivo(input))) return;

    const leitor = new FileReader();
    leitor.onload = e => {
        try {
            const wb = XLSX.read(e.target.result, { type: "binary", cellDates: false, cellText: false });
            _cadImpPlano = _cadImpMontarPlano(wb);
            _cadImpRenderizarPrevia();
        } catch (erro) {
            console.error("Importação de cadastros:", erro);
            mostrarToast("Não consegui ler essa planilha. Confira se é o arquivo gerado para importação.", "erro", 7000);
        }
    };
    leitor.onerror = () => mostrarToast("Não consegui abrir o arquivo.", "erro", 5000);
    leitor.readAsBinaryString(arquivo);
}

/** Aba pelo nome, ignorando acento, caixa e espaço em volta. */
function _cadImpAba(wb, chave) {
    const nomes = CAD_IMP_ABAS[chave].nomes;
    const achou = (wb.SheetNames || []).find(n => nomes.includes(normalizarTexto(n)));
    return achou ? wb.Sheets[achou] : null;
}

/** A aba como matriz de texto, já sem as linhas totalmente vazias. */
function _cadImpLinhas(ws) {
    const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
    return linhas.filter(l => l.some(c => String(c == null ? "" : c).trim() !== ""));
}

/** Mapa "cabeçalho normalizado" → índice da coluna. */
function _cadImpColunas(cabecalho) {
    const mapa = {};
    (cabecalho || []).forEach((c, i) => {
        const chave = normalizarTexto(String(c == null ? "" : c));
        if (chave && !(chave in mapa)) mapa[chave] = i;
    });
    return mapa;
}

function _cadImpCelula(linha, indice) {
    if (indice === undefined || indice === null) return "";
    return String(linha[indice] == null ? "" : linha[indice]).trim();
}

/*─────────────────────────────────────────────
  MONTAGEM DO PLANO
  Cada item vira { valor, situacao, motivo }. `situacao` é "novo",
  "existe" ou "erro"; só "novo" é gravado.
─────────────────────────────────────────────*/
function _cadImpMontarPlano(wb) {
    const plano = {
        veiculos: [], motoristas: [], bases: [], conjuntos: [],
        abasFaltando: [], nomeArquivo: ""
    };

    Object.keys(CAD_IMP_ABAS).forEach(chave => {
        if (!_cadImpAba(wb, chave)) plano.abasFaltando.push(CAD_IMP_ABAS[chave].rotulo);
    });

    _cadImpLerVeiculos(wb, plano);
    _cadImpLerSimples(wb, plano, "motoristas", "motoristas", "nome");
    _cadImpLerSimples(wb, plano, "bases",      "bases",      "nome");
    _cadImpLerConjuntos(wb, plano);
    return plano;
}

function _cadImpLerVeiculos(wb, plano) {
    const ws = _cadImpAba(wb, "veiculos");
    if (!ws) return;
    const linhas = _cadImpLinhas(ws);
    if (!linhas.length) return;
    const col = _cadImpColunas(linhas[0]);
    const iPlaca  = col["placa"];
    const iAntiga = col["placa antiga"];
    if (iPlaca === undefined) {
        plano.veiculos.push({ valor: "", situacao: "erro", motivo: 'A aba Veículos precisa de uma coluna "PLACA".' });
        return;
    }
    const vistas = new Set();
    linhas.slice(1).forEach((l, idx) => {
        const bruta = _cadImpCelula(l, iPlaca);
        if (!bruta) return;
        const placa  = normalizarPlaca(bruta);
        const antiga = _cadImpCelula(l, iAntiga);
        const item   = { valor: placa, antiga, linha: idx + 2 };

        if (vistas.has(placa)) {
            item.situacao = "erro";
            item.motivo = "repetida dentro da própria planilha";
        } else if (db.veiculos.some(v => normalizarPlaca(v.nome) === placa)) {
            item.situacao = "existe";
        } else if (!validarPlaca(placa)) {
            item.situacao = "erro";
            item.motivo = "não segue o padrão ABC1234 nem ABC1D23";
        } else {
            item.situacao = "novo";
        }
        vistas.add(placa);
        plano.veiculos.push(item);
    });
}

/** Motoristas e bases: uma coluna de nome, mesma regra. */
function _cadImpLerSimples(wb, plano, chaveAba, lista, coluna) {
    const ws = _cadImpAba(wb, chaveAba);
    if (!ws) return;
    const linhas = _cadImpLinhas(ws);
    if (!linhas.length) return;
    const col = _cadImpColunas(linhas[0]);
    const i = col[coluna];
    const iApelidos = col["apelidos"];
    if (i === undefined) {
        plano[chaveAba].push({ valor: "", situacao: "erro",
            motivo: `A aba ${CAD_IMP_ABAS[chaveAba].rotulo} precisa de uma coluna "${coluna.toUpperCase()}".` });
        return;
    }
    const vistos = new Set();
    linhas.slice(1).forEach((l, idx) => {
        const nome = _cadImpCelula(l, i);
        if (!nome) return;
        const chave = normalizarTexto(nome);
        const item = { valor: nome, apelidos: _cadImpCelula(l, iApelidos), linha: idx + 2 };
        if (vistos.has(chave)) {
            item.situacao = "erro";
            item.motivo = "repetido dentro da própria planilha";
        } else if (db[lista].some(x => normalizarTexto(x.nome) === chave)) {
            item.situacao = "existe";
        } else {
            item.situacao = "novo";
        }
        vistos.add(chave);
        plano[chaveAba].push(item);
    });
}

function _cadImpLerConjuntos(wb, plano) {
    const ws = _cadImpAba(wb, "conjuntos");
    if (!ws) return;
    const linhas = _cadImpLinhas(ws);
    if (!linhas.length) return;
    const col = _cadImpColunas(linhas[0]);
    const iNome = col["conjunto"];
    if (iNome === undefined) {
        plano.conjuntos.push({ valor: "", situacao: "erro", motivo: 'A aba Conjuntos precisa de uma coluna "CONJUNTO".' });
        return;
    }
    // "PLACA 1", "PLACA 2", … em qualquer quantidade: quem manda é o
    // cabeçalho, não um número fixo de colunas.
    const iPlacas = Object.keys(col)
        .filter(k => /^placa\s*\d+$/.test(k))
        .sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10))
        .map(k => col[k]);

    // As placas que vão existir depois da importação: as do banco mais as
    // que esta mesma planilha cria. Sem isso, um conjunto de placas novas
    // acusaria "placa não cadastrada" no mesmo arquivo que as cadastra.
    const disponiveis = new Set(db.veiculos.map(v => normalizarPlaca(v.nome)));
    plano.veiculos.filter(v => v.situacao === "novo").forEach(v => disponiveis.add(v.valor));

    const vistos = new Set();
    linhas.slice(1).forEach((l, idx) => {
        const nome = _cadImpCelula(l, iNome);
        if (!nome) return;
        const placas = iPlacas.map(i => _cadImpCelula(l, i)).filter(Boolean).map(normalizarPlaca);
        const item = { valor: nome, placas, linha: idx + 2 };
        const chave = normalizarTexto(nome);
        const faltando = placas.filter(p => !disponiveis.has(p));
        const repetida = placas.filter((p, i) => placas.indexOf(p) !== i);

        if (vistos.has(chave)) {
            item.situacao = "erro"; item.motivo = "conjunto repetido dentro da própria planilha";
        } else if (db.conjuntosVeiculos.some(c => normalizarTexto(c.nome || "") === chave)) {
            item.situacao = "existe";
        } else if (placas.length < 2) {
            item.situacao = "erro"; item.motivo = "um conjunto precisa de pelo menos duas placas";
        } else if (repetida.length) {
            item.situacao = "erro"; item.motivo = `a placa ${repetida[0]} aparece duas vezes na mesma linha`;
        } else if (faltando.length) {
            item.situacao = "erro";
            item.motivo = `${faltando.join(", ")} não está na aba Veículos nem no cadastro`;
        } else {
            item.situacao = "novo";
            // Aviso, não impedimento: a placa continua podendo entrar, mas
            // o dono precisa saber que ela já está em outro conjunto ativo.
            const emOutro = placas.filter(p => db.conjuntosVeiculos.some(c =>
                c.ativo !== false && (c.composicaoAtual || []).some(x => normalizarPlaca(x) === p)));
            if (emOutro.length) item.aviso = `${emOutro.join(", ")} já está em outro conjunto`;
        }
        vistos.add(chave);
        plano.conjuntos.push(item);
    });
}

/*─────────────────────────────────────────────
  PRÉVIA
─────────────────────────────────────────────*/
function _cadImpContar(itens, situacao) {
    return itens.filter(i => i.situacao === situacao).length;
}

function _cadImpRenderizarPrevia() {
    const alvo = document.getElementById("cadImportarResultado");
    if (!alvo || !_cadImpPlano) return;
    const p = _cadImpPlano;

    const grupos = [
        ["Veículos",   p.veiculos],
        ["Motoristas", p.motoristas],
        ["Conjuntos",  p.conjuntos],
        ["Bases",      p.bases]
    ];
    const totalNovos = grupos.reduce((s, [, itens]) => s + _cadImpContar(itens, "novo"), 0);
    const totalErros = grupos.reduce((s, [, itens]) => s + _cadImpContar(itens, "erro"), 0);

    /* A prévia detalhada (22/09/2026). Contar "128 novos" diz que a leitura
       funcionou, não QUE 128. Quem vai gravar 251 cadastros de uma vez na
       base de verdade precisa poder correr o olho pelo que vai entrar, e
       achar a placa errada antes, não depois. Fica fechado por padrão: a
       lista completa aberta empurraria o botão de confirmar para fora da
       tela. */
    const detalhe = (rotulo, itens) => {
        const novos = itens.filter(i => i.situacao === "novo");
        if (!novos.length) return "";
        const texto = novos.map(i => {
            if (i.placas) return `${escapeHtml(i.valor)} (${i.placas.map(escapeHtml).join(" · ")})`;
            const extra = [i.antiga && `antiga ${i.antiga}`, i.apelidos && `apelidos: ${i.apelidos}`]
                .filter(Boolean).join(", ");
            return escapeHtml(i.valor) + (extra ? ` <em>(${escapeHtml(extra)})</em>` : "");
        }).join(" &nbsp;·&nbsp; ");
        return `<details class="cad-imp-detalhe">
            <summary>Ver ${novos.length} ${escapeHtml(rotulo.toLowerCase())} que ${novos.length === 1 ? "vai" : "vão"} entrar</summary>
            <p class="cad-imp-itens">${texto}</p>
        </details>`;
    };

    const linhasTabela = grupos.map(([rotulo, itens]) => {
        const novos = _cadImpContar(itens, "novo");
        const existe = _cadImpContar(itens, "existe");
        const erros = _cadImpContar(itens, "erro");
        return `<tr>
            <td><strong>${rotulo}</strong></td>
            <td class="celula-num">${novos}</td>
            <td class="celula-num">${existe}</td>
            <td class="celula-num">${erros ? `<strong>${erros}</strong>` : "—"}</td>
        </tr>`;
    }).join("");

    const problemas = grupos.flatMap(([rotulo, itens]) =>
        itens.filter(i => i.situacao === "erro")
             .map(i => `<li><strong>${escapeHtml(rotulo)}</strong>${i.linha ? ` · linha ${i.linha}` : ""}: ` +
                       `${escapeHtml(i.valor || "")} ${escapeHtml(i.motivo || "")}</li>`));

    const avisos = p.conjuntos.filter(i => i.aviso)
        .map(i => `<li><strong>Conjunto ${escapeHtml(i.valor)}</strong>: ${escapeHtml(i.aviso)}</li>`);

    alvo.innerHTML = `
        ${p.abasFaltando.length ? `<div class="importacao-aviso">Não achei ${p.abasFaltando.length === 1 ? "a aba" : "as abas"}
            <strong>${p.abasFaltando.map(escapeHtml).join(", ")}</strong>. O que existe nas demais pode ser importado.</div>` : ""}
        <div class="tabela-container">
            <table class="tabela-numeros">
                <thead><tr><th>Cadastro</th><th>Novos</th><th>Já existem</th><th>Com problema</th></tr></thead>
                <tbody>${linhasTabela}</tbody>
            </table>
        </div>
        ${grupos.map(([rotulo, itens]) => detalhe(rotulo, itens)).join("")}
        ${problemas.length ? `<div class="importacao-aviso"><strong>Linhas que não vão entrar</strong>
            <ul class="lista-limpa">${problemas.join("")}</ul></div>` : ""}
        ${avisos.length ? `<div class="importacao-aviso aviso-novos"><strong>Para você conferir</strong>
            <ul class="lista-limpa">${avisos.join("")}</ul></div>` : ""}
        <p class="dica mt-3">
            ${totalNovos > 0
                ? `Vou criar <strong>${totalNovos}</strong> ${totalNovos === 1 ? "cadastro" : "cadastros"}.
                   O que já existe fica como está, e nada é sobrescrito.`
                : "Não há nada novo para criar: tudo o que a planilha traz já está cadastrado."}
            ${totalErros ? ` As <strong>${totalErros}</strong> ${totalErros === 1 ? "linha" : "linhas"} com problema ficam de fora.` : ""}
        </p>
        <div class="linha-acoes mt-3">
            <button class="btn-primario" onclick="cadImportarConfirmar()" ${totalNovos ? "" : "disabled"}>
                Importar ${totalNovos} ${totalNovos === 1 ? "cadastro" : "cadastros"}
            </button>
            <button class="btn-secundario" onclick="cadImportarCancelar()">Cancelar</button>
        </div>`;
    alvo.style.display = "block";
}

function cadImportarCancelar() {
    _cadImpPlano = null;
    const alvo = document.getElementById("cadImportarResultado");
    if (alvo) { alvo.innerHTML = ""; alvo.style.display = "none"; }
    const input = document.getElementById("cadImportarArquivo");
    if (input) input.value = "";
}

/*─────────────────────────────────────────────
  GRAVAÇÃO
─────────────────────────────────────────────*/
async function cadImportarConfirmar() {
    if (!_cadImpPlano) return;
    if (typeof exigirPapel === "function" && !exigirPapel("admin", "Importar cadastros")) return;
    const p = _cadImpPlano;
    const novos = n => n.filter(i => i.situacao === "novo");

    const qtdV = novos(p.veiculos).length, qtdM = novos(p.motoristas).length;
    const qtdC = novos(p.conjuntos).length, qtdB = novos(p.bases).length;
    const resumo = [qtdV && `${qtdV} ${qtdV === 1 ? "veículo" : "veículos"}`,
                    qtdM && `${qtdM} ${qtdM === 1 ? "motorista" : "motoristas"}`,
                    qtdC && `${qtdC} ${qtdC === 1 ? "conjunto" : "conjuntos"}`,
                    qtdB && `${qtdB} ${qtdB === 1 ? "base" : "bases"}`].filter(Boolean).join(", ");

    if (!await fmConfirm({
        titulo: "Confirmar a importação",
        msg: `Vou criar ${resumo}.\n\nNada do que já existe é alterado.`,
        confirmTxt: "Importar", tipo: "aviso"
    })) return;

    const log = fmLogNovo("Criado", "importado da planilha de cadastros");
    // Um conjunto novo vale desde 01/01/2026 e pode entrar num mês fechado.
    const fotoTrava = _travaFoto();

    novos(p.veiculos).forEach(v => {
        const registro = { id: gerarId(), nome: v.valor, ativo: true, logs: [log] };
        // A placa original só é guardada quando a importação converteu de
        // verdade. Guardá-la sempre encheria o cadastro de "antiga" igual à
        // placa, e a tela passaria a repetir o mesmo número duas vezes.
        if (v.antiga && normalizarPlaca(v.antiga) === v.valor
            && v.antiga.replace(/[-\s]/g, "").toUpperCase() !== v.valor) {
            registro.placaAntiga = v.antiga.toUpperCase();
        }
        db.veiculos.push(registro);
    });
    const simples = item => {
        const registro = { id: gerarId(), nome: item.valor, ativo: true, logs: [log] };
        if (item.apelidos) registro.apelidos = item.apelidos;
        return registro;
    };
    novos(p.motoristas).forEach(m => db.motoristas.push(simples(m)));
    novos(p.bases).forEach(b => db.bases.push(simples(b)));

    if (typeof garantirConjuntos === "function") garantirConjuntos();
    novos(p.conjuntos).forEach(c => db.conjuntosVeiculos.push({
        id: gerarId(), nome: c.valor,
        composicaoAtual: c.placas.slice(),
        // A vigência é a data que o dono escolheu para o começo do uso
        // real (01/01/2026): sem ela, um conjunto criado hoje não valeria
        // para nenhuma nota importada de um mês passado, e o Fretes por
        // conjunto voltaria vazio justamente na conferência do histórico.
        historico: [{ placas: c.placas.slice(), vigenciaDe: CAD_IMP_VIGENCIA, vigenciaAte: null }],
        ativo: true, logs: [log]
    }));

    if (_travaBarrar(fotoTrava, "Importar cadastros")) return;
    salvarDB();
    if (typeof atualizarListas === "function") atualizarListas();
    if (typeof renderizarConjuntos === "function") renderizarConjuntos();
    cadImportarCancelar();
    mostrarToast(`Importado: ${resumo}.`, "sucesso", 6000);
}
