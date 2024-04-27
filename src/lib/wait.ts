export default async function wait(delay: number = 5000) {
  await new Promise((resolve) => {
    setTimeout(resolve, delay)
    if (global.gc) {
      global.gc()
    }
  })
  return true
}
