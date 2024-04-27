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

  return Object.entries(time)
    .filter((val) => val[1] !== 0)
    .map(([key, val]) => `${val}${key}`)
    .join('')
}
