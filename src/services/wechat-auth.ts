import { AppProblem } from '../lib/problem.js';

interface WechatCodeSessionResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

export interface WechatSession {
  openId: string;
  unionId: string;
}

export async function exchangeWechatCode(appId: string, appSecret: string, code: string): Promise<WechatSession> {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
  } catch {
    throw new AppProblem(503, 'SERVER_ERROR', '微信登录服务暂时不可用', true);
  }
  if (!response.ok) throw new AppProblem(503, 'SERVER_ERROR', '微信登录服务暂时不可用', true);

  const payload = await response.json() as WechatCodeSessionResponse;
  if (payload.errcode != null && payload.errcode !== 0) {
    throw new AppProblem(401, 'UNAUTHORIZED', '登录凭证已失效，请重试', false);
  }
  if (payload.openid == null || payload.openid === '') {
    throw new AppProblem(502, 'SERVER_ERROR', '微信登录返回缺少用户标识', true);
  }
  return { openId: payload.openid, unionId: payload.unionid ?? '' };
}
