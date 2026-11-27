export default async function setup() {
  await (await import('./global-setup.ts')).default();
}
