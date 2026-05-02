const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const crypto = require('crypto');
const { renderAllMermaidDiagrams } = require('./renderer');
const { globalStore } = require('./store');

const activeRenderPromises = new Map();

function createHash(str) {
  return crypto.createHash('md5').update(str).digest('hex').substring(0, 10);
}

function getWatchPatterns(siteDir, contentPaths, configFile) {
  const contentWatchPatterns = contentPaths.flatMap((contentPath) => [
    path.join(siteDir, contentPath, '**/*.md'),
    path.join(siteDir, contentPath, '**/*.mdx'),
  ]);

  const localizedWatchPatterns = [
    path.join(siteDir, 'i18n', '*', 'docusaurus-plugin-content-*', '**/*.md'),
    path.join(siteDir, 'i18n', '*', 'docusaurus-plugin-content-*', '**/*.mdx'),
  ];

  const configWatchPatterns = configFile
    ? [path.join(siteDir, configFile)]
    : [];

  return [
    ...contentWatchPatterns,
    ...localizedWatchPatterns,
    ...configWatchPatterns,
  ];
}

async function withSingleRender(renderKey, renderFn) {
  if (activeRenderPromises.has(renderKey)) {
    return activeRenderPromises.get(renderKey);
  }

  const renderPromise = (async () => {
    try {
      await renderFn();
    } finally {
      activeRenderPromises.delete(renderKey);
    }
  })();

  activeRenderPromises.set(renderKey, renderPromise);
  return renderPromise;
}

module.exports = async function (context, options) {
  const { siteDir, siteConfig, i18n } = context;

  // ### 1. Define the Temp Directory ###
  const pluginTempDir = path.join(
    os.tmpdir(),
    'docusaurus-plugin-mermaid-static'
  );
  await fs.mkdir(pluginTempDir, { recursive: true });

  // ### 2. Set Defaults & Merge Options ###
  const defaults = {
    contentPaths: ['docs', 'blog'],
    outputDir: 'img/diagrams',
    configFile: 'mermaid.config.json',
    outputFormat: 'svg',
    concurrency: os.cpus().length || 4,
    mmdcArgs: ['-b', 'transparent'],
    outputSuffixes: {
      light: '-light',
      dark: '-dark',
    },
    renderInDevelopment: true,
  };
  const mergedOptions = { ...defaults, ...options };
  const shouldRenderDiagrams =
    process.env.NODE_ENV === 'production' ||
    mergedOptions.renderInDevelopment !== false;

  // ### 3. Get Docusaurus Theme Config ###
  const colorModeConfig = siteConfig.themeConfig.colorMode || {};
  const disableSwitch = colorModeConfig.disableSwitch === true;
  const defaultMode = colorModeConfig.defaultMode || 'light';

  const mermaidThemeConfig = siteConfig.themeConfig?.mermaid?.theme || {};
  const lightTheme = mermaidThemeConfig.light || 'neutral';
  const darkTheme = mermaidThemeConfig.dark || 'dark';

  // ### 4. Determine Themes to Render ###
  const themesToRender = [];
  let defaultThemeSuffix = null; // For remark.js

  if (disableSwitch) {
    // Only render the default theme
    const isDefaultDark = defaultMode === 'dark';
    defaultThemeSuffix = isDefaultDark
      ? mergedOptions.outputSuffixes.dark
      : mergedOptions.outputSuffixes.light;

    themesToRender.push({
      themeName: isDefaultDark ? darkTheme : lightTheme,
      outputSuffix: defaultThemeSuffix,
    });
  } else {
    // Render both themes
    themesToRender.push({
      themeName: lightTheme,
      outputSuffix: mergedOptions.outputSuffixes.light,
    });
    themesToRender.push({
      themeName: darkTheme,
      outputSuffix: mergedOptions.outputSuffixes.dark,
    });
  }

  // ### 5. Resolve Config for Remark ###
  const publicDir = path.join(siteConfig.baseUrl, mergedOptions.outputDir);
  const baseRenderVersionSalt = createHash(
    JSON.stringify({
      outputFormat: mergedOptions.outputFormat,
      outputSuffixes: mergedOptions.outputSuffixes,
      defaultThemeSuffix,
      disableSwitch,
      lightTheme,
      darkTheme,
      mmdcArgs: mergedOptions.mmdcArgs,
      configFile: mergedOptions.configFile,
    })
  );
  const renderKey = `${siteDir}:${mergedOptions.outputDir}`;
  const renderStampPath = path.join(
    siteDir,
    '.docusaurus',
    'docusaurus-plugin-mermaid-static',
    `render-version-${createHash(mergedOptions.outputDir)}.txt`
  );

  async function readRenderVersionSalt() {
    try {
      const renderStamp = (await fs.readFile(renderStampPath, 'utf8')).trim();
      return createHash(`${baseRenderVersionSalt}:${renderStamp}`);
    } catch (error) {
      return baseRenderVersionSalt;
    }
  }

  async function writeRenderVersionSalt() {
    const nextRenderStamp = createHash(
      JSON.stringify({
        renderKey,
        renderedAt: Date.now(),
      })
    );

    await fs.mkdir(path.dirname(renderStampPath), { recursive: true });
    await fs.writeFile(renderStampPath, `${nextRenderStamp}\n`);

    return createHash(`${baseRenderVersionSalt}:${nextRenderStamp}`);
  }

  const renderVersionSalt = await readRenderVersionSalt();
  globalStore.set({
    siteDir,
    publicDir,
    defaultLocale: i18n.defaultLocale,
    outputFormat: mergedOptions.outputFormat,
    outputSuffixes: mergedOptions.outputSuffixes,
    renderDualThemes: !disableSwitch,
    defaultThemeSuffix: defaultThemeSuffix,
    useRenderedDiagrams: shouldRenderDiagrams,
    renderVersionSalt,
  });

  const cacheFilePath = path.join(
    siteDir,
    '.docusaurus',
    'docusaurus-plugin-mermaid-static',
    `cache-${createHash(mergedOptions.outputDir)}.json`
  );

  return {
    name: 'docusaurus-plugin-mermaid-static',

    getPathsToWatch() {
      if (!shouldRenderDiagrams) {
        return [];
      }

      return [
        ...getWatchPatterns(
          siteDir,
          mergedOptions.contentPaths,
          mergedOptions.configFile
        ),
        renderStampPath,
      ];
    },

    getClientModules() {
      const clientModules = [];

      if (process.env.NODE_ENV !== 'production' && shouldRenderDiagrams) {
        clientModules.push(path.join(__dirname, 'dev-image-retry.js'));
      }

      // Only inject the theme-switching CSS if the switch is enabled
      if (!disableSwitch) {
        clientModules.push(path.join(__dirname, 'mermaid-styles.css'));
      }

      return clientModules;
    },

    async loadContent() {
      if (!shouldRenderDiagrams) {
        console.log(
          '[Mermaid-Static] Development mode detected with renderInDevelopment disabled, skipping diagram rendering.'
        );
        return;
      }

      globalStore.set({
        renderVersionSalt: await readRenderVersionSalt(),
      });

      // Don't run if we've already rendered for another locale
      if (
        process.env.NODE_ENV === 'production' &&
        process.env.MERMAID_STATIC_RENDERED === 'true'
      ) {
        console.log(
          '[Mermaid-Static] Diagrams for all locales already rendered, skipping.'
        );
        return;
      }

      await withSingleRender(renderKey, async () => {
        // ### 6. Resolve Configs for Renderer ###
        const absoluteOutputDir = path.join(
          siteDir,
          'static',
          mergedOptions.outputDir
        );
        const absoluteConfigFile = path.join(siteDir, mergedOptions.configFile);

        let themeConfigPath = null;
        let themeConfigHash = 'default';
        let didCreateTempConfig = false;
        const mmdcConfigObject = siteConfig.themeConfig?.mermaid?.config;

        try {
          await fs.access(absoluteConfigFile);
          const configContents = await fs.readFile(absoluteConfigFile, 'utf8');
          themeConfigPath = absoluteConfigFile;
          themeConfigHash = crypto
            .createHash('md5')
            .update(configContents)
            .digest('hex');
        } catch (err) {
          if (mmdcConfigObject && typeof mmdcConfigObject === 'object') {
            try {
              const configJson = JSON.stringify(mmdcConfigObject);
              const hash = crypto
                .createHash('md5')
                .update(configJson)
                .digest('hex');
              const tempPath = path.join(
                pluginTempDir,
                `mermaid-temp-config-${hash}.json`
              );
              await fs.writeFile(tempPath, configJson);
              themeConfigPath = tempPath;
              themeConfigHash = hash;
              didCreateTempConfig = true;
            } catch (writeErr) {
              console.error(
                '[Mermaid-Static] Failed to write temporary mermaid config.',
                writeErr
              );
            }
          }
        }

        // ### 7. Define Common Options for Renderer ###
        const commonRenderOptions = {
          siteDir,
          contentPaths: mergedOptions.contentPaths,
          outputDir: absoluteOutputDir,
          themeConfigPath,
          themeConfigHash,
          cacheFilePath,
          defaultLocale: i18n.defaultLocale,
          locales: i18n.locales,
          outputFormat: mergedOptions.outputFormat,
          concurrency: mergedOptions.concurrency,
          mmdcArgs: mergedOptions.mmdcArgs,
          tempDir: pluginTempDir,
        };

        try {
          // ### 8. RUN RENDERER (Once or Twice) ###
          let totalRendered = 0;
          for (const theme of themesToRender) {
            console.log(
              `[Mermaid-Static] Rendering theme ('${theme.themeName}')...`
            );
            const renderResult = await renderAllMermaidDiagrams({
              ...commonRenderOptions,
              themeName: theme.themeName,
              outputSuffix: theme.outputSuffix,
            });
            totalRendered += renderResult.renderedCount;
          }
          // ### END RUN ###

          if (process.env.NODE_ENV !== 'production' && totalRendered > 0) {
            globalStore.set({
              renderVersionSalt: await writeRenderVersionSalt(),
            });
          }
        } finally {
          if (didCreateTempConfig && themeConfigPath) {
            try {
              await fs.unlink(themeConfigPath);
            } catch (unlinkErr) {
              console.warn(
                `[Mermaid-Static] Failed to delete temp config file: ${themeConfigPath}`,
                unlinkErr
              );
            }
          }
        }

        if (process.env.NODE_ENV === 'production') {
          process.env.MERMAID_STATIC_RENDERED = 'true';
        }
      });
    },
  };
};
