/*=================================================
  MODAL DE EDIÇÃO
=================================================*/
let modalContexto = null;

function abrirModal(titulo, label, valorAtual, lista, id, perdaAtual = null) {
    modalContexto = { lista, id };
    document.getElementById("modalTitulo").textContent = titulo;
    document.getElementById("modalLabel").textContent = label;
    document.getElementById("modalInput").value = valorAtual;

    const wrapperPerda = document.getElementById("modalCampoPerdaWrapper");
    if (lista === "combustiveis") {
        wrapperPerda.style.display = "flex";
        document.getElementById("modalInputPerda").value = perdaAtual ?? 0;
    } else {
        wrapperPerda.style.display = "none";
    }

    document.getElementById("modalOverlay").style.display = "flex";
    document.getElementById("modalInput").focus();
}

function fecharModal() {
    document.getElementById("modalOverlay").style.display = "none";
    modalContexto = null;
}

function confirmarEdicao() {
    if (!modalContexto) return;
    const { lista, id } = modalContexto;
    const novoValor = document.getElementById("modalInput").value.trim();
    if (!novoValor) return alert("O campo não pode ficar vazio.");
    const item = db[lista].find(i => i.id === id);
    if (!item) return;
    const duplicado = db[lista].some(i => i.id !== id && i.nome.toLowerCase() === novoValor.toLowerCase());
    if (duplicado) return alert("Já existe um cadastro com esse nome.");
    item.nome = lista === "veiculos" ? novoValor.toUpperCase() : novoValor;
    if (lista === "combustiveis") {
        const perdaInput = parseFloat(document.getElementById("modalInputPerda").value);
        item.perda = isNaN(perdaInput) ? 0 : perdaInput;
    }
    salvarDB();
    fecharModal();
    atualizarListas();
}

document.addEventListener("keydown", e => { if (e.key === "Escape") fecharModal(); });

/*=================================================
  MOTORISTAS
=================================================*/
function salvarMotorista() {
    const input = document.getElementById("nomeMotorista");
    const nome = input.value.trim();
    if (!nome) return alert("Digite o nome do motorista.");
    if (db.motoristas.some(m => m.nome.toLowerCase() === nome.toLowerCase())) return alert("Esse motorista já está cadastrado.");
    db.motoristas.push({ id: Date.now(), nome, ativo: true });
    input.value = "";
    salvarDB(); atualizarListas();
}

/*=================================================
  VEÍCULOS
=================================================*/
function salvarVeiculo() {
    const input = document.getElementById("placaVeiculo");
    const placa = input.value.trim().toUpperCase();
    if (!placa) return alert("Digite a placa do veículo.");
    if (db.veiculos.some(v => v.nome === placa)) return alert("Essa placa já está cadastrada.");
    db.veiculos.push({ id: Date.now(), nome: placa, ativo: true });
    input.value = "";
    salvarDB(); atualizarListas();
}

/*=================================================
  EMPRESAS  — agora objeto { id, nome, ativo }
=================================================*/
function migrarEmpresas() {
    if (db.empresas.length > 0 && typeof db.empresas[0] === "string") {
        db.empresas = db.empresas.map(nome => ({ id: Date.now() + Math.random(), nome, ativo: true }));
        salvarDB();
    }
}
migrarEmpresas();

function salvarEmpresa() {
    const input = document.getElementById("nomeEmpresa");
    const nome = input.value.trim();
    if (!nome) return alert("Digite o nome da empresa.");
    if (db.empresas.some(e => e.nome.toLowerCase() === nome.toLowerCase())) return alert("Essa empresa já está cadastrada.");
    db.empresas.push({ id: Date.now(), nome, ativo: true });
    input.value = "";
    salvarDB(); atualizarListas();
}

/*=================================================
  COMBUSTÍVEIS
=================================================*/
function salvarCombustivel() {
    const inputNome  = document.getElementById("nomeCombustivel");
    const inputPerda = document.getElementById("perdaCombustivel");
    const nome  = inputNome.value.trim();
    const perda = parseFloat(inputPerda.value) || 0;
    if (!nome) return alert("Digite o tipo de combustível.");
    if (db.combustiveis.some(c => c.nome.toLowerCase() === nome.toLowerCase())) return alert("Esse combustível já está cadastrado.");
    db.combustiveis.push({ id: Date.now(), nome, perda, ativo: true });
    inputNome.value = ""; inputPerda.value = "";
    salvarDB(); atualizarListas();
}

/*=================================================
  INATIVAR / REATIVAR
=================================================*/
function toggleAtivo(lista, id) {
    const item = db[lista].find(i => i.id === id);
    if (!item) return;
    const acao = item.ativo !== false ? "inativar" : "reativar";
    if (!confirm(`Deseja ${acao} "${item.nome}"?`)) return;
    item.ativo = item.ativo !== false ? false : true;
    salvarDB(); atualizarListas();
}

/*=================================================
  VERIFICAÇÃO DE VÍNCULOS
=================================================*/
function temVinculoEmLancamentos(lista, item) {
    if (lista === "motoristas")   return db.lancamentos.some(l => l.motorista === item.nome);
    if (lista === "veiculos")     return db.lancamentos.some(l => l.placa === item.nome);
    if (lista === "empresas")     return db.lancamentos.some(l => l.empresa === item.nome);
    if (lista === "combustiveis") return db.lancamentos.some(l => l.itens.some(i => i.tipo === item.nome));
    return false;
}

/*=================================================
  EXCLUIR COM VERIFICAÇÃO DE VÍNCULOS
=================================================*/
function excluirCadastro(lista, id) {
    const item = db[lista].find(i => i.id === id);
    if (!item) return;
    if (temVinculoEmLancamentos(lista, item)) {
        alert(`Não é possível excluir "${item.nome}" pois existem lançamentos vinculados.\n\nUse o botão "Inativar" para que ele deixe de aparecer em novos lançamentos.`);
        return;
    }
    if (!confirm(`Excluir "${item.nome}" permanentemente?`)) return;
    db[lista] = db[lista].filter(i => i.id !== id);
    salvarDB(); atualizarListas();
}

/*=================================================
  ATUALIZA LISTAS E SELECTS
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
                    <span>${m.nome}${m.ativo !== false ? "" : ' <em class="tag-inativo">inativo</em>'}</span>
                    <div class="acoes-lista">
                        <button class="btn-editar"   onclick="abrirModal('Editar Motorista','Nome','${m.nome.replace(/'/g,"\\'")}','motoristas',${m.id})">Editar</button>
                        <button class="btn-inativar" onclick="toggleAtivo('motoristas',${m.id})">${m.ativo !== false ? "Inativar" : "Reativar"}</button>
                        <button class="btn-excluir"  onclick="excluirCadastro('motoristas',${m.id})">Excluir</button>
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
                    <span>${v.nome}${v.ativo !== false ? "" : ' <em class="tag-inativo">inativo</em>'}</span>
                    <div class="acoes-lista">
                        <button class="btn-editar"   onclick="abrirModal('Editar Veículo','Placa','${v.nome.replace(/'/g,"\\'")}','veiculos',${v.id})">Editar</button>
                        <button class="btn-inativar" onclick="toggleAtivo('veiculos',${v.id})">${v.ativo !== false ? "Inativar" : "Reativar"}</button>
                        <button class="btn-excluir"  onclick="excluirCadastro('veiculos',${v.id})">Excluir</button>
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
                    <span>${e.nome}${e.ativo !== false ? "" : ' <em class="tag-inativo">inativo</em>'}</span>
                    <div class="acoes-lista">
                        <button class="btn-editar"   onclick="abrirModal('Editar Empresa','Nome','${e.nome.replace(/'/g,"\\'")}','empresas',${e.id})">Editar</button>
                        <button class="btn-inativar" onclick="toggleAtivo('empresas',${e.id})">${e.ativo !== false ? "Inativar" : "Reativar"}</button>
                        <button class="btn-excluir"  onclick="excluirCadastro('empresas',${e.id})">Excluir</button>
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
                        ${c.nome}
                        ${c.perda > 0 ? `<em class="tag-perda">Perda: ${c.perda}%</em>` : ""}
                        ${c.ativo !== false ? "" : '<em class="tag-inativo">inativo</em>'}
                    </span>
                    <div class="acoes-lista">
                        <button class="btn-editar"   onclick="abrirModal('Editar Combustível','Nome','${c.nome.replace(/'/g,"\\'")}','combustiveis',${c.id},${c.perda})">Editar</button>
                        <button class="btn-inativar" onclick="toggleAtivo('combustiveis',${c.id})">${c.ativo !== false ? "Inativar" : "Reativar"}</button>
                        <button class="btn-excluir"  onclick="excluirCadastro('combustiveis',${c.id})">Excluir</button>
                    </div>
                </li>`).join("");
    }

    // SELECTS DE FORMULÁRIOS (apenas ativos)
    const empresasAtivas     = db.empresas.filter(e => e.ativo !== false);
    const motoristasAtivos   = db.motoristas.filter(m => m.ativo !== false);
    const veiculosAtivos     = db.veiculos.filter(v => v.ativo !== false);

    preencherSelect("empresaSelect",   empresasAtivas.map(e => ({ valor: e.nome, texto: e.nome })), "Selecione a empresa");
    preencherSelect("motoristaSelect", motoristasAtivos.map(m => ({ valor: m.nome, texto: m.nome })), "Selecione o motorista");
    preencherSelect("placaSelect",     veiculosAtivos.map(v => ({ valor: v.nome, texto: v.nome })), "Selecione a placa");

    // Filtros de relatório (todos, com rótulo se inativo)
    preencherSelect("filtroEmpresa",     db.empresas.map(e => ({ valor: e.nome, texto: e.nome + (e.ativo !== false ? "" : " (inativo)") })), "Todas");
    preencherSelect("filtroMotorista",   db.motoristas.map(m => ({ valor: m.nome, texto: m.nome + (m.ativo !== false ? "" : " (inativo)") })), "Todos");
    preencherSelect("filtroPlaca",       db.veiculos.map(v => ({ valor: v.nome, texto: v.nome + (v.ativo !== false ? "" : " (inativo)") })), "Todas");
    preencherSelect("filtroCombustivel", db.combustiveis.map(c => ({ valor: c.nome, texto: c.nome + (c.ativo !== false ? "" : " (inativo)") })), "Todos");
}