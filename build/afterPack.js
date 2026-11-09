// Embeds the app icon and version info in the .exe. electron-builder normally does this through its
// winCodeSign bundle, which cannot be unpacked on Windows without symlink privileges, so it is done here.
const path = require('path');
const { rcedit } = require('rcedit');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const { version, productName } = context.packager.appInfo;
  await rcedit(exe, {
    icon: path.join(__dirname, 'icon.ico'),
    'version-string': { ProductName: productName, FileDescription: productName, CompanyName: 'KGitty', LegalCopyright: 'MIT' },
    'file-version': version,
    'product-version': version,
  });
};
