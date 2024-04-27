export default function formatDuration(ms: number): string {
  if (ms < 0) ms = -ms

  const time = {
    d: Math.floor(ms / 86400000),
    h: Math.floor(ms / 3600000) % 24,
    m: Math.floor(ms / 60000) % 60,
    s: Number.parseFloat(
      (Math.floor(ms / 1000) % 60) +
        '.' +
        `${Math.floor(ms) % 1000}`.padStart(3, '0'),
    ).toFixed(2),
  }

  let output = ''
  let isFirstComponent = true

  for (const [key, val] of Object.entries(time)) {
    if ((val !== 0 && val !== '0.00') || output) {
      if (isFirstComponent) {
        isFirstComponent = false
        if (key === 's') {
          output += `${parseFloat(`${val}`).toFixed(2)}s`
        } else {
          output += `${parseInt(`${val}`, 10)}${key}`
        }
      } else {
        if (key === 's') {
          output += `${parseFloat(`${val}`).toFixed(2)}s`
        } else {
          output += `${parseInt(`${val}`, 10)
            .toString()
            .padStart(2, '0')}${key}`
        }
      }
    }
  }

  return output || '0.00s'
}
