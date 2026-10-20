import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '自用 · 本地音乐播放器', description: '自己的音乐，自己的分类。本地音乐文件夹绑定、分类与多格式播放。' };
export default function RootLayout({children}: {children: React.ReactNode}) { return <html lang="zh-CN" className="dark"><body>{children}</body></html>; }
