#!/usr/bin/env node
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const sourceImagePath = '/Users/rohits/.gemini/antigravity-ide/brain/1fd31198-5f5f-4e27-aada-4f04fc725154/switchui_logo_var3_matrix_1782307661708.png';
const publicDir = '/Volumes/Ext-nvme/Development/hermes-switchui/public';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Read the source image and convert to base64
  const sourceBuffer = readFileSync(sourceImagePath);
  const base64Image = sourceBuffer.toString('base64');
  const mimeType = 'image/png';

  console.log('Scaling and converting branding assets...');

  // Helper to generate PNG or JPEG screenshot using Playwright
  async function resizeImage(width, height, format = 'png') {
    await page.setViewportSize({ width, height });
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background: transparent; display: flex; align-items: center; justify-content: center; overflow: hidden; }
            img { width: 100vw; height: 100vh; object-fit: cover; }
          </style>
        </head>
        <body>
          <img src="data:${mimeType};base64,${base64Image}" />
        </body>
      </html>
    `;
    await page.setContent(html);
    // Give a brief moment to ensure image renders
    await page.waitForTimeout(100);
    return await page.screenshot({ type: format === 'jpg' ? 'jpeg' : 'png', omitBackground: true });
  }

  // Helper to convert to WebP using Canvas in Playwright
  async function convertToWebP(width, height) {
    await page.setViewportSize({ width, height });
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background: transparent; }
          </style>
        </head>
        <body>
          <canvas id="canvas" width="${width}" height="${height}"></canvas>
          <script>
            window.convertToWebP = function(imgBase64) {
              return new Promise((resolve) => {
                const img = new Image();
                img.src = 'data:${mimeType};base64,' + imgBase64;
                img.onload = () => {
                  const canvas = document.getElementById('canvas');
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0, ${width}, ${height});
                  resolve(canvas.toDataURL('image/webp', 0.9));
                };
              });
            }
          </script>
        </body>
      </html>
    `;
    await page.setContent(html);
    const dataUrl = await page.evaluate((b64) => window.convertToWebP(b64), base64Image);
    const base64Data = dataUrl.split(',')[1];
    return Buffer.from(base64Data, 'base64');
  }

  // 1. claude-avatar.png (80x80)
  const avatarPng = await resizeImage(80, 80, 'png');
  writeFileSync(join(publicDir, 'claude-avatar.png'), avatarPng);
  console.log('✓ Generated claude-avatar.png');

  // 2. claude-avatar.webp (80x80)
  const avatarWebp = await convertToWebP(80, 80);
  writeFileSync(join(publicDir, 'claude-avatar.webp'), avatarWebp);
  console.log('✓ Generated claude-avatar.webp');

  // 3. apple-touch-icon.png (180x180)
  const appleTouchIcon = await resizeImage(180, 180, 'png');
  writeFileSync(join(publicDir, 'apple-touch-icon.png'), appleTouchIcon);
  console.log('✓ Generated apple-touch-icon.png');

  // 4. claude-icon-192.png (192x192)
  const icon192 = await resizeImage(192, 192, 'png');
  writeFileSync(join(publicDir, 'claude-icon-192.png'), icon192);
  console.log('✓ Generated claude-icon-192.png');

  // 5. claude-icon-512.png (512x512)
  const icon512 = await resizeImage(512, 512, 'png');
  writeFileSync(join(publicDir, 'claude-icon-512.png'), icon512);
  console.log('✓ Generated claude-icon-512.png');

  // 6. logo-icon.png (256x256)
  const logoIconPng = await resizeImage(256, 256, 'png');
  writeFileSync(join(publicDir, 'logo-icon.png'), logoIconPng);
  console.log('✓ Generated logo-icon.png');

  // 7. logo-icon.jpg (256x256)
  const logoIconJpg = await resizeImage(256, 256, 'jpg');
  writeFileSync(join(publicDir, 'logo-icon.jpg'), logoIconJpg);
  console.log('✓ Generated logo-icon.jpg');

  // 8. claude-logo.png (1024x1024)
  const mainLogo = await resizeImage(1024, 1024, 'png');
  writeFileSync(join(publicDir, 'claude-logo.png'), mainLogo);
  console.log('✓ Generated claude-logo.png');

  // 9. favicon.svg (vector wrapper of the png base64)
  const p512Base64 = icon512.toString('base64');
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <image href="data:image/png;base64,${p512Base64}" x="0" y="0" width="512" height="512" />
</svg>`;
  writeFileSync(join(publicDir, 'favicon.svg'), svgContent);
  console.log('✓ Generated favicon.svg');

  // 10. claude-favicon.ico (containing 16x16, 32x32, 48x48)
  const p16 = await resizeImage(16, 16, 'png');
  const p32 = await resizeImage(32, 32, 'png');
  const p48 = await resizeImage(48, 48, 'png');

  const icoBuffer = createIco([p16, p32, p48], [16, 32, 48]);
  writeFileSync(join(publicDir, 'claude-favicon.ico'), icoBuffer);
  console.log('✓ Generated claude-favicon.ico');

  await browser.close();
  console.log('✓ All branding assets updated successfully!');
}

function createIco(pngBuffers, sizes) {
  const HEADER_SIZE = 6;
  const DIRECTORY_ENTRY_SIZE = 16;

  const count = pngBuffers.length;
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = ICO
  header.writeUInt16LE(count, 4); // Count of images

  const entries = [];
  let currentOffset = HEADER_SIZE + (DIRECTORY_ENTRY_SIZE * count);

  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const data = pngBuffers[i];
    const dataSize = data.length;

    const entry = Buffer.alloc(DIRECTORY_ENTRY_SIZE);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height
    entry.writeUInt8(0, 2); // Color count
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(dataSize, 8); // Size of data
    entry.writeUInt32LE(currentOffset, 12); // Offset of data

    entries.push(entry);
    currentOffset += dataSize;
  }

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

main().catch(console.error);
