'use client';

import { createStyles } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Flexbox, FlexboxProps } from 'react-layout-kit';

import BrandWatermark from '@/components/BrandWatermark';
import PanelTitle from '@/components/PanelTitle';

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    padding-block: 0 16px;
    padding-inline: 12px;
    background: ${token.colorBgContainer};
    border-inline-end: 1px solid ${token.colorBorder};
  `,
  /** 回舞台的入口：舞台那边已经没有侧栏了，这里得留一条回头路 */
  back: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    padding: 6px 10px;
    border: none;
    border-radius: 10px;

    font-size: 12px;
    color: ${token.colorTextSecondary};
    text-align: left;

    background: none;

    transition:
      color 150ms ease,
      background 150ms ease;

    &:hover {
      color: ${token.colorText};
      background: ${token.colorFillTertiary};
    }
  `,
}));

interface SidebarLayoutProps extends FlexboxProps {
  desc?: string;
  title?: string;
}

const SidebarLayout = ({ children, className, title, desc, ...rest }: SidebarLayoutProps) => {
  const { cx, styles } = useStyles();
  const { t } = useTranslation('settings');
  const router = useRouter();

  return (
    <Flexbox
      className={cx(styles.container, className)}
      flex={'none'}
      gap={20}
      width={280}
      {...rest}
    >
      <button
        className={styles.back}
        onClick={() => router.push('/')}
        style={{ marginTop: 8 }}
        type="button"
      >
        <ArrowLeft size={13} />
        回到舞台
      </button>
      <PanelTitle desc={desc || t('header.desc')} title={title || t('header.title')} />
      {children}
      <BrandWatermark paddingInline={12} />
    </Flexbox>
  );
};

export default SidebarLayout;
