import type { Navigation } from '../../shared/reading';
// One page turn can emit several relocates: crossing a section, foliate first
// shows the old section's trailing blank column, then the new section. Every
// relocate until the turn settles belongs to that turn; later ones are jumps.
export function navigationMode() {
  let mode: Navigation = 'jump',
    turns = 0;
  return {
    get current() {
      return mode;
    },
    jump() {
      turns++;
      mode = 'jump';
    },
    async turn(direction: 'next' | 'prev', run: () => Promise<unknown>) {
      const turn = ++turns;
      mode = direction;
      try {
        await run();
      } finally {
        if (turn === turns) mode = 'jump';
      }
    },
  };
}
