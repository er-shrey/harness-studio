# Harness Studio

A visual designer for Claude Code workflow skills. Drop skills on a canvas, link them with
plain-language conditions, attach the reference files and MCP connectors each step needs,
dry-run the flow, then export a ready-to-install skill bundle.

## Run

```bash
npm install
npm run dev
```

## What it does

- **Canvas**: add skills (toolbar or double-click), drag between handles to link them, click a
  link's label to set its condition. Empty condition means "always continue".
- **Skill inspector**: name, description, instructions, attached `.md` / `.yaml` / `.txt` / `.json`
  files, and MCP connectors.
- **Connector detection**: flags the MCP servers a skill probably needs, from keywords
  (Slack, GitHub, Jira…) and explicit `mcp__<server>__tool` references.
- **Connectors**: edit each server's config as YAML; export `.mcp.json` or `connectors.yaml` on
  their own. Use `${VAR}` placeholders for secrets.
- **Simulate**: walks the flow from its start skills (or the selected one), animating each step and
  asking you whether each condition holds.
- **Delete**: select a skill or link, then use its Delete button, the ✕ on the canvas, or the
  Delete / Backspace key. Deleting a skill with content asks first.
- **Import** (File menu): open a folder or a .zip and get a graph back.
  - A Harness Studio bundle reloads exactly from `harness.json`, or is rebuilt from its `SKILL.md`.
  - A plugin (`.claude-plugin/plugin.json` with `skills/`, `agents/`, `commands/`) becomes one node
    per skill, agent and command. Mentions such as `/plugin:name`, `skills/name/` or
    `` `agent-name` `` become dotted "uses" links; a mention on an "If …" / "When …" line becomes a
    condition.
  - A single skill or command with numbered `## 1 · …` sections is split into a chain of steps.
  - Files a skill links to (`$CLAUDE_PLUGIN_ROOT/…`, relative links) and the rest of its folder are
    attached. `.mcp.json`, `connectors.yaml` and `mcp__server__tool` references become connectors.
  - Build output, binaries, files over 512 KB and secret-looking files (`.env`, keys, `*token*`) are
    never read.
- **Generate skill**: previews `SKILL.md` and downloads a zip:

```
<harness-name>/
  SKILL.md                 orchestrator: connectors, mermaid flow, steps with routing
  references/<skill>/…     files attached to each step
  .mcp.json                connectors in Claude Code's format
  connectors.yaml          the same, as YAML
  harness.json             reopen this graph in Harness Studio
```

Unzip into `~/.claude/skills/` (personal) or `.claude/skills/` in a repo.

Work is saved in the browser's local storage. Use **File → Save harness.json** to keep a copy.

## Stack

Vite, React, TypeScript, [React Flow](https://reactflow.dev), Zustand, JSZip, js-yaml.
No backend.
