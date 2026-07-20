// src/scheduler/alerter.ts — 告警器

export interface Alert {
  level: 'info' | 'warn' | 'error';
  title: string;
  message: string;
  timestamp: Date;
}

export interface AlertChannel {
  send(alert: Alert): Promise<void>;
}

/** 日志告警 */
export class LogAlertChannel implements AlertChannel {
  async send(alert: Alert): Promise<void> {
    const prefix = alert.level === 'error' ? '❌' : alert.level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`[${alert.timestamp.toISOString()}] ${prefix} ${alert.title}: ${alert.message}`);
  }
}

/** Telegram Bot 告警 */
export class TelegramAlertChannel implements AlertChannel {
  constructor(private readonly botToken: string, private readonly chatId: string) {}

  async send(alert: Alert): Promise<void> {
    if (!this.botToken || !this.chatId) return;
    const prefix = alert.level === 'error' ? '🚨' : alert.level === 'warn' ? '⚠️' : 'ℹ️';
    const text = `${prefix} *${alert.title}*\n${alert.message}\n_${alert.timestamp.toISOString()}_`;

    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: 'Markdown' }),
      });
    } catch (e) {
      console.error('Telegram alert failed:', (e as Error).message);
    }
  }
}

/** 多通道告警器 */
export class Alerter {
  private channels: AlertChannel[] = [];
  private sent = new Map<string, number>(); // 防重复发送

  addChannel(channel: AlertChannel): void { this.channels.push(channel); }

  async alert(level: Alert['level'], title: string, message: string): Promise<void> {
    // 防重复：同一标题 5 分钟内不重复发送
    const key = title;
    const lastSent = this.sent.get(key) ?? 0;
    if (Date.now() - lastSent < 5 * 60 * 1000) return;

    const alert: Alert = { level, title, message, timestamp: new Date() };
    this.sent.set(key, Date.now());

    for (const channel of this.channels) {
      try { await channel.send(alert); } catch {}
    }
  }

  async info(title: string, message: string): Promise<void> { await this.alert('info', title, message); }
  async warn(title: string, message: string): Promise<void> { await this.alert('warn', title, message); }
  async error(title: string, message: string): Promise<void> { await this.alert('error', title, message); }
}
