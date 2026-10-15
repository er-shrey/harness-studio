import type { Connector, SkillData } from './types'

type CatalogEntry = {
  template: Connector
  /** Lower-case phrases that suggest this connector when found in a skill. */
  keywords: string[]
  /** Case-sensitive whole-word tokens (e.g. "PR"), checked separately. */
  tokens?: string[]
}

const VERIFY = 'Template: check the server package or URL and fill in the env vars before use.'

/**
 * Starting points for common MCP servers. These are templates, not endorsements:
 * every entry is editable in the Connectors panel and nothing secret is stored.
 */
export const CATALOG: CatalogEntry[] = [
  {
    template: {
      id: 'slack',
      label: 'Slack',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}', SLACK_TEAM_ID: '${SLACK_TEAM_ID}' },
      notes: VERIFY,
    },
    keywords: ['slack', 'channel', 'thread', 'direct message'],
  },
  {
    template: {
      id: 'github',
      label: 'GitHub',
      transport: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' },
      notes: VERIFY,
    },
    keywords: ['github', 'pull request', 'pr review', 'code review'],
    tokens: ['PR', 'PRs'],
  },
  {
    template: {
      id: 'bitbucket',
      label: 'Bitbucket',
      transport: 'stdio',
      command: '<bitbucket-mcp-server-command>',
      env: { BITBUCKET_USERNAME: '${BITBUCKET_USERNAME}', BITBUCKET_APP_PASSWORD: '${BITBUCKET_APP_PASSWORD}' },
      notes: VERIFY,
    },
    keywords: ['bitbucket'],
  },
  {
    template: {
      id: 'atlassian',
      label: 'Jira / Confluence',
      transport: 'sse',
      url: 'https://mcp.atlassian.com/v1/sse',
      notes: VERIFY,
    },
    keywords: ['jira', 'confluence', 'atlassian', 'ticket', 'sprint', 'epic'],
  },
  {
    template: {
      id: 'linear',
      label: 'Linear',
      transport: 'sse',
      url: 'https://mcp.linear.app/sse',
      notes: VERIFY,
    },
    keywords: ['linear'],
  },
  {
    template: {
      id: 'notion',
      label: 'Notion',
      transport: 'http',
      url: 'https://mcp.notion.com/mcp',
      notes: VERIFY,
    },
    keywords: ['notion'],
  },
  {
    template: {
      id: 'gmail',
      label: 'Gmail',
      transport: 'stdio',
      command: '<gmail-mcp-server-command>',
      notes: VERIFY,
    },
    keywords: ['gmail', 'email', 'inbox', 'mail'],
  },
  {
    template: {
      id: 'google-drive',
      label: 'Google Drive',
      transport: 'stdio',
      command: '<google-drive-mcp-server-command>',
      notes: VERIFY,
    },
    keywords: ['google drive', 'google doc', 'google sheet', 'spreadsheet'],
  },
  {
    template: {
      id: 'postgres',
      label: 'Postgres',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', '${DATABASE_URL}'],
      notes: VERIFY,
    },
    keywords: ['postgres', 'sql', 'database', 'query the db'],
  },
]

export type Suggestion = { connector: Connector; reason: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Work out which MCP servers a skill probably needs, from its name, description,
 * instructions and attached files. Also picks up explicit `mcp__<server>__tool`
 * references, which is how Claude Code names MCP tools.
 */
export function inferConnectors(data: SkillData): Suggestion[] {
  const sources: { label: string; text: string }[] = [
    { label: 'name', text: data.name },
    { label: 'description', text: data.description },
    { label: 'instructions', text: data.instructions },
    ...data.attachments.map((a) => ({ label: a.name, text: `${a.name}\n${a.content}` })),
  ]
  const found = new Map<string, Suggestion>()

  for (const { template, keywords, tokens } of CATALOG) {
    for (const src of sources) {
      const lower = src.text.toLowerCase()
      const kw = keywords.find((k) => new RegExp(`\\b${escapeRe(k)}\\b`).test(lower))
      const tok = tokens?.find((t) => new RegExp(`\\b${escapeRe(t)}\\b`).test(src.text))
      const hit = kw ?? tok
      if (hit) {
        found.set(template.id, { connector: template, reason: `“${hit}” in ${src.label}` })
        break
      }
    }
  }

  for (const src of sources) {
    for (const m of src.text.matchAll(/mcp__([a-zA-Z0-9_-]+?)__/g)) {
      const id = m[1].toLowerCase()
      if (found.has(id)) continue
      const known = CATALOG.find((c) => c.template.id === id)?.template
      found.set(id, {
        connector: known ?? { id, label: m[1], transport: 'stdio', command: `<${id}-mcp-server-command>`, notes: VERIFY },
        reason: `tool reference ${m[0]}… in ${src.label}`,
      })
    }
  }

  return [...found.values()]
}

/**
 * Suggestions that aren't attached to the skill yet. An attached connector with a different
 * key but the same service (e.g. a claude.ai Jira connector with an opaque id) counts as covered.
 */
export function missingConnectors(data: SkillData, connectors: Record<string, Connector> = {}): Suggestion[] {
  const attachedLabels = data.connectorIds.map((id) => connectors[id]?.label ?? id)
  return inferConnectors(data).filter(
    (s) => !data.connectorIds.includes(s.connector.id) && !attachedLabels.some((l) => l.startsWith(s.connector.label)),
  )
}
