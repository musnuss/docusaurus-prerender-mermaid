const path = require('path');
const crypto = require('crypto');

function createHash(str) {
  return crypto.createHash('md5').update(str).digest('hex').substring(0, 10);
}

function normalizePathForHash(filePath) {
  return filePath.split(path.sep).join('/');
}

function getDiagramAssetBaseName(options) {
  const { id, mermaidCode, hasExplicitId, siteDir, filePath, diagramIndex } =
    options;
  const resolvedId = id || createHash(mermaidCode);

  if (!hasExplicitId) {
    return resolvedId;
  }

  const relativeFilePath = siteDir ? path.relative(siteDir, filePath) : filePath;
  const sourceLocation = normalizePathForHash(relativeFilePath || filePath);
  const sourceHash = createHash(`${sourceLocation}:${diagramIndex}`);

  return `${resolvedId}-${sourceHash}`;
}

function getDiagramFilename(options) {
  const { locale, outputSuffix, outputFormat } = options;
  const assetBaseName = getDiagramAssetBaseName(options);

  return `${assetBaseName}-${locale}${outputSuffix}.${outputFormat}`;
}

module.exports = {
  createHash,
  getDiagramAssetBaseName,
  getDiagramFilename,
};