// store.js

const globalStore = {
  options: {
    // Sensible fallbacks
    siteDir: '',
    publicDir: '/img/diagrams',
    defaultLocale: 'en',
    outputFormat: 'svg',
    outputSuffixes: {
      light: '-light',
      dark: '-dark',
    },
    // --- ADD THIS ---
    renderDualThemes: true, // Default to dual themes
    defaultThemeSuffix: null, // Suffix for single-theme mode
    useRenderedDiagrams: false,
    renderVersionSalt: '',
    // --- END ADD ---
  },
  /**
   * @param {object} options
    * @param {string} options.siteDir
   * @param {string} options.publicDir
   * @param {string} options.defaultLocale
   * @param {string} options.outputFormat
   * @param {object} options.outputSuffixes
   * @param {boolean} options.renderDualThemes
   * @param {string | null} options.defaultThemeSuffix
   * @param {boolean} options.useRenderedDiagrams
   * @param {string} options.renderVersionSalt
   */
  set(options) {
    this.options = { ...this.options, ...options };
  },
  get() {
    return this.options;
  },
};

module.exports = { globalStore };
