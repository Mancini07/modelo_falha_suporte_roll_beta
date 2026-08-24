# Falha de lubrificação — painel de ativos cravados

Painel operacional que compara a temperatura de dois pontos do **mesmo ativo** e
acusa **falha de lubrificação** quando o desvio entre eles rompe o limite.

Cada ativo aparece como um *digital twin*: dois mancais, o rolo entre eles e um
sensor sobre cada mancal. O mancal que aquece acende; em falha, ele e seu sensor
pulsam em vermelho.

## Regras

| Parâmetro | Valor | Onde muda |
|---|---|---|
| Limite de desvio **padrão** | **3 °C** | **cravado** — só em `config.defaults.thresholdC` |
| Limite **por ativo** | opcional | no diálogo **+ Pin asset**, campo *Tolerable deviation* |
| Tolerância de horário | **10 min** | campo no cabeçalho / `config.defaults.toleranceMin` |
| Correção de temperatura | **−6,8 °C** | `TEMPERATURE_OFFSET_C` no `.env` |

Cada ativo tem sua assimetria normal entre mancais — um redutor grande tolera
mais desvio que um rolo leve. Por isso o limite é **por ativo**: definido ao
cravar (ou depois, reabrindo o ativo no mesmo diálogo) e guardado junto do par em
`pairs.json`. Quem não tem limite próprio usa o padrão.

O padrão **não é editável pela interface nem por query string**: as rotas ignoram
qualquer `?threshold=`, e ele vem sempre de `config.defaults.thresholdC`. Mudá-lo
exige acesso ao servidor.

1. Toda leitura de temperatura entra no sistema já com **6,8 °C subtraídos**.
2. Duas leituras só são comparadas se forem **praticamente simultâneas**: cada
   leitura do ponto A é casada com a mais próxima do ponto B, e se a defasagem
   passar de 10 min o ponto é **descartado**, não comparado.
3. Desvio com módulo **acima do limite do ativo** = falha de lubrificação.
4. **Inversão de lado** é um alerta próprio: dispara quando o lado quente troca
   em relação ao normal do ativo *e* o giro passa do limite dele.
5. Um rompimento **mantém o ativo em risco por 24 h**, mesmo que a leitura atual
   volte para dentro do limite (`RISK_HOLD_HOURS` em `board.ts`).

Sobre a tolerância: sensores do mesmo ativo transmitem em slots diferentes do
gateway, e a defasagem observada vai de ~6 a ~8 min conforme o slot. Por isso
10 min — com 8 min, pares com defasagem de 8min10s ficavam de fora e o ativo
aparecia como "sem leitura" sem estar com problema de sensor.

Como a correção de −6,8 °C é a mesma nos dois pontos, ela **se cancela na
subtração**: o desvio e o diagnóstico não mudam. O que muda são as temperaturas
absolutas mostradas.

## Telas

A interface é toda em inglês e roda em **tema escuro** azul-ardósia (fundo
`#161A25`), fixado por
`data-theme="dark"` no `<html>` de `web/index.html`. Os tokens do tema claro
continuam definidos em `styles.css`: para voltar ao claro basta remover esse
atributo, e para seguir a preferência do sistema, trocá-lo por nada.

**Board** — a grade de digital twins dos ativos cravados. Atualiza sozinho a
cada 60 s. É a tela inicial. Sob cada temperatura fica o horário exato em que
aquela leitura chegou, o que expõe de imediato um sensor fora de sincronia.

**Analytics** — a visão analítica de um par: estado atual (desvio, as duas
temperaturas e o pico do período), as duas séries no mesmo eixo, o desvio contra
a faixa tolerada e a tabela par a par.

A navegação é pelo card: o botão **↗** no twin abre aquele ativo na Analytics, e
**← Back to board** volta. Não há abas.

## Retenção do risco (24 h)

A temperatura oscila em torno do limite, então um ativo poderia entrar e sair de
alarme a cada leitura. Basta **um** rompimento na janela de 24 h para o ativo
continuar em risco.

Quando o desvio atual já voltou para dentro do limite, o card continua vermelho e
mostra a linha *"Within the limit now · broke it 14× in the last 24 h, last at …"*
— o estado é honesto sobre a diferença entre "rompendo agora" e "rompeu há
pouco". Nesse caso os mancais não são pintados de vermelho: nenhum lado está
rompendo neste instante.

## Inversão de lado

O alarme de módulo não enxerga um caso real: um mancal que sempre foi o mais
frio começar a ser o mais quente. Se o giro passa perto de zero, o `|desvio|`
fica pequeno e nada dispara — mesmo tendo havido uma mudança grande na máquina.

Por isso cada ativo pode guardar o seu **normal** (`baselineC`): o desvio típico
**com sinal**, isto é, qual lado costuma ser o mais quente e por quanto. Ele não
desloca o alarme de módulo — serve só de referência para a inversão:

```
inverteu = sinal(desvio) ≠ sinal(normal)  E  |desvio − normal| > limite
```

A segunda condição evita falso positivo em ativo cujo normal fica perto de zero,
onde o sinal troca a cada oscilação.

O normal é aprendido de uma **janela escolhida por você**, no diálogo do ativo
(*Normal side* → *Learn normal from this period*). É de propósito que não seja
automático dos últimos dias: se a falha já começou, aprender do período recente
ensinaria a falha como se fosse o normal, e o alarme nunca dispararia.

## Ativos cravados

Os pares ficam gravados em `server/data/pairs.json` e sobrevivem ao restart. Em
**+ Cravar ativo** você filtra por unidade, busca por nome de ativo ou de ponto,
e o par mais provável já vem sugerido — pontos de lados opostos do mesmo
conjunto (`LA` × `LOA`, `Drive Side` × `Op Side`). O `✕` no card remove.

## Como rodar

```bash
# terminal 1 — API
cd server && npm install && npm run dev      # http://localhost:4000

# terminal 2 — painel
cd web && npm install && npm run dev         # http://localhost:5173
```

O painel se atualiza sozinho a cada 60 s.

## Fontes de dados

| Dado | Origem |
|---|---|
| Séries de temperatura | DynamoDB `retina-global-charts`, `pk = "{positionId}-1"`, `sk` = epoch ms, atributo `T` |
| Unidade, ativo, ponto | Postgres — `tbPosition` → `tbAsset` → `tbFacility` → `tbCompany` |

Só pontos com `sysSensorTypeId = 1` (vibração e temperatura) e ativos com pelo
menos dois pontos aparecem no seletor — um ponto sozinho não tem par.

## API

| Rota | O que faz |
|---|---|
| `GET /api/board?threshold=3&toleranceMin=8` | estado atual de todos os pares cravados |
| `GET /api/tree?companyId=5` | unidade → ativo → pontos, para o seletor |
| `GET /api/pairs` · `POST /api/pairs` · `DELETE /api/pairs/:id` | gerencia os pares cravados |
| `PATCH /api/pairs/:id` | ajusta o limite de um ativo (`{"thresholdC": 5}`; `null` volta ao padrão) |
| `POST /api/pairs/:id/baseline` | aprende o normal de uma janela (`{"from","to"}`), grava na mão (`{"baselineC"}`) ou limpa (`{}`) |
| `GET /api/companies` | empresas com pontos de temperatura ativos |
| `GET /api/analysis?a=&b=&days=` | série completa de um par (usada para investigação; o painel não consome) |

O `/api/board` lê só as últimas 12 h — sem gráficos, basta a comparação válida
mais recente, o que mantém a consulta barata com dezenas de pares.

## Estrutura

```
server/src
  pairing.ts     casamento por proximidade temporal + limite  (núcleo da regra)
  board.ts       avalia todos os pares cravados
  pairsStore.ts  persistência dos pares em data/pairs.json
  dynamo.ts      leitura das séries — aplica a correção de temperatura
  postgres.ts    árvore unidade/ativo/ponto e metadados
web/src
  components/AssetTwin.tsx   o digital twin de um ativo
  components/PairPicker.tsx  seleção de ativo e pontos
  suggest.ts                 sugestão do par por nome dos pontos
```

## Acessibilidade

O alarme nunca depende só de cor nem só do movimento: vem sempre com ícone e
rótulo. Em `prefers-reduced-motion` o piscar vira contorno vermelho fixo. O lado
quente só é tingido quando o desvio se aproxima do limite — uma diferença de
décimos de grau não pinta mancal nenhum.

A cor de ação (`--accent`, `#00595F`) é só da interface — botões, foco e seleção.
As duas cores de série, azul e laranja, identificam os pontos nos gráficos e no
twin, e nunca são usadas como cor de controle.

As cores de status (vermelho, verde, âmbar) são fixas e não mudam com o tema,
justamente para que "em falha" tenha sempre a mesma aparência. Só as superfícies,
os textos e as duas cores de série trocam de passo no escuro.
