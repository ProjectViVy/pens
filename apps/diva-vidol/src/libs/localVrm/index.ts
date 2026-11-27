/**
 * 本地 VRM 库
 *
 * 导入的模型存在浏览器的 IndexedDB 里，而不是写进 `public/assets/agents`：
 * 舞台是纯前端应用（Electron 窗口或普通浏览器打开都行），没有「往磁盘写文件」的接口，
 * 存浏览器里既不依赖服务端、也不依赖重启 dev server，刷新后还在。
 *
 * 两个 store：`meta` 只存名字/大小/时间（列表用，不用把几十 MB 的模型读进内存），
 * `blobs` 存真正的文件内容。
 */

export interface LocalVrmMeta {
  addedAt: number;
  id: string;
  name: string;
  size: number;
}

const DB_NAME = 'diva-local-vrm';
const DB_VERSION = 1;
const META = 'meta';
const BLOBS = 'blobs';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打不开本地模型库'));
  });

const runTx = async <T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> => {
  const db = await openDb();
  try {
    const tx = db.transaction(stores, mode);
    const result = await work(tx);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('本地模型库操作失败'));
      tx.onabort = () => reject(tx.error ?? new Error('本地模型库操作被中断'));
    });
    return result;
  } finally {
    db.close();
  }
};

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本地模型库请求失败'));
  });

/** 列表：只读 meta，不碰模型本体 */
export const listLocalVrm = async (): Promise<LocalVrmMeta[]> => {
  const metas = await runTx([META], 'readonly', (tx) =>
    requestToPromise<LocalVrmMeta[]>(tx.objectStore(META).getAll()),
  );
  return metas.sort((a, b) => b.addedAt - a.addedAt);
};

export const isVrmFile = (file: File) => /\.vrm$/i.test(file.name);

/** 存入一个模型，返回它的 meta。同名不合并：每次导入都是一条新记录。 */
export const addLocalVrm = async (file: File): Promise<LocalVrmMeta> => {
  if (!isVrmFile(file)) throw new Error('只支持 .vrm 文件');
  if (file.size === 0) throw new Error('文件是空的');

  const meta: LocalVrmMeta = {
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name.replace(/\.vrm$/i, ''),
    size: file.size,
    addedAt: Date.now(),
  };

  await runTx([META, BLOBS], 'readwrite', (tx) => {
    tx.objectStore(META).put(meta);
    tx.objectStore(BLOBS).put(file, meta.id);
  });

  return meta;
};

export const removeLocalVrm = async (id: string): Promise<void> => {
  const cached = urlCache.get(id);
  if (cached) {
    URL.revokeObjectURL(cached);
    urlCache.delete(id);
  }
  await runTx([META, BLOBS], 'readwrite', (tx) => {
    tx.objectStore(META).delete(id);
    tx.objectStore(BLOBS).delete(id);
  });
};

export const getLocalVrmBlob = async (id: string): Promise<Blob | undefined> =>
  runTx([BLOBS], 'readonly', (tx) => requestToPromise<Blob | undefined>(tx.objectStore(BLOBS).get(id)));

/** 同一份模型只创建一次 objectURL，避免每次挂画布都复制一份 */
const urlCache = new Map<string, string>();

/**
 * 把 `local:<id>` 换成能直接喂给 GLTFLoader 的 blob URL。
 * 不是本地前缀的地址原样返回（静态 `/assets/agents/...`）。
 */
export const resolveModelUrl = async (modelUrl: string): Promise<string> => {
  if (!modelUrl.startsWith('local:')) return modelUrl;

  const id = modelUrl.slice('local:'.length);
  const cached = urlCache.get(id);
  if (cached) return cached;

  const blob = await getLocalVrmBlob(id);
  if (!blob) throw new Error('本地模型已经不在了，重新导入一次');

  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
};
