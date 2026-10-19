const path = require('node:path');

function createPreviewResolver(projectRoot, environment = 'production') {
  if (!['production', 'test'].includes(environment)) throw new Error('Preview build environment must be production or test.');
  const isTest = environment === 'test';
  const entry = path.resolve(projectRoot, isTest ? 'src/dev/preview/integration.tsx' : 'src/integrations/uiPreview/production.tsx');
  const previewRoot = `${path.resolve(projectRoot, 'src/dev/preview').toLowerCase()}${path.sep}`;
  return (context, moduleName, platform) => {
    const result = context.resolveRequest(context, moduleName === '@lmt/ui-preview' ? entry : moduleName, platform);
    if (!isTest && result.type === 'sourceFile' && path.resolve(result.filePath).toLowerCase().startsWith(previewRoot)) {
      throw new Error('Production bundle attempted to import TEST UI Preview code. Use @lmt/ui-preview.');
    }
    return result;
  };
}

module.exports = { createPreviewResolver };
