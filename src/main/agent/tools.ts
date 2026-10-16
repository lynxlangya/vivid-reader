import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { SelectionRange } from '../../shared/companion';
import { ContentGateway } from '../content/gateway';
const empty = Type.Object({}, { additionalProperties: false });
const cfi = Type.String({ maxLength: 4096 });
const range = Type.Object(
  { start: cfi, end: cfi },
  { additionalProperties: false },
);
export function readingTools(
  gateway: ContentGateway,
  selection?: SelectionRange,
): AgentTool[] {
  const make = (
    name: string,
    description: string,
    parameters: TSchema,
    run: (args: Record<string, unknown>) => unknown,
  ): AgentTool => ({
    name,
    label: name,
    description,
    parameters,
    execute: async (_id, args) => {
      try {
        if (!Value.Check(parameters, args))
          throw new Error('Invalid parameters');
        const value = run(args as Record<string, unknown>);
        return {
          content: [{ type: 'text', text: JSON.stringify(value) }],
          details: undefined,
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: 'Requested content is unavailable within the read boundary.',
            },
          ],
          details: undefined,
          isError: true,
        };
      }
    },
  });
  return [
    make(
      'get_reading_context',
      'Get current reading context, read boundary, and known entities.',
      empty,
      () => ({
        ...gateway.context(),
        selection:
          selection && gateway.selectionAllowed(selection.start, selection.end)
            ? gateway.read(selection.start, selection.end)
            : [],
      }),
    ),
    make(
      'read_text',
      'Read a CFI range. Unread text is always removed.',
      range,
      (args) => gateway.read(String(args.start), String(args.end)),
    ),
    make(
      'search_book',
      'Search only text already read.',
      Type.Object(
        { query: Type.String({ minLength: 1, maxLength: 200 }) },
        { additionalProperties: false },
      ),
      (args) => gateway.search(String(args.query)),
    ),
    make(
      'lookup_entity',
      'Look up an entity with a mention already read.',
      Type.Object(
        { name: Type.String({ minLength: 1, maxLength: 120 }) },
        { additionalProperties: false },
      ),
      (args) => gateway.lookup(String(args.name)),
    ),
    make(
      'summarize',
      'Obtain clipped source material for a requested summary.',
      Type.Object(
        {
          scope: Type.Union([
            Type.Literal('selection'),
            Type.Literal('chapter'),
            Type.Literal('to_boundary'),
          ]),
        },
        { additionalProperties: false },
      ),
      (args) =>
        args.scope === 'selection'
          ? selection
            ? gateway.summary('chapter', selection)
            : []
          : gateway.summary(args.scope as 'chapter' | 'to_boundary'),
    ),
  ];
}
