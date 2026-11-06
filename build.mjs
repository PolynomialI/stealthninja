// Builds stealthninja.html: one self-contained file (Three.js + levels + game inlined).
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const parts = {
  '/*THREE*/': read('./node_modules/three/build/three.min.js'),
  '/*LEVELS*/': read('./src/levels.js'),
  '/*GAME*/': read('./src/game.js'),
};
let html = read('./src/template.html');
for (const [mark, code] of Object.entries(parts)) {
  if (/<\/script/i.test(code)) throw new Error(`${mark} contains </script>`);
  if (!html.includes(mark)) throw new Error(`template is missing ${mark}`);
  html = html.replace(mark, () => code);
}
fs.writeFileSync(new URL('./stealthninja.html', import.meta.url), html);
console.log(`stealthninja.html: ${(html.length / 1024).toFixed(0)} KB`);
