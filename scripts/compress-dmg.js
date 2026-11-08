// Packs the .dmg tighter once electron-builder has made it.
//
// The disk image formats electron-builder offers end at bzip2. macOS also has
// lzma (ULMO), which every macOS the app runs on can open and which makes the
// download about a quarter smaller. What is in the image stays as it was; only
// how it is packed changes. The "afterAllArtifactBuild" in package.json runs this.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const megabytes = (file) => `${Math.round(fs.statSync(file).size / 1024 / 1024)} MB`;

/**
 * @param {{ artifactPaths: string[] }} built  what electron-builder made
 * @param {(command: string, args: string[]) => void} [run]
 * @returns {string[]} no files to publish besides those: each .dmg is replaced where it is
 */
export default function compressDmg(
  { artifactPaths },
  run = (command, args) => execFileSync(command, args, { stdio: 'inherit' })
) {
  for (const dmg of artifactPaths.filter((file) => file.endsWith('.dmg'))) {
    // hdiutil won't write over the image it reads, and adds ".dmg" to a name without it.
    const packed = dmg.replace(/\.dmg$/, '.lzma.dmg');
    const before = megabytes(dmg);
    fs.rmSync(packed, { force: true });
    run('hdiutil', ['convert', dmg, '-quiet', '-format', 'ULMO', '-o', packed]);
    fs.renameSync(packed, dmg);
    console.log(`  • packed with lzma  file=${path.basename(dmg)} before=${before} after=${megabytes(dmg)}`);
  }
  return [];
}
