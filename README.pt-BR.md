# Fuel Mind

O Fuel Mind é um sistema web para controlar a compra de combustível e o
frete de um grupo de empresas que compram das distribuidoras e pagam as
transportadoras por litro. Cada nota fiscal (NF-e) é lançada uma vez,
digitada ou importada do XML, e o resto sai dela: o custo de compra, os
alertas de preço, o frete devido por placa, motorista, empresa e
conjunto, e os documentos de fechamento do mês.

Foi feito para uma operação de combustível no Brasil que fazia esse
controle em planilhas. É JavaScript puro sobre o Firebase, sem framework
e sem etapa de build.

**Demonstração: [controle-entradas-posto.web.app](https://controle-entradas-posto.web.app)** (sem cadastro)

Clique em **Acessar modo demo** e escolha um dos três perfis. Cada um
enxerga um conjunto diferente de empresas e de telas, que é o jeito mais
rápido de ver as regras de acesso funcionando. A demonstração tem oito
meses de dados fictícios, fica toda no seu navegador e volta ao estado
original todo dia.

![Testes](https://img.shields.io/badge/testes-102_passando-success?style=flat-square)
![JavaScript](https://img.shields.io/badge/JavaScript-sem_framework-f7df1e?style=flat-square&logo=javascript&logoColor=black)
![Sem build](https://img.shields.io/badge/etapa_de_build-nenhuma-success?style=flat-square)
![Firebase](https://img.shields.io/badge/Firebase-Firestore_%2B_Auth-ff6f00?style=flat-square&logo=firebase&logoColor=white)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue?style=flat-square)

Este README também está em [inglês](README.md).

## Telas

Capturadas da demonstração, com os dados fictícios dela.

| Dashboard, tema escuro | Histórico com uma nota aberta, tema claro |
|---|---|
| ![Dashboard](assets/screenshots/dashboard-escuro.png) | ![Histórico](assets/screenshots/relatorios-claro.png) |
| **Analítico** | **Fretes** |
| ![Analítico](assets/screenshots/analitico-escuro.png) | ![Fretes](assets/screenshots/fretes-claro.png) |

| Fechamento do mês, gerado em PDF | No celular |
|---|---|
| <img src="assets/screenshots/fechamento-pdf.png" alt="Fechamento em PDF" width="560"> | <img src="assets/screenshots/celular-dashboard.png" alt="Dashboard no celular" width="260"> |

## O que ele faz

### Lançamento de notas

- Importar o XML da NF-e preenche o formulário: datas, número,
  combustíveis, quantidades e preços. A base de distribuição é
  encontrada pelo nome e pela cidade do fornecedor na nota; quando nada
  casa, o sistema pergunta uma vez e guarda a resposta.
- Vários combustíveis por nota, com a quantidade carregada e a
  descarregada. A perda no transporte é conferida contra uma tolerância
  definida para cada combustível.
- Conferências antes de salvar: descarga antes da data da nota, data no
  futuro, número de nota já lançado e preço unitário muito longe da
  mediana dos dias anteriores daquele combustível.
- Um formulário deixado pela metade fica guardado como rascunho. As
  notas podem ser clonadas, editadas, canceladas ou excluídas, e toda
  alteração entra no histórico da nota. Nota excluída fica guardada e
  marcada, não é apagada.

### Histórico e relatórios

- Histórico de lançamentos com filtro pela data de emissão e pela data
  de descarga ao mesmo tempo, que é como aparecem as notas que caem na
  virada do mês.
- Uma central de relatórios com tudo o que o sistema emite. Cada item
  gera o arquivo ali mesmo, para o mês escolhido na página.
- PDFs e planilhas no mesmo padrão visual: fechamento do mês, resumo de
  fretes, frete nota a nota, relatório mensal de compras, lista de
  lançamentos e comparativo entre as empresas. CSV onde faz sentido, e um
  resumo curto para mandar por WhatsApp ou e-mail.

### Fretes

- Taxa de frete por empresa (R$ por litro) e a parte do motorista (% do
  frete), as duas com vigência: uma taxa nova vale da data dela em
  diante, e os meses anteriores continuam com os mesmos números.
- Frete por placa, motorista, empresa e conjunto, contado pela data da
  descarga. O conjunto é montado com as placas que ele tinha na data de
  cada viagem.
- Fechamento do mês: um administrador fecha o mês de uma empresa, e até
  alguém reabrir nenhuma nota descarregada naquele mês pode ser lançada,
  alterada ou retirada, nem as taxas daqueles dias. Quem pode fechar e
  reabrir é garantido pela regra do banco; a trava das notas, pelo
  sistema.

### Dashboard e analítico

- Totais do período com a variação contra o período anterior, alertas
  de preço, volume e data fora do normal, as últimas entradas de cada
  combustível e os últimos seis meses.
- Abas do analítico: mensal, por motorista, por veículo, por
  combustível, distribuição e preço por litro. Clicar numa barra abre o
  histórico já filtrado.
- Uma tela de grupo que põe lado a lado as empresas que o perfil
  enxerga.

### Conferência

- O relatório de tanque exportado do AutoSystem (o sistema de gestão do
  posto) é comparado, dia a dia, com as notas lançadas.

### Controle de acesso

- Três perfis: Supremo (tudo), Admin (as empresas atribuídas a ele e os
  usuários delas) e Operador (lança e confere notas). O frete por pessoa
  e as quantidades por motorista, placa e conjunto aparecem só para
  Admin e Supremo.
- As notas de cada empresa ficam num documento próprio do Firestore, e
  as regras de segurança só deixam o usuário ler os documentos das
  empresas do perfil dele.
- Entrada com e-mail ou @usuario, por um índice público pequeno que liga
  cada nome de usuário ao e-mail.

### No dia a dia

- Queda curta de conexão não perde trabalho: as alterações ficam no
  navegador e sobem quando a conexão volta, e o que outros usuários
  mudam chega em tempo real.
- Backup automático diário no navegador (ficam os 7 últimos) e download
  do backup completo. Restaurar é só do Supremo.
- Importação de planilhas de lançamentos antigos (três formatos,
  reconhecidos pelo cabeçalho, com uma etapa para ligar as colunas) e do
  cadastro da frota. Nada é gravado antes de uma prévia.
- Busca e comandos com Ctrl+K, atalhos de teclado, temas claro e escuro,
  e telas que funcionam no celular.

## Como é feito

| Parte | Tecnologia |
|---|---|
| Interface | HTML, CSS e JavaScript, sem framework e sem etapa de build |
| Dados e login | Firebase Firestore (tempo real) e Firebase Authentication |
| Gráficos | Chart.js 4 |
| PDF | jsPDF e jsPDF-AutoTable |
| Excel | xlsx-js-style (SheetJS com estilo nas células) |
| Hospedagem | Firebase Hosting |

As bibliotecas de PDF e Excel são carregadas de uma CDN só quando um
documento é gerado.

Algumas decisões por trás dele:

- **A regra do banco é a barreira de segurança.** Quais empresas cada
  usuário lê, quem administra usuários e quem fecha o mês são decididos
  no `firestore.rules`; as telas só deixam de oferecer o que a regra
  recusaria. A exceção é esconder os detalhes de frete do perfil
  Operador, que é feito na interface.
- **Número digitado do jeito brasileiro** (1.234,56) passa por uma camada
  própria em vez de `<input type="number">`, que nos navegadores em
  português pode mudar o valor sem avisar.
- **As contas que decidem dinheiro são testadas**: o cálculo de frete, as
  vigências das taxas, a referência de preço, a trava do mês fechado, o
  reconhecimento da base pela NF-e, a formatação dos números e o padrão
  dos PDFs e das planilhas. `node --test tests/*.test.js` roda os 102
  testes sem nenhuma dependência.

## Como rodar a sua cópia

1. Clone o repositório:
   ```bash
   git clone https://github.com/alyssom-fernandes/Fuel-Mind.git
   ```
2. Crie um projeto no Firebase com Firestore e autenticação por
   e-mail e senha.
3. Coloque a configuração web do seu projeto em `src/core/firebase.js` e
   o id dele em `.firebaserc`.
4. Publique as regras deste repositório:
   ```bash
   firebase deploy --only firestore:rules
   ```
5. Crie o primeiro usuário no Authentication e depois, no Firestore, o
   documento `usuarios/{uid}` com `nome`, `email`, `role: "supremo"`,
   `ativo: true`, `empresas: []` e `empresaIds: []`.
6. Sirva a pasta com `firebase deploy --only hosting`, ou localmente com
   qualquer servidor estático, como `npx serve .`. O sistema usa módulos
   ES, então abrir o `index.html` direto do disco não funciona.

O modo demonstração não precisa de nada disso: sirva a pasta e clique em
**Acessar modo demo**.

A configuração web do Firebase em `src/core/firebase.js` é pública por
natureza; o que protege os dados é o `firestore.rules`.

## Estrutura

```
index.html              o sistema inteiro: todas as telas e janelas
404.html
firebase.json           configuração da hospedagem
firestore.rules         regras de segurança do banco
assets/
  style.css             temas claro e escuro, variáveis CSS
  logo-dark.svg, logo-light.svg
  screenshots/
src/
  core/                 dados, sessão e infraestrutura
    firebase.js         Firebase, chamadas ao banco e ao login
    sessao.js           login, perfis, empresa ativa, permissões
    dados.js            estado em memória
    sincronizacao.js    gravação, fila offline, tempo real
    navegacao.js        troca de telas, avisos
    tema.js             tema claro e escuro
    backup.js           backup e restauração
    erros.js            registro local de falhas
  shared/               usado por todas as telas
    utils.js            formatação, cálculo de frete, regras comuns
    pdf-padrao.js       o padrão dos PDFs
    planilha-padrao.js  o padrão das planilhas
    mes-fechado.js      trava do mês fechado
    base-nfe.js         reconhecer a base de uma NF-e
    validacao.js        conferências do formulário da nota
    numerico.js         campos de número em português
    combobox.js         campo com sugestões
    rascunho.js         rascunho do formulário
    ui.js               barra lateral, busca, atalhos
  screens/              uma tela por arquivo
    dashboard.js, lancamentos.js (formulário da nota),
    relatorios.js (histórico), central.js (central de relatórios),
    analitico.js, fretes.js, fechamento.js, grupo.js, cadastros.js,
    cadastros-importar.js, importacao.js,
    sistema.js (backup, configurações, conferência), usuarios.js, demo.js
tests/                  node --test, sem dependências
```

## Licença

[MIT](LICENSE). Feito por Alyssom Fernandes.
