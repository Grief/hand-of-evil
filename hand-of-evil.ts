#!/usr/bin/env ts-node

import { dirname, join } from 'path';
import { mkdirSync, readFileSync } from 'fs';
import {
  appendFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { chdir, exit } from 'process';
import { createHash } from 'crypto';
import { execSync } from 'node:child_process';

import Cursors from './hand-of-evil.json';

const [, script, command] = process.argv;

const DIR = dirname(script);
const CURSORS = join(DIR, 'hand-of-evil', 'cursors');
const PREVIEWS = join(DIR, 'previews');

const ReFrame = /^(\*|[0-9]+)(?::([0-9]+))?$/;

const RePrintF = /%([^a-z%]*)([a-z%])/g;
const RePrintFormatSpecifier = /^([-+ #0])?([0-9]+|\*)?(?:\.([0-9]+))?$/;

const ARCHIVE = join(DIR, 'HandOfEvil.zip');

type Cursor = {
  name: string;
  aliases?: string[];
  hotPoint: number[];
  prefix: string;
  frames: string[];
  flop?: string;
  angle?: number;
  extra?: string;
};

type CursorExtended = Cursor & {
  max: CursorDimensions;
  frameData: Frame[];
  size: number;
};

type CursorDimensions = {
  width: number;
  height: number;
  hotX: number;
  hotY: number;
};

type Frame = CursorDimensions & {
  delay?: number;
  index: number;
};

type ProcessImageParams = {
  index: number;
  file: string;
  hotPoint: number[];
};

type ProcessResult = CursorDimensions & {
  index: number;
};

function printf(format: string, ...args: any) {
  let i = 0;
  return format.replace(RePrintF, (s, params, letter) => {
    const arg = args[i++];
    switch (letter) {
      case 's':
        return arg;
      case 'd': {
        const match = params.match(RePrintFormatSpecifier);
        if (!match) throw Error(`Unexpected specifier ${s}`);
        const [, , width] = match;
        return String(arg).padStart(Number(width), '0');
      }
      case '%':
        return '%';
      default:
        throw Error(`Unexpected specifier ${s}`);
    }
  });
}

function execConvert(args: string[]) {
  const command = `convert ${args.join(' ')}`;
  try {
    return execSync(command);
  } catch (e) {
    throw Error(`command failed: ${command}`);
  }
}

function processImage(
  { flop, angle, extra }: Cursor,
  { index, file, hotPoint }: ProcessImageParams,
): ProcessResult {
  const tmp = printf('tmp%04d.png', index);
  const effect = Cursors.applyEffects
    .map((effect) => Cursors.effects[effect])
    .join(' ');
  let [
    origWidth,
    origHeight,
    pageX,
    pageY,
    width,
    height,
    pageWidth,
    pageHeight,
  ] = execConvert([
    `${file}`,
    flop ?? '',
    "-print '%W %H '",
    angle ? `-background none -rotate ${angle} +repage` : '',
    extra ?? '',
    effect,
    '-trim',
    "-print '%X %Y %w %h %W %H'",
    '+repage',
    `"${tmp}"`,
  ])
    .toString()
    .split(' ')
    .map(Number);

  let hotX = hotPoint[0];
  let hotY = hotPoint[1];

  if (flop) hotX = origWidth - hotX;
  if (angle) {
    const xd = hotX - (origWidth - 1) / 2;
    const yd = hotY - (origHeight - 1) / 2;
    const a = (angle * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    hotX = (pageWidth - 1) / 2 + xd * c - yd * s;
    hotY = (pageHeight - 1) / 2 + yd * c + xd * s;
  }
  hotX -= pageX;
  hotY -= pageY;
  return { width, height, hotX, hotY, index };
}

function calculateParams(cursor: Cursor): CursorExtended {
  const { frames, prefix, hotPoint } = cursor;
  let index = 1;
  let max: CursorDimensions = { width: 0, height: 0, hotX: 0, hotY: 0 };
  const processed: Record<string, Frame> = {};

  const frameData: Frame[] = [];
  let delay: number;

  for (const frame of frames) {
    let match = frame.match(ReFrame);
    if (!match) throw Error('Invalid frame format');
    const [, suffix, strDelay] = match;
    const files =
      suffix === '*'
        ? readdirSync('.').filter((name) =>
            name.match(printf(Cursors.fileMask, prefix, '.*')),
          )
        : [printf(Cursors.fileName, prefix, suffix)];
    if (strDelay) delay = Number(strDelay);
    for (let file of files) {
      if (processed[file]) {
        if (suffix !== '*')
          frameData.push({ ...processed[file], delay: delay });
        continue;
      }

      const result = processImage(cursor, {
        index,
        file,
        hotPoint,
      });
      for (let key of Object.keys(max)) {
        if (result[key] > max[key]) max[key] = result[key];
      }

      let frame: Frame = {
        ...result,
        delay: delay,
      };
      frameData.push(frame);
      processed[file] = frame;
      index++;
    }
  }

  return { ...cursor, max, frameData, size: Math.max(max.width, max.height) };
}

function generate(type: 'xcursor' | 'gif') {
  const dir = type === 'xcursor' ? CURSORS : PREVIEWS;
  // not available anymore
  // if [ ! -f "${ARCHIVE}" ]; then
  // wget -q -O "${ARCHIVE}" --show-progress 'ftp://ftp.ea-europe.com/support/patches/dk2/HandOfEvil.zip'
  // if [ $? != 0 ]; then
  // echo "ERROR: Failed to download ${ARCHIVE} archive"
  // exit -1

  if (
    createHash('md5').update(readFileSync(ARCHIVE)).digest('hex') !==
    'c1dd086f15a91bfa08c30530d0ff1e6f'
  ) {
    console.error(`ERROR: ${ARCHIVE} archive checksum mismatch`);
    exit(2);
  }

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  chdir(dir);
  execSync(`unzip -q -o "${ARCHIVE}"`, { stdio: 'inherit' });

  for (let [path, target] of Object.entries(Cursors.aliases))
    symlinkSync(target, path);

  for (let [name, entry] of Object.entries(Cursors.cursors)) {
    const { aliases } = entry as Cursor;
    const cursor = { name, ...entry };
    let extended = calculateParams(cursor);

    if (type !== 'gif' && aliases)
      for (let alias of aliases) symlinkSync(name, alias);

    console.log(`    Generating ${name}...`);
    switch (type) {
      case 'xcursor':
        xcursor(extended);
        break;
      case 'gif':
        gif(extended);
        break;
    }
  }

  console.info('\nGeneration completed.');

  for (let png of readdirSync('.').filter((name) => name.endsWith('.png')))
    rmSync(png);
}

function scale_percent(a: number, b: string) {
  return Math.round((a * Number(b.slice(0, -1))) / 100);
}

function xcursor({ name, max, size, frameData }: CursorExtended) {
  const configLines: string[] = [];
  for (let s = 0; s < Cursors.sizes.length; s++) {
    let scale = Cursors.sizes[s];
    const processed: Record<number, any> = {};
    const hotX = scale_percent(max.hotX, scale);
    const hotY = scale_percent(max.hotY, scale);

    for (let frame of frameData) {
      let { delay, index, width, height, hotX: chx, hotY: chy } = frame;
      const tmp = printf('tmp%04d-%s.png', index, s);
      let scaledSize = scale_percent(size, scale);
      let strDelay = delay ? delay : '';
      const xcursorLine = `${scaledSize} ${hotX} ${hotY} ${tmp} ${strDelay}`;
      configLines.push(xcursorLine);
      if (!processed[index]) {
        const extentWidth = width + max.hotX - chx;
        const extentHeight = height + max.hotY - chy;
        let result = '';
        try {
          result = execConvert([
            printf('tmp%04d.png', index),
            '-background none',
            `-extent ${extentWidth}x${extentHeight}-${max.hotX - chx}-${max.hotY - chy}`,
            `-resize ${scale}`,
            '+repage',
            `${tmp}`,
          ]).toString();
        } catch (e) {
          console.error(result);
          exit(2);
        }
        processed[index] = true;
      }
    }
  }
  execSync(`xcursorgen - ${name}`, { input: configLines.join('\n') });
}

function gif({ name, frameData, max }: CursorExtended) {
  appendFileSync(
    join(DIR, 'previews.md'),
    `${name}|![${name}](previews/${name}.gif)\n`,
  );
  const cmd: string[] = [];
  for (let { delay, index, hotX: chx, hotY: chy } of frameData) {
    if (delay)
      cmd.push(
        `-delay ${delay / 10} -page +${max.hotX - chx}+${max.hotY - chy}`,
      );
    cmd.push(printf('tmp%04d.png', index));
  }
  execConvert([
    '-dispose Background',
    ...cmd,
    '-layers trim-bounds',
    `${name}.gif`,
  ]);
}

switch (command) {
  case 'xcursor': {
    console.log('Generating XCURSOR theme...\n');
    generate('xcursor');
    chdir('..');
    writeFileSync(
      'index.theme',
      '[Icon Theme]\nName=Hand of Evil\nInherits=core\n',
    );
    chdir('..');
    execSync('tar czf hand-of-evil.tar.gz hand-of-evil', { stdio: 'inherit' });
    console.log(`You can now install the theme with one of the following ways:
1. Using GUI, i.e. in KDE choose \"cursor theme\" from menu and install from:
${DIR}/hand-of-evil.tar.gz
2. Manual way is to do:
  sudo mv ${DIR}/hand-of-evil /usr/share/icons
sudo update-alternatives --install /usr/share/icons/default/index.theme x-cursor-theme /usr/share/icons/hand-of-evil/index.theme 200`);
    break;
  }
  case 'gif': {
    console.log('Generating GIF previews...');
    writeFileSync(join(DIR, 'previews.md'), 'name|preview\n---|---\n');
    generate('gif');
    for (let dirent of readdirSync('.', { withFileTypes: true })) {
      if (dirent.isSymbolicLink()) rmSync(dirent.name);
    }
    break;
  }
  default:
    console.error(`Unknown option: ${command}\nUsage: $0 (xcursor | gif)`);
}
