'use client';

import { useRouter } from 'next/navigation';
import { memo, useEffect } from 'react';

import { CHARACTER_STORAGE_KEY, useCharacterStore } from '@/store/character';
import { DANCE_STORAGE_KEY } from '@/store/dance';
import { SETTING_STORAGE_KEY, useSettingStore } from '@/store/setting';
import { vidolStorage } from '@/utils/storage';

const MIGRATION_KEY = 'MIGRATE_TO_INDEXED_DB';

export const migrateLocalStorageToIndexedDB = async (storageKey: string) => {
  const localStorageData = localStorage.getItem(storageKey);
  if (localStorageData) {
    await vidolStorage.setItem(storageKey, localStorageData);
    localStorage.removeItem(storageKey);
  }
};

const migrate = async () => {
  // localstorage 迁移到 indexeddb 后，删除迁移标识
  if (localStorage.getItem(MIGRATION_KEY)) return;
  await migrateLocalStorageToIndexedDB(CHARACTER_STORAGE_KEY);
  await migrateLocalStorageToIndexedDB(SETTING_STORAGE_KEY);
  await migrateLocalStorageToIndexedDB(DANCE_STORAGE_KEY);
  localStorage.setItem(MIGRATION_KEY, 'true');
};

/**
 * 客户端水合
 *
 * agent / 会话两个 store 已删除，这里只负责：旧 localStorage 数据迁移到 IndexedDB、
 * 人物 store 重新水合、语言模型列表刷新、两条路由预取。
 */
const StoreHydration = () => {
  const router = useRouter();

  const refreshDefaultModelProviderList = useSettingStore((s) => s.refreshDefaultModelProviderList);

  useEffect(() => {
    migrate().then(() => {
      useCharacterStore.persist.rehydrate();
    });

    refreshDefaultModelProviderList();
  }, []);

  useEffect(() => {
    // 只剩 舞台 / 设置 两个入口
    router.prefetch('/');
    router.prefetch('/settings/common');
  }, [router]);

  return null;
};

export default memo(StoreHydration);
