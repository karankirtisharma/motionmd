/**
 * Run the production kit's own tests, three ways:
 *
 *   node tools/run-kit-tests.mjs --kit <path-to-extracted-kit> [--out docs/evidence/kit-tests.json]
 *
 *   supplied   the kit's test command, on the kit's files as supplied
 *   adapter    the kit's controller and integration tests with this project's
 *              production adapter (src/host/connect.mjs) in place of the example
 *   copies     the kit's scene-adapter tests against the copy shipped in src/kit
 *
 * The kit's test files are executed unmodified. For the second and third runs
 * they are copied to a temporary folder next to one-line modules that re-export
 * this project's sources under the names the tests import.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const kit = option('kit', process.env.LM_KIT);
if (!kit) {
  console.error('usage: node tools/run-kit-tests.mjs --kit <path-to-extracted-kit>');
  process.exit(1);
}
const kitRoot = resolve(kit);
const out = resolve(root, option('out', 'docs/evidence/kit-tests.json'));

function run(label, files, cwd) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd, encoding: 'utf8' });
  const count = (name) => Number((new RegExp(`^# ${name} (\\d+)`, 'm').exec(result.stdout) ?? [])[1] ?? NaN);
  const summary = { run: label, files: files.map((file) => file.replace(`${kitRoot}/`, '<kit>/')), tests: count('tests'), pass: count('pass'), fail: count('fail'), exitCode: result.status };
  console.log(`${label.padEnd(9)} tests ${summary.tests}  pass ${summary.pass}  fail ${summary.fail}`);
  if (result.status !== 0) console.log(result.stdout.split('\n').filter((line) => /^not ok|^# Subtest/.test(line)).slice(0, 20).join('\n'));
  return summary;
}

const reExport = (target) => `export * from ${JSON.stringify(pathToFileURL(target).href)};\n`;
const temp = mkdtempSync(join(tmpdir(), 'lm-kit-tests-'));
const results = [];
try {
  // 1. As supplied (the kit's documented test command), run from this project.
  results.push(run('supplied', [
    join(kitRoot, '01_ui_package/components/loader-controller.test.mjs'),
    join(kitRoot, '05_components/maquette-scene-adapter.test.mjs'),
  ], root));

  // 2. Controller and integration tests against the production adapter.
  const components = join(temp, 'components');
  mkdirSync(components, { recursive: true });
  cpSync(join(kitRoot, '01_ui_package/components/loader-controller.test.mjs'), join(components, 'loader-controller.test.mjs'));
  writeFileSync(join(components, 'loader-controller.mjs'), reExport(join(root, 'src/kit/loader-controller.mjs')));
  writeFileSync(join(components, 'loader-integration-example.mjs'), reExport(join(root, 'src/host/connect.mjs')));
  results.push(run('adapter', [join(components, 'loader-controller.test.mjs')], root));

  // 3. Scene-adapter tests against the shipped copy, with the kit's models.
  const adapter = join(temp, '05_components');
  mkdirSync(adapter, { recursive: true });
  cpSync(join(kitRoot, '05_components/maquette-scene-adapter.test.mjs'), join(adapter, 'maquette-scene-adapter.test.mjs'));
  writeFileSync(join(adapter, 'maquette-scene-adapter.mjs'), reExport(join(root, 'src/kit/maquette-scene-adapter.mjs')));
  symlinkSync(join(kitRoot, '03_models'), join(temp, '03_models'), 'dir');
  results.push(run('copies', [join(adapter, 'maquette-scene-adapter.test.mjs')], root));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ node: process.version, ran: new Date().toISOString(), results }, null, 2)}\n`);
process.exitCode = results.every((result) => result.exitCode === 0) ? 0 : 1;
