# Zabbix Dashboard Migrator Web (v0.1)

Interface web estática para exportar e importar **dashboards globais** do Zabbix usando a API JSON-RPC. Desenvolvida a partir dos fluxos do `zabbix_global_dashboard_migrator_v7.py`.

## O que já faz

- Seletor de versões esperadas **7.0, 7.2, 7.4** para origem e destino.
- Teste de conexão (versão real + `dashboard.get`).
- Listagem de dashboards globais acessíveis, filtro e seleção múltipla.
- Exportação de dashboard individual no formato compatível com o script Python v7 (`export_version=5`).
- Exportação múltipla em um **bundle JSON**, importável no próprio site.
- Coleta de metadados de referências 2..13 com tratamento de falhas/sem permissões.
- Importação de arquivos JSON produzidos pelo script Python v7 ou pelo site.
- Remapeamento conservador por nome ou `key_` dentro do escopo de host/template, aceitando somente uma correspondência inequívoca.
- Modo **somente layout** (remove referências numéricas que são específicas do ambiente).
- Compatibilidade de **tipo de widget** 7.0/7.4 baseada na documentação Zabbix.
- DRY-RUN local, relatório de pendências, payload para download, proteção contra dashboard de mesmo nome e confirmação manual `CREATE_GLOBAL_DASHBOARD`.
- Criação exclusivamente via `dashboard.create`; sem `dashboard.update` ou `dashboard.delete`.
- Tokens só em memória, não são enviados ao GitHub e não usam localStorage/cookies.

## Limitações importantes

Este é um **protótipo funcional para homologação**, não uma garantia de migração perfeita entre versões:

1. GitHub Pages **não executa Python**. Toda a lógica funciona no navegador, que precisa acessar **diretamente** a URL `/api_jsonrpc.php` do Zabbix. A API deve estar acessível por HTTPS e a configuração de **CORS** do frontend Zabbix deve permitir a origem do site e o header Authorization.
2. Zabbix **7.0.0 a 7.0.6** não possuem o suporte ao cabeçalho `Authorization` em requisições cross-origin que foi introduzido em **7.0.7**. Para ambientes antigos, proxies com CORS restrito ou servidores acessíveis somente por rede interna, é necessário **backend/conector local**, ainda não incluído neste protótipo.
3. **Versão 7.2**: a aplicação permite selecionar e operar, mas **não dispõe de catálogo homologado de widgets**. É necessário marcar a aceitação explícita de validação manual antes de importar.
4. O diagnóstico de compatibilidade verifica tipos de widgets e referências; **não verifica todos os campos específicos de cada widget**. O Zabbix não valida todos esses campos no `dashboard.create` e pode criar widgets com problemas de funcionamento visual.
5. Widgets inexistentes no destino não são convertidos automaticamente; a importação fica **bloqueada** ou o usuário escolhe **removê-los** explicitamente.
6. IDs não resolvidos são bloqueados por padrão. É possível remover os respectivos campos com uma opção consciente, mas isso pode deixar widgets sem parâmetros obrigatórios.
7. **Não migra dashboards de template** (`templatedashboard.get/create`), permissões de compartilhamento, gráficos personalizados, hosts/itens ou templates em si. O dashboard depende de os objetos já existirem no destino.
8. Remapeamento por nome/key e escopo pode ser inconclusivo; a aplicação **não escolhe arbitrariamente** entre vários candidatos.
9. O DRY-RUN **não testa a aceitação do payload** pelo Zabbix. A API não oferece método de dry-run de `dashboard.create`.
10. Exportações podem conter detalhes da infraestrutura e precisam de armazenamento e compartilhamento controlados.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub, por exemplo `zabbix-dashboard-migrator-web`.
2. Envie **os arquivos da pasta raiz** (`index.html`, `styles.css`, `app.js`, `core.mjs`, `.nojekyll`, `README.md`).
3. No repositório, abra **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Selecione `main`, pasta `/(root)` e clique em **Save**.
6. O site ficará acessível em uma URL semelhante a `https://SEU_USUARIO.github.io/zabbix-dashboard-migrator-web/`.

Não envie tokens de API, arquivos JSON de produção ou capturas de tela contendo segredos ao repositório.

## Execução local pelo VS Code

Para verificar a interface localmente:

```powershell
py -m http.server 8080
```

Acesse no navegador: `http://localhost:8080`

Observação: o servidor Python **só serve arquivos estáticos**. Não contorna restrições CORS na API do Zabbix. A conexão continua sendo feita diretamente do navegador para o endpoint remoto.

## Como usar

### Exportar
1. Na aba **Conexões**, configure URL e token da origem (token de leitura).
2. Teste a conexão e confira a versão detectada.
3. Na aba **Exportar**, clique em **Atualizar listagem**.
4. Selecione um ou mais dashboards e clique em **Exportar JSON**.
5. Guarde o arquivo baixado em local seguro.

### Importar
1. Configure e teste o destino (token com permissão de criação).
2. Na aba **Importar**, selecione o JSON exportado.
3. Escolha dashboard, nome e modo de importação.
4. Execute **DRY-RUN** e examine o relatório e o payload.
5. Ajuste opções de modo consciente até não haver bloqueios.
6. Digite exatamente `CREATE_GLOBAL_DASHBOARD` e confirme a criação.
7. No Zabbix destino, abra o dashboard e verifique **cada widget**.

## Métodos de API

- Conectividade: `apiinfo.version`, `dashboard.get`.
- Exportação: `dashboard.get` com `selectPages:"extend"`; consulta de metadados por `hostgroup.get`, `host.get`, `template.get`, `item.get`, `itemprototype.get`, `graph.get`, `graphprototype.get`, `map.get`, `service.get`, `sla.get`, `user.get`, `action.get`, `mediatype.get`, conforme o dashboard.
- Criação: somente `dashboard.create`.

O token só precisa ter acesso aos métodos usados e aos objetos consultados. Não amplie permissões desnecessariamente.

## Estrutura

```text
zabbix-dashboard-migrator-web/
├── index.html      Interface
├── styles.css      Estilos
├── app.js          API, export/import, interações, logs
├── core.mjs        Normalização e validação (sem HTTP)
├── .nojekyll       Desabilita build Jekyll
├── README.md       Este guia
└── tests/
    └── core.test.mjs
```

## Executar testes de lógica

Se o Node.js estiver instalado:

```powershell
node --test .\tests\core.test.mjs
```

**Documentação de referência:**
- https://www.zabbix.com/documentation/7.0/en/manual/api/reference/dashboard
- https://www.zabbix.com/documentation/7.4/en/manual/api/reference/dashboard
- https://www.zabbix.com/documentation/7.0/en/manual/api
- https://docs.github.com/en/pages

## Próximas melhorias para produção

- Conector local/backend com autenticação, allowlist e TLS para ambientes bloqueados por CORS.
- Mapeamento assistido por UI para referências ambíguas, hosts e templates renomeados.
- Validadores específicos dos **campos de cada widget** por versão.
- `templatedashboard.get/create`, modo lote com rastreamento/retomada, logs auditáveis.
- Testes de integração em laboratórios reais 7.0/7.2/7.4 e relatório pós-importação.

Não é produto oficial Zabbix.
