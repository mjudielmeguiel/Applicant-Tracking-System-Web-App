import jpeg from 'npm:jpeg-js@0.4.4';
import { decode } from 'npm:fast-png@6.2.0';
import { imageMetrics } from './image-metrics.ts';

export function imageQuality(bytes: Uint8Array, extension: string, idPhoto: boolean) {
  if (!['jpg', 'jpeg', 'png'].includes(extension)) return { checked: false, rejected: false, comment: '', method: 'manual-document-review' };
  if (extension === 'png') {
    if (bytes.length < 24) throw Error('The PNG image is incomplete.');
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (header.getUint32(16) * header.getUint32(20) > 16000000) throw Error('Choose an image with at most 16 megapixels.');
    const image = decode(bytes);
    return imageMetrics(image.data, image.width, image.height, image.channels, image.depth, idPhoto);
  }
  const image = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 16, maxMemoryUsageInMB: 96 });
  return imageMetrics(image.data, image.width, image.height, 4, 8, idPhoto);
}
