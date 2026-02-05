# Agentic-Coding-Dev-Setup

Working on

https://github.com/github/awesome-copilot 

MonoRepo Setup via Symlink
https://chatgpt.com/share/6984605c-52a4-8001-83bd-a1ec867fdf9a


Kurzfassung:  
- **AGENTS/agent.md**: Charakter & Arbeitsweise deines Agents (wer bin ich, wie arbeite ich, was ist dieses Repo?).  
- ***.instructions.md**: Dauerhafte Coding-Guidelines für bestimmte Pfade/Sprachen.  
- **SKILL.md**: Modul für einen speziellen Workflow (z.B. „CQRS-UseCase implementieren“).  
- ***.prompt.md**: Wiederverwendbare Chat-Kommandos (Slash-Commands für typische Tasks).  [docs.github](https://docs.github.com/en/copilot/reference/custom-instructions-support)

***

## 1. Wofür sind die einzelnen Dateien?

### AGENTS.md / agent.md

- Legt fest, wie der Agent grundsätzlich tickt: Rolle, Tech-Stack, Architektur-Standards, Quality-Gates.  [docs.github](https://docs.github.com/en/copilot/reference/custom-instructions-support)  
- Wirkt für Copilot Chat / Coding Agent als „persönliche README“ für dieses Repo.  
- Kann hierarchisch liegen (Root + Unterordner, nächster Treffer im Pfad gewinnt).  [docs.github](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot)

Typische Inhalte:
- Tech-Stack: „C# 12, .NET 9, HotChocolate 16, Azure, Mongo, SQL“.  
- Architekturregeln: Outbox Pflicht, DataLoader Pflicht, CQRS-Trennung, Event-Versionierung.  
- Arbeitsstil: „erst Plan, dann Code; immer Tests generieren; keine direkten Service-Bus-Calls“.  [xebia](https://xebia.com/blog/vibe-coding-github-copilot-maintenance/)

### *.instructions.md

- Repository-/Pfad-spezifische Coding-Regeln, Naming- und Format-Guidelines.  [docs.github](https://docs.github.com/en/copilot/reference/custom-instructions-support)  
- Werden automatisch als Kontext geladen, wenn du in diesem Pfad arbeitest.  [docs.github](https://docs.github.com/en/copilot/reference/custom-instructions-support)  
- Gut für Dinge wie: „Alle .cs unter /src/Orders verwenden Nullable, Logging-Pattern X, Exception-Handling Y“.

Beispiel-Pfad:
- `.github/copilot-instructions.md` – global fürs Repo.  
- `.github/instructions/backend.instructions.md` – nur für Backend.  [docs.github](https://docs.github.com/en/copilot/reference/custom-instructions-support)

### SKILL.md (Agent Skills)

- Ein Skill = Ordner unter `.github/skills/<name>/` mit **SKILL.md** und optional Scripts / Beispiele.  [code.visualstudio](https://code.visualstudio.com/docs/copilot/customization/agent-skills)  
- Beschreibt einen spezialisierten Ablauf, den der Agent bei passenden Prompts automatisch nutzt.  
- Wird erst geladen, wenn dein Prompt zum Skill passt (z.B. „erstelle Migration“, „implementiere neue GraphQL-Query“).  [code.visualstudio](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

Typischer Skill:
- „dotnet-service-pbi-implementation“ → Steps: PBI lesen, Schichten anlegen, Outbox-Event, Tests, Checkliste.  
- Enthält Referenzen auf Scripts/Templates im Skill-Ordner.  [code.visualstudio](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

### *.prompt.md

- Beschreibt wiederverwendbare Chat-Prompts, die du z.B. über Slash-Commands / Custom Chat Modes triggerst.  [github](https://github.com/github/awesome-copilot/blob/main/docs/README.prompts.md)  
- Eher „Makro“ für eine bestimmte Gesprächssituation (Code-Review, Refactor-Session, Planungsmodus).  
- Wird oft mit Chatmodes kombiniert (z.B. `{name}.prompt.md` unter `.github/prompts`).  [github](https://github.com/github/awesome-copilot/blob/main/docs/README.prompts.md)

***

## 2. Best-Practice-Setup für Backend / Vibe Coding

Ziel: Copilot im Agent Mode wie einen konstanten, repo-bewussten Backend-Dev nutzen, ohne jedes Mal alles zu erklären.  [docs.github](https://docs.github.com/en/copilot/get-started/best-practices)

### Struktur im Repo

Empfehlung fürs Root der Mono-Repo (angepasst auf deinen Fusion-Backend-Kontext):

```text
/.github/
  copilot-instructions.md
  AGENTS.md                 # oder agent.md im Root
  /instructions/
    root.backend.instructions.md
    fusion-backend.instructions.md
  /skills/
    backend-pbi/
      SKILL.md
      templates/
        command-handler.cs.txt
        graphql-mutation.cs.txt
    backend-bugfix/
      SKILL.md
    backend-refactor/
      SKILL.md
  /prompts/
    code-review.prompt.md
    plan-feature.prompt.md
    implement-pbi.prompt.md
    bug-analysis.prompt.md
```

Rollen der Teile:

- **AGENTS.md**: Dein globaler „Backend-Architekt“.  
- **copilot-instructions.md**: Allgemeine Projekt- und Coding-Regeln (C# 12, .NET 9, Style, Testing).  [docs.github](https://docs.github.com/en/copilot/reference/custom-instructions-support)  
- **instructions/**: Feiner granulare Policies pro Service/Pfad (z.B. Insights = read-only, CQRS strikt).  
- **skills/**: Feste Abläufe (PBI-Implementierung, Bugfix, Refactor).  [code.visualstudio](https://code.visualstudio.com/docs/copilot/customization/agent-skills)  
- **prompts/**: Deine Standard-Chatbefehle für schnelle Interaktionen.  [github](https://github.com/github/awesome-copilot/blob/main/docs/README.prompts.md)

***

## 3. Konkrete Inhalte für dein Setup

### 3.1 AGENTS.md (Backend-Dev-Identity)

Inhalt grob:

- Rolle: „Senior Backend Engineer für Fusion Backend“.  
- Tech-Stack: C# 12, .NET 9 LTS, HotChocolate 16, Azure, MongoDB, SQL.  
- Non-Negotiable Patterns: Outbox, DataLoader, ID<T>, Mutation-Payload, Event-Version.  
- Workflow:  
  - erst Architektur/Plan,  
  - dann Code mit kleinen, kompilierbaren Schritten,  
  - immer Tests generieren,  
  - keine direkten Service-Bus-Calls.

Dazu 2–3 kurze Beispiele, wie ein idealer PR aussieht (Schichten, Tests, Events).  [github](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)

### 3.2 copilot-instructions.md

Fokus auf allgemeine Coding-Regeln, kurz halten (Performance, jede Anfrage lädt das mit):  [docs.github](https://docs.github.com/en/copilot/get-started/best-practices)

- Coding-Style (Namen, Nullability, Logging).  
- Fehler-Handling-Standard (Result-Typen, Exceptions).  
- Test-Standards (xUnit, 80% Coverage, Naming).  
- Sicherheitsregeln (keine Secrets, kein direkter HTTP-Call zu internen Diensten, etc.).

### 3.3 Skills für wiederkehrende Backend-Aufgaben

Beispiele für SKILLs:

1. `backend-pbi/SKILL.md`  
   - Zweck: PBI mit ID `F2C-xxxx` in bestimmtem Service end-to-end umsetzen.  
   - Steps (sehr konkret): PBI lesen, Service-Kontext laden, Architektur-Entscheid, Domain + GraphQL + Outbox + Tests, Checkliste.  
   - Verweise auf vorhandene Projekt-Doku / Templates.  [code.visualstudio](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

2. `backend-bugfix/SKILL.md`  
   - Zweck: Bug anhand Stacktrace/Log analysieren und fixen.  
   - Steps: Klassifizieren, Root Cause, Fix + Regression-Test, Prävention.  

3. `backend-refactor/SKILL.md`  
   - Zweck: gezielte Refactors („GraphQL Resolver in DataLoader Pattern überführen“, usw.).

Diese Skills werden automatisch gezogen, wenn du entsprechend fragst („Nutze den Backend-PBI Skill, um F2C-12345 zu implementieren.“).  [code.visualstudio](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

### 3.4 prompt.md Dateien für Vibes

Je nach Geschmack 3–5 gut definierte Prompts:

- `plan-feature.prompt.md`: „Lies PBI, mach Plan mit Tasks, Edge Cases, Checkliste“ – perfekt, um einen Plan zu haben, bevor du „vibe coded“.  [sinergikreatifa](https://sinergikreatifa.com/best-practices-for-vibe-coding-with-vs-code-github-copilot/)  
- `implement-pbi.prompt.md`: „Nutze Plan und Backend-PBI-Skill, implementiere inkrementell, nach jedem Schritt Tests anpassen“.  
- `code-review.prompt.md`: „Strenge Review-Brille: Outbox, DataLoader, IDs, Tests, Naming“.  
- `bug-analysis.prompt.md`: Fokus auf Diagnose und Minimal-Fix.

Damit kannst du im Chat / Agent Mode schnell in bestimmte „Modi“ springen, ohne jedes Mal alles neu zu tippen.  [github](https://github.com/github/awesome-copilot/blob/main/docs/README.prompts.md)

***

## 4. Vibe-Coding-spezifische Tipps

Für Agent Mode + Vibes Coding mit Backend-Fokus:  [docs.github](https://docs.github.com/en/copilot/get-started/best-practices)

- Agent immer erst „einchecken“ lassen  
  - „Lies AGENTS.md, copilot-instructions und relevante SKILLs für Service X. Sag mir, was du verstanden hast.“  
- Kleine Loops fahren  
  - Plan → ein kleiner Implementierungsschritt → Test/Review → Nächster Schritt.  
- Chat als Wegwerf-Context sehen, State liegt in Dateien (AGENTS, TASKS, Skills, etc.).  [wictorwilen](https://www.wictorwilen.se/blog/top-10-learnings-from-vibe-coding-with-github-copilot/)  
- Tasks in Datei halten (z.B. `TASKS.md` im Service) und Agent darauf referenzieren.  [wictorwilen](https://www.wictorwilen.se/blog/top-10-learnings-from-vibe-coding-with-github-copilot/)  

Wenn du magst, kann ich dir im nächsten Schritt ein konkretes Beispiel-AGENTS.md + einen SKILL.md (z.B. „PBI implementieren im Insights Service“) in C#/.NET-9-/HotChocolate-Sprache vorschlagen, passend zu deinem Fusion-Setup.