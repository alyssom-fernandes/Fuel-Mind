/*  CENTRAL DE RELATÓRIOS
 *  =====================
 *  Decidida com o dono em 22/09/2026, depois de ele procurar o fechamento
 *  do mês em "Relatórios", não achar, e encontrá-lo em Fretes.
 *
 *  O diagnóstico é dele: a aba chamada "Relatórios" não era uma seção de
 *  relatórios, era o histórico de lançamentos. Os relatórios de verdade
 *  moravam espalhados: o fechamento em Fretes, os gráficos no Analítico,
 *  a conferência na tela dela. Quem precisa de um documento não sabe em
 *  qual tela ele mora; sabe o que quer entregar. Esta tela responde a essa
 *  pergunta, e menu nenhum responde.
 *
 *  O DESENHO, e o que ele corrigiu. A primeira versão fazia do cartão
 *  inteiro um botão que abria a tela de origem, com os formatos como
 *  etiquetas discretas no canto. O dono olhou e disse: "os relatórios só
 *  direcionam pra abas, talvez seja melhor remover essa aba".
 *
 *  Ele tinha razão. O alvo grande fazia a coisa fraca, mandar embora, e o
 *  alvo pequeno fazia a coisa forte, entregar o documento. Com os pesos
 *  assim a página era um segundo menu ao lado do menu lateral, e um
 *  segundo menu não se sustenta. Nas ferramentas de referência isso não
 *  acontece: no QuickBooks o relatório escolhido abre ali, com o período
 *  ajustável na própria página, e no Stripe os relatórios prontos são
 *  vistos no painel ou baixados em CSV. Nenhuma usa a página de
 *  relatórios para empurrar a pessoa para outro lugar.
 *
 *  Agora o botão de formato é a ação principal e o cartão não é clicável.
 *  "Ver em Fretes" ficou como link discreto, para quem quer conferir o
 *  número na tela antes de emitir.
 *
 *  A ARMADILHA QUE ESTA TELA EVITA: gerar um arquivo de um mês que a tela
 *  de origem não está mostrando deixaria dois estados do mesmo dado vivos
 *  ao mesmo tempo. Quem gerasse o fechamento de agosto daqui e depois
 *  abrisse Fretes veria setembro, sem entender por quê. Por isso
 *  `_centralPreparar` aplica o mês NO SELETOR da tela de origem e manda
 *  recalcular antes de disparar qualquer exportação: o arquivo e a tela
 *  falam sempre do mesmo mês.
 *
 *  As ações são NOMES de função, não funções: é o que permite ao teste
 *  `central.test.js` varrer os fontes e provar que todo botão desta tela
 *  chama algo que existe. Um botão que não leva a lugar nenhum foi
 *  exatamente o problema que originou a tela.
 */

/* O mês que a central usa para tudo. Começa no mês corrente, como a tela
   de Fretes, para as duas não discordarem na primeira abertura. */
let _centralMes = "";

/* A LISTA.

   `formatos` é a AÇÃO PRINCIPAL de cada item, e foi isto que mudou em
   22/09/2026, depois de o dono olhar a tela pronta. O porquê está no
   cabeçalho deste arquivo.

   Saiu junto o que não era documento: "Análise gráfica" e "Conferência
   de estoque" eram telas, não papéis, e eram os dois únicos itens cuja
   única ação possível era ir embora daqui. Continuam no menu lateral,
   que é o lugar de tela.

   `base` diz de qual data o documento fala, porque descarga e emissão
   dão números diferentes e isso precisa estar à vista ANTES do clique.
   `telaRotulo` é o nome legível da tela de origem, para o link
   secundário dizer para onde leva em vez de um "abrir" sem destino. */
const _CENTRAL_ITENS = [
    {
        id: "fechamento",
        nome: "Fechamento do mês",
        linha: "O documento completo do mês em uma peça só: os números em cartões, por empresa, por conjunto, por motorista, por placa e a lista nota a nota. Você escolhe quais empresas entram.",
        tela: "fretes",
        telaRotulo: "Fretes",
        base: "descarga",
        formatos: [
            { rotulo: "PDF",   classe: "btn-pdf",  fn: "abrirFechamentoPDF" },
            { rotulo: "Excel", classe: "btn-xlsx", fn: "exportarFechamentoDoMes" }
        ]
    },
    {
        id: "resumo-fretes",
        nome: "Resumo de fretes",
        linha: "Litros e frete do mês somados por placa, por motorista, por empresa e por conjunto, com a taxa que valia em cada data.",
        tela: "fretes",
        telaRotulo: "Fretes",
        base: "descarga",
        formatos: [
            { rotulo: "PDF",   classe: "btn-pdf",  fn: "exportarFretesPDF" },
            { rotulo: "Excel", classe: "btn-xlsx", fn: "exportarFretesExcel" },
            { rotulo: "CSV",   classe: "btn-csv",  fn: "exportarFretesCSV" }
        ]
    },
    {
        id: "nota-a-nota",
        nome: "Frete nota a nota",
        linha: "Nota, data, litros, taxa e frete de cada viagem do mês. É esta lista que responde a um transportador que questiona um valor.",
        tela: "fretes",
        telaRotulo: "Fretes",
        base: "descarga",
        formatos: [
            { rotulo: "Excel",       classe: "btn-xlsx",   fn: "exportarFreteNotaANota" },
            /* "Ver a lista" fica entre as ações principais, e não no link
               de abrir a tela, porque ela entrega a lista AQUI, num modal,
               sem tirar ninguém da página. */
            { rotulo: "Ver a lista", classe: "btn-export", fn: "abrirFreteNotaANota" }
        ]
    },
    {
        id: "mensal",
        nome: "Relatório mensal de compras",
        linha: "Um mês fechado em PDF: os números do período, a comparação com o mês anterior, o detalhamento por combustível e a lista das notas.",
        tela: "relatorios",
        telaRotulo: "Histórico",
        base: "emissao",
        formatos: [
            { rotulo: "PDF", classe: "btn-pdf", fn: "gerarRelatorioMensalPDF" }
        ]
    },
    {
        id: "historico",
        nome: "Histórico de lançamentos",
        linha: "Todas as notas do período, uma a uma, com o total por combustível e o preço médio de compra.",
        tela: "relatorios",
        telaRotulo: "Histórico",
        base: "emissao",
        formatos: [
            { rotulo: "Excel", classe: "btn-xlsx", fn: "exportarExcel",  arg: "relatorio" },
            { rotulo: "PDF",   classe: "btn-pdf",  fn: "exportarPDF",    arg: "relatorio" },
            { rotulo: "CSV",   classe: "btn-csv",  fn: "exportarCSV",    arg: "relatorio" }
        ]
    },
    {
        id: "grupo",
        nome: "Comparativo do grupo",
        linha: "Todas as empresas que o seu perfil enxerga lado a lado no período: litros, gasto, preço médio e frete de cada uma.",
        tela: "grupo",
        telaRotulo: "Grupo",
        base: "ambas",
        formatos: [
            { rotulo: "Excel", classe: "btn-xlsx", fn: "exportarGrupoExcel" }
        ]
    }
];

/* A lista que este perfil vê. Hoje nenhum item exige papel, e a função
   existe assim mesmo: ela é o único lugar onde um item futuro de admin
   entraria, e o teste já cobre a regra. Pura de propósito, sem DOM. */
function _centralItens(ctx) {
    const papel = (ctx && ctx.papel) || "";
    const permite = (minimo) => {
        if (!minimo) return true;
        if (minimo === "supremo") return papel === "supremo";
        if (minimo === "admin")   return papel === "supremo" || papel === "admin";
        return true;
    };
    return _CENTRAL_ITENS.filter(i => permite(i.papel));
}

/** O rótulo da base de data, que vai na etiqueta do cartão. */
function _centralRotuloBase(base) {
    if (base === "descarga") return "pela data da descarga";
    if (base === "emissao")  return "pela data de emissão";
    if (base === "ambas")    return "litros e frete pela descarga, gasto pela emissão";
    return "";
}

/*=================================================
  A TELA
=================================================*/
function carregarCentral() {
    const alvo = document.getElementById("centralLista");
    if (!alvo) return;

    const sel = document.getElementById("centralMes");
    if (sel) {
        if (!sel.value) {
            const hoje = new Date();
            sel.value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
        }
        _centralMes = sel.value;
    }

    const papel = typeof papelAtual === "function" ? papelAtual() : "";
    const itens = _centralItens({ papel });

    /* `escapeJsAttr` mesmo com valores fixos: é o idioma do projeto
       (`grupo.js`, `fretes.js`) e a defesa continua de pé no dia em que um
       item desta lista passar a vir de configuração.

       O CARTÃO NÃO É MAIS CLICÁVEL, e isso é a mudança de 22/09/2026. Ele
       deixou de ser um botão gigante que mandava embora e voltou a ser o
       que é: a descrição de um documento. Quem age são os botões de
       formato, que entregam o arquivo sem tirar ninguém da página, e o
       link do rodapé, para quem quer conferir o número na tela antes de
       emitir.

       O efeito colateral bom: some o conflito de teclado que existia aqui.
       Com o cartão como `role="button"`, o Enter num botão de formato
       borbulhava até ele, que dava `preventDefault()` e matava o clique
       sintético do navegador. Sem cartão clicável não há o que borbulhar,
       e cada botão volta a ser um botão comum. */
    alvo.innerHTML = itens.map(item => {
        const id = escapeJsAttr(item.id);
        const formatos = (item.formatos || []).map(f =>
            `<button class="btn-export ${escapeHtml(f.classe)} central-formato" type="button"
                     onclick="centralExecutar('${id}', '${escapeJsAttr(f.rotulo)}')"
                     title="${escapeHtml(item.nome)} em ${escapeHtml(f.rotulo)}">${escapeHtml(f.rotulo)}</button>`
        ).join("");
        const base = _centralRotuloBase(item.base);
        const destino = item.telaRotulo ? escapeHtml(item.telaRotulo) : "";
        return `<div class="central-card">
            <div class="central-card-topo">
                <h3 class="central-card-nome">${escapeHtml(item.nome)}</h3>
                ${base ? `<span class="central-card-base">${escapeHtml(base)}</span>` : ""}
            </div>
            <p class="central-card-linha">${escapeHtml(item.linha)}</p>
            <div class="central-card-rodape">
                <div class="central-card-formatos">${formatos}</div>
                ${destino ? `<button type="button" class="central-card-abrir"
                     onclick="centralExecutar('${id}')"
                     title="Abre ${destino} no mês escolhido aqui, sem gerar arquivo">Ver em ${destino}
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>
                </button>` : ""}
            </div>
        </div>`;
    }).join("");
}

/** Os dois atalhos de mês do topo, os mesmos rótulos das outras telas. */
function centralMesRapido(qual) {
    const sel = document.getElementById("centralMes");
    if (!sel) return;
    const hoje = new Date();
    const d = qual === "mes_anterior"
        ? new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
        : hoje;
    sel.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    carregarCentral();
}

/** O seletor mudou: guarda o mês e redesenha (os cartões citam o mês). */
function centralTrocarMes() {
    carregarCentral();
}

/*=================================================
  ABRIR E GERAR
=================================================*/
/* Deixa a tela de origem no mês da central ANTES de qualquer exportação.
   Sem isto, o arquivo sairia de um mês e a tela mostraria outro. Devolve
   `false` quando o preparo não pôde ser feito, e nesse caso nada é
   disparado: um botão que gera silenciosamente o mês errado é pior que um
   botão que não gera. */
function _centralPreparar(item, mes) {
    if (item.semMes || !mes) return true;

    if (item.tela === "fretes") {
        const sel = document.getElementById("fretesSelectMes");
        if (!sel) return false;
        sel.value = mes;
        if (typeof calcularEExibirFretes !== "function") return false;
        calcularEExibirFretes();
        return true;
    }

    const periodo = typeof _mesParaPeriodo === "function"
        ? _mesParaPeriodo(mes)
        : { inicio: `${mes}-01`, fim: "" };

    if (item.tela === "relatorios") {
        // O período do histórico é pela emissão, e é nele que o mês entra.
        // Os campos de descarga ficam vazios de propósito: somar os dois
        // recortes aqui esconderia as notas da fronteira sem avisar.
        const ini = document.getElementById("filtroDataInicio");
        const fim = document.getElementById("filtroDataFim");
        if (!ini || !fim) return false;
        /* TODO O RESTO VOLTA AO VAZIO, e isto não é zelo: é o defeito que a
           central criaria se não o fizesse. O histórico guarda os filtros
           entre visitas de propósito, então quem filtrou por um motorista,
           saiu da tela e veio aqui pedir "todas as notas do período"
           receberia um arquivo só com as notas daquele motorista, com o
           nome do mês inteiro no cabeçalho. É a mesma regra que
           `irParaRelatorioFiltrado` já segue, com a mesma razão: filtro
           pela metade engana mais do que filtro nenhum. */
        ["filtroDescargaInicio", "filtroDescargaFim", "filtroMotorista", "filtroPlaca",
         "filtroCombustivel", "filtroNota", "filtroBase", "filtroBusca"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        const inativos = document.getElementById("filtroMostrarInativos");
        if (inativos) inativos.checked = false;
        if (typeof relatorioAlvoPeriodo === "function") relatorioAlvoPeriodo("emissao");
        ini.value = periodo.inicio;
        fim.value = periodo.fim;
        if (typeof carregarRelatorio !== "function") return false;
        carregarRelatorio();
        return true;
    }

    if (item.tela === "grupo") {
        const ini = document.getElementById("grupoInicio");
        const fim = document.getElementById("grupoFim");
        if (!ini || !fim) return false;
        ini.value = periodo.inicio;
        fim.value = periodo.fim;
        if (typeof carregarGrupo !== "function") return false;
        carregarGrupo();
        return true;
    }

    if (item.tela === "analitico") {
        const ini = document.getElementById("analiticoInicio");
        const fim = document.getElementById("analiticoFim");
        if (!ini || !fim) return false;
        ini.value = periodo.inicio;
        fim.value = periodo.fim;
        if (typeof carregarAnalitico !== "function") return false;
        carregarAnalitico();
        return true;
    }

    return true;
}

/**
 * A porta única da central. Sem `formato`, abre a tela de origem com o mês
 * aplicado. Com `formato`, prepara a tela de origem e dispara a geração
 * sem trocar de tela.
 *
 * @param {string} id       - id do item em `_CENTRAL_ITENS`
 * @param {string} [formato] - rótulo do formato, como no cartão
 */
async function centralExecutar(id, formato) {
    const item = _CENTRAL_ITENS.find(i => i.id === id);
    if (!item) return;

    /* O MÊS É LIDO AQUI, na primeira linha, antes de qualquer `await`, e é
       ele que atravessa a função inteira.

       Esta função espera pela biblioteca de planilha e pela troca de tela,
       e durante essa espera o seletor da central continua clicável. Lendo
       o DOM lá adiante, um clique pedindo agosto seguido de uma troca para
       setembro geraria o "fechamento de agosto" com os números de
       setembro, sem aviso nenhum. O mês que vale é o do instante do
       clique, e capturá-lo agora é o que torna isso verdade. */
    const mes = document.getElementById("centralMes")?.value || _centralMes;

    /* Um `try` em volta de tudo porque esta função é chamada de `onclick`,
       sem `await` e sem `.catch`: qualquer exceção viraria uma promessa
       rejeitada que ninguém lê. O clique não produziria arquivo nem aviso,
       e quem clicou não teria como saber que quebrou. As telas de origem
       passaram a ser recalculadas num momento novo, com a tela escondida,
       que é justamente onde uma surpresa apareceria. */
    try {
        if (!formato) {
            // Abrir a tela: `mostrarTela` já chama a carga dela, e o preparo
            // roda depois para o mês da central vencer o padrão da tela.
            await mostrarTela(item.tela);
            if (document.getElementById(item.tela)?.style.display !== "block") return;
            if (!_centralPreparar(item, mes)) {
                mostrarToast(`Abri a tela, mas não consegui aplicar o mês escolhido. Confira o período por lá.`, "aviso", 6000);
            }
            return;
        }

        const f = (item.formatos || []).find(x => x.rotulo === formato);
        if (!f) return;

        const fn = window[f.fn];
        if (typeof fn !== "function") {
            mostrarToast(`"${item.nome}" em ${formato} não está disponível nesta versão.`, "erro", 6000);
            return;
        }

        /* As bibliotecas ANTES do preparo, e é o que fecha uma corrida.

           Os exportadores se adiam sozinhos quando o jsPDF ou o xlsx ainda
           não chegou, e reexecutam lendo o estado GLOBAL no momento em que
           a biblioteca carrega. Da central isso abria uma janela: pedir o
           fechamento de agosto, e antes de a biblioteca chegar pedir o
           resumo de setembro; o segundo pedido reescreve o mês da tela de
           Fretes, e o fechamento "de agosto" sai fechando setembro, sem
           aviso nenhum. Esperando aqui, nenhum exportador precisa se
           adiar, e cada clique gera o mês que ele pediu. */
        if (typeof garantirBibliotecas === "function") {
            try { await garantirBibliotecas(["xlsx", "jspdf", "autotable"]); } catch (_) {}
        }
        if (!_centralPreparar(item, mes)) {
            mostrarToast("Não consegui preparar este relatório. Abra a tela dele e tente por lá.", "erro", 6000);
            return;
        }

        // O mensal tem seletor de mês próprio dentro do modal: o mês da
        // central entra nele depois de aberto, senão o dono escolheria
        // agosto aqui e veria setembro marcado lá.
        if (f.fn === "gerarRelatorioMensalPDF") {
            fn();
            const sel = document.getElementById("_selMesRelMensal");
            if (sel && mes && [...sel.options].some(o => o.value === mes)) sel.value = mes;
            return;
        }

        fn(f.arg);
    } catch (e) {
        console.error("centralExecutar", id, formato, e);
        mostrarToast(`Não consegui gerar "${item.nome}". Abra a tela dele e tente por lá.`, "erro", 7000);
    }
}
