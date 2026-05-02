// renderer.js
const { globby } = require('globby');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const crypto = require('crypto');
const { createHash, getDiagramFilename } = require('./diagram-utils');
let pLimit;

const execAsync = util.promisify(exec);

const metadataBlockRegex = /---([\s\S]*?)---/;
const idRegex = /id:\s*(.*)/;
const prerenderRegex = /prerender:\s*false/;
const draftRegex = /draft:\s*true/;
const cacheVersion = 1;

function createRenderSignature(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function readCacheIndex(cacheFilePath) {
  if (!cacheFilePath) {
    return {};
  }

  try {
    const raw = await fs.readFile(cacheFilePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed.version !== cacheVersion || typeof parsed.tasks !== 'object') {
      return {};
    }

    return parsed.tasks;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      error(`Failed to read cache file: ${cacheFilePath}`, err);
    }

    return {};
  }
}

async function writeCacheIndex(cacheFilePath, cacheIndex) {
  if (!cacheFilePath) {
    return;
  }

  await fs.mkdir(path.dirname(cacheFilePath), { recursive: true });
  await fs.writeFile(
    cacheFilePath,
    JSON.stringify({ version: cacheVersion, tasks: cacheIndex }, null, 2)
  );
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    return false;
  }
}

// --- Logging helpers ---
function log(message) {
  console.log(`[Mermaid-Static] ${message}`);
}
function success(message) {
  console.log(`\x1b[32m[Mermaid-Static] ${message}\x1b[0m`);
}
function error(message, err) {
  // prettier-ignore
  console.error(`\x1b[31m[Mermaid-Static] ERROR: ${message}\x1b[0m`, err ? (err.message || err) : '');
}
// ---

async function renderAllMermaidDiagrams(options) {
  const {
    siteDir,
    contentPaths,
    outputDir,
    themeConfigPath,
    themeConfigHash,
    cacheFilePath,
    defaultLocale,
    outputFormat,
    concurrency,
    mmdcArgs,
    tempDir,
    themeName,
    outputSuffix,
    renderDiagram,
  } = options;

  log(`Build process starting for theme: ${themeName} ('${outputSuffix}')`);

  if (!pLimit) {
    pLimit = (await import('p-limit')).default;
  }
  const limit = pLimit(concurrency);
  log(`Starting build with concurrency: ${concurrency}`);

  await fs.mkdir(outputDir, { recursive: true });
  const cacheIndex = await readCacheIndex(cacheFilePath);
  let cacheIndexChanged = false;

  const themeConfigFile = themeConfigPath ? `-c "${themeConfigPath}"` : '';
  if (themeConfigPath) {
    log(`Using base config from ${themeConfigPath}`);
  }

  const themeNameConfig = `-t ${themeName}`;

  const globPatterns = [
    // original sources
    ...contentPaths.flatMap((contentPath) => [
      path.join(contentPath, '**/*.md'),
      path.join(contentPath, '**/*.mdx'),
    ]),
    // localized plugin content
    path.join('i18n', '*', 'docusaurus-plugin-content-*', '**/*.md'),
    path.join('i18n', '*', 'docusaurus-plugin-content-*', '**/*.mdx'),
  ];

  log(`Globbing patterns: \n- ${globPatterns.join('\n- ')}`);

  const docFiles = await globby(globPatterns, { cwd: siteDir, absolute: true });
  log(`Found ${docFiles.length} content files to scan.`);

  const diagramTasks = [];

  for (const file of docFiles) {
    const content = await fs.readFile(file, 'utf8');

    if (content.match(draftRegex)) {
      log(`Skipping draft file: ${file}`);
      continue;
    }

    const relativePath = path.relative(siteDir, file);
    const localeMatch = relativePath.match(/i18n\/([^\/]+)\//);
    const locale = localeMatch ? localeMatch[1] : defaultLocale;

    const mermaidBlocks = content.match(/```mermaid([\s\S]*?)```/g) || [];
    if (mermaidBlocks.length > 0) {
      log(`Found ${mermaidBlocks.length} mermaid blocks in: ${relativePath}`);
    }

    for (const [mermaidBlockIndex, block] of mermaidBlocks.entries()) {
      const metadataBlockMatch = block.match(metadataBlockRegex);
      const metadataContent = metadataBlockMatch ? metadataBlockMatch[1] : '';

      if (metadataContent.match(prerenderRegex)) {
        log(`... Skipping block with 'prerender: false'`);
        continue;
      }

      const idMatch = metadataContent.match(idRegex);
      const hasExplicitId = Boolean(idMatch && idMatch[1]);
      const mermaidCode = block
        .replace(/```mermaid|```/g, '')
        .replace(metadataBlockRegex, '')
        .trim();

      let id;
      if (idMatch && idMatch[1]) {
        id = idMatch[1].trim();
      } else {
        id = createHash(mermaidCode);
      }

      const filename = getDiagramFilename({
        id,
        mermaidCode,
        hasExplicitId,
        siteDir,
        filePath: file,
        diagramIndex: mermaidBlockIndex,
        locale,
        outputSuffix,
        outputFormat,
      });
      const outputPath = path.join(outputDir, filename);
      const renderSignature = createRenderSignature(
        JSON.stringify({
          filename,
          mermaidCode,
          outputFormat,
          outputSuffix,
          themeName,
          themeConfigHash: themeConfigHash || 'default',
          mmdcArgs,
        })
      );

      log(
        `... Queuing task for ID ${id} (locale: ${locale}, theme: ${themeName})`
      );

      diagramTasks.push({
        id,
        locale,
        filename,
        mermaidCode,
        outputPath,
        renderSignature,
      });
    }
  }

  log(
    `Found ${diagramTasks.length} total diagram tasks for theme '${themeName}'.`
  );
  const uniqueTasks = Array.from(
    new Map(diagramTasks.map((task) => [task.filename, task])).values()
  );
  log(
    `Found ${uniqueTasks.length} unique diagrams to render for theme '${themeName}'.`
  );

  const renderPromises = [];
  let renderedCount = 0;
  let skippedCount = 0;

  for (const task of uniqueTasks) {
    renderPromises.push(
      limit(async () => {
        const tempInputFile = path.join(tempDir, `temp_${task.filename}.mmd`);
        const hasCachedOutput = await pathExists(task.outputPath);
        let wroteTempInput = false;

        try {
          if (
            hasCachedOutput &&
            cacheIndex[task.filename] === task.renderSignature
          ) {
            success(`Skipping cached: ${task.filename}`);
            skippedCount++;
            return;
          }

          if (hasCachedOutput) {
            log(`Cache changed, re-rendering: ${task.filename}`);
          } else {
            log(`No cached output found, rendering: ${task.filename}`);
          }

          await fs.writeFile(tempInputFile, task.mermaidCode);
          wroteTempInput = true;

          log(`Rendering: ${task.filename}`);
          if (renderDiagram) {
            await renderDiagram({
              ...task,
              tempInputFile,
              themeConfigPath,
              themeName,
              outputFormat,
              outputSuffix,
              mmdcArgs,
            });
          } else {
            await execAsync(
              `npx mmdc -i "${tempInputFile}" -o "${task.outputPath}" ${themeConfigFile} ${themeNameConfig} ${mmdcArgs.join(
                ' '
              )}`
            );
          }

          cacheIndex[task.filename] = task.renderSignature;
          cacheIndexChanged = true;
          success(`Finished rendering: ${task.filename}`);
          renderedCount++;
        } catch (err) {
          if (cacheIndex[task.filename]) {
            delete cacheIndex[task.filename];
            cacheIndexChanged = true;
          }

          error(`Failed to render ${task.filename}`, err);
          if (err.stdout) console.error(err.stdout);
          if (err.stderr) console.error(err.stderr);
        } finally {
          if (wroteTempInput) {
            try {
              await fs.unlink(tempInputFile);
            } catch (unlinkErr) {
              error(`Failed to delete temp file: ${tempInputFile}`, unlinkErr);
            }
          }
        }
      })
    );
  }

  await Promise.all(renderPromises);

  if (cacheIndexChanged) {
    await writeCacheIndex(cacheFilePath, cacheIndex);
  }

  success(`--- Mermaid Theme Build Finished ('${themeName}') ---`);
  success(`Rendered: ${renderedCount} new`);
  success(`Skipped:  ${skippedCount} cached`);
  log('------------------------------------');

  return {
    renderedCount,
    skippedCount,
    totalCount: uniqueTasks.length,
  };
}

module.exports = { renderAllMermaidDiagrams };
