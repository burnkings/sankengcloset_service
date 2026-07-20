// tests/crawler/images.test.ts — 图片处理测试

import { describe, it, expect } from 'vitest';
import { SsrfGuard } from '../../src/crawler/images/ssrf-guard.js';

describe('SsrfGuard', () => {
  const guard = new SsrfGuard();

  it('should allow public HTTPS URLs', () => {
    const r = guard.validate('https://example.com/image.jpg');
    expect(r.safe).toBe(true);
  });

  it('should block localhost', () => {
    expect(guard.validate('http://localhost/admin').safe).toBe(false);
    expect(guard.validate('http://127.0.0.1/admin').safe).toBe(false);
  });

  it('should block private IPs', () => {
    expect(guard.validate('http://192.168.1.1/secret').safe).toBe(false);
    expect(guard.validate('http://10.0.0.1/admin').safe).toBe(false);
    expect(guard.validate('http://172.16.0.1/admin').safe).toBe(false);
  });

  it('should block non-standard ports', () => {
    expect(guard.validate('https://example.com:8080/image.jpg').safe).toBe(false);
  });

  it('should block file:// protocol', () => {
    expect(guard.validate('file:///etc/passwd').safe).toBe(false);
  });

  it('should block ftp:// protocol', () => {
    expect(guard.validate('ftp://example.com/file.jpg').safe).toBe(false);
  });

  it('should block loopback IPv6', () => {
    expect(guard.validate('http://[::1]/admin').safe).toBe(false);
  });

  it('should sanitize URLs', () => {
    const clean = guard.sanitize('https://example.com/path?q=1#fragment');
    expect(clean).toBe('https://example.com/path?q=1');
    expect(clean).not.toContain('#');
  });
});
