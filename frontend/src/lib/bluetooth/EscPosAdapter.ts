import type { PrinterAdapter } from './types';

export class EscPosAdapter implements PrinterAdapter {
  init(): Uint8Array {
    return new Uint8Array([0x1B, 0x40]); // ESC @
  }

  text(content: string, bold = false, doubleWidth = false, doubleHeight = false): Uint8Array {
    const commands: number[] = [];
    
    let mode = 0;
    if (bold) mode |= 0x08;
    if (doubleHeight) mode |= 0x10;
    if (doubleWidth) mode |= 0x20;
    
    commands.push(0x1B, 0x21, mode); // ESC ! n

    // Strip Sinhala Unicode and normalize non-ASCII punctuation so single-byte ESC/POS never emits control/garbage bytes
    const sanitized = String(content || '')
      .replace(/[\u0D80-\u0DFF]+/g, '')
      .replace(/\(\s*\)/g, '')
      .replace(/\/\s*(?=[,\n\r]|$)/g, '')
      .replace(/[\u00B7\u2022\u2013\u2014]/g, '-')
      .replace(/[ \t]{2,}/g, ' ');
    
    for (let i = 0; i < sanitized.length; i++) {
      const code = sanitized.charCodeAt(i);
      if (code === 0x0A || code === 0x0D || code === 0x09) {
        commands.push(code);
      } else if (code >= 0x20 && code <= 0x7E) {
        commands.push(code);
      }
    }
    
    commands.push(0x1B, 0x21, 0x00);
    return new Uint8Array(commands);
  }

  // ESC a n — Set text alignment: 0=left, 1=center, 2=right
  align(alignment: 0 | 1 | 2): Uint8Array {
    return new Uint8Array([0x1B, 0x61, alignment]);
  }

  feed(lines = 3): Uint8Array {
    return new Uint8Array([0x1B, 0x64, lines]); // ESC d n
  }

  cut(): Uint8Array {
    return new Uint8Array([0x1D, 0x56, 0x41, 0x00]); // GS V A 0 (Partial Cut)
  }

  // Native ESC/POS QR Code (GS ( k)
  qrcode(data: string, size = 5): Uint8Array {
    const commands: number[] = [];
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    const len = bytes.length + 3;
    const pL = len & 0xFF;
    const pH = (len >> 8) & 0xFF;

    // Center alignment for QR
    commands.push(0x1B, 0x61, 0x01);

    // 1. Set QR model: GS ( k 4 0 49 65 50 0 (Model 2)
    commands.push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);

    // 2. Set module size: GS ( k 3 0 49 67 <size> (size in dots: 1-16, default 5)
    commands.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, Math.min(Math.max(size, 2), 8));

    // 3. Set error correction level: GS ( k 3 0 49 69 49 (M level)
    commands.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31);

    // 4. Store QR data: GS ( k <pL> <pH> 49 80 48 <data>
    commands.push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
    for (let i = 0; i < bytes.length; i++) {
      commands.push(bytes[i]);
    }

    // 5. Print QR code: GS ( k 3 0 49 81 48
    commands.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);

    // Reset alignment to Left
    commands.push(0x1B, 0x61, 0x00);

    return new Uint8Array(commands);
  }

  // Convert HTMLCanvasElement to ESC/POS raster image (GS v 0)
  image(canvas: HTMLCanvasElement): Uint8Array {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error("Could not get 2d context");

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Width in bytes (8 pixels per byte, padded to next byte boundary)
    const bytesWidth = Math.ceil(width / 8);

    const commands: number[] = [];

    // Initialize printer and set line spacing to 0
    commands.push(0x1B, 0x40); // ESC @ (Init)
    commands.push(0x1B, 0x33, 0x00); // ESC 3 0 (Set line spacing to 0)

    // GS v 0 raster print command
    commands.push(0x1D, 0x76, 0x30, 0x00); // GS v 0 0 (normal mode)
    
    // Set width and height
    commands.push(bytesWidth & 0xFF, (bytesWidth >> 8) & 0xFF);
    commands.push(height & 0xFF, (height >> 8) & 0xFF);

    // Process pixels to 1-bit monochrome
    for (let y = 0; y < height; y++) {
      for (let xByte = 0; xByte < bytesWidth; xByte++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xByte * 8 + bit;
          if (x < width) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];

            // Simple thresholding (Luminance < 128 is considered black if not fully transparent)
            // ESC/POS: 1 is black, 0 is white
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            if (a > 128 && luminance < 128) {
              byte |= (1 << (7 - bit));
            }
          }
        }
        commands.push(byte);
      }
    }

    // Reset line spacing to default
    commands.push(0x1B, 0x32); // ESC 2

    return new Uint8Array(commands);
  }

  // Helper to concat multiple Uint8Arrays
  static concat(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((acc, val) => acc + val.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
}
