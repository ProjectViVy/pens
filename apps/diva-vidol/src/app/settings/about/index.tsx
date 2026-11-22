'use client';

import { Form, FormGroup, FormItem } from '@lobehub/ui';
import { Button } from 'antd';
import { createStyles } from 'antd-style';
import { Book, Coffee, Github, Info, LifeBuoy, Mail, MessageCircle } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Logo from '@/components/Logo';
import { BRANDING_NAME } from '@/constants/branding';
import {
  DISCORD,
  DOCUMENTS_REFER_URL,
  EMAIL_SUPPORT,
  GITHUB_ISSUES,
  GITHUB_REPO,
  KO_FI,
  WECHAT_QRCODE_URL,
} from '@/constants/url';
import { CURRENT_VERSION } from '@/constants/version';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-grow: 1;
    justify-content: center;
  `,
  version: css`
    font-family: ${token.fontFamilyCode};
    color: ${token.colorTextSecondary};
  `,
  qrCode: css`
    width: 152px;
    height: 152px;
    border-radius: ${token.borderRadius}px;
    object-fit: contain;
  `,
  qrFallback: css`
    display: flex;
    align-items: center;

    width: 152px;
    min-height: 64px;

    font-size: 12px;
    line-height: 1.6;
    color: ${token.colorTextDescription};
  `,
}));

interface LinkButtonProps {
  href: string;
  icon: React.ReactNode;
  label: string;
}

const LinkButton = ({ href, icon, label }: LinkButtonProps) => (
  <Button href={href} icon={icon} rel={'noreferrer'} target={'_blank'}>
    {label}
  </Button>
);

/**
 * 微信赞赏码
 *
 * 图片仍然挂在原来的外链上（r2 上的那张），拿不到时退化成一行说明，
 * 不让一处加载失败把整行撑成破图。
 */
const WechatQRCode = () => {
  const { styles } = useStyles();
  const { t } = useTranslation('settings');
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className={styles.qrFallback}>{t('about.wechat.qrUnavailable')}</div>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={t('about.wechat.qrAlt')}
      className={styles.qrCode}
      src={WECHAT_QRCODE_URL}
      onError={() => setFailed(true)}
    />
  );
};

/**
 * 关于
 *
 * 以前散在左侧栏的东西都收在这里：品牌图标、版本、GitHub、文档、
 * 反馈与社区入口，以及赞助作者。侧栏只留舞台 / 设置 / 切换场景。
 */
const About = () => {
  const { styles } = useStyles();
  const { t } = useTranslation('settings');

  return (
    <div className={styles.container}>
      <Form style={{ display: 'flex', flexGrow: 1 }}>
        <FormGroup icon={Info} title={t('about.app.title')}>
          <FormItem avatar={<Logo size={40} />} desc={t('about.app.desc')} label={BRANDING_NAME}>
            <span className={styles.version}>v{CURRENT_VERSION}</span>
          </FormItem>
          <FormItem divider desc={t('about.repository.desc')} label={t('about.repository.title')}>
            <LinkButton
              href={GITHUB_REPO}
              icon={<Github size={14} />}
              label={t('about.repository.action')}
            />
          </FormItem>
          <FormItem divider desc={t('about.docs.desc')} label={t('about.docs.title')}>
            <LinkButton
              href={DOCUMENTS_REFER_URL}
              icon={<Book size={14} />}
              label={t('about.docs.action')}
            />
          </FormItem>
        </FormGroup>

        <FormGroup icon={LifeBuoy} title={t('about.help.title')}>
          <FormItem desc={t('about.feedback.desc')} label={t('about.feedback.title')}>
            <LinkButton
              href={GITHUB_ISSUES}
              icon={<Github size={14} />}
              label={t('about.feedback.action')}
            />
          </FormItem>
          <FormItem divider desc={t('about.community.desc')} label={t('about.community.title')}>
            <LinkButton
              href={DISCORD}
              icon={<MessageCircle size={14} />}
              label={t('about.community.action')}
            />
          </FormItem>
          <FormItem divider desc={t('about.email.desc')} label={t('about.email.title')}>
            <LinkButton
              href={EMAIL_SUPPORT}
              icon={<Mail size={14} />}
              label={t('about.email.action')}
            />
          </FormItem>
        </FormGroup>

        <FormGroup icon={Coffee} title={t('about.support.title')}>
          <FormItem desc={t('about.coffee.desc')} label={t('about.coffee.title')}>
            <LinkButton
              href={KO_FI}
              icon={<Coffee size={14} />}
              label={t('about.coffee.action')}
            />
          </FormItem>
          <FormItem divider desc={t('about.wechat.desc')} label={t('about.wechat.title')}>
            <WechatQRCode />
          </FormItem>
        </FormGroup>
      </Form>
    </div>
  );
};

export default About;
