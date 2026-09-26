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
test('renders draft docs in development and skips them in production', async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'docusaurus-prerender-mermaid-')
  );
  const previousEnv = process.env.NODE_ENV;

  t.after(async () => {
    process.env.NODE_ENV = previousEnv;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const siteDir = tempRoot;
  const docsDir = path.join(siteDir, 'docs');
  const outputDir = path.join(siteDir, 'static', 'img', 'diagrams');
  const tempDir = path.join(siteDir, '.tmp');
  const renderCalls = [];

  await fs.mkdir(docsDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  await fs.writeFile(
    path.join(docsDir, 'draft.mdx'),
    [
      '---',
      'draft: true',
      '---',
      '',
      '```mermaid',
      '---',
      'id: draft-diagram',
      '---',
      'graph TD',
      '  A[Draft] --> B[Diagram]',
      '```',
      '',
    ].join('\n')
  );

  const options = (name) => ({
    siteDir,
    contentPaths: ['docs'],
    outputDir,
    themeConfigPath: null,
    themeConfigHash: 'default',
    cacheFilePath: path.join(siteDir, '.docusaurus', `cache-${name}.json`),
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

  process.env.NODE_ENV = 'production';
  await renderAllMermaidDiagrams(options('production'));
  assert.equal(renderCalls.length, 0);

  process.env.NODE_ENV = 'development';
  await renderAllMermaidDiagrams(options('development'));
  assert.equal(renderCalls.length, 1);
  assert.match(renderCalls[0], /^draft-diagram-/);
});

test('ignores mermaid examples nested in other code blocks, like remark', async (t) => {
  const { extractMermaidBlocks } = require('../renderer');
  const { getDiagramFilename } = require('../diagram-utils');
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
  const renderCalls = [];

  await fs.mkdir(docsDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  const docPath = path.join(docsDir, 'plugin-docs.mdx');
  const content = [
    '# Usage',
    '',
    '````markdown title="Example"',
    '```mermaid',
    '---',
    'id: example-only',
    '---',
    'graph TD',
    '  A[Example] --> B[Only]',
    '```',
    '````',
    '',
    '1. A list item:',
    '',
    '    ```mermaid',
    '    ---',
    '    id: first-real',
    '    ---',
    '    graph TD',
    '      A[First] --> B[Real]',
    '    ```',
    '',
    '~~~mermaid',
    '---',
    'id: second-real',
    '---',
    'graph TD',
    '  A[Second] --> B[Real]',
    '~~~',
    '',
  ].join('\n');
  await fs.writeFile(docPath, content);

  const blocks = extractMermaidBlocks(content);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /^---\nid: first-real\n---\ngraph TD\n {2}A\[First\]/);
  assert.match(blocks[1], /id: second-real/);

  await renderAllMermaidDiagrams({
    siteDir,
    contentPaths: ['docs'],
    outputDir,
    themeConfigPath: null,
    themeConfigHash: 'default',
    cacheFilePath: path.join(siteDir, '.docusaurus', 'cache-nested.json'),
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

  // The remark plugin numbers only real diagrams: first-real is 0,
  // second-real is 1. The renderer must produce exactly those files.
  const expected = ['first-real', 'second-real'].map((id, diagramIndex) =>
    getDiagramFilename({
      id,
      mermaidCode: '',
      hasExplicitId: true,
      siteDir,
      filePath: docPath,
      diagramIndex,
      locale: 'en',
      outputSuffix: '-light',
      outputFormat: 'svg',
    })
  );
  assert.deepEqual([...renderCalls].sort(), [...expected].sort());
});
