export type EditHistory<T> = {
  current: T;
  past: T[];
  grouping: boolean;
  captured: boolean;
};

export type HistoryAction<T> =
  | { type: 'change'; patch: Partial<T> }
  | { type: 'reset'; current: T }
  | { type: 'begin' }
  | { type: 'end' }
  | { type: 'undo' };

export function createHistory<T>(current: T): EditHistory<T> {
  return { current, past: [], grouping: false, captured: false };
}

export function historyReducer<T extends object>(
  state: EditHistory<T>,
  action: HistoryAction<T>,
): EditHistory<T> {
  if (action.type === 'reset') return createHistory(action.current);
  if (action.type === 'begin')
    return { ...state, grouping: true, captured: false };
  if (action.type === 'end')
    return { ...state, grouping: false, captured: false };
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    return previous
      ? {
          current: previous,
          past: state.past.slice(0, -1),
          grouping: false,
          captured: false,
        }
      : state;
  }
  const keys = Object.keys(action.patch) as (keyof T)[];
  if (keys.every((key) => Object.is(state.current[key], action.patch[key])))
    return state;
  return {
    current: { ...state.current, ...action.patch },
    past:
      state.grouping && state.captured
        ? state.past
        : [...state.past.slice(-49), state.current],
    grouping: state.grouping,
    captured: state.grouping,
  };
}
