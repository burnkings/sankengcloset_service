import postgres from 'postgres';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { max: 1 });
try {
  await sql`insert into users (id, nickname, status) values ('usr_dev', '本地测试用户', 'active') on conflict (id) do nothing`;
  await sql`
    insert into products (id, brand_id, brand_name, title, category, status, cover_url, price_cents, original_price_cents, description)
    values
      ('prd_jk_navy_45', 'br_rabbit', '兔缝缝', '深蓝格裙 45cm', 'JK', 'ON_SALE', '/media/demo/jk-navy.jpg', 12800, 16800, '本地开发种子数据'),
      ('prd_lolita_moon', 'br_starcat', '星辰猫', '月光曲 JSK', 'LOLITA', 'PRE_ORDER', '/media/demo/moon-jsk.jpg', 36800, 39800, '本地开发种子数据'),
      ('prd_hanfu_song', 'br_flower', '花笺', '宋制旋裙套装', 'HANFU', 'UPCOMING', '/media/demo/hanfu-song.jpg', 25800, 0, '本地开发种子数据')
    on conflict (id) do nothing
  `;
  console.log('Seeded development user and products');
} finally {
  await sql.end();
}
