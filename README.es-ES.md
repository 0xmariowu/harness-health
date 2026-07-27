<div align="center">

<h1>AgentLint</h1>

<p><strong>El linter para el arnés de tu agente.</strong></p>
<p><em>ESLint fue para el código que escriben los humanos.<br/>AgentLint es para el contexto que leen los agentes.</em></p>

[![CI](https://github.com/0xmariowu/AgentLint/actions/workflows/ci.yml/badge.svg)](https://github.com/0xmariowu/AgentLint/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/0xmariowu/AgentLint)](https://github.com/0xmariowu/AgentLint/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Checks](https://img.shields.io/badge/checks-58-00b48c)](#what-it-checks)
[![npm](https://img.shields.io/npm/v/agentlint-ai)](https://www.npmjs.com/package/agentlint-ai)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-cc785c)](https://claude.com/download)

<p><a href="https://www.agentlint.app"><strong>🌐 Sitio</strong></a> · <a href="https://www.agentlint.app/blog">Blog</a> · <a href="#install">Instalar</a> · <a href="#what-you-get">Demo</a> · <a href="#the-harness-problem">Harness 101</a> · <a href="#what-it-checks">Verificaciones</a> · <a href="#evidence">Evidencia</a> · <a href="#faq">FAQ</a> · <a href="README_CN.md">中文</a></p>

</div>

---

> **Agente = Modelo + Arnés (Harness).** El modelo ya no es el cuello de botella; lo es el arnés.
>
> Tus archivos `AGENTS.md`, `CLAUDE.md`, la configuración de CI, los hooks y el `.gitignore` *son* el arnés. Cuando están mal, Claude Code, Cursor y Codex generan basura de IA. Cuando están bien, los agentes potencian el trabajo.
>
> AgentLint califica tu arnés a través de **51 verificaciones deterministas en 6 dimensiones principales**, más **7 verificaciones extendidas opcionales** (Deep + Session) que utilizan sub-agentes de IA y logs de sesión locales de Claude Code cuando están disponibles. Basado en evidencia. Cero opiniones.

> 📚 **La documentación completa, más de 20 guías extensas y el catálogo completo de verificaciones están en [agentlint.app](https://www.agentlint.app/).** Destacados: [Cómo escribir un buen CLAUDE.md](https://www.agentlint.app/blog/writing-a-good-claude-md) · [El catálogo de 33 verificaciones](https://www.agentlint.app/blog/the-33-checks-every-claude-md-should-pass) · [AGENTS.md vs CLAUDE.md](https://www.agentlint.app/blog/agents-md-vs-claude-md) · [中文博客](https://www.agentlint.app/zh/blog).

## Instalar

```bash
npm install -g agentlint-ai           # Solo CLI — aún sin plugin de Claude
npx agentlint-ai install              # opcional: registrar plugin /al para Claude Code
```

> El primer comando instala la CLI de `agentlint` en el `$PATH` y **no** toca `~/.claude/`. El segundo comando (única vez, opcional) detecta Claude Code, copia el comando de barra `/al` en `~/.claude/commands/` y registra el plugin del marketplace. Detalles de efectos secundarios y ruta de desinstalación en [INSTALL.md](./INSTALL.md#side-effects).

Luego, en cualquier repositorio de git:

```bash
agentlint check
```

En Claude Code (después de ejecutar `npx agentlint-ai install`): ejecuta `/al` para el flujo interactivo de escaneo-corrección-reporte.

> **¿Estás usando un agente de codificación con IA?** Dirígelo a [INSTALL.md](./INSTALL.md); está escrito para ser leído una vez y ejecutado.

## Qué obtienes

```
$ /al

AgentLint — Score: 72/100 (core)

Findability      ██████████████░░░░░░  7/10
Instructions     ████████████████░░░░  8/10
Workability      ████████████░░░░░░░░  6/10
Safety           ██████████░░░░░░░░░░  5/10
Continuity       ██████████████░░░░░░  7/10
Harness          ████████████████████  10/10
Deep             ░░░░░░░░░░░░░░░░░░░░  n/a   (opcional)
Session          ░░░░░░░░░░░░░░░░░░░░  n/a   (opcional)

Plan de Corrección (7 ítems):
  [guided]   Fijar 8 GitHub Actions a un SHA (riesgo de cadena de suministro)
  [guided]   Añadir .env a .gitignore (la IA expone secretos)
  [assisted] Generar HANDOFF.md
  [guided]   Reducir palabras clave IMPORTANT (7 encontradas, Anthropic usa 4)

Seleccionar ítems → AgentLint corrige → recalcula score → guarda reporte HTML
```

## El problema del arnés (harness)

En febrero de 2026, Mitchell Hashimoto (HashiCorp) acuñó el término. Ryan Lopopolo de OpenAI lo formalizó días después. Vivek Trivedy de LangChain dio la definición más clara:

> **Agente = Modelo + Arnés.** Si no eres el modelo, eres el arnés.

El **arnés** es cada pieza de código, configuración e instrucción que envuelve a un LLM y lo convierte en un agente. Para agentes de codificación, tu arnés incluye:

- `AGENTS.md` / `CLAUDE.md` — las reglas persistentes inyectadas al inicio de la sesión.
- `.cursor/rules/`, `.github/copilot-instructions.md` — capas de instrucciones específicas de la herramienta.
- CI, hooks de pre-commit, `.gitignore` — las restricciones deterministas que el agente no puede anular.
- `SECURITY.md`, changelogs, notas de traspaso (handoff) — el contexto que sobrevive entre sesiones.

La **ingeniería de arneses** es la disciplina de diseñar estas piezas para que el agente se mantenga confiable a través de cientos de llamadas a herramientas, no solo en las primeras diez.

La investigación es contundente:

- El **Informe de Tendencias de Codificación Agéntica 2026** de Anthropic encontró que los equipos que mantienen un buen archivo de contexto reportan un **40% menos de sesiones con "sugerencias erróneas"**.
- El **Estado del Desarrollo de Software Asistido por IA DORA 2025** llegó a la misma conclusión: la IA es un amplificador; acelera a los equipos con buenos arneses y amplifica la disfunción en los equipos que no los tienen.
- Un **estudio de la ETH Zurich** encontró que los archivos de contexto *generados automáticamente* en realidad **reducen** las tasas de éxito del agente en 5 de 8 entornos probados, e incrementan el costo de inferencia entre un **20% y 23%**.
- Un ensayo controlado aleatorizado encontró que los desarrolladores que usaban IA eran un **19% más lentos** en tareas complejas, mientras creían que eran un 20% más rápidos.
- El informe de LangChain de febrero de 2026: **el 70% del rendimiento del agente reside fuera del modelo**. Mismos pesos, diferente arnés, diferentes resultados.

Traducción: un mal arnés es peor que ningún arnés. Y casi nadie sabe cómo es uno bueno.

**AgentLint es el primer linter para el arnés en sí.**

## Qué hace diferente a AgentLint

Cada verificación está respaldada por datos, no por opiniones. Los datos provienen de lugares que la mayoría de los desarrolladores nunca miran, y es lo que nos permite medir la salud del arnés rigurosamente:

- **265 versiones** del propio system prompt de Claude Code de Anthropic: rastreamos cada palabra que añadieron, eliminaron y reescribieron. Cuando redujeron el uso de `IMPORTANT` de 12 a 4, lo supimos. Cuando eliminaron cada sección de identidad de "Eres un asistente útil...", lo supimos.
- **Código fuente de Claude Code**, que es donde residen los límites estrictos del arnés. Los archivos de entrada de 40,000 caracteres se truncan silenciosamente. Los archivos de 256 KB no se pueden leer en absoluto. Los hooks de pre-commit que tardan demasiado provocan que los commits se queden colgados porque Claude Code nunca usa `--no-verify`.
- **Auditorías reales de producción** en bases de código de código abierto: los brechas de seguridad en las que los agentes entran directamente.
- **6 artículos académicos** sobre cumplimiento de instrucciones, efectividad de archivos de contexto y degradación de la documentación.

Si una verificación no puede citar una fuente, no se incluye.

## Qué verifica

**58 verificaciones en total: 51 verificaciones deterministas del núcleo en 6 dimensiones (se ejecutan siempre), más 7 verificaciones extendidas opcionales** (Deep: 3 análisis potenciados por IA; Session: 4 verificaciones de lectura de logs de Claude Code). El comando `agentlint check` por defecto y la GitHub Action solo ejecutan las 51 del núcleo; las extendidas requieren sub-agentes de IA o logs de sesión locales de Claude Code, por lo que son opcionales a través de `/al` dentro de Claude Code.

La puntuación total es un promedio solo de las dimensiones que realmente se ejecutaron. Una ejecución de CI predeterminada muestra `Score: NN/100 (core)` y marca Deep/Session como `n/a`, nunca como `0/10`. Cuando se ejecutan las verificaciones extendidas, el encabezado muestra `(core+extended)`.

### 🔍 Findability (Encontrabilidad) — ¿Puede la IA encontrar lo que necesita? *(20%)*

| Verificación | Qué | Por qué |
| --- | --- | --- |
| F1 | Existe archivo de entrada | Sin CLAUDE.md / AGENTS.md = la IA comienza a ciegas |
| F2 | Descripción del proyecto en las primeras 10 líneas | La IA necesita contexto antes que las reglas |
| F3 | Guía de carga condicional | "Si trabajas en X, lee Y" evita la saturación del contexto |
| F4 | Directorios grandes tienen INDEX | >10 archivos sin índice = la IA lee todo |
| F5 | Todas las referencias resuelven | Los enlaces rotos desperdician tokens en lecturas sin salida |
| F6 | Nombres de archivo estándar | README.md, CLAUDE.md se descubren automáticamente |
| F7 | Directivas `@include` resuelven | Los objetivos faltantes se ignoran silenciosamente; crees que se cargó, pero no |
| F8 | El frontmatter de reglas usa globs | Los archivos MDC de `.cursor/rules/` deben coincidir con patrones glob, no rutas exactas |
| F9 | Sin marcadores de plantilla vacíos | `{{variables}}` dejadas en archivos de contexto desperdician tokens y confunden al modelo |

### 📝 Instructions (Instrucciones) — ¿Están bien escritas tus reglas? *(25% — peso más alto)*

| Verificación | Qué | Por qué |
| --- | --- | --- |
| I1 | Recuento de palabras de énfasis | Anthropic redujo `IMPORTANT` de 12 a 4 a través de 265 versiones |
| I2 | Densidad de palabras clave | Más énfasis = menos cumplimiento. Anthropic: 7.5 → 1.4 por cada 1K palabras |
| I3 | Especificidad de la regla | "No hagas X. En su lugar Y. Porque Z." — la fórmula dorada de Anthropic |
| I4 | Encabezados orientados a la acción | Anthropic eliminó todas las secciones de identidad "Eres un..." |
| I5 | Sin lenguaje de identidad | "Sigue las convenciones" fue eliminado — el modelo ya hace esto |
| I6 | Longitud del archivo de entrada | Entre 60 y 120 líneas es el punto ideal. Más largo diluye la prioridad |
| I7 | Menos de 40,000 caracteres | Límite estricto de Claude Code. Por encima de esto, tu archivo se trunca silenciosamente |
| I8 | Contenido inyectado total dentro del presupuesto | Todos los archivos auto-inyectados se mantienen dentro del presupuesto de contexto de 200K |

### 🔨 Workability (Operabilidad) — ¿Puede la IA construir y probar? *(18%)*

| Verificación | Qué | Por qué |
| --- | --- | --- |
| W1 | Comandos de build/test documentados | La IA no puede adivinar tu ejecutor de pruebas |
| W2 | Existe CI | Reglas sin ejecución son solo sugerencias |
| W3 | Existen tests (no es un cascarón vacío) | Una CI que ejecuta `pytest` con 0 archivos de prueba siempre "pasa" |
| W4 | Linter configurado | El formateo mecánico libera a la IA de adivinar el estilo |
| W5 | Sin archivos de más de 256 KB | Claude Code no puede leerlos — error crítico |
| W6 | Hooks de pre-commit son rápidos | Claude Code nunca usa `--no-verify`. Hooks lentos = commits bloqueados |
| W7 | Comando de test rápido local documentado | El archivo de entrada documenta un comando de test rápido (<30s) para verificación intra-sesión |
| W8 | Existe script de npm test | Los repos de JS/Node necesitan `npm test` para que la IA pruebe sin adivinar |
| W9 | Workflow de release valida consistencia de versión | Detección automatizada de deriva entre package.json, CHANGELOG y badges |
| W10 | Niveles de costo de tests definidos (pytest markers) | `@pytest.mark.fast` permite que la IA ejecute el subconjunto barato, no la suite completa de 10 minutos |
| W11 | Commits de feat/fix emparejados con commits de test | Puerta que detecta funcionalidades que llegan sin pruebas correspondientes |

### 🔄 Continuity (Continuidad) — ¿Puede la siguiente sesión retomar el trabajo? *(12%)*

| Verificación | Qué | Por qué |
| --- | --- | --- |
| C1 | Frescura de la documentación | Instrucciones obsoletas son peores que ninguna instrucción |
| C2 | Existe archivo de traspaso (handoff) | Sin él, cada sesión comienza desde cero |
| C3 | El changelog tiene el "por qué" | "Updated INDEX" no dice nada. "Fixed broken path" lo dice todo |
| C4 | Planes en el repo | Los planes en Jira no existen para la IA |
| C5 | `CLAUDE.local.md` no está en git | Archivo privado por usuario — debe estar en `.gitignore` |
| C6 | HANDOFF.md tiene condiciones de verificación | Notas con evidencia (`score ≥ X`, `tests pass`) permiten que la siguiente sesión omita la re-auditoría completa |

### 🔒 Safety (Seguridad) — ¿Está la IA trabajando de forma segura? *(15%)*

| Verificación | Qué | Por qué |
| --- | --- | --- |
| S1 | `.env` en `.gitignore` | La herramienta Glob de la IA ignora `.gitignore` por defecto — los secretos quedan visibles |
| S2 | SHA de Actions fijado | El push de la IA dispara la CI. Tags flotantes = vector de ataque a la cadena de suministro |
| S3 | Escaneo de secretos configurado | La IA no se auto-revisará en busca de claves API escritas accidentalmente |
| S4 | Existe `SECURITY.md` | La IA necesita contexto de seguridad para decisiones de código sensibles |
| S5 | Permisos de workflow minimizados | Los workflows disparados por IA no deben tener acceso de escritura por defecto |
| S6 | Sin secretos hardcodeados | Detecta patrones `sk-`, `ghp_`, `AKIA`, claves privadas en el código fuente |
| S7 | Sin rutas personales en el código | Rutas absolutas del home-dir filtran la identidad de la máquina y fallan en otras máquinas |
| S8 | Sin trigger `pull_request_target` | Se ejecuta en contexto privilegiado — vector de ataque para PRs externos |
| S9 | Sin email personal en el historial de git | El email personal en los commits es una filtración de privacidad e identidad |

### ⚙️ Harness (Arnés) — ¿Es correcta tu configuración de Claude Code? *(10%)*

| Verificación | Qué | Por qué |
| --- | --- | --- |
| H1 | Nombres de eventos de hook válidos | `PoToolUse` vs `PostToolUse` — los errores tipográficos evitan que los hooks se disparen |
| H2 | Hooks de PreToolUse tienen matcher | Sin un matcher de herramienta, el hook se ejecuta antes de *cada* llamada a herramienta |
| H3 | Hook de parada tiene circuit breaker | Los hooks de parada sin condición de salida se ejecutan infinitamente |
| H4 | Sin auto-aprobación peligrosa | `*` o `.*` otorgan ejecución ilimitada de herramientas sin revisión humana |
| H5 | Cobertura de denegación de env completa | La falta de patrones de denegación permite que los secretos se filtren a herramientas no confiables |
| H6 | Acceso a red de scripts de hook | Llamadas salientes desde hooks pueden exfiltrar datos disparados por el agente |
| H7 | Gate workflows son bloqueantes | Las puertas de CI que solo advierten están efectivamente desactivadas — los agentes hacen merge a pesar de fallos |
| H8 | Errores de hook usan formato estructurado | `what/rule/fix` permite que el agente se auto-corrija; errores no estructurados lo dejan bloqueado |

### 🧠 Deep — Análisis de instrucciones potenciado por IA *(opcional, extendida)*

Lanza sub-agentes de IA para encontrar lo que el emparejamiento de patrones no puede:

| Verificación | Qué | Por qué |
| --- | --- | --- |
| D1 | Reglas contradictorias | Dos reglas que chocan hacen que el modelo elija una — usualmente la incorrecta |
| D2 | Reglas de peso muerto | Reglas que el modelo seguiría de todos modos desperdician tokens y diluyen la prioridad |
| D3 | Reglas vagas sin límite de decisión | "Usa el buen sentido" no le da al modelo nada contra qué evaluar |

### 📊 Session — aprende de tus logs de Claude Code *(opcional, extendida)*

Lee tu historial de sesiones para hacer emerger patrones que nunca notarías manualmente:

| Verificación | Qué | Por qué |
| --- | --- | --- |
| SS1 | Instrucciones repetidas | Instrucciones que escribes cada sesión pertenecen en `CLAUDE.md` |
| SS2 | Reglas ignoradas | Reglas que la IA sigue saltando necesitan reescritura, no repetición |
| SS3 | Puntos calientes de fricción | Qué proyectos y tareas generan más retrabajo |
| SS4 | Sugerencias de reglas faltantes | Correcciones comunes que aún no están capturadas en ningún lado |

## ¿En qué se diferencia de `/init`?

`/init` genera una plantilla de `CLAUDE.md` desde cero. Útil el primer día. **Inútil el día cincuenta**, cuando el archivo está obsoleto, inflado con palabras de énfasis que el modelo ignora, le falta el `.env` en `.gitignore` y excede silenciosamente el límite estricto de 40K.

`/init` escribe un archivo. AgentLint audita todo el sistema:

| | `/init` | AgentLint |
|---|:---:|:---:|
| Genera plantilla `CLAUDE.md` | ✅ | — |
| Verifica la calidad del archivo de entrada | — | ✅ |
| Encuentra referencias `@include` rotas | — | ✅ |
| Impone el límite estricto de 40K caracteres | — | ✅ |
| Audita CI, hooks, `.gitignore`, fijado de SHA de Actions | — | ✅ |
| Detecta la degradación de instrucciones con el tiempo | — | ✅ |
| Audita la configuración de hooks de Claude Code | — | ✅ |
| Auto-corrige lo que puede | — | ✅ |
| Cada verificación respaldada por una fuente de datos citada | — | ✅ |

## Para quién es esto

- **Desarrolladores solistas** que usan Claude Code, Cursor o Codex y quieren que el agente deje de ignorar sus reglas.
- **Líderes de equipo** que necesitan que cada repositorio de la organización esté listo para IA antes de que los agentes lleguen a producción.
- **Mantenedores de OSS** cuyos colaboradores externos (y sus agentes) deben escribir código siguiendo su estilo.
- **Ingenieros conscientes de la seguridad** preocupados por que los agentes exfiltren el `.env` o disparen workflows vulnerables.

## Compatibilidad

AgentLint se distribuye como un **plugin de Claude Code** y como una **CLI** independiente. Cuando se ejecuta, audita cualquiera de los siguientes si están presentes en tu repo:

- `CLAUDE.md` (Claude Code de Anthropic)
- `AGENTS.md` (el estándar universal — usado por OpenAI Codex, Cursor, Windsurf, Kilo, GitHub Copilot, Gemini CLI y [más de 60,000 repos de código abierto](https://agents.md/))
- `.cursor/rules/`
- `.github/copilot-instructions.md`

**Hoja de ruta:** integraciones nativas con Cursor y Codex. [Dale una estrella al repo](https://github.com/0xmariowu/AgentLint) para seguir los avances.

## Actualizar

```bash
npm install -g agentlint-ai
```

O actualiza el plugin de Claude Code directamente:

```bash
claude plugin update agent-lint@agent-lint
```

## Evidencia

Cada verificación cita su fuente. Sin opiniones, sin "mejores prácticas", solo datos.

| Fuente | Tipo |
| --- | --- |
| [Anthropic 265 prompt versions](https://cchistory.mariozechner.at) | Conjunto de datos primario |
| Código fuente de Claude Code | Límites estrictos y comportamiento interno |
| [IFScale (NeurIPS)](https://arxiv.org/abs/2507.11538) | Cumplimiento de instrucciones a escala |
| [ETH Zurich](https://arxiv.org/abs/2602.11988) | ¿Ayudan los archivos de contexto a los agentes de codificación? |
| [Codified Context](https://arxiv.org/abs/2602.20478) | Contenido obsoleto como modo de fallo número 1 |
| [Agent READMEs](https://arxiv.org/abs/2511.12884) | Efectividad concreta vs abstracta |

Citas completas en [`standards/evidence.json`](https://github.com/0xmariowu/AgentLint/blob/main/standards/evidence.json).

## FAQ

<details>
<summary><strong>¿Qué es exactamente un "arnés de agente" (agent harness)?</strong></summary>

El término se popularizó a principios de 2026 (Mitchell Hashimoto, OpenAI, LangChain). Definición más corta: <strong>Agente = Modelo + Arnés</strong>. El arnés es todo lo que envuelve a un LLM y lo convierte en un agente: herramientas, gestión de estado, bucles de retroalimentación y las reglas persistentes que lee al inicio de la sesión. Para agentes de codificación, esa última parte es tu <code>AGENTS.md</code>, <code>CLAUDE.md</code>, <code>.cursor/rules</code>, CI, hooks de pre-commit y <code>.gitignore</code>. AgentLint es el primer linter creado específicamente para auditar esa capa.
</details>

<details>
<summary><strong>¿Por qué no simplemente usar <code>/init</code> y ya está?</strong></summary>

Mira la tabla anterior. `/init` escribe un archivo; no audita tu repositorio. AgentLint realiza 51 verificaciones deterministas en 6 dimensiones principales (más 7 verificaciones extendidas opcionales) y corrige lo que encuentra.
</details>

<details>
<summary><strong>¿Funciona con Cursor, Codex o GitHub Copilot?</strong></summary>

Hoy AgentLint se ejecuta *dentro* de Claude Code, pero las verificaciones se aplican a los activos del repositorio que lee cualquier agente: `AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md`. Un repositorio bien lintado hace que cualquier agente sea mejor, no solo Claude. Las integraciones nativas con Cursor y Codex están en la hoja de ruta.
</details>

<details>
<summary><strong>¿Se envía mi código a algún lugar?</strong></summary>

Depende del modo que ejecutes. El predeterminado (`agentlint check` y la GitHub Action) es solo local y no ejecuta ninguna IA. Los dos modos extendidos opcionales sí interactúan con la IA o los logs de sesión locales; lo detallamos para que no haya sorpresas:

| Modo | Datos accedidos | Red / IA |
|------|---------------|--------------|
| `agentlint check` (defecto) | archivos en el repo escaneado | **Solo local, sin IA** |
| GitHub Action | archivos en el repo dentro del runner | **Solo local, sin IA** |
| `/al` (solo dims core) | repos git bajo el `PROJECTS_ROOT` configurado | **Solo local, sin IA** |
| `/al` con Deep (opcional) | archivos de entrada seleccionados (ej. `CLAUDE.md`) | **Envía el contenido del archivo a un sub-agente de Claude** |
| `/al` con Session (opcional) | logs de `~/.claude/projects/` en tu máquina | Analizador local. La salida está anonimizada por defecto; los fragmentos raw requieren `--include-raw-snippets` |

Deep es el único modo que transmite contenido de archivos fuera de tu máquina, y solo se ejecuta cuando lo pides explícitamente dentro de Claude Code. Todo lo que produce el escaneo predeterminado (la salida de `Score: NN/100 (core)`, el JSONL, el SARIF, las anotaciones de GitHub Action) proviene de verificaciones de patrones en disco, sin llamadas a API.
</details>

<details>
<summary><strong>¿El <code>npm install</code> escribe fuera de node_modules?</strong></summary>

**No.** `npm install -g agentlint-ai` solo instala la CLI de `agentlint` en el prefijo global de npm (como cualquier otra herramienta CLI). La instalación del plugin de Claude Code es **opcional**: ejecuta `npx agentlint-ai install` (una sola vez) para detectar Claude Code y registrar el comando de barra `/al` en `~/.claude/commands/`. La CLI funciona sin ese paso; el comando `/al` no.

Los fallbacks para modos de error están en [INSTALL.md](./INSTALL.md).
</details>

<details>
<summary><strong>¿No son estas simplemente "mejores prácticas"?</strong></summary>

No. Cada verificación cita una fuente específica: las 265 versiones de prompts de Anthropic, el código fuente de Claude Code, artículos revisados por pares o auditorías reales de producción. Si una verificación no puede respaldarse con datos, no se incluye.
</details>

<details>
<summary><strong>¿Por qué lintasan <code>AGENTS.md</code> si esto es un plugin de Claude Code?</strong></summary>

Porque la buena ingeniería de contexto es transversal a las herramientas. Si usas cualquier combinación de Claude Code, Cursor y Codex, el mismo `AGENTS.md` les sirve a todos. AgentLint lo verifica contra la misma base de evidencia, independientemente de qué agente termine leyéndolo.
</details>

<details>
<summary><strong>¿Cuánto tarda un escaneo?</strong></summary>

Menos de 5 segundos para la mayoría de los repositorios. Las dimensiones Deep y Session tardan más porque lanzan sub-agentes o laen logs de sesión.
</details>

## Requisitos

- Node 20+
- `jq`
- [Claude Code](https://claude.com/download) (para el plugin `/al` y el análisis Deep/Session)

## Contribuir

Problemas y PRs bienvenidos. Consulta [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

[MIT](LICENSE)

---

<div align="center">

**Si AgentLint te salvó de una sesión fallida con un agente, por favor [⭐ dale una estrella al repo](https://github.com/0xmariowu/AgentLint)** — es así como sabemos que es útil.

<sub>Construido por <a href="https://github.com/0xmariowu">@0xmariowu</a> · <a href="https://www.agentlint.app/">agentlint.app</a></sub>

</div>
