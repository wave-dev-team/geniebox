export default async function teardown() {
  await (await import('./global-teardown.ts')).default();
}
