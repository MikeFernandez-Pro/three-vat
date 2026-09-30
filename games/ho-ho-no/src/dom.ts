// The page's elements, as index.html has them.

/** The element `selector` names in index.html; one missing is a broken page, not a case to handle. */
export function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`index.html has no ${selector}`)
  return element
}
