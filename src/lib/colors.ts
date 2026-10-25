export const TASK_COLORS = [
  ['red', 'Red'],
  ['orange', 'Orange'],
  ['yellow', 'Yellow'],
  ['green', 'Green'],
  ['teal', 'Teal'],
  ['blue', 'Blue'],
  ['purple', 'Purple'],
  ['pink', 'Pink'],
] as const

export type TaskColor = typeof TASK_COLORS[number][0]

/** CSS custom-property value for a task colour; the tokens are defined per theme in index.css. */
export const colorVar = (color: TaskColor | null | undefined) => color ? `var(--c-${color})` : undefined
