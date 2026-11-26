/** AAD of a sealed credential: binds the ciphertext to its account, project and row. */
export function credentialAad(accountId: string, projectId: string, credentialId: string): string {
  return `${accountId}|${projectId}|${credentialId}`;
}
