// Renders build/icon.svg into build/icon.png (512 px), build/icon.ico (16–256 px) and src/renderer/img/icon.png (128 px).
// Run with: npx electron tools/build-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

// An .ico file whose images are stored as PNG (supported since Windows Vista).
function makeIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<!doctype html><body></body>');
  const sizes = [512, ...ICO_SIZES];
  const urls = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    await img.decode();
    return ${JSON.stringify(sizes)}.map((s) => {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, s, s);
      return c.toDataURL('image/png');
    });
  })()`);
  const pngs = urls.map((u, i) => ({ size: sizes[i], data: Buffer.from(u.split(',')[1], 'base64') }));
  fs.writeFileSync(path.join(BUILD, 'icon.png'), pngs[0].data);
  // A copy inside the app itself (build/ is not packaged), used by the About dialog.
  fs.mkdirSync(path.join(__dirname, '..', 'src', 'renderer', 'img'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'img', 'icon.png'), pngs.find((p) => p.size === 128).data);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), makeIco(pngs.slice(1)));
  console.log('icon.png and icon.ico written:', ICO_SIZES.join(', '));
  app.quit();
});
