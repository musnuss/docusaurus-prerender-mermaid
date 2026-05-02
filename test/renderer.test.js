const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { renderAllMermaidDiagrams } = require('../renderer');

test('re-renders cached diagrams when mermaid code changes for a stable id', async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'docusaurus-prerender-mermaid-')
  );

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const siteDir = tempRoot;
  const docsDir = path.join(siteDir, 'docs');
  const outputDir = path.join(siteDir, 'static', 'img', 'diagrams');
  const tempDir = path.join(siteDir, '.tmp');
  const cacheFilePath = path.join(
    siteDir,
    '.docusaurus',
    'docusaurus-plugin-mermaid-static',
    'cache-test.json'
  );
  const renderCalls = [];

  await fs.mkdir(docsDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  const docPath = path.join(docsDir, 'cache-check.mdx');
  const writeDoc = (label) =>
    fs.writeFile(
      docPath,
      [
        '# Cache Check',
        '',
        '```mermaid',
        '---',
        'id: stable-id',
        '---',
        'graph TD',
        `  A[${label}] --> B[Done]`,
        '```',
        '',
      ].join('\n')
    );

  const baseOptions = {
    siteDir,
    contentPaths: ['docs'],
    outputDir,
    themeConfigPath: null,
    themeConfigHash: 'default',
    cacheFilePath,
    defaultLocale: 'en',
    outputFormat: 'svg',
    concurrency: 1,
    mmdcArgs: ['-b', 'transparent'],
    tempDir,
    themeName: 'neutral',
    outputSuffix: '-light',
    renderDiagram: async (task) => {
      renderCalls.push(task.filename);
      await fs.writeFile(task.outputPath, task.mermaidCode);
    },
  };

  await writeDoc('Initial');
  await renderAllMermaidDiagrams(baseOptions);
  assert.equal(renderCalls.length, 1);
  const outputFiles = await fs.readdir(outputDir);
  assert.equal(outputFiles.length, 1);
  assert.match(outputFiles[0], /^stable-id-[a-f0-9]{10}-en-light\.svg$/);
  const outputFile = path.join(outputDir, outputFiles[0]);
  assert.match(await fs.readFile(outputFile, 'utf8'), /Initial/);

  await renderAllMermaidDiagrams(baseOptions);
  assert.equal(renderCalls.length, 1);

  await writeDoc('Updated');
  await renderAllMermaidDiagrams(baseOptions);
  assert.equal(renderCalls.length, 2);
  assert.match(await fs.readFile(outputFile, 'utf8'), /Updated/);
});

test('renders separate assets when explicit ids are reused across files', async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'docusaurus-prerender-mermaid-')
  );

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const siteDir = tempRoot;
  const docsDir = path.join(siteDir, 'docs');
  const nestedDocsDir = path.join(siteDir, 'docs', 'nested');
  const outputDir = path.join(siteDir, 'static', 'img', 'diagrams');
  const tempDir = path.join(siteDir, '.tmp');
  const renderCalls = [];

  await fs.mkdir(docsDir, { recursive: true });
  await fs.mkdir(nestedDocsDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  await fs.writeFile(
    path.join(docsDir, 'first.mdx'),
    [
      '```mermaid',
      '---',
      'id: shared-id',
      '---',
      'graph TD',
      '  A[First] --> B[Diagram]',
      '```',
      '',
    ].join('\n')
  );

  await fs.writeFile(
    path.join(nestedDocsDir, 'second.mdx'),
    [
      '```mermaid',
      '---',
      'id: shared-id',
      '---',
      'graph TD',
      '  A[Second] --> B[Diagram]',
      '```',
      '',
    ].join('\n')
  );

  await renderAllMermaidDiagrams({
    siteDir,
    contentPaths: ['docs'],
    outputDir,
    themeConfigPath: null,
    themeConfigHash: 'default',
    cacheFilePath: null,
    defaultLocale: 'en',
    outputFormat: 'svg',
    concurrency: 1,
    mmdcArgs: ['-b', 'transparent'],
    tempDir,
    themeName: 'neutral',
    outputSuffix: '-light',
    renderDiagram: async (task) => {
      renderCalls.push(task.filename);
      await fs.writeFile(task.outputPath, task.mermaidCode);
    },
  });

  const outputFiles = (await fs.readdir(outputDir)).sort();
  assert.equal(outputFiles.length, 2);
  assert.notEqual(outputFiles[0], outputFiles[1]);
  assert.match(outputFiles[0], /^shared-id-[a-f0-9]{10}-en-light\.svg$/);
  assert.match(outputFiles[1], /^shared-id-[a-f0-9]{10}-en-light\.svg$/);
  assert.equal(renderCalls.length, 2);
});