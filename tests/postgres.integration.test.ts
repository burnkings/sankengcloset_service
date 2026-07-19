import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PostgresRepository } from "../src/repositories/postgres.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL repository integration", () => {
  const admin = postgres(databaseUrl, { max: 1 });
  const repository = new PostgresRepository(databaseUrl);

  beforeAll(async () => {
    await admin.unsafe(`
      truncate table
        ai_import_confirmations,
        wardrobe_items,
        wishlist_items,
        ai_import_suggestions,
        ai_import_tasks,
        media_objects,
        sync_operations,
        release_events,
        product_images,
        products,
        user_identities,
        users
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await repository.close();
    await admin.end();
  });

  it("persists feed data and keeps sync operation IDs idempotent", async () => {
    const user = await repository.ensureDevUser("数据库测试用户");
    expect(user.id).toBe("usr_dev");

    await admin`
      insert into products
        (id, brand_id, brand_name, title, category, status, cover_url, price_cents, original_price_cents)
      values
        ('prd_ci_jk', 'br_ci', 'CI 品牌', 'CI 深蓝格裙', 'JK', 'PRE_ORDER', '/ci/jk.jpg', 12800, 16800)
    `;

    const feed = await repository.listFeed(user.id, {
      channel: "reservation",
      category: "JK",
      cursor: "",
      limit: 10,
    });
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]?.entityId).toBe("prd_ci_jk");
    expect(feed.items[0]?.badgeText).toBe("预约");
    expect(feed.hasMore).toBe(false);

    const operation = {
      opId: "op_ci_same",
      deviceId: "device_ci",
      entityType: "favorite",
      entityId: "prd_ci_jk",
      action: "create",
      payload: "{}",
      createdAt: String(Date.now()),
    };
    const first = await repository.applySyncBatch(user.id, [operation]);
    const second = await repository.applySyncBatch(user.id, [operation]);
    expect(second).toEqual(first);

    const rows = await admin`
      select count(*)::int as count
      from sync_operations
      where user_id = ${user.id} and op_id = ${operation.opId}
    `;
    expect(rows[0]?.count).toBe(1);
  });
});
