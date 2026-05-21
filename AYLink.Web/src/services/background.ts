import { ref } from 'vue';

const BACKGROUND_ENABLED_KEY = 'aylink.settings.backgroundEnabled';

export interface BackgroundImage {
  id: string;
  dataUrl: string;
}

const dbName = 'aylink_backgrounds';
const storeName = 'images';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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

export const backgroundEnabled = ref(localStorage.getItem(BACKGROUND_ENABLED_KEY) === 'true');
export const backgroundImages = ref<BackgroundImage[]>([]);
export const currentBackgroundImage = ref<string | null>(null);

export async function loadBackgroundImages() {
  try {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    
    request.onsuccess = () => {
      backgroundImages.value = request.result || [];
      updateCurrentBackgroundImage();
    };
  } catch (e) {
    console.error('Failed to load background images', e);
  }
}

export async function addBackgroundImages(files: File[]) {
  const db = await openDB();
  
  for (const file of files) {
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve) => {
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const img: BackgroundImage = { id, dataUrl };
    
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.add(img);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    
    backgroundImages.value.push(img);
  }
  
  updateCurrentBackgroundImage();
}

export async function removeBackgroundImage(id: string) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  
  backgroundImages.value = backgroundImages.value.filter(img => img.id !== id);
  updateCurrentBackgroundImage();
}

export function setBackgroundEnabled(enabled: boolean) {
  backgroundEnabled.value = enabled;
  localStorage.setItem(BACKGROUND_ENABLED_KEY, String(enabled));
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
