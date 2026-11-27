import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import { sql } from 'kysely';
import { z } from 'zod';

import { createKysely } from '../src/database/create-kysely.js';
import type { DB } from '../src/database/types.js';
import { chunkPage } from '../src/modules/knowledge/chunker.js';
import { detectFormat, extractDocument, mimeFor } from '../src/modules/knowledge/extract.js';
import { KNOWLEDGE_FILE_FORMATS } from '../src/modules/knowledge/knowledge.constants.js';
import { KnowledgeRepository } from '../src/modules/knowledge/repositories/knowledge.repository.js';

/**
 * Loads demo knowledge from a local directory (the organizers' dataset is not part of this
 * repository). Extraction and chunking are the same code the worker uses; pages are created
 * published so the demo has something to search from the first minute.
 *
 *   pnpm --filter @workspace/api exec tsx scripts/seed-knowledge.ts \
 *     --account <uuid> --project <uuid> --dir ../../context/tz/materials
 *
 * Never point `--dir` at data that may not leave the private environment.
 */

const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');

/** Only what the seed needs: the app role connection and where sources are stored. */
const seedEnv = z.object({
  DATABASE_URL: z.string().min(1),
  KNOWLEDGE_BLOB_DIR: z.string().min(1).default('./data/knowledge'),
});

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const accountId = argument('account');
  const projectId = argument('project');
  const dir = argument('dir');
  if (!accountId || !projectId || !dir) {
    throw new Error('usage: seed-knowledge --account <uuid> --project <uuid> --dir <path>');
  }
  const env = seedEnv.parse(process.env);
  const files = (await readdir(resolve(dir))).filter((name) =>
    KNOWLEDGE_FILE_FORMATS.includes(extname(name).slice(1).toLowerCase() as never),
  );
  if (!files.length) throw new Error(`no supported files in ${dir}`);

  const db = createKysely<DB>({
    connectionString: env.DATABASE_URL,
    max: 1,
    applicationName: 'knowledge-seed',
  });
  const repo = new KnowledgeRepository();
  try {
    await db.transaction().execute(async (tx) => {
      await sql`SELECT set_config('app.account_id', ${accountId}, true)`.execute(tx);
      for (const name of files) {
        const path = join(resolve(dir), name);
        const data = await readFile(path);
        const format = detectFormat(name, data);
        const title = name.replace(/\.[A-Za-z0-9]{1,8}$/, '').slice(0, 200);
        const hash = sha256(data);
        const existing = await repo.findSourceByHash(tx, projectId, hash);
        if (existing) {
          console.log(`skip ${name}: already loaded`);
          continue;
        }
        const blobKey = `${accountId}/${projectId}/${hash}.${format}`;
        const blobPath = join(resolve(env.KNOWLEDGE_BLOB_DIR), accountId, projectId, `${hash}.${format}`);
        await mkdir(dirname(blobPath), { recursive: true });
        await writeFile(blobPath, data, { mode: 0o600 });

        const source = await repo.insertSource(tx, {
          account_id: accountId,
          project_id: projectId,
          kind: 'upload',
          title,
          mime: mimeFor(format),
          size_bytes: data.length,
          sha256: hash,
          blob_key: blobKey,
          status: 'ready',
          period_start: null,
          period_end: null,
          metadata: { format, seed: true },
          created_by: null,
        });
        const document = await extractDocument(format, name, data);
        const position = await repo.nextPosition(tx, projectId, null);
        const body = document.parts
          .map((part) => `## ${part.headingPath.slice(1).join(' / ') || part.headingPath[0]}\n\n${part.text}`)
          .join('\n\n')
          .slice(0, 180_000);
        const nodeTitle = (document.parts[0]?.headingPath.at(-1) ?? title).slice(0, 120);
        const node = await repo.insertNode(tx, {
          account_id: accountId,
          project_id: projectId,
          parent_id: null,
          kind: 'page',
          title: nodeTitle,
          body,
          status: 'published',
          position,
          content_hash: sha256(`${nodeTitle}\n${body}`),
          indexed_hash: null,
          source_id: source.id,
          created_by: null,
          updated_by: null,
        });
        await tx
          .updateTable('knowledge_nodes')
          .set({ published_at: new Date() })
          .where('id', '=', node.id)
          .execute();
        await repo.appendRevision(tx, {
          account_id: accountId,
          node_id: node.id,
          title: nodeTitle,
          body,
          status: 'published',
          author_id: null,
          author_kind: 'system',
        });
        await repo.replaceCitations(
          tx,
          node.id,
          document.parts.map((part) => ({
            account_id: accountId,
            source_id: source.id,
            locator: part.locator,
            quote: part.text.slice(0, 500),
          })),
        );
        const drafts = chunkPage(nodeTitle, body);
        await repo.replaceChunks(
          tx,
          node.id,
          drafts.map((draft, index) => ({
            account_id: accountId,
            project_id: projectId,
            node_id: node.id,
            position: index,
            heading_path: draft.headingPath,
            text: draft.text,
            token_count: draft.tokenCount,
            content_hash: sha256(draft.text),
            embedding: null,
            embedding_model: null,
          })),
        );
        await tx
          .updateTable('knowledge_nodes')
          .set({ indexed_hash: sha256(`${nodeTitle}\n${body}`) })
          .where('id', '=', node.id)
          .execute();
        console.log(`loaded ${name}: ${drafts.length} chunks`);
      }
    });
    console.log('done. Publish fixes and embeddings are computed by the worker on the next edit.');
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
