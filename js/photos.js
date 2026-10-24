// Photos: shrunk on the device before saving, shown through cached object URLs,
// and turned into data URLs only for backups.

const MAX_SIDE = 1600;
const urls = new Map();

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older browsers: fall back to an <img>, which also applies the camera's rotation.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Resizes a camera photo to at most 1600 px on its long side and re-encodes it as JPEG. */
export async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a photo.`);
  const img = await decode(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  img.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error(`${file.name} could not be read.`);
  return { blob, width, height, lastModified: file.lastModified || null };
}

export function photoUrl(photo) {
  if (!urls.has(photo.id)) urls.set(photo.id, URL.createObjectURL(photo.blob));
  return urls.get(photo.id);
}

export function forgetPhotos(ids) {
  for (const id of ids ?? [...urls.keys()]) {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Decoded by hand: the page's security policy does not allow fetch() on data: URLs.
export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const type = head.match(/^data:([^;]+)/)[1];
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}
