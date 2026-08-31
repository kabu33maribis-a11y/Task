// Simple unique id generator (no dependency).
let counter = 0
export function uid(prefix = 't') {
  counter += 1
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${counter}_${rand}`
}
