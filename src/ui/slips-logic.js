// The paper slip of an earned mark (slips.js draws it): what it says and which slips are on screen. Pure, no DOM.

export const SLIP_LIFE = 4; // s a slip stays fully visible
export const SLIP_LEAVE = 0.6; // s it takes to go (matches the CSS transition)
export const SLIP_MAX = 2; // slips on screen at once; the rest wait their turn
const LINE_MAX = 78; // characters of the one line

/** The naturalist's remark of a mark cut to its first sentence (and to LINE_MAX characters at a word). */
export function slipLine(mark) {
  const text = String((mark && mark.line) || '').trim();
  const first = text.split(/(?<=[.!?…])\s/)[0] || '';
  if (first.length <= LINE_MAX) return first;
  const cut = first.slice(0, LINE_MAX - 1);
  return `${cut.slice(0, Math.max(1, cut.lastIndexOf(' ')))}…`;
}

/** What a slip shows for a mark: { id, icon, title, line }. */
export const slipOf = (mark) => ({ id: mark.id, icon: mark.icon, title: mark.title, line: slipLine(mark) });

/**
 * The slips on screen. `push(item)` queues a slip ({ id, ... }; an id that is already queued or showing is ignored);
 * `tick(dt)` returns { enter, leave, gone }: the items that should appear, start leaving and be removed now. At most
 * `max` slips are on screen (leaving ones included, so the stack never grows past it); the others wait.
 */
export function createSlipQueue({ life = SLIP_LIFE, leave = SLIP_LEAVE, max = SLIP_MAX } = {}) {
  /** @type {{item: object, age: number, leaving: boolean}[]} */
  let active = [];
  let pending = [];
  const known = (id) => active.some((a) => a.item.id === id) || pending.some((p) => p.id === id);
  return {
    push(item) {
      if (!item || known(item.id)) return false;
      pending.push(item);
      return true;
    },
    tick(dt = 0) {
      const out = { enter: [], leave: [], gone: [] };
      for (const a of active) {
        a.age += dt;
        if (!a.leaving && a.age >= life) {
          a.leaving = true;
          out.leave.push(a.item);
        }
      }
      active = active.filter((a) => {
        if (a.leaving && a.age >= life + leave) {
          out.gone.push(a.item);
          return false;
        }
        return true;
      });
      while (pending.length && active.length < max) {
        const item = pending.shift();
        active.push({ item, age: 0, leaving: false });
        out.enter.push(item);
      }
      return out;
    },
    reset() {
      active = [];
      pending = [];
    },
    /** { showing, waiting }: the ids on screen and in line. */
    snapshot: () => ({ showing: active.map((a) => a.item.id), waiting: pending.map((p) => p.id) }),
  };
}
