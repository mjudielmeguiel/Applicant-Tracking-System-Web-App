// Resolution-normalized Laplacian sharpness check. This is a heuristic, not OCR.
// Images that fail remain privately stored so recruiters can review/override.
export function imageMetrics(data: ArrayLike<number>, width: number, height: number, channels: number, depth = 8, idPhoto = false) {
  if (width < 1 || height < 1 || width * height > 16000000 || channels < 1 || channels > 4) throw Error('The image dimensions are unsupported.');
  const scale = Math.min(1, 600 / Math.max(width, height));
  const w = Math.max(3, Math.floor(width * scale)), h = Math.max(3, Math.floor(height * scale));
  const gray = new Float64Array(w * h);
  const maximum = (2 ** depth) - 1;
  let sum = 0, squares = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sourceX = Math.min(width - 1, Math.floor(x / scale));
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    const index = (sourceY * width + sourceX) * channels;
    const red = Number(data[index]) * 255 / maximum;
    const green = channels < 3 ? red : Number(data[index + 1]) * 255 / maximum;
    const blue = channels < 3 ? red : Number(data[index + 2]) * 255 / maximum;
    const alpha = channels === 2 ? Number(data[index + 1]) / maximum : channels === 4 ? Number(data[index + 3]) / maximum : 1;
    const value = (.299 * red + .587 * green + .114 * blue) * alpha + 255 * (1 - alpha);
    gray[y * w + x] = value; sum += value; squares += value * value;
  }
  const contrast = Math.sqrt(Math.max(0, squares / gray.length - (sum / gray.length) ** 2));
  let lapSum = 0, lapSquares = 0, count = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const lap = gray[p - 1] + gray[p + 1] + gray[p - w] + gray[p + w] - 4 * gray[p];
    lapSum += lap; lapSquares += lap * lap; count++;
  }
  const variance = Math.max(0, lapSquares / count - (lapSum / count) ** 2);
  const normalized = variance / (contrast * contrast + 1);
  let comment = '';
  if (idPhoto && (width < 300 || height < 300 || Math.abs(width / height - 1) > .02)) {
    comment = 'Please upload a square 1×1 ID picture, at least 300×300 pixels, with your face clearly visible.';
  } else if (width < 128 || height < 128) {
    comment = 'The image resolution is too low. Please upload a larger, clearer image.';
  } else if (contrast < 8 || (variance < (idPhoto ? 25 : 55) && normalized < (idPhoto ? .015 : .025))) {
    comment = 'The image appears blurred or unclear. Please upload a clearer, well-lit image with readable details.';
  }
  return { checked: true, rejected: Boolean(comment), comment, width, height, variance: Math.round(variance * 100) / 100, contrast: Math.round(contrast * 100) / 100, normalized: Math.round(normalized * 10000) / 10000, method: 'laplacian-v1' };
}
