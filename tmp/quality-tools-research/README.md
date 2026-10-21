# Ferramentas de qualidade de software: o que 88 projetos open source usam

Pesquisa de 21/10/2026. Pasta temporária: não faz parte do produto.

## Como foi feita

Clonamos 88 repositórios públicos e lemos os workflows de CI, os arquivos da raiz, todos os `package.json` e os arquivos de build e de configuração de ferramentas (Python, Go, Ruby, PHP, Java, Rust, Elixir, .NET): cerca de 15 mil arquivos. Cada ocorrência foi conferida na linha onde aparece, e os falsos positivos foram descartados. Num segundo passo, inventariamos tudo o que os projetos usam (475 actions, cerca de 8.400 pacotes npm e cerca de 1.000 arquivos de raiz) para achar ferramentas que não estavam na lista inicial.

- **Frameworks (24):** Rails, Django, Laravel, Symfony, Spring Boot, Quarkus, ASP.NET Core, Phoenix, FastAPI, Flask, Django REST Framework, Express, Fastify, Nuxt, SvelteKit, React Router, Ember, Solid, Gin, Echo, Fiber, Axum, Actix, Turbo.
- **Produtos e serviços (35):** PostHog, Supabase, Polar, OpenMeter, n8n, Sentry, Mattermost, Temporal, Traefik, Infisical, Langfuse, Unkey, Trigger.dev, Medusa, Directus, Strapi, Appwrite, NocoDB, Plausible, Umami, Hoppscotch, Immich, AFFiNE, Logto, Zitadel, Keycloak, Gitea, Backstage, Dub, Openstatus, Outline, Documenso, Formbricks, Twenty, Novu.
- **Ferramentas JS (18):** Vite, Vitest, React, Vue, Svelte, Angular, Astro, Next.js, Storybook, Playwright, Hono, Drizzle, Prisma, NestJS, typescript-eslint, oxc, Node, Sentry SDK.
- **Apps (11):** Electron, VS Code, Signal, Bitwarden, Mattermost Desktop, Element (todos Electron), Grafana, Mastodon, Cal.com, Excalidraw, tldraw.

### Limites

- Zero não quer dizer que ninguém usa. Ferramentas instaladas como GitHub App (Codacy, DeepSource, SonarCloud, Socket) podem não deixar arquivo no repositório, e gestão de casos de teste fica fora do repositório por natureza.
- Rails e ASP.NET Core não rodam o CI principal em `.github/workflows`, então deles se viu pouco.
- Preços e planos não foram verificados: a rede do ambiente da pesquisa bloqueava os sites dos fornecedores.
- Ferramentas que o Formbricks e o Strapi só ativam dentro da configuração do CodeRabbit não foram contadas como uso direto.

## Resultado: a lista inicial

Números: quantos dos 88 projetos usam a ferramenta.

### Dependências

| Ferramenta               | Projetos | Exemplos                                                                   |
| ------------------------ | -------- | -------------------------------------------------------------------------- |
| Dependabot               | 44       | Spring Boot, Laravel, FastAPI, Express, Supabase, Sentry, Polar, OpenMeter |
| Renovate                 | 22       | Nuxt, Ember, PostHog, Backstage, Gitea, Grafana, Vite, Vitest              |
| dependency-review-action | 3        | NocoDB, Novu, OpenMeter                                                    |

### Segurança

| Ferramenta                         | Projetos | Exemplos                                                         |
| ---------------------------------- | -------- | ---------------------------------------------------------------- |
| CodeQL                             | 29       | Spring Boot, Express, Nuxt, Gin, VS Code, Node, Keycloak, Sentry |
| Provenance / assinatura de release | 22       | Electron, PostHog, Gitea, Mattermost, Ember, Trigger.dev         |
| zizmor                             | 19       | Django, Symfony, FastAPI, Flask, Nuxt, Vite, n8n, Supabase       |
| Semgrep                            | 9        | PostHog, Appwrite, Grafana, Langfuse, Vite, Vitest, Astro        |
| OpenSSF Scorecard                  | 9        | Electron, Node, Express, Nuxt, Symfony, Backstage, OpenMeter     |
| harden-runner                      | 6        | Node, Backstage, Formbricks, Medusa, OpenMeter, Twenty           |
| Trivy                              | 6        | Gin, Keycloak, Appwrite, Infisical, n8n, Trigger.dev             |
| Snyk                               | 5        | Infisical, Backstage, Langfuse, Cal.com, Mattermost Desktop      |
| Syft (SBOM)                        | 4        | Directus, n8n, OpenMeter, Openstatus                             |
| SonarQube / SonarCloud             | 3        | Formbricks, Strapi, Element                                      |
| TruffleHog                         | 2        | Grafana, OpenMeter                                               |
| Aikido                             | 2        | n8n, Traefik                                                     |
| gitleaks                           | 1        | Umami                                                            |
| Socket                             | 1        | tldraw                                                           |
| OSV-Scanner                        | 1        | Appwrite                                                         |
| OWASP ZAP                          | 1        | Logto                                                            |
| OWASP Dependency-Check             | 1        | Quarkus                                                          |
| Por linguagem                      |          | Brakeman e bundler-audit (Rails); govulncheck e gosec (Go)       |

### Qualidade de código

| Ferramenta         | Projetos | Exemplos                                                                                                                                                                                    |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| knip               | 21       | Nuxt, PostHog, Polar, Sentry, n8n, Grafana, Signal                                                                                                                                          |
| actionlint         | 10       | PostHog, Grafana, Temporal, OpenMeter, Fiber, Vitest                                                                                                                                        |
| autofix-ci         | 5        | Nuxt, Vue, Hono, oxc, Openstatus                                                                                                                                                            |
| dependency-cruiser | 2        | Prisma, Langfuse                                                                                                                                                                            |
| Por linguagem      |          | RuboCop (Rails); PHPStan e Psalm (Laravel, Symfony); Checkstyle (Spring Boot, Quarkus); ruff e mypy (FastAPI, Flask, PostHog, Sentry); golangci-lint (Go); clippy (Rust); Credo (Plausible) |

### Cobertura e testes

| Ferramenta                           | Projetos | Exemplos                                                            |
| ------------------------------------ | -------- | ------------------------------------------------------------------- |
| Codecov                              | 17       | Nuxt, Django REST Framework, Gin, Fiber, Node, Mattermost, Temporal |
| Coveralls                            | 6        | Express, Solid, Supabase, Plausible                                 |
| k6 (carga)                           | 4        | Appwrite, Cal.com, n8n, Plausible                                   |
| fast-check (testes por propriedades) | 4        | Nuxt, Formbricks, Langfuse, n8n                                     |
| BrowserStack / Sauce Labs            | 3        | Ember, Rails, ASP.NET Core                                          |
| Trunk (testes instáveis)             | 2        | PostHog, Strapi                                                     |
| Datadog CI Visibility                | 2        | Electron, Next.js                                                   |
| Develocity (Gradle/Maven)            | 2        | Spring Boot, Quarkus                                                |
| Fuzzing                              | 2        | Node, Next.js                                                       |
| Stryker (mutação)                    | 1        | n8n                                                                 |
| Currents                             | 1        | n8n                                                                 |

### Visual e acessibilidade

| Ferramenta                | Projetos | Exemplos                                                  |
| ------------------------- | -------- | --------------------------------------------------------- |
| `@storybook/addon-a11y`   | 11       | PostHog, Grafana, Backstage, Signal, Mastodon, Twenty     |
| axe-core                  | 9        | Grafana, Keycloak, Mattermost, VS Code, Supabase, n8n     |
| Chromatic                 | 7        | Storybook, Backstage, Bitwarden, Mastodon, n8n, Infisical |
| Screenshots do Playwright | 7        | Django, PostHog, Mattermost, Twenty, Element, tldraw      |
| Lighthouse                | 2        | Backstage, Sentry SDK                                     |
| Argos                     | 1        | Twenty                                                    |
| Percy                     | 1        | Mattermost                                                |

### Performance e produção

| Ferramenta        | Projetos | Exemplos                                                     |
| ----------------- | -------- | ------------------------------------------------------------ |
| Sentry            | 23       | FastAPI, Polar, Mattermost, n8n, Supabase, Element, AFFiNE   |
| Tamanho de bundle | 8        | PostHog, Excalidraw, Prisma, Outline, Twenty                 |
| Benchmarks        | 6        | CodSpeed (FastAPI, Polar, oxc, Next.js, Astro); asv (Django) |

### Outros

| Ferramenta           | Projetos | Exemplos                                                    |
| -------------------- | -------- | ----------------------------------------------------------- |
| Claude Code Action   | 12       | Storybook, Temporal, Mattermost, Medusa, Twenty             |
| CodeRabbit           | 6        | PostHog, Supabase, Prisma, Strapi                           |
| Checagem de licenças | 11       | FOSSA (Backstage, OpenMeter); cargo-deny (Axum, Actix, oxc) |

### Nenhum dos 88

Codacy, DeepSource, Qlty/Code Climate, Dependency-Track, DefectDojo, GitGuardian, Checkmarx, Allure, Qase, TestRail, Testmo, Kiwi TCMS, Tuskr, Cypress Cloud, Lost Pixel, Applitools, GlitchTip, e testes de mutação fora do JavaScript (Infection, PIT, cargo-mutants, Stryker.NET, mutmut).

## Resultado: ferramentas fora da lista inicial

Achadas no inventário. Licença e preço delas não foram verificados. Quando a ferramenta era desconhecida, a descrição vem do que o workflow que a usa mostra.

### Testes

| Ferramenta                    | Projetos | Exemplos                                                        | O que faz                                               |
| ----------------------------- | -------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| msw                           | 20       | PostHog, Polar, Supabase, Grafana, Vitest, React Router, Twenty | Simula a API nos testes do front                        |
| @faker-js/faker               | 16       | Supabase, Keycloak, Immich, n8n, Vitest, Zitadel                | Gera dados falsos para testes                           |
| testcontainers                | 8        | Mattermost, n8n, Immich, Trigger.dev, Zitadel, Element          | Sobe banco ou serviço real em container durante o teste |
| nock                          | 7        | Sentry SDK, Mattermost, n8n, Infisical, Logto                   | Simula HTTP no Node                                     |
| expect-type                   | 7        | Vitest, Astro, Next.js, Storybook, Sentry                       | Testa tipos do TypeScript                               |
| autocannon                    | 6        | Fastify, Nest, React, Astro, Medusa, n8n                        | Teste de carga HTTP                                     |
| @storybook/test-runner        | 5        | PostHog, Grafana, Signal, Bitwarden, Next.js                    | Roda as stories como testes                             |
| eslint-plugin-no-only-tests   | 4        | PostHog, Nuxt, Mattermost                                       | Impede que um `.only` esquecido vá para o CI            |
| nick-fields/retry             | 4        | Electron, Laravel, Temporal, Infisical                          | Repete um passo do CI que falhou                        |
| storybook-addon-pseudo-states | 3        | PostHog, Storybook, Twenty                                      | Mostra hover e focus nas stories                        |

Relatório de teste e cobertura no próprio PR, sem serviço externo:

- vitest-coverage-report-action (Excalidraw): comenta a cobertura do Vitest no PR.
- diff-cover (Element): cobertura só das linhas alteradas.
- octocov (Hono): métricas no PR.
- dorny/test-reporter (Bitwarden), publish-unit-test-result (Mattermost Desktop), action-junit-report (Mattermost) e playwright-report-comment (Supabase): resultado dos testes no PR.

### Qualidade de código e documentação

| Ferramenta                 | Projetos | Exemplos                                                     | O que faz                                           |
| -------------------------- | -------- | ------------------------------------------------------------ | --------------------------------------------------- |
| eslint-plugin-jsx-a11y     | 14       | Grafana, Mattermost, Next.js, React Router, Sentry, Mastodon | Regras de acessibilidade no JSX                     |
| stylelint                  | 13       | PostHog, Sentry, Gitea, Signal, Mattermost, n8n              | Lint de CSS                                         |
| markdownlint               | 7        | Electron, Fastify, PostHog, Nuxt, Gitea, Novu                | Lint de Markdown                                    |
| typos / codespell / cspell | 8        | Backstage, oxc, Axum, Fiber, Langfuse, Plausible             | Erros de digitação no código e na documentação      |
| madge                      | 5        | Grafana, Backstage, n8n, Novu, Sentry SDK                    | Detecta imports circulares                          |
| syncpack / sherif          | 5        | PostHog, Strapi, Documenso, Nuxt, Sentry                     | Mantém versões de dependência alinhadas no monorepo |
| @microsoft/api-extractor   | 4        | Backstage, Element, tldraw, typescript-eslint                | Controla a API pública dos pacotes                  |
| Vale                       | 4        | Medusa e outros 3 com `.vale.ini`                            | Revisão de estilo da documentação                   |
| e18e                       | 3        | Vite, Sentry, Astro                                          | Aponta dependências pesadas ou substituíveis        |
| lychee                     | 2        | Nuxt, Fastify                                                | Encontra links quebrados                            |
| ast-grep                   | 1        | Next.js                                                      | Regras de lint escritas por padrão de código        |

### Processo de PR

| Ferramenta                   | Projetos | Exemplos                                               | O que faz                                         |
| ---------------------------- | -------- | ------------------------------------------------------ | ------------------------------------------------- |
| action-semantic-pull-request | 11       | PostHog, Electron, Vite, Nuxt, Langfuse, Novu, Cal.com | Exige título de PR em Conventional Commits        |
| commitlint                   | 6        | Nest, Strapi, AFFiNE, Logto, Documenso, Hoppscotch     | Valida mensagens de commit                        |
| AgentScan                    | 6        | Node, Vite, Vitest, Nuxt, Storybook, typescript-eslint | Analisa quem abriu o PR (documentação não lida)   |
| danger                       | 3        | Storybook, Signal, Twenty                              | Regras automáticas sobre o PR                     |
| codeowners-validator         | 2        | Node, Grafana                                          | Valida o arquivo `CODEOWNERS`                     |
| anti-slop                    | 1        | typescript-eslint                                      | Workflow "Slop Detection", que rotula e fecha PRs |
| vouch                        | 1        | Trigger.dev                                            | Workflow "Vouch - Check PR"                       |
| check-signed-commits         | 1        | Electron                                               | Exige commits assinados                           |

### Segurança

| Ferramenta         | Projetos | Exemplos                                                 | O que faz                                                |
| ------------------ | -------- | -------------------------------------------------------- | -------------------------------------------------------- |
| @electron/fuses    | 5        | Electron, Signal, Bitwarden, Mattermost Desktop, Element | Fuses do Electron                                        |
| poutine            | 1        | n8n                                                      | Varre os workflows de CI em busca de falhas de segurança |
| OWASP cve-lite-cli | 1        | Solid                                                    | Auditoria de dependências                                |

### APIs

| Ferramenta  | Projetos | Exemplos                                                 | O que faz                              |
| ----------- | -------- | -------------------------------------------------------- | -------------------------------------- |
| Redocly CLI | 6        | OpenMeter, Supabase, Mattermost, Medusa, n8n, Formbricks | Lint de OpenAPI                        |
| Spectral    | 2        |                                                          | Lint de OpenAPI (`.spectral.yaml`)     |
| oasdiff     | 1        | Immich                                                   | Detecta mudança que quebra a API no PR |

### Práticas, sem ferramenta

- `AGENTS.md` em 52 projetos, `CLAUDE.md` em 27.
- `.git-blame-ignore-revs` em 23: esconde commits de formatação em massa no `git blame`.
- `AI_POLICY.md` em 4, `REVIEW.md` em 2.

## Licenças verificadas

Lidas no repositório oficial de cada ferramenta:

- **Apache 2.0:** Scorecard, Trivy, OSV-Scanner, Stryker, OWASP ZAP, Dependency-Track, Lighthouse CI, Allure
- **MIT:** zizmor, gitleaks, size-limit, Argos, Lost Pixel
- **LGPL:** Semgrep, SonarQube (edição de código aberto)
- **AGPL 3:** Renovate
- **GPL 2:** Kiwi TCMS
- **BSD:** DefectDojo
- **Functional Source License 1.1:** Codecov e Sentry self-hosted. Não é open source, mas permite uso interno.

## Recomendação para o sextou

O sextou já tem Dependabot, CodeQL, zizmor, knip, gitleaks, grype, `@storybook/addon-vitest`, `@electron/fuses` e cobertura mínima de 90%. O que falta, em ordem de adoção entre os 88:

1. **Sentry** (23) no web e no desktop. Element, Mattermost e AFFiNE são apps Electron que usam.
2. **msw** (20): testa o web contra respostas no formato do `@sextou/contract` sem subir o servidor.
3. **Acessibilidade** nas stories (20 somando addon-a11y e axe-core) e no lint (14 com jsx-a11y). O oxlint 1.88.0 tem o plugin `jsx-a11y`, que não aparece no `.oxlintrc.json`.
4. **Título do PR em Conventional Commits** (11). O `main` só recebe squash, então o título do PR vira a mensagem do commit, e o hook `commit-msg` não chega nele.
5. **actionlint** (10): procura erros nos workflows, enquanto o zizmor procura problemas de segurança.
6. **OpenSSF Scorecard** (9).
7. **Semgrep** (9): não pede conta; o workflow do Vite serve de modelo.
8. **Tamanho de bundle** no `apps/web` (8): como o desktop carrega o web por URL, o bundle afeta os dois.
9. **Cobertura comentada no PR**, sem serviço externo, como faz o Excalidraw.
10. **madge** (5): o knip garante a direção das dependências entre pacotes, mas não procura ciclos dentro de um pacote.

Codecov (17) é opcional, porque o sextou já garante a cobertura sem ele. Teste de mutação e gestão de casos de teste quase não aparecem nos 88.

## Dados brutos (`data/`)

- `repos_all.txt`: os 88 repositórios.
- `fetch.sh`: clona cada repositório com sparse checkout, só com CI, manifestos e configs.
- `scan3.sh` e `patterns3.txt`: a busca por ferramenta. `result4.txt` é a contagem bruta, antes da conferência manual; `hits.txt` é a primeira linha encontrada em cada repositório, usada na conferência.
- `inv_actions.txt`, `inv_npm.txt`, `inv_rootfiles.txt`: o inventário de actions, pacotes npm e arquivos de raiz, com o número de repositórios em que cada item aparece.

As contagens deste documento são as conferidas à mão. Por isso diferem de `result4.txt`, que inclui falsos positivos (por exemplo, "pyright" casando com "copyright").
