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

const [, script, command] = process.argv;

const DIR = dirname(script);
const CURSORS = join(DIR, 'hand-of-evil', 'cursors');
const PREVIEWS = join(DIR, 'previews');
const MAPPING_CONF = 'mapping.conf';

const ReEmptyLine = /^\s*(?:#.*)?$/;
const ReFrame = /^(\*|[0-9]+)(?::([0-9]+))?$/;
const Spaces = /\s+/;

const RePrintF = /%([^a-z%]*)([a-z%])/g;
const RePrintFormatSpecifier = /^([-+ #0])?([0-9]+|\*)?(?:\.([0-9]+))?$/;

const ARCHIVE = join(DIR, 'HandOfEvil.zip');

type Cursor = {
  name: string;
  aliases: string[];
  hotPoint: number[];
  prefix: string;
  frames: string[];
};

type CursorDimensions = {
  width: number;
  height: number;
  hotX: number;
  hotY: number;
};

type CursorInfo = {
  name: string;
  max: CursorDimensions;
  config: Frame[];
  size: number;
};

type Frame = CursorDimensions & {
  delay?: number;
  index: number;
};

type ProcessImageParams = {
  index: number;
  flop: string;
  file: string;
  rotate: string;
  extra: string;
  effect: string;
  hotPoint: number[];
};

type ProcessResult = CursorDimensions & {
  index: number;
};

const Config = {
  FILE_NAME: '%s%s',
  FILE_MASK: '%s%s',
  LINE: 1,
  ERRORS: 0,
  DO: '',
  ANGLE: 0,
  FLOP: '',
  SIZES: ['100%'],
  EFFECT: '',
  frame: '',
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

function error(msg: string) {
  console.error(`LINE ${Config.LINE}: ${msg}`);
  Config.ERRORS++;
}

function processImage({
  index,
  flop,
  file,
  rotate,
  extra,
  effect,
  hotPoint,
}: ProcessImageParams): ProcessResult {
  const tmp = printf('tmp%04d.png', index);
  let [
    origWidth,
    origHeight,
    pageX,
    pageY,
    width,
    height,
    pageWidth,
    pageHeight,
  ] = execSync(
    `convert "${file}" ${flop} -print '%W %H ' ${rotate} ${extra} ${effect} -trim -print '%X %Y %w %h %W %H' +repage "${tmp}"`,
  )
    .toString()
    .split(' ')
    .map(Number);

  let hotX = hotPoint[0];
  let hotY = hotPoint[1];

  if (Config.FLOP) {
    hotX = origWidth - hotX;
  }
  if (rotate) {
    const xd = hotX - (origWidth - 1) / 2;
    const yd = hotY - (origHeight - 1) / 2;
    const a = (Config.ANGLE * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    hotX = (pageWidth - 1) / 2 + xd * c - yd * s;
    hotY = (pageHeight - 1) / 2 + yd * c + xd * s;
  }
  hotX -= pageX;
  hotY -= pageY;
  return { width, height, hotX, hotY, index };
}

function convert({ frames, prefix, hotPoint, name }: Cursor): CursorInfo {
  const rotate = Config.ANGLE
    ? `-background none -rotate ${Config.ANGLE} +repage`
    : '';
  let index = 1;
  let max: CursorDimensions = { width: 0, height: 0, hotX: 0, hotY: 0 };
  const processed: Record<string, Frame> = {};

  const config: Frame[] = [];
  let delay: number;

  for (const frame of frames) {
    let match = frame.match(ReFrame);
    if (!match) throw Error('Invalid frame format');
    const [, suffix, strDelay] = match;
    const files =
      suffix === '*'
        ? readdirSync('.').filter((name) =>
            name.match(printf(Config.FILE_MASK, prefix, '.*')),
          )
        : [printf(Config.FILE_NAME, prefix, suffix)];
    if (strDelay) delay = Number(strDelay);
    for (let file of files) {
      if (processed[file]) {
        if (suffix !== '*') config.push({ ...processed[file], delay: delay });
        continue;
      }

      const result = processImage({
        index,
        file,
        rotate,
        flop: Config.FLOP,
        extra: Config.DO,
        effect: Config.EFFECT,
        hotPoint,
      });
      for (let key of Object.keys(max)) {
        if (result[key] > max[key]) max[key] = result[key];
      }

      let frame: Frame = {
        ...result,
        delay: delay,
      };
      config.push(frame);
      processed[file] = frame;
      index++;
    }
  }

  return { max, config, size: Math.max(max.width, max.height), name };
}

function processLine(type: 'xcursor' | 'gif', line: string) {
  Config.frame = '';
  if (line.match(ReEmptyLine)) return;
  const args = line.split(Spaces);
  const [cmd, ...params] = args;
  if (cmd.startsWith('!')) {
    switch (cmd) {
      case '!file-name':
        Config.FILE_NAME = params[0];
        return;
      case '!file-mask':
        Config.FILE_MASK = params[0];
        return;
      case '!do':
        Config.DO = params.join(' ');
        return;
      case '!rotate':
        Config.ANGLE = Number(params[0]);
        return;
      case '!flop':
        Config.FLOP = '-flop';
        return;
      case '!sizes':
        Config.SIZES = params;
        return;
      case '!effect':
        Config.EFFECT = params.join(' ');
        return;
      case '!alias':
        symlinkSync(params[1], params[0]);
        return;
      default:
        error(`Unknown option: ${cmd}`);
        return;
    }
  }
  const hotPointIndex = args.findIndex((arg) => arg.match(/^\d+:\d+$/));
  let names = args.slice(0, hotPointIndex);
  if (type !== 'gif')
    for (let i = 1; i < names.length; i++) symlinkSync(names[0], names[i]);

  let cursor = {
    name: names[0],
    aliases: names.slice(1),
    frames: args.slice(hotPointIndex + 2),
    hotPoint: args[hotPointIndex].split(':').map(Number),
    prefix: args[hotPointIndex + 1],
  };
  let info = convert(cursor);

  const [name] = names;
  console.log(`    Generating ${name}...`);
  switch (type) {
    case 'xcursor':
      xcursor(info);
      break;
    case 'gif':
      gif(info);
      break;
  }
  Config.DO = '';
  Config.ANGLE = 0;
  Config.FLOP = '';
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

  for (let line of readFileSync(join(DIR, MAPPING_CONF), 'utf8').split('\n')) {
    processLine(type, line);
    Config.LINE++;
  }

  if (Config.ERRORS === 0) console.info('\nGeneration completed.');
  else
    console.error(
      '\n${ERRORS} errors occurred during parsing ${MAPPING_CONF} file.\n' +
        'Please make sure that all the mentioned lines conform to the following format:\n' +
        'name1 [name2, ...] x:y prefix frame1 [frame2, ...]\n',
    );

  for (let png of readdirSync('.').filter((name) => name.endsWith('.png')))
    rmSync(png);
}

function scale_percent(a: number, b: string) {
  return Math.round((a * Number(b.slice(0, -1))) / 100);
}

function xcursor({ max, size, config, name }: CursorInfo) {
  const configLines: string[] = [];
  for (let s = 0; s < Config.SIZES.length; s++) {
    let scale = Config.SIZES[s];
    const processed: Record<number, any> = {};
    const hotX = scale_percent(max.hotX, scale);
    const hotY = scale_percent(max.hotY, scale);

    for (let { delay, index, width, height, hotX: chx, hotY: chy } of config) {
      const tmp = printf('tmp%04d-%s.png', index, s);
      let scaledSize = scale_percent(size, scale);
      let strDelay = delay ? delay : '';
      const xcursorLine = `${scaledSize} ${hotX} ${hotY} ${tmp} ${strDelay}`;
      configLines.push(xcursorLine);
      if (!processed[index]) {
        const args0 = width;
        const args1 = height;
        const args2 = chx;
        const args3 = chy;
        const max2 = max.hotX;
        const max3 = max.hotY;
        execSync(
          `convert ${printf('tmp%04d.png', index)} -background none -extent ${args0 + max2 - args2}x${args1 + max3 - args3}-${max2 - args2}-${max3 - args3} -resize ${scale} +repage ${tmp}`,
        );
        processed[index] = true;
      }
    }
  }
  execSync(`xcursorgen - ${name}`, { input: configLines.join('\n') });
}

function gif({ name, config, max }: CursorInfo) {
  appendFileSync(
    join(DIR, 'previews.md'),
    `${name}|![${name}](previews/${name}.gif)\n`,
  );
  const cmd: string[] = [];
  for (let { delay, index, width, height, hotX: chx, hotY: chy } of config) {
    const args0 = width;
    const args1 = height;
    const args2 = chx;
    const args3 = chy;
    const max2 = max.hotX;
    const max3 = max.hotY;

    if (delay)
      cmd.push(`-delay ${delay / 10} -page +${max2 - args2}+${max3 - args3}`);
    cmd.push(printf('tmp%04d.png', index));
  }
  execSync(
    `convert -dispose Background ${cmd.join(' ')} -layers trim-bounds ${name}.gif`,
  );
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
