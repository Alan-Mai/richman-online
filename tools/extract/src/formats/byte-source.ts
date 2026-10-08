import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** Random-access, read-only view of a file, so large archives never need to be loaded whole. */
export interface ByteSource {
  readonly size: number;
  /** Returns exactly `length` bytes; throws RangeError if the range runs past the end. */
  read(offset: number, length: number): Uint8Array;
}

function checkRange(size: number, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > size) {
    throw new RangeError(`read [${offset}, ${offset + length}) outside size ${size}`);
  }
}

export function bufferByteSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read(offset, length) {
      checkRange(bytes.length, offset, length);
      return bytes.subarray(offset, offset + length);
    },
  };
}

export interface FileByteSource extends ByteSource {
  close(): void;
}

/** Opens a file read-only; the original game directory must never be modified. */
export function openFileByteSource(filePath: string): FileByteSource {
  const fd = openSync(filePath, 'r');
  const size = fstatSync(fd).size;
  return {
    size,
    read(offset, length) {
      checkRange(size, offset, length);
      const out = new Uint8Array(length);
      let done = 0;
      while (done < length) {
        const n = readSync(fd, out, done, length - done, offset + done);
        if (n === 0) throw new RangeError(`unexpected end of file at ${offset + done}`);
        done += n;
      }
      return out;
    },
    close() {
      closeSync(fd);
    },
  };
}
