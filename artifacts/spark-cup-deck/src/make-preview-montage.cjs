const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const previewDir = path.join(root, 'previews');
const files = fs.readdirSync(previewDir).filter((file) => /^slide-\d+\.png$/.test(file)).sort();

(async () => {
  const thumbs = [];
  for (const file of files) {
    const labelSvg = `<svg width="500" height="320"><text x="16" y="305" fill="#A8BCD4" font-size="22" font-family="Arial">${file}</text></svg>`;
    const buffer = await sharp(path.join(previewDir, file))
      .resize(480, 270)
      .extend({ top: 10, bottom: 40, left: 10, right: 10, background: '#08111F' })
      .composite([{ input: Buffer.from(labelSvg), top: 0, left: 0 }])
      .png()
      .toBuffer();
    thumbs.push(buffer);
  }
  await sharp({
    create: {
      width: 1000,
      height: 320 * Math.ceil(files.length / 2),
      channels: 4,
      background: '#050B14',
    },
  })
    .composite(thumbs.map((input, index) => ({
      input,
      left: (index % 2) * 500,
      top: Math.floor(index / 2) * 320,
    })))
    .png()
    .toFile(path.join(previewDir, 'montage.png'));
})();
