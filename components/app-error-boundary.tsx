'use client';

import React from 'react';
import { translate } from '@/lib/i18n/core';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[自用音乐播放器] 页面初始化失败', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main
        role="alert"
        style={{
          minHeight: '100vh',
          boxSizing: 'border-box',
          padding: '48px 32px',
          background: '#111315',
          color: '#edf0ef',
          fontFamily: "Arial, 'PingFang SC', sans-serif",
        }}
      >
        <h1 style={{ fontSize: 24, margin: '0 0 14px' }}>{translate('页面加载失败')}</h1>
        <p style={{ color: '#aeb9b2', lineHeight: 1.8, maxWidth: 620 }}>
          {translate('播放器页面没有正常完成加载。你的音乐文件和音乐库不会因此被删除，可以先重新加载页面。')}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            border: 0,
            borderRadius: 7,
            padding: '10px 16px',
            background: '#b7f36b',
            color: '#14200c',
            cursor: 'pointer',
          }}
        >
          {translate('重新加载')}
        </button>
      </main>
    );
  }
}
