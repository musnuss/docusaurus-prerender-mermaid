// remark.js
const { visit } = require('unist-util-visit');
const { createHash, getDiagramFilename } = require('./diagram-utils');
const { globalStore } = require('./store');

const metadataBlockRegex = /---([\s\S]*?)---/;
const idRegex = /id:\s*(.*)/;
const altRegex = /alt:\s*(.*)/;
const captionRegex = /caption:\s*(.*)/;
const widthRegex = /width:\s*(.*)/;
const prerenderRegex = /prerender:\s*false/;
const descriptionIdRegex = /descriptionId:\s*(.*)/;

module.exports = () => {
  // ### 1. Get New Options from Store ###
  const {
    siteDir,
    publicDir,
    defaultLocale,
    outputFormat,
    outputSuffixes,
    renderDualThemes,
    defaultThemeSuffix,
    useRenderedDiagrams,
    renderVersionSalt,
  } = globalStore.get();

  function createVersionedSrc(filename, versionKey) {
    const baseSrc = `${publicDir.replace(/\/$/, '')}/${filename}`;

    if (!versionKey) {
      return baseSrc;
    }

    return `${baseSrc}?v=${versionKey}`;
  }

  return (tree, file) => {
    const tasks = [];
    let mermaidBlockIndex = 0;

    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'mermaid') {
        return;
      }

      const currentDiagramIndex = mermaidBlockIndex;
      mermaidBlockIndex += 1;

      // ### 2. Parse Metadata ###
      const value = node.value;
      const metadataBlockMatch = value.match(metadataBlockRegex);
      const metadataContent = metadataBlockMatch ? metadataBlockMatch[1] : '';

      if (metadataContent.match(prerenderRegex)) {
        node.value = value.replace(metadataBlockRegex, '').trim();
        return;
      }

      const idMatch = metadataContent.match(idRegex);
  const hasExplicitId = Boolean(idMatch && idMatch[1]);
      const altMatch = metadataContent.match(altRegex);
      const captionMatch = metadataContent.match(captionRegex);
      const descriptionIdMatch = metadataContent.match(descriptionIdRegex);
      const widthMatch = metadataContent.match(widthRegex);
      const caption =
        captionMatch && captionMatch[1] ? captionMatch[1].trim() : null;
      const mermaidCode = value.replace(metadataBlockRegex, '').trim();

      let id;
      if (idMatch && idMatch[1]) {
        id = idMatch[1].trim();
      } else {
        id = createHash(mermaidCode);
      }

      const alt =
        altMatch && altMatch[1] ? altMatch[1].trim() : 'Mermaid diagram';
      let descriptionId = null;
      if (descriptionIdMatch && descriptionIdMatch[1]) {
        descriptionId = descriptionIdMatch[1].trim();
      }
      let width = null;
      if (widthMatch && widthMatch[1]) {
        width = widthMatch[1].trim();
      }

      const figcaptionNode = caption
        ? {
            type: 'mdxJsxFlowElement',
            name: 'figcaption',
            attributes: [
              { type: 'mdxJsxAttribute', name: 'id', value: `${id}-caption` },
            ],
            children: [
              {
                type: 'text',
                value: caption,
              },
            ],
          }
        : null;

      // ### 3. Create Figure/Image Nodes ###
      let childrenNodes = [];

      if (useRenderedDiagrams) {
        const filePath = file.path;
        const localeMatch = filePath.match(/i18n\/([^\/]+)\//);
        const locale = localeMatch ? localeMatch[1] : defaultLocale;
        const versionBase = JSON.stringify({
          mermaidCode,
          renderVersionSalt,
        });

        // ### CHECK WHICH MODE TO RENDER ###
        if (renderDualThemes) {
          // ### Render BOTH Light and Dark Images ###
          const filenameLight = getDiagramFilename({
            id,
            mermaidCode,
            hasExplicitId,
            siteDir,
            filePath,
            diagramIndex: currentDiagramIndex,
            locale,
            outputSuffix: outputSuffixes.light,
            outputFormat,
          });
          const lightVersionKey = createHash(`${versionBase}:${filenameLight}`);
          const srcLight = createVersionedSrc(
            filenameLight,
            lightVersionKey
          );
          const lightImgNode = {
            type: 'mdxJsxFlowElement',
            name: 'img',
            attributes: [
              {
                type: 'mdxJsxAttribute',
                name: 'key',
                value: `mermaid-light-${lightVersionKey}`,
              },
              {
                type: 'mdxJsxAttribute',
                name: 'width',
                value: width || 'auto',
              },
              {
                type: 'mdxJsxAttribute',
                name: 'className',
                value: 'mermaid-light',
              },
              { type: 'mdxJsxAttribute', name: 'src', value: srcLight },
              { type: 'mdxJsxAttribute', name: 'alt', value: '' },
            ],
            children: [],
          };

          const filenameDark = getDiagramFilename({
            id,
            mermaidCode,
            hasExplicitId,
            siteDir,
            filePath,
            diagramIndex: currentDiagramIndex,
            locale,
            outputSuffix: outputSuffixes.dark,
            outputFormat,
          });
          const darkVersionKey = createHash(`${versionBase}:${filenameDark}`);
          const srcDark = createVersionedSrc(
            filenameDark,
            darkVersionKey
          );
          const darkImgNode = {
            type: 'mdxJsxFlowElement',
            name: 'img',
            attributes: [
              {
                type: 'mdxJsxAttribute',
                name: 'key',
                value: `mermaid-dark-${darkVersionKey}`,
              },
              {
                type: 'mdxJsxAttribute',
                name: 'width',
                value: width || 'auto',
              },
              {
                type: 'mdxJsxAttribute',
                name: 'className',
                value: 'mermaid-dark',
              },
              { type: 'mdxJsxAttribute', name: 'src', value: srcDark },
              { type: 'mdxJsxAttribute', name: 'alt', value: '' },
            ],
            children: [],
          };
          childrenNodes = [lightImgNode, darkImgNode];
        } else {
          // ### Render ONLY the Default Image ###
          const filename = getDiagramFilename({
            id,
            mermaidCode,
            hasExplicitId,
            siteDir,
            filePath,
            diagramIndex: currentDiagramIndex,
            locale,
            outputSuffix: defaultThemeSuffix,
            outputFormat,
          });
          const versionKey = createHash(`${versionBase}:${filename}`);
          const src = createVersionedSrc(
            filename,
            versionKey
          );

          const defaultImgNode = {
            type: 'mdxJsxFlowElement',
            name: 'img',
            attributes: [
              {
                type: 'mdxJsxAttribute',
                name: 'key',
                value: `mermaid-${versionKey}`,
              },
              {
                type: 'mdxJsxAttribute',
                name: 'width',
                value: width || 'auto',
              },
              // No 'className' needed
              { type: 'mdxJsxAttribute', name: 'src', value: src },
              { type: 'mdxJsxAttribute', name: 'alt', value: '' }, // Decorative
            ],
            children: [],
          };
          childrenNodes = [defaultImgNode];
        }
      } else {
        childrenNodes = [
          {
            type: 'code',
            lang: 'mermaid',
            value: mermaidCode,
          },
        ];
      }

      // ### 4. Create the Final Figure Node ###
      const figureNode = {
        type: 'mdxJsxFlowElement',
        name: 'figure',
        attributes: [
          { type: 'mdxJsxAttribute', name: 'id', value: id },
          {
            type: 'mdxJsxAttribute',
            name: 'className',
            value: 'static-mermaid-figure',
          },
          { type: 'mdxJsxAttribute', name: 'role', value: 'img' },
          { type: 'mdxJsxAttribute', name: 'aria-label', value: alt },
          caption && {
            type: 'mdxJsxAttribute',
            name: 'aria-labelledby',
            value: `${id}-caption`,
          },
          descriptionId !== null && {
            type: 'mdxJsxAttribute',
            name: 'aria-describedby',
            value: descriptionId,
          },
        ].filter(Boolean),
        children: [...childrenNodes, figcaptionNode].filter(Boolean),
      };

      tasks.push({ index, parent, newNode: figureNode });
    });

    for (const task of tasks.reverse()) {
      task.parent.children.splice(task.index, 1, task.newNode);
    }
  };
};
