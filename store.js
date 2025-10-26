// store.js

const globalStore = {
  options: {
    // Sensible fallbacks
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
    // --- END ADD ---
  },
  /**
   * @param {object} options
   * @param {string} options.publicDir
   * @param {string} options.defaultLocale
   * @param {string} options.outputFormat
   * @param {object} options.outputSuffixes
   * @param {boolean} options.renderDualThemes
   * @param {string | null} options.defaultThemeSuffix
   */
  set(options) {
    this.options = { ...this.options, ...options };
  },
  get() {
    return this.options;
  },
};

module.exports = { globalStore };
