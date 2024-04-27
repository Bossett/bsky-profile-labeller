export default async function wait(delay: number = 5000) {
  await new Promise((resolve) => {
    setTimeout(resolve, delay)
  })
  return true
}
