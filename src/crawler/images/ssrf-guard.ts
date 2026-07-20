// crawler/images/ssrf-guard.ts — SSRF 防护

import { isIPv4, isIPv6 } from 'node:net';

/** 禁止访问的内部 IP 范围 */
const BLOCKED_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
  /^ff/,
];

/** 禁止的 scheme */
const BLOCKED_SCHEMES = ['file:', 'ftp:', 'gopher:', 'dict:', 'jar:', 'data:', 'javascript:'];

export class SsrfGuard {
  /** 验证 URL 是否安全可访问 */
  validate(url: string): { safe: boolean; reason: string } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { safe: false, reason: 'URL 格式无效' };
    }

    // Scheme 检查
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: `禁止的协议: ${parsed.protocol}` };
    }

    // 禁止的 scheme
    for (const blocked of BLOCKED_SCHEMES) {
      if (url.toLowerCase().startsWith(blocked)) {
        return { safe: false, reason: `禁止的 scheme: ${blocked}` };
      }
    }

    // Hostname 检查
    const hostname = parsed.hostname.toLowerCase();

    // 禁止 localhost 变体
    if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
      return { safe: false, reason: '禁止访问 localhost' };
    }

    // 禁止内部 IP
    for (const range of BLOCKED_RANGES) {
      if (range.test(hostname)) {
        return { safe: false, reason: `禁止访问内部 IP: ${hostname}` };
      }
    }

    // 禁止 IPv6 环回
    if (hostname.includes('[') && hostname.includes(']')) {
      return { safe: false, reason: '禁止 IPv6 地址' };
    }

    // 禁止非标准端口（仅允许 80/443）
    const port = parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    if (port !== 80 && port !== 443) {
      return { safe: false, reason: `禁止非标准端口: ${port}` };
    }

    // 禁止特殊字符（可能用于绕过）
    if (hostname.includes('@') || hostname.includes('#') || hostname.includes('\\')) {
      return { safe: false, reason: 'hostname 包含非法字符' };
    }

    return { safe: true, reason: '' };
  }

  /** 清理 URL（移除危险部分） */
  sanitize(url: string): string {
    try {
      const parsed = new URL(url);
      // 只保留 protocol + hostname + port + pathname + search
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }
}
