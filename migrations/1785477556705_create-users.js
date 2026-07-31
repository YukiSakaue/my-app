/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable("users", {
    id: { type: "serial", primaryKey: true },
    name: { type: "text", notNull: true },
    // メールは小文字に正規化してから保存する。text は大文字小文字を区別するため、
    // 正規化しないと同じ人が Taro@… と taro@… で二重登録できてしまう。
    email: { type: "text", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // アプリ側の小文字化を忘れても DB が弾くようにしておく
  pgm.addConstraint("users", "users_email_lowercase", {
    check: "email = lower(email)",
  });
  pgm.addConstraint("users", "users_email_not_blank", {
    check: "length(btrim(email)) > 0",
  });
  pgm.addConstraint("users", "users_name_not_blank", {
    check: "length(btrim(name)) > 0",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropTable("users");
};
