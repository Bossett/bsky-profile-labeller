export default async function wait(delay: number = 5000) {
  if (delay <= 0) return true
  await new Promise((resolve) => {
    setTimeout(resolve, Math.floor(delay))
  })
  return true
}
