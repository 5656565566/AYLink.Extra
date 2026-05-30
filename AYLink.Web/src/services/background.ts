import { ref } from 'vue';
import { readLocalBoolean, writeLocalBoolean } from '../core/storage/browserStorage';
import { storageKeys } from '../core/storage/keys';

const BACKGROUND_ENABLED_KEY = storageKeys.app.backgroundEnabled;

export interface BackgroundImage {
  id: string;
  dataUrl: string;
}

const dbName = 'aylink_backgrounds';
const storeName = 'images';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'));
      return;
    }

    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const backgroundEnabled = ref(readLocalBoolean(BACKGROUND_ENABLED_KEY));
export const backgroundImages = ref<BackgroundImage[]>([]);
export const currentBackgroundImage = ref<string | null>(null);

function closeDatabase(db: IDBDatabase) {
  try {
    db.close();
  } catch (error) {
    console.warn('Failed to close background image database cleanly', error);
  }
}

function isValidBackgroundImageRecord(value: unknown): value is BackgroundImage {
  return !!value
    && typeof value === 'object'
    && typeof (value as BackgroundImage).id === 'string'
    && typeof (value as BackgroundImage).dataUrl === 'string'
    && (value as BackgroundImage).dataUrl.startsWith('data:image/');
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error(`Failed to read background image file: ${file.name}`));
    };
    reader.onabort = () => {
      reject(new Error(`Background image file read was aborted: ${file.name}`));
    };

    reader.readAsDataURL(file);
  });
}

export async function loadBackgroundImages() {
  let db: IDBDatabase | null = null;

  try {
    db = await openDB();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    
    request.onsuccess = () => {
      backgroundImages.value = Array.isArray(request.result)
        ? request.result.filter(isValidBackgroundImageRecord)
        : [];
      updateCurrentBackgroundImage();
    };
    request.onerror = () => {
      console.error('Failed to read background images from IndexedDB', request.error);
    };
  } catch (e) {
    console.error('Failed to load background images', e);
    backgroundImages.value = [];
    updateCurrentBackgroundImage();
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

export async function addBackgroundImages(files: File[]) {
  let db: IDBDatabase | null = null;

  try {
    db = await openDB();
    const database = db;
    
    for (const file of files) {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl.startsWith('data:image/')) {
        console.warn('Skipped non-image background file payload', {
          fileName: file.name,
          mimeType: file.type
        });
        continue;
      }
      
      const id = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
      const img: BackgroundImage = { id, dataUrl };
      
      await new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.add(img);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      
      backgroundImages.value.push(img);
    }
    
    updateCurrentBackgroundImage();
  } catch (error) {
    console.error('Failed to add background images', {
      fileCount: files.length,
      error
    });
    throw error;
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

export async function removeBackgroundImage(id: string) {
  let db: IDBDatabase | null = null;

  try {
    db = await openDB();
    const database = db;
    await new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    
    backgroundImages.value = backgroundImages.value.filter(img => img.id !== id);
    updateCurrentBackgroundImage();
  } catch (error) {
    console.error('Failed to remove background image', {
      id,
      error
    });
    throw error;
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

export function setBackgroundEnabled(enabled: boolean) {
  backgroundEnabled.value = enabled;
  writeLocalBoolean(BACKGROUND_ENABLED_KEY, enabled);
  updateCurrentBackgroundImage();
}

export function updateCurrentBackgroundImage() {
  if (!backgroundEnabled.value || backgroundImages.value.length === 0) {
    currentBackgroundImage.value = null;
    applyBackgroundToBody(null);
    return;
  }
  
  const randomIndex = Math.floor(Math.random() * backgroundImages.value.length);
  currentBackgroundImage.value = backgroundImages.value[randomIndex].dataUrl;
  applyBackgroundToBody(currentBackgroundImage.value);
}

function applyBackgroundToBody(dataUrl: string | null) {
  if (typeof document === 'undefined' || !document.body) {
    return;
  }

  if (dataUrl) {
    document.body.classList.add('has-background-image');
    document.body.style.backgroundImage = `url("${dataUrl}")`;
  } else {
    document.body.classList.remove('has-background-image');
    document.body.style.backgroundImage = '';
  }
}

if (typeof window !== 'undefined') {
  loadBackgroundImages();
}
