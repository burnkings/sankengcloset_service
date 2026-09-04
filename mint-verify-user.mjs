// 生成生产验证用测试用户 + JWT（密钥不落终端输出）
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import postgres from 'postgres';

const env = Object.fromEntries(
  readFileSync('/home/admin/projects/sankengcloset_service/.env.production', 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sql = postgres(env.DATABASE_URL, { max: 2 });

const USER_ID = 'usr_curl_test';
const NICKNAME = '接口验证用户';
await sql`insert into users (id, nickname, status) values (${USER_ID}, ${NICKNAME}, 'active')
  on conflict (id) do nothing`;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const now = Math.floor(Date.now() / 1000);
const jti = () => createHash('sha256').update(`${USER_ID}:${Date.now()}:${randomBytes(8).toString('hex')}`).digest('hex').slice(0, 16);
const sign = (payload, expSec) => {
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + expSec }));
  const sig = createHmac('sha256', env.JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
};

const accessToken = sign({ sub: USER_ID, kind: 'access', jti: jti() }, 900);
const refreshToken = sign({ sub: USER_ID, kind: 'refresh', jti: jti() }, 30 * 24 * 3600);
const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
await sql`insert into user_sessions (id, user_id, refresh_token_hash, device_id, expires_at)
  values (${`ses_curl_${Date.now()}_${randomBytes(4).toString('hex')}`}, ${USER_ID}, ${refreshHash}, 'curl-verify', now() + interval '30 days')`;

import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/verify-tokens.env', `ACCESS_TOKEN=${accessToken}\nREFRESH_TOKEN=${refreshToken}\nUSER_ID=${USER_ID}\n`);
console.log('TOKENS_MINTED');
await sql.end();
