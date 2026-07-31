/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable("teams", {
    id: { type: "serial", primaryKey: true },
    name: { type: "text", notNull: true },
    // 招待コードはチームごとに1つ。漏れたらリーダーが再発行できる。
    invite_code: { type: "text", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("teams", "teams_name_not_blank", {
    check: "length(btrim(name)) > 0",
  });

  pgm.createTable("team_members", {
    team_id: {
      type: "integer",
      notNull: true,
      // チームを消したら所属も消える
      references: "teams",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "integer",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    role: { type: "text", notNull: true },
    joined_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // 1人が複数チームに所属でき、チームごとに role を持つ
  pgm.addConstraint("team_members", "team_members_pkey", {
    primaryKey: ["team_id", "user_id"],
  });

  // enum ではなく CHECK にする。値の追加・変更をマイグレーションで扱いやすくするため。
  pgm.addConstraint("team_members", "team_members_role_valid", {
    check: "role IN ('leader', 'member')",
  });

  // 「自分が所属するチーム一覧」を引く経路に索引を張る
  pgm.createIndex("team_members", "user_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropTable("team_members");
  pgm.dropTable("teams");
};
