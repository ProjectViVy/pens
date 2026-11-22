'use client';

import dynamic from 'next/dynamic';
import React, { memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';
import { Spin } from 'antd';

const Stage = dynamic(() => import('@/features/Stage'), {
  ssr: false,
  loading: () => (
    <Center style={{ height: '100%', width: '100%' }}>
      <Spin />
    </Center>
  ),
});

/**
 * 舞台（首页）
 *
 * 普通聊天与 agent 都已经移除，这里只渲染 3D 舞台。
 */
const StagePage = () => {
  return (
    <Flexbox flex={1} height={'100%'} width={'100%'} horizontal>
      <Stage />
    </Flexbox>
  );
};

export default memo(StagePage);
