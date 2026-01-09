import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';

type WorkerBadgePerson = {
  id: number;
  first_name: string;
  last_name: string;
  active: boolean;
};

type WorkerBadgePrinterProps = {
  open: boolean;
  onClose: () => void;
  workers: WorkerBadgePerson[];
  defaultWorkerId?: number | null;
};

type PaperSize = 'a4' | 'letter';

type QRCodeMatrix = {
  moduleCount: number;
  modules: boolean[][];
  truncated: boolean;
};

const LOGO_SRC = '/logo.png';
const BADGE_WIDTH_MM = 86;
const BADGE_HEIGHT_MM = 54;
const BADGE_GAP_MM = 6;
const PAGE_MARGIN_MM = 10;
const QR_SIZE_MM = 36;
const MM_TO_PX = 3.7795;
// Minimal QR generator (version 4, ECC M) to keep printing offline and dependency-free.
const QR_TYPE_NUMBER = 4;
const QR_ERROR_CORRECTION_LEVEL = 0;
const RS_BLOCKS_V4_M = [
  { totalCount: 50, dataCount: 32 },
  { totalCount: 50, dataCount: 32 },
];

const PAPER_SIZES: Record<
  PaperSize,
  { label: string; width: number; height: number; pageLabel: string }
> = {
  a4: { label: 'A4', width: 210, height: 297, pageLabel: 'A4' },
  letter: { label: 'Carta', width: 216, height: 279, pageLabel: 'letter' },
};

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

const encodeUtf8 = (value: string): number[] => {
  if (textEncoder) {
    return Array.from(textEncoder.encode(value));
  }
  const utf8: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    let code = value.charCodeAt(i);
    if (code < 0x80) {
      utf8.push(code);
    } else if (code < 0x800) {
      utf8.push(0xc0 | (code >> 6));
      utf8.push(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      utf8.push(0xe0 | (code >> 12));
      utf8.push(0x80 | ((code >> 6) & 0x3f));
      utf8.push(0x80 | (code & 0x3f));
    } else {
      code -= 0x10000;
      utf8.push(0xf0 | ((code >> 18) & 0x07));
      utf8.push(0x80 | ((code >> 12) & 0x3f));
      utf8.push(0x80 | ((code >> 6) & 0x3f));
      utf8.push(0x80 | (code & 0x3f));
    }
  }
  return utf8;
};

class QRBitBuffer {
  buffer: number[] = [];

  length = 0;

  get(index: number): boolean {
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
  }

  getLengthInBits(): number {
    return this.length;
  }

  put(num: number, length: number): void {
    for (let i = 0; i < length; i += 1) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean): void {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length += 1;
  }
}

const QRMath = (() => {
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);

  for (let i = 0; i < 8; i += 1) {
    EXP_TABLE[i] = 1 << i;
  }
  for (let i = 8; i < 256; i += 1) {
    EXP_TABLE[i] =
      EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i += 1) {
    LOG_TABLE[EXP_TABLE[i]] = i;
  }

  const glog = (n: number): number => {
    if (n < 1) {
      throw new Error(`glog(${n})`);
    }
    return LOG_TABLE[n];
  };

  const gexp = (n: number): number => {
    let value = n;
    while (value < 0) {
      value += 255;
    }
    while (value >= 256) {
      value -= 255;
    }
    return EXP_TABLE[value];
  };

  return { glog, gexp };
})();

class QRPolynomial {
  num: number[];

  constructor(num: number[], shift: number) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) {
      offset += 1;
    }
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      this.num[i] = num[i + offset];
    }
    for (let i = 0; i < shift; i += 1) {
      this.num[num.length - offset + i] = 0;
    }
  }

  get(index: number): number {
    return this.num[index];
  }

  getLength(): number {
    return this.num.length;
  }

  multiply(e: QRPolynomial): QRPolynomial {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i += 1) {
      for (let j = 0; j < e.getLength(); j += 1) {
        num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
      }
    }
    return new QRPolynomial(num, 0);
  }

  mod(e: QRPolynomial): QRPolynomial {
    if (this.getLength() - e.getLength() < 0) {
      return this;
    }
    const num = this.num.slice();
    while (num.length - e.getLength() >= 0) {
      const ratio = QRMath.glog(num[0]) - QRMath.glog(e.get(0));
      for (let i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
      }
      while (num.length > 0 && num[0] === 0) {
        num.shift();
      }
    }
    return new QRPolynomial(num, 0);
  }
}

const getBCHDigit = (data: number): number => {
  let digit = 0;
  let value = data;
  while (value !== 0) {
    digit += 1;
    value >>>= 1;
  }
  return digit;
};

const getBCHTypeInfo = (data: number): number => {
  const G15 = 0b10100110111;
  const G15_MASK = 0b101010000010010;
  let d = data << 10;
  while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
    d ^= G15 << (getBCHDigit(d) - getBCHDigit(G15));
  }
  return ((data << 10) | d) ^ G15_MASK;
};

const getMask = (maskPattern: number, i: number, j: number): boolean => {
  switch (maskPattern) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7:
      return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
    default:
      return false;
  }
};

const getErrorCorrectPolynomial = (errorCorrectLength: number): QRPolynomial => {
  let a = new QRPolynomial([1], 0);
  for (let i = 0; i < errorCorrectLength; i += 1) {
    a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
  }
  return a;
};

const createDataBytes = (dataBytes: number[]): number[] => {
  const buffer = new QRBitBuffer();
  buffer.put(0b0100, 4);
  buffer.put(dataBytes.length, 8);
  dataBytes.forEach((byte) => buffer.put(byte, 8));

  const totalDataCount = RS_BLOCKS_V4_M.reduce((sum, block) => sum + block.dataCount, 0);
  const totalDataBits = totalDataCount * 8;

  if (buffer.getLengthInBits() + 4 <= totalDataBits) {
    buffer.put(0, 4);
  }

  while (buffer.getLengthInBits() % 8 !== 0) {
    buffer.putBit(false);
  }

  let padByte = 0xec;
  while (buffer.getLengthInBits() < totalDataBits) {
    buffer.put(padByte, 8);
    padByte = padByte === 0xec ? 0x11 : 0xec;
  }

  const data = buffer.buffer.slice(0, totalDataCount);

  let offset = 0;
  const dcdata: number[][] = [];
  const ecdata: number[][] = [];
  let maxDcCount = 0;
  let maxEcCount = 0;

  RS_BLOCKS_V4_M.forEach((block) => {
    const dcCount = block.dataCount;
    const ecCount = block.totalCount - dcCount;
    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);
    const dcItem = data.slice(offset, offset + dcCount);
    offset += dcCount;
    const rsPoly = getErrorCorrectPolynomial(ecCount);
    const rawPoly = new QRPolynomial(dcItem, rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);
    const ecItem = new Array(ecCount).fill(0);
    for (let i = 0; i < ecCount; i += 1) {
      const modIndex = i + modPoly.getLength() - ecCount;
      ecItem[i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
    }
    dcdata.push(dcItem);
    ecdata.push(ecItem);
  });

  const dataBuffer: number[] = [];
  for (let i = 0; i < maxDcCount; i += 1) {
    dcdata.forEach((block) => {
      if (i < block.length) {
        dataBuffer.push(block[i]);
      }
    });
  }
  for (let i = 0; i < maxEcCount; i += 1) {
    ecdata.forEach((block) => {
      if (i < block.length) {
        dataBuffer.push(block[i]);
      }
    });
  }

  return dataBuffer;
};

const setupPositionProbePattern = (
  modules: Array<Array<boolean | null>>,
  row: number,
  col: number
): void => {
  for (let r = -1; r <= 7; r += 1) {
    if (row + r <= -1 || modules.length <= row + r) {
      continue;
    }
    for (let c = -1; c <= 7; c += 1) {
      if (col + c <= -1 || modules.length <= col + c) {
        continue;
      }
      if (
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      ) {
        modules[row + r][col + c] = true;
      } else {
        modules[row + r][col + c] = false;
      }
    }
  }
};

const setupTimingPattern = (modules: Array<Array<boolean | null>>): void => {
  for (let i = 8; i < modules.length - 8; i += 1) {
    if (modules[i][6] === null) {
      modules[i][6] = i % 2 === 0;
    }
    if (modules[6][i] === null) {
      modules[6][i] = i % 2 === 0;
    }
  }
};

const setupAlignmentPattern = (modules: Array<Array<boolean | null>>): void => {
  const positions = [6, 26];
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      const row = positions[i];
      const col = positions[j];
      if (modules[row][col] !== null) {
        continue;
      }
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          if (
            r === -2 ||
            r === 2 ||
            c === -2 ||
            c === 2 ||
            (r === 0 && c === 0)
          ) {
            modules[row + r][col + c] = true;
          } else {
            modules[row + r][col + c] = false;
          }
        }
      }
    }
  }
};

const setupTypeInfo = (modules: Array<Array<boolean | null>>, maskPattern: number): void => {
  const data = (QR_ERROR_CORRECTION_LEVEL << 3) | maskPattern;
  const bits = getBCHTypeInfo(data);
  for (let i = 0; i < 15; i += 1) {
    const mod = ((bits >> i) & 1) === 1;
    if (i < 6) {
      modules[i][8] = mod;
    } else if (i < 8) {
      modules[i + 1][8] = mod;
    } else {
      modules[modules.length - 15 + i][8] = mod;
    }

    if (i < 8) {
      modules[8][modules.length - i - 1] = mod;
    } else if (i < 9) {
      modules[8][15 - i - 1 + 1] = mod;
    } else {
      modules[8][15 - i - 1] = mod;
    }
  }
  modules[modules.length - 8][8] = true;
};

const mapData = (
  modules: Array<Array<boolean | null>>,
  data: number[],
  maskPattern: number
): void => {
  let inc = -1;
  let row = modules.length - 1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let col = modules.length - 1; col > 0; col -= 2) {
    if (col === 6) {
      col -= 1;
    }
    while (true) {
      for (let c = 0; c < 2; c += 1) {
        if (modules[row][col - c] === null) {
          let dark = false;
          if (byteIndex < data.length) {
            dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
          }
          if (getMask(maskPattern, row, col - c)) {
            dark = !dark;
          }
          modules[row][col - c] = dark;
          bitIndex -= 1;
          if (bitIndex === -1) {
            byteIndex += 1;
            bitIndex = 7;
          }
        }
      }
      row += inc;
      if (row < 0 || modules.length <= row) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
};

const getLostPoint = (modules: boolean[][]): number => {
  const moduleCount = modules.length;
  let lostPoint = 0;

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      let sameCount = 0;
      const dark = modules[row][col];
      for (let r = -1; r <= 1; r += 1) {
        if (row + r < 0 || moduleCount <= row + r) {
          continue;
        }
        for (let c = -1; c <= 1; c += 1) {
          if (col + c < 0 || moduleCount <= col + c) {
            continue;
          }
          if (r === 0 && c === 0) {
            continue;
          }
          if (dark === modules[row + r][col + c]) {
            sameCount += 1;
          }
        }
      }
      if (sameCount > 5) {
        lostPoint += 3 + (sameCount - 5);
      }
    }
  }

  for (let row = 0; row < moduleCount - 1; row += 1) {
    for (let col = 0; col < moduleCount - 1; col += 1) {
      const count =
        Number(modules[row][col]) +
        Number(modules[row + 1][col]) +
        Number(modules[row][col + 1]) +
        Number(modules[row + 1][col + 1]);
      if (count === 0 || count === 4) {
        lostPoint += 3;
      }
    }
  }

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount - 6; col += 1) {
      if (
        modules[row][col] &&
        !modules[row][col + 1] &&
        modules[row][col + 2] &&
        modules[row][col + 3] &&
        modules[row][col + 4] &&
        !modules[row][col + 5] &&
        modules[row][col + 6]
      ) {
        if (
          (col - 4 >= 0 &&
            !modules[row][col - 1] &&
            !modules[row][col - 2] &&
            !modules[row][col - 3] &&
            !modules[row][col - 4]) ||
          (col + 10 < moduleCount &&
            !modules[row][col + 7] &&
            !modules[row][col + 8] &&
            !modules[row][col + 9] &&
            !modules[row][col + 10])
        ) {
          lostPoint += 40;
        }
      }
    }
  }

  for (let col = 0; col < moduleCount; col += 1) {
    for (let row = 0; row < moduleCount - 6; row += 1) {
      if (
        modules[row][col] &&
        !modules[row + 1][col] &&
        modules[row + 2][col] &&
        modules[row + 3][col] &&
        modules[row + 4][col] &&
        !modules[row + 5][col] &&
        modules[row + 6][col]
      ) {
        if (
          (row - 4 >= 0 &&
            !modules[row - 1][col] &&
            !modules[row - 2][col] &&
            !modules[row - 3][col] &&
            !modules[row - 4][col]) ||
          (row + 10 < moduleCount &&
            !modules[row + 7][col] &&
            !modules[row + 8][col] &&
            !modules[row + 9][col] &&
            !modules[row + 10][col])
        ) {
          lostPoint += 40;
        }
      }
    }
  }

  let darkCount = 0;
  modules.forEach((row) => {
    row.forEach((cell) => {
      if (cell) {
        darkCount += 1;
      }
    });
  });
  const ratio = Math.abs((100 * darkCount) / (moduleCount * moduleCount) - 50) / 5;
  lostPoint += ratio * 10;

  return lostPoint;
};

const createQrCodeMatrix = (value: string): QRCodeMatrix => {
  const dataBytes = encodeUtf8(value);
  const totalDataCount = RS_BLOCKS_V4_M.reduce((sum, block) => sum + block.dataCount, 0);
  const maxDataBytes = Math.floor((totalDataCount * 8 - 12) / 8);
  const truncated = dataBytes.length > maxDataBytes;
  const trimmedBytes = truncated ? dataBytes.slice(0, maxDataBytes) : dataBytes;
  const data = createDataBytes(trimmedBytes);

  let minLostPoint = Infinity;
  let bestModules: boolean[][] = [];

  for (let maskPattern = 0; maskPattern < 8; maskPattern += 1) {
    const moduleCount = QR_TYPE_NUMBER * 4 + 17;
    const modules: Array<Array<boolean | null>> = Array.from({ length: moduleCount }, () =>
      new Array(moduleCount).fill(null)
    );
    setupPositionProbePattern(modules, 0, 0);
    setupPositionProbePattern(modules, moduleCount - 7, 0);
    setupPositionProbePattern(modules, 0, moduleCount - 7);
    setupTimingPattern(modules);
    setupAlignmentPattern(modules);
    setupTypeInfo(modules, maskPattern);
    mapData(modules, data, maskPattern);
    const normalized = modules.map((row) => row.map((cell) => Boolean(cell)));
    const lostPoint = getLostPoint(normalized);
    if (lostPoint < minLostPoint) {
      minLostPoint = lostPoint;
      bestModules = normalized;
    }
  }

  return {
    moduleCount: QR_TYPE_NUMBER * 4 + 17,
    modules: bestModules,
    truncated,
  };
};

const buildQrPath = (modules: boolean[][]): string => {
  const path: string[] = [];
  for (let row = 0; row < modules.length; row += 1) {
    for (let col = 0; col < modules.length; col += 1) {
      if (modules[row][col]) {
        path.push(`M${col} ${row}h1v1h-1z`);
      }
    }
  }
  return path.join('');
};

const getNameParts = (
  worker: WorkerBadgePerson
): { first: string; last: string; full: string } => {
  const tokens = `${worker.first_name} ${worker.last_name}`
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return { first: 'Trabajador', last: '', full: 'Trabajador' };
  }
  const first = tokens[0] ?? '';
  let last = '';
  if (tokens.length === 2) {
    last = tokens[1];
  } else if (tokens.length >= 3) {
    last = tokens[tokens.length - 2];
  }
  if (!first) {
    return { first: last, last: '', full: last };
  }
  return {
    first,
    last,
    full: [first, last].filter(Boolean).join(' ').trim(),
  };
};

const buildDisplayName = (worker: WorkerBadgePerson): string => {
  return getNameParts(worker).full;
};

const getDynamicFontSize = (text: string, baseSize: number, maxWidthMm: number) => {
  const charCount = text.length;
  if (charCount === 0) return `${baseSize}px`;
  // Heuristic factor for uppercase bold characters (W is wider than I)
  const factor = baseSize > 15 ? 0.65 : 0.55;
  const estimatedWidthPx = charCount * baseSize * factor;
  const maxWidthPx = maxWidthMm * MM_TO_PX;
  if (estimatedWidthPx <= maxWidthPx) return `${baseSize}px`;
  const calculated = maxWidthPx / (charCount * factor);
  return `${Math.max(calculated, 8).toFixed(1)}px`;
};

const WorkerBadgePrinter: React.FC<WorkerBadgePrinterProps> = ({
  open,
  onClose,
  workers,
  defaultWorkerId,
}) => {
  const [paperSize, setPaperSize] = useState<PaperSize>('a4');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showCutLines, setShowCutLines] = useState(true);
  const [previewScale, setPreviewScale] = useState(1);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const logoSrc = LOGO_SRC;

  useEffect(() => {
    if (!open) {
      return;
    }
    if (selectedIds.size > 0) {
      return;
    }
    const fallbackId =
      defaultWorkerId ?? workers.find((worker) => worker.active)?.id ?? workers[0]?.id;
    if (fallbackId) {
      setSelectedIds(new Set([fallbackId]));
    }
  }, [defaultWorkerId, open, selectedIds, workers]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSearchQuery('');
  }, [open]);

  const orderedWorkers = useMemo(() => {
    return [...workers].sort((a, b) => {
      const lastCompare = a.last_name.localeCompare(b.last_name);
      if (lastCompare !== 0) {
        return lastCompare;
      }
      return a.first_name.localeCompare(b.first_name);
    });
  }, [workers]);

  const filteredWorkers = useMemo(() => {
    if (!searchQuery.trim()) {
      return orderedWorkers;
    }
    const query = searchQuery.trim().toLowerCase();
    return orderedWorkers.filter((worker) =>
      buildDisplayName(worker).toLowerCase().includes(query)
    );
  }, [orderedWorkers, searchQuery]);

  const selectedWorkers = useMemo(() => {
    return orderedWorkers.filter((worker) => selectedIds.has(worker.id));
  }, [orderedWorkers, selectedIds]);



  const badgeItems = useMemo(() => {
    const qrCache = new Map<string, { path: string; moduleCount: number; truncated: boolean }>();
    return selectedWorkers.map((worker) => {
      const { first, last, full } = getNameParts(worker);
      const cached = qrCache.get(full);
      if (cached) {
        return { id: worker.id, name: full, firstName: first, lastName: last, ...cached };
      }
      const matrix = createQrCodeMatrix(full);
      const path = buildQrPath(matrix.modules);
      const entry = { path, moduleCount: matrix.moduleCount, truncated: matrix.truncated };
      qrCache.set(full, entry);
      return { id: worker.id, name: full, firstName: first, lastName: last, ...entry };
    });
  }, [selectedWorkers]);

  const paper = PAPER_SIZES[paperSize];

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      return;
    }
    const element = previewRef.current;
    if (!element) {
      return;
    }

    const updateScale = () => {
      const { clientWidth, clientHeight } = element;
      const styles = window.getComputedStyle(element);
      const paddingX =
        parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const paddingY =
        parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const availableWidth = clientWidth - paddingX;
      const availableHeight = clientHeight - paddingY;
      if (!availableWidth || !availableHeight) {
        return;
      }
      const pageWidthPx = paper.width * MM_TO_PX;
      const pageHeightPx = paper.height * MM_TO_PX;
      const nextScale = Math.min(
        1,
        availableWidth / pageWidthPx,
        availableHeight / pageHeightPx
      );
      if (Number.isFinite(nextScale)) {
        setPreviewScale(nextScale);
      }
    };

    updateScale();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateScale);
      return () => {
        window.removeEventListener('resize', updateScale);
      };
    }

    const observer = new ResizeObserver(updateScale);
    observer.observe(element);
    window.addEventListener('resize', updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [open, paper.height, paper.width]);

  const scaledPageWidth = paper.width * previewScale;
  const scaledPageHeight = paper.height * previewScale;
  const columns = Math.max(
    1,
    Math.floor((paper.width - PAGE_MARGIN_MM * 2 + BADGE_GAP_MM) / (BADGE_WIDTH_MM + BADGE_GAP_MM))
  );
  const rows = Math.max(
    1,
    Math.floor((paper.height - PAGE_MARGIN_MM * 2 + BADGE_GAP_MM) / (BADGE_HEIGHT_MM + BADGE_GAP_MM))
  );
  const badgesPerPage = columns * rows;

  const pages = useMemo(() => {
    if (!badgeItems.length) {
      return [];
    }
    const grouped: typeof badgeItems[] = [];
    for (let i = 0; i < badgeItems.length; i += badgesPerPage) {
      grouped.push(badgeItems.slice(i, i + badgesPerPage));
    }
    return grouped;
  }, [badgeItems, badgesPerPage]);

  const truncatedCount = badgeItems.filter((item) => item.truncated).length;
  const canPrint = badgeItems.length > 0;

  const toggleWorker = (workerId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedIds(new Set(filteredWorkers.map((worker) => worker.id)));
  };

  const printStyles = `
    .badge-print-only { display: none; }
    @page { 
      size: ${paper.pageLabel}; 
      margin: 0; 
    }
    @media print {
      html, body { 
        background: #fff !important; 
        margin: 0 !important; 
        padding: 0 !important;
        height: auto !important;
        min-height: 100% !important;
        overflow: visible !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body > *:not(.badge-modal-root) { display: none !important; }
      .badge-no-print, .badge-screen-only { 
        display: none !important; 
        visibility: hidden !important;
        height: 0 !important; 
        width: 0 !important;
        overflow: hidden !important; 
        margin: 0 !important;
        padding: 0 !important;
      }
      .badge-modal-root { 
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: auto !important;
        display: block !important; 
        padding: 0 !important;
        margin: 0 !important;
        background: transparent !important;
        z-index: 999999 !important;
      }
      .badge-modal-content { 
        position: static !important;
        display: block !important;
        width: 100% !important;
        height: auto !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .badge-modal-content .grid, 
      .badge-modal-content .flex { 
        display: block !important; 
        margin: 0 !important;
        padding: 0 !important;
        gap: 0 !important;
      }
      .badge-print-only { 
        display: block !important; 
        position: static !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .badge-page-outer { 
        width: ${paper.width}mm !important; 
        height: ${paper.height}mm !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
        overflow: hidden !important;
        box-sizing: border-box !important;
        background: #fff !important;
      }
      .badge-page-break { 
        page-break-after: always !important; 
        break-after: page !important;
      }
      .badge-page { 
        box-shadow: none !important; 
        border: none !important; 
        margin: 0 !important;
        border-radius: 0 !important;
        background: #fff !important;
      }
      .badge-card {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: #fff !important;
      }
      .badge-card-inner {
        display: flex !important;
        height: 100% !important;
        width: 100% !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 1.5rem !important;
        padding: 1.25rem 1.25rem !important;
      }
      .badge-name-section {
        display: flex !important;
        height: 100% !important;
        min-width: 0 !important;
        flex: 1 !important;
        flex-direction: column !important;
        justify-content: space-between !important;
      }
      .badge-logo-container {
        display: flex !important;
        width: 100% !important;
        align-items: flex-start !important;
        height: 10mm !important;
      }
      .badge-logo-container img {
        height: 100% !important;
        width: auto !important;
        object-fit: contain !important;
      }
      .badge-name-text {
        text-align: left !important;
        color: #0f172a !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 0.125rem !important;
        margin-bottom: 0.25rem !important;
      }
      .badge-first-name {
        font-size: 22px !important;
        font-weight: 800 !important;
        text-transform: uppercase !important;
        line-height: 1 !important;
      }
      .badge-last-name {
        font-size: 13px !important;
        font-weight: 500 !important;
        text-transform: uppercase !important;
        color: #64748b !important;
        letter-spacing: 0.025em !important;
      }
      .badge-qr-container {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: #fff !important;
        padding: 0.25rem !important;
        border: 1px solid #f1f5f9 !important;
        border-radius: 0.25rem !important;
      }
      .badge-qr-container svg {
        display: block !important;
      }
    }
  `;

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="badge-modal-root fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <style>{printStyles}</style>
      <div className="badge-no-print absolute inset-0 bg-slate-900/70" onClick={onClose} />
      <div className="badge-modal-content relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="badge-no-print flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Credenciales QR</h3>
            <p className="text-xs text-slate-500">
              Genera credenciales con QR, logo oficial y nombre para impresion estandarizada.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 min-h-0 gap-6 p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="badge-no-print min-h-0 space-y-5 overflow-auto pr-2">
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Seleccion</div>
              <input
                type="search"
                placeholder="Buscar trabajador"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-50"
                >
                  Seleccionar filtrados
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-50"
                >
                  Limpiar
                </button>
                <span className="text-slate-500">
                  {selectedIds.size} seleccionados
                </span>
              </div>
              <div className="max-h-56 overflow-auto rounded-2xl border border-slate-200 bg-white">
                {filteredWorkers.map((worker) => (
                  <label
                    key={worker.id}
                    className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(worker.id)}
                      onChange={() => toggleWorker(worker.id)}
                    />
                    <span className="flex-1 text-slate-700">
                      {buildDisplayName(worker)}
                    </span>
                    {!worker.active && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        Inactivo
                      </span>
                    )}
                  </label>
                ))}
                {filteredWorkers.length === 0 && (
                  <div className="px-3 py-4 text-xs text-slate-500">
                    No hay resultados para la busqueda.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Impresion</div>
              <div className="grid gap-3 text-sm text-slate-600">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <span>Tamano de pagina</span>
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                    value={paperSize}
                    onChange={(event) => setPaperSize(event.target.value as PaperSize)}
                  >
                    {Object.entries(PAPER_SIZES).map(([key, option]) => (
                      <option key={key} value={key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <span>Guias de corte</span>
                  <input
                    type="checkbox"
                    checked={showCutLines}
                    onChange={(event) => setShowCutLines(event.target.checked)}
                  />
                </label>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                  {BADGE_WIDTH_MM} x {BADGE_HEIGHT_MM} mm por credencial. {columns} x {rows} por
                  pagina.
                </div>
                {truncatedCount > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {truncatedCount} nombres fueron recortados para el QR. Ajusta si es necesario.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col space-y-4">
            <div className="badge-no-print flex items-center justify-between text-sm text-slate-600">
              <div>
                {badgeItems.length === 0
                  ? 'Selecciona trabajadores para generar credenciales.'
                  : `${badgeItems.length} credenciales en ${pages.length} paginas`}
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={!canPrint}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                Imprimir
              </button>
            </div>

            <div
              ref={previewRef}
              className="badge-print-root badge-screen-only flex-1 min-h-0 space-y-6 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              {pages.map((page, pageIndex) => (
                <div
                  key={`page-${pageIndex}`}
                  className="badge-page-outer mx-auto overflow-hidden rounded-2xl"
                  style={{
                    width: `${scaledPageWidth}mm`,
                    height: `${scaledPageHeight}mm`,
                    pageBreakAfter: pageIndex === pages.length - 1 ? 'auto' : 'always',
                  }}
                >
                  <div
                    className="badge-page badge-page-preview h-full w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    style={{
                      width: `${paper.width}mm`,
                      height: `${paper.height}mm`,
                      padding: `${PAGE_MARGIN_MM}mm`,
                      transform: `scale(${previewScale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `repeat(${columns}, ${BADGE_WIDTH_MM}mm)`,
                        gridAutoRows: `${BADGE_HEIGHT_MM}mm`,
                        gap: `${BADGE_GAP_MM}mm`,
                        justifyContent: 'center',
                        alignContent: 'start',
                      }}
                    >
                      {page.map((badge) => (
                        <div
                          key={badge.id}
                          className={`badge-card flex items-center justify-center rounded-xl bg-white ${
                            showCutLines ? 'border border-dashed border-slate-300' : ''
                          }`}
                          style={{ width: `${BADGE_WIDTH_MM}mm`, height: `${BADGE_HEIGHT_MM}mm` }}
                        >
                          <div className="badge-card-inner flex h-full w-full items-center justify-between gap-6 p-5">
                            <div className="badge-name-section flex h-full min-w-0 flex-1 flex-col justify-between">
                              <div className="badge-logo-container flex h-[10mm] w-full items-start">
                                <img
                                  src={logoSrc}
                                  alt="Logo"
                                  className="h-full w-auto object-contain"
                                />
                              </div>
                              <div className="badge-name-text mb-1 flex flex-col gap-0.5 text-left text-slate-900">
                                <div 
                                  className="badge-first-name font-extrabold uppercase leading-none"
                                  style={{ fontSize: getDynamicFontSize(badge.firstName, 22, 33) }}
                                >
                                  {badge.firstName}
                                </div>
                                <div 
                                  className="badge-last-name font-medium uppercase tracking-wide text-slate-500"
                                  style={{ fontSize: getDynamicFontSize(badge.lastName, 13, 33) }}
                                >
                                  {badge.lastName}
                                </div>
                              </div>
                            </div>
                            <div className="badge-qr-container flex items-center justify-center rounded border border-slate-100 bg-white p-1">
                              <svg
                                width={`${QR_SIZE_MM}mm`}
                                height={`${QR_SIZE_MM}mm`}
                                viewBox={`0 0 ${badge.moduleCount} ${badge.moduleCount}`}
                                style={{ color: 'black' }}
                                shapeRendering="crispEdges"
                              >
                                <rect
                                  x="0"
                                  y="0"
                                  width={badge.moduleCount}
                                  height={badge.moduleCount}
                                  fill="white"
                                />
                                <path d={badge.path} fill="currentColor" />
                              </svg>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              {pages.length === 0 && (
                <div className="flex h-64 items-center justify-center text-sm text-slate-500">
                  Vista previa disponible cuando selecciones trabajadores.
                </div>
              )}
            </div>

            <div className="badge-print-only">
              {pages.map((page, pageIndex) => (
                <div
                  key={`print-page-${pageIndex}`}
                  className={`badge-page-outer ${pageIndex < pages.length - 1 ? 'badge-page-break' : ''}`}
                  style={{
                    width: `${paper.width}mm`,
                    height: `${paper.height}mm`,
                  }}
                >
                  <div
                    className="badge-page"
                    style={{
                      width: `${paper.width}mm`,
                      height: `${paper.height}mm`,
                      padding: `${PAGE_MARGIN_MM}mm`,
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${columns}, ${BADGE_WIDTH_MM}mm)`,
                        gridAutoRows: `${BADGE_HEIGHT_MM}mm`,
                        gap: `${BADGE_GAP_MM}mm`,
                        justifyContent: 'center',
                        alignContent: 'start',
                      }}
                    >
                      {page.map((badge) => (
                        <div
                          key={badge.id}
                          className="badge-card"
                          style={{
                            width: `${BADGE_WIDTH_MM}mm`,
                            height: `${BADGE_HEIGHT_MM}mm`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: '#fff',
                            border: showCutLines ? '1px dashed #cbd5e1' : 'none',
                          }}
                        >
                          <div
                            className="badge-card-inner"
                            style={{
                              display: 'flex',
                              height: '100%',
                              width: '100%',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '1.5rem',
                              padding: '1.25rem 1.25rem',
                            }}
                          >
                            <div
                              className="badge-name-section"
                              style={{
                                display: 'flex',
                                height: '100%',
                                minWidth: 0,
                                flex: 1,
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                              }}
                            >
                              <div
                                className="badge-logo-container"
                                style={{
                                  display: 'flex',
                                  width: '100%',
                                  alignItems: 'flex-start',
                                  height: '10mm',
                                }}
                              >
                                <img
                                  src={logoSrc}
                                  alt="Logo"
                                  style={{ height: '100%', width: 'auto', objectFit: 'contain' }}
                                />
                              </div>
                              <div
                                className="badge-name-text"
                                style={{
                                  textAlign: 'left',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '0.125rem',
                                  marginBottom: '0.25rem',
                                  color: '#0f172a',
                                }}
                              >
                                <div
                                  className="badge-first-name"
                                  style={{
                                    fontSize: getDynamicFontSize(badge.firstName, 22, 33),
                                    fontWeight: 800,
                                    textTransform: 'uppercase',
                                    lineHeight: 1,
                                  }}
                                >
                                  {badge.firstName}
                                </div>
                                <div
                                  className="badge-last-name"
                                  style={{
                                    fontSize: getDynamicFontSize(badge.lastName, 13, 33),
                                    fontWeight: 500,
                                    textTransform: 'uppercase',
                                    color: '#64748b',
                                    letterSpacing: '0.025em',
                                  }}
                                >
                                  {badge.lastName}
                                </div>
                              </div>
                            </div>
                            <div
                              className="badge-qr-container"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: '#fff',
                                padding: '0.25rem',
                                border: '1px solid #f1f5f9',
                                borderRadius: '0.25rem',
                              }}
                            >
                              <svg
                                width={`${QR_SIZE_MM}mm`}
                                height={`${QR_SIZE_MM}mm`}
                                viewBox={`0 0 ${badge.moduleCount} ${badge.moduleCount}`}
                                style={{ color: 'black', display: 'block' }}
                                shapeRendering="crispEdges"
                              >
                                <rect
                                  x="0"
                                  y="0"
                                  width={badge.moduleCount}
                                  height={badge.moduleCount}
                                  fill="white"
                                />
                                <path d={badge.path} fill="currentColor" />
                              </svg>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="badge-no-print flex items-center justify-between border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
          <span>La impresion usa {paper.label} con guias de corte para credenciales.</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Listo
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default WorkerBadgePrinter;
