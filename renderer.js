// renderer.js
const { globby } = require('globby');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const crypto = require('crypto');
let pLimit;

const execAsync = util.promisify(exec);

const metadataBlockRegex = /---([\s\S]*?)---/;
const idRegex = /id:\s*(.*)/;
const prerenderRegex = /prerender:\s*false/;
const draftRegex = /draft:\s*true/;

function createHash(str) {
  return crypto.createHash('md5').update(str).digest('hex').substring(0, 10);
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
    defaultLocale,
    outputFormat,
    concurrency,
    mmdcArgs,
    tempDir,
    themeName,
    outputSuffix,
  } = options;

  log(`Build process starting for theme: ${themeName} ('${outputSuffix}')`);

  if (!pLimit) {
    pLimit = (await import('p-limit')).default;
  }
  const limit = pLimit(concurrency);
  log(`Starting build with concurrency: ${concurrency}`);

  await fs.mkdir(outputDir, { recursive: true });

  const themeConfigFile = themeConfigPath ? `-c "${themeConfigPath}"` : '';
  if (themeConfigPath) {
    log(`Using base config from ${themeConfigPath}`);
  }

  const themeNameConfig = `-t ${themeName}`;

  const globPatterns = contentPaths.flatMap((p) => [
    path.join(p, '**/*.md'),
    path.join(p, '**/*.mdx'),
    path.join('i18n', '**', p, '**/*.md'),
    path.join('i18n', '**', p, '**/*.mdx'),
  ]);

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

    for (const block of mermaidBlocks) {
      const metadataBlockMatch = block.match(metadataBlockRegex);
      const metadataContent = metadataBlockMatch ? metadataBlockMatch[1] : '';

      if (metadataContent.match(prerenderRegex)) {
        log(`... Skipping block with 'prerender: false'`);
        continue;
      }

      const idMatch = metadataContent.match(idRegex);
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

      const filename = `${id}-${locale}${outputSuffix}.${outputFormat}`;
      const outputPath = path.join(outputDir, filename);

      log(
        `... Queuing task for ID ${id} (locale: ${locale}, theme: ${themeName})`
      );

      diagramTasks.push({
        id,
        locale,
        filename,
        mermaidCode,
        outputPath,
      });
    }
  }

  log(
    `Found ${diagramTasks.length} total diagram tasks for theme '${themeName}'.`
  );
  const uniqueTasks = Array.from(
    new Map(diagramTasks.map((t) => [t.filename, t])).values()
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
        try {
          await fs.access(task.outputPath);
          success(`Skipping cached: ${task.filename}`);
          skippedCount++;
          return;
        } catch (e) {
          log(`Temp file not found, creating: ${tempInputFile}`);
        }

        await fs.writeFile(tempInputFile, task.mermaidCode);

        try {
          log(`Rendering new: ${task.filename}`);
          await execAsync(
            `npx mmdc -i "${tempInputFile}" -o "${task.outputPath}" ${themeConfigFile} ${themeNameConfig} ${mmdcArgs.join(
              ' '
            )}`
          );
          success(`Finished rendering: ${task.filename}`);
          renderedCount++;
        } catch (err) {
          error(`Failed to render ${task.filename}`, err);
          if (err.stdout) console.error(err.stdout);
          if (err.stderr) console.error(err.stderr);
        } finally {
          try {
            await fs.unlink(tempInputFile);
          } catch (unlinkErr) {
            error(`Failed to delete temp file: ${tempInputFile}`, unlinkErr);
          }
        }
      })
    );
  }

  await Promise.all(renderPromises);

  success(`--- Mermaid Theme Build Finished ('${themeName}') ---`);
  success(`Rendered: ${renderedCount} new`);
  success(`Skipped:  ${skippedCount} cached`);
  log('------------------------------------');
}

module.exports = { renderAllMermaidDiagrams };
