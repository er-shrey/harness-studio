import type { Project } from './types'
import { CATALOG } from './connectors'

const tpl = (id: string) => CATALOG.find((c) => c.template.id === id)!.template

/** The starter project: the Slack → PR review flow from the original idea. */
export function exampleProject(): Project {
  return {
    version: 1,
    name: 'PR review from Slack',
    description:
      'Watch Slack for pull requests I am tagged on, review them, and post the review summary back to the thread.',
    connectors: { slack: tpl('slack'), github: tpl('github') },
    nodes: [
      {
        id: 's-slack',
        type: 'skill',
        position: { x: 60, y: 140 },
        data: {
          name: 'Slack messages',
          description: 'Read recent Slack messages that mention me.',
          instructions:
            'Search Slack for messages from the last 24 hours that mention me. For each one, capture the channel, thread link, author and any URLs in the message.',
          attachments: [
            {
              id: 'a-slack-read',
              name: 'slack-reading.md',
              content:
                '# Reading Slack\n\n- Use the search tool with `to:me` / `@me` to find mentions.\n- Always open the full thread, not just the first message.\n- Ignore bot messages.\n',
            },
          ],
          connectorIds: ['slack'],
        },
      },
      {
        id: 's-review',
        type: 'skill',
        position: { x: 420, y: 60 },
        data: {
          name: 'PR review',
          description: 'Review the pull request against our review checklist.',
          instructions:
            'Open the pull request from the message. Read the diff and the description, then review it against the checklist in the references. Produce a short verdict (approve / changes requested) and a bulleted list of findings with file:line.',
          attachments: [
            {
              id: 'a-checklist',
              name: 'review-checklist.md',
              content:
                '# Review checklist\n\n1. Does the change do what the PR description says?\n2. Are there tests for new behaviour?\n3. Any secrets, debug logs or commented-out code?\n4. Error handling on network and IO calls.\n',
            },
            {
              id: 'a-rules',
              name: 'review-rules.yaml',
              content: 'severity_levels: [blocker, major, minor, nit]\nmax_findings: 10\nskip_paths:\n  - "**/*.lock"\n  - "dist/**"\n',
            },
          ],
          connectorIds: ['github'],
        },
      },
      {
        id: 's-reply',
        type: 'skill',
        position: { x: 780, y: 140 },
        data: {
          name: 'Post summary',
          description: 'Reply in the Slack thread with the review summary.',
          instructions:
            'Draft a reply in the original Slack thread with the verdict and the top findings. Show me the draft and wait for my OK before sending.',
          attachments: [],
          connectorIds: ['slack'],
        },
      },
      {
        id: 's-ignore',
        type: 'skill',
        position: { x: 420, y: 300 },
        data: {
          name: 'Log and skip',
          description: 'Note the message so it is not picked up again.',
          instructions: 'Add the message link to the "seen" list in the run summary and move on.',
          attachments: [],
          connectorIds: [],
        },
      },
    ],
    edges: [
      {
        id: 'e-1',
        source: 's-slack',
        target: 's-review',
        type: 'condition',
        data: { condition: 'the message links a pull request and tags me' },
      },
      {
        id: 'e-2',
        source: 's-slack',
        target: 's-ignore',
        type: 'condition',
        data: { condition: 'the message is not about a pull request' },
      },
      { id: 'e-3', source: 's-review', target: 's-reply', type: 'condition', data: { condition: '' } },
    ],
  }
}
