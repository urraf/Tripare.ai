// Build step: bundle the workflow code once (dist/workflow-bundle.js) so the worker
// does not have to run webpack on every start. Run after `tsc` (see `npm run build`).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundleWorkflowCode } from '@temporalio/worker';

async function main(): Promise<void> {
  const { code } = await bundleWorkflowCode({ workflowsPath: require.resolve('../temporal/workflows') });
  const outFile = path.join(__dirname, '../workflow-bundle.js');
  await writeFile(outFile, code);
  console.log(`Workflow bundle written to ${outFile} (${Math.round(code.length / 1024)} KiB)`);
}

main().catch((err) => {
  console.error('Failed to bundle workflows', err);
  process.exit(1);
});
