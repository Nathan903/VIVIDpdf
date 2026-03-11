// db.js
const DB_NAME = 'PDFReaderDB';
const DB_VERSION = 1;
const STORE_FILES = 'files';

export const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = (e) => reject(e.target.error);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }
    };
    
    request.onsuccess = (e) => resolve(e.target.result);
  });
};

// Generate a unique ID for a file based on name and size
export const getFileId = (file) => `${file.name}-${file.size}`;

export const saveFileRecord = async (fileObj) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    store.put(fileObj);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
};

export const getFileRecord = async (id) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readonly');
    const store = tx.objectStore(STORE_FILES);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

export const getRecentFiles = async () => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readonly');
    const store = tx.objectStore(STORE_FILES);
    const request = store.getAll();
    request.onsuccess = () => {
      // Sort by last opened date (descending)
      const res = request.result.sort((a, b) => b.lastOpened - a.lastOpened);
      // Remove blob to save memory
      const metadataOnly = res.map(r => {
        const { blob, ...rest } = r;
        rest.hasBlob = !!blob;
        return rest;
      });
      resolve(metadataOnly);
    };
    request.onerror = (e) => reject(e.target.error);
  });
};

export const updateFileMeta = async (id, meta) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const data = getReq.result;
      if (data) {
        const updated = { ...data, ...meta, lastOpened: Date.now() };
        store.put(updated);
      }
      resolve();
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
};

export const deleteFileRecord = async (id) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
};

export const getStorageInfo = async () => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readonly');
    const store = tx.objectStore(STORE_FILES);
    const request = store.getAll();
    request.onsuccess = () => {
      let usedBytes = 0;
      const records = request.result.map(r => {
        if (r.blob && r.blob.size) {
          usedBytes += r.blob.size;
        }
        return {
          id: r.id,
          lastOpened: r.lastOpened,
          hasBlob: !!r.blob,
          blobSize: (r.blob && r.blob.size) ? r.blob.size : 0
        };
      }).sort((a, b) => b.lastOpened - a.lastOpened);
      resolve({ usedBytes, records });
    };
    request.onerror = (e) => reject(e.target.error);
  });
};

export const deleteBlobs = async (ids) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    
    let completed = 0;
    let errors = 0;
    
    if (ids.length === 0) {
      resolve();
      return;
    }

    ids.forEach(id => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const data = getReq.result;
        if (data && data.blob) {
          delete data.blob;
          const putReq = store.put(data);
          putReq.onsuccess = () => {
            completed++;
            if (completed + errors === ids.length) resolve();
          };
          putReq.onerror = () => {
            errors++;
            if (completed + errors === ids.length) resolve();
          };
        } else {
          completed++;
          if (completed + errors === ids.length) resolve();
        }
      };
      getReq.onerror = () => {
        errors++;
        if (completed + errors === ids.length) resolve();
      };
    });
  });
};