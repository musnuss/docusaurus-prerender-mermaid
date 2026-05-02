const test = require('node:test');
const assert = require('node:assert/strict');

const remarkMermaidStatic = require('../remark');
const { globalStore } = require('../store');

test('renders static image nodes in development when enabled', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  try {
    globalStore.set({
      siteDir: '/tmp/site',
      publicDir: '/img/diagrams',
      defaultLocale: 'en',
      outputFormat: 'svg',
      outputSuffixes: {
        light: '-light',
        dark: '-dark',
      },
      renderDualThemes: true,
      defaultThemeSuffix: null,
      useRenderedDiagrams: true,
      renderVersionSalt: 'test-salt',
    });

    const tree = {
      type: 'root',
      children: [
        {
          type: 'code',
          lang: 'mermaid',
          value:
            '---\nid: dev-preview\nalt: Development preview\n---\ngraph TD\n  A[Start] --> B[Finish]',
        },
      ],
    };

    const file = { path: '/tmp/site/docs/preview.mdx' };
    const transform = remarkMermaidStatic();

    transform(tree, file);

    const figureNode = tree.children[0];
    assert.equal(figureNode.name, 'figure');

    const imageNodes = figureNode.children.filter(
      (child) => child.name === 'img'
    );
    assert.equal(imageNodes.length, 2);
    assert.match(
      imageNodes[0].attributes.find((attribute) => attribute.name === 'src')
        .value,
      /^\/img\/diagrams\/dev-preview-[a-f0-9]{10}-en-light\.svg\?v=[a-f0-9]{10}$/
    );
    assert.match(
      imageNodes[0].attributes.find((attribute) => attribute.name === 'key')
        .value,
      /^mermaid-light-[a-f0-9]{10}$/
    );
    assert.match(
      imageNodes[1].attributes.find((attribute) => attribute.name === 'src')
        .value,
      /^\/img\/diagrams\/dev-preview-[a-f0-9]{10}-en-dark\.svg\?v=[a-f0-9]{10}$/
    );
    assert.match(
      imageNodes[1].attributes.find((attribute) => attribute.name === 'key')
        .value,
      /^mermaid-dark-[a-f0-9]{10}$/
    );
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});