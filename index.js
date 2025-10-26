const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const crypto = require('crypto');
const { renderAllMermaidDiagrams } = require('./renderer');
const { globalStore } = require('./store');

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
  };
  const mergedOptions = { ...defaults, ...options };

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
  globalStore.set({
    publicDir,
    defaultLocale: i18n.defaultLocale,
    outputFormat: mergedOptions.outputFormat,
    outputSuffixes: mergedOptions.outputSuffixes,
    renderDualThemes: !disableSwitch,
    defaultThemeSuffix: defaultThemeSuffix,
  });

  return {
    name: 'docusaurus-plugin-mermaid-static',

    getClientModules() {
      // Only inject the theme-switching CSS if the switch is enabled
      if (disableSwitch) {
        return [];
      }
      return [path.join(__dirname, 'mermaid-styles.css')];
    },

    async loadContent() {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          '[Mermaid-Static] Development mode detected, skipping diagram rendering.'
        );
        return;
      }

      // Don't run if we've already rendered for another locale
      if (process.env.MERMAID_STATIC_RENDERED === 'true') {
        console.log(
          '[Mermaid-Static] Diagrams for all locales already rendered, skipping.'
        );
        return;
      }

      // ### 6. Resolve Configs for Renderer ###
      const absoluteOutputDir = path.join(
        siteDir,
        'static',
        mergedOptions.outputDir
      );
      const absoluteConfigFile = path.join(siteDir, mergedOptions.configFile);

      let themeConfigPath = null;
      let didCreateTempConfig = false;
      const mmdcConfigObject = siteConfig.themeConfig?.mermaid?.config;

      try {
        await fs.access(absoluteConfigFile);
        themeConfigPath = absoluteConfigFile;
      } catch (e) {
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
            didCreateTempConfig = true;
          } catch (err) {
            console.error(
              '[Mermaid-Static] Failed to write temporary mermaid config.',
              err
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
        defaultLocale: i18n.defaultLocale,
        locales: i18n.locales,
        outputFormat: mergedOptions.outputFormat,
        concurrency: mergedOptions.concurrency,
        mmdcArgs: mergedOptions.mmdcArgs,
        tempDir: pluginTempDir,
      };

      try {
        // ### 8. RUN RENDERER (Once or Twice) ###
        for (const theme of themesToRender) {
          console.log(
            `[Mermaid-Static] Rendering theme ('${theme.themeName}')...`
          );
          await renderAllMermaidDiagrams({
            ...commonRenderOptions,
            themeName: theme.themeName,
            outputSuffix: theme.outputSuffix,
          });
        }
        // ### END RUN ###
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

      // Set env var to avoid re-rendering in other locales
      process.env.MERMAID_STATIC_RENDERED = 'true';
    },
  };
};
