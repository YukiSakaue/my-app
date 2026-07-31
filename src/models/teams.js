import { query, queryOne, withTransaction } from "../db.js";
import { generateInviteCode, normalizeInviteCode } from "../lib/invite-codes.js";

const UNIQUE_VIOLATION = "23505";
const INVITE_CODE_ATTEMPTS = 5;

export const ROLES = { LEADER: "leader", MEMBER: "member" };

/**
 * チームを作り、作成者を leader として登録する。
 * 片方だけ成功して「リーダーのいないチーム」が残らないよう同一トランザクションで行う。
 */
export function createTeam({ name, creatorId }) {
  return withTransaction(async (client) => {
    const team = await insertTeamWithUniqueCode(client, name.trim());
    await client.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [team.id, creatorId, ROLES.LEADER]
    );
    return team;
  });
}

// 招待コードはランダムなので、まれに既存と衝突する。数回だけ引き直す。
async function insertTeamWithUniqueCode(client, name) {
  for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt += 1) {
    try {
      const result = await client.query(
        `INSERT INTO teams (name, invite_code)
         VALUES ($1, $2)
         RETURNING id, name, invite_code, created_at`,
        [name, generateInviteCode()]
      );
      return result.rows[0];
    } catch (err) {
      const isCodeCollision =
        err.code === UNIQUE_VIOLATION && err.constraint === "teams_invite_code_key";
      if (!isCodeCollision) {
        throw err;
      }
    }
  }
  throw new Error("招待コードの生成に失敗しました");
}

/** 自分が所属するチームだけを返す。 */
export async function listTeamsForUser(userId) {
  const result = await query(
    `SELECT t.id,
            t.name,
            tm.role,
            (SELECT count(*)::int FROM team_members WHERE team_id = t.id) AS member_count
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = $1
      ORDER BY t.name`,
    [userId]
  );
  return result.rows;
}

/**
 * チームと、そのユーザーの所属情報をまとめて取得する。
 * 所属していなければ null を返し、チームの存在自体を伏せる。
 */
export function findTeamForMember(teamId, userId) {
  return queryOne(
    `SELECT t.id, t.name, t.invite_code, t.created_at, tm.role
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
      WHERE t.id = $1 AND tm.user_id = $2`,
    [teamId, userId]
  );
}

export async function listMembers(teamId) {
  const result = await query(
    `SELECT u.id, u.name, u.email, tm.role, tm.joined_at
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1
      ORDER BY tm.role, u.name`,
    [teamId]
  );
  return result.rows;
}

export function findTeamByInviteCode(code) {
  return queryOne(
    `SELECT id, name FROM teams WHERE invite_code = $1`,
    [normalizeInviteCode(code)]
  );
}

/**
 * メンバーとして追加する。すでに所属していれば何もしない。
 * 追加されたときだけ true を返す。
 */
export async function addMember(teamId, userId, role = ROLES.MEMBER) {
  const result = await query(
    `INSERT INTO team_members (team_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (team_id, user_id) DO NOTHING
     RETURNING user_id`,
    [teamId, userId, role]
  );
  return result.rowCount > 0;
}

export async function findMemberRole(teamId, userId) {
  const row = await queryOne(
    `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );
  return row?.role ?? null;
}

export async function countLeaders(teamId) {
  const row = await queryOne(
    `SELECT count(*)::int AS count
       FROM team_members
      WHERE team_id = $1 AND role = $2`,
    [teamId, ROLES.LEADER]
  );
  return row.count;
}

export async function updateMemberRole(teamId, userId, role) {
  const result = await query(
    `UPDATE team_members
        SET role = $3
      WHERE team_id = $1 AND user_id = $2
      RETURNING user_id`,
    [teamId, userId, role]
  );
  return result.rowCount > 0;
}

export async function regenerateInviteCode(teamId) {
  for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt += 1) {
    try {
      const row = await queryOne(
        `UPDATE teams SET invite_code = $2 WHERE id = $1 RETURNING invite_code`,
        [teamId, generateInviteCode()]
      );
      return row?.invite_code ?? null;
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) {
        throw err;
      }
    }
  }
  throw new Error("招待コードの生成に失敗しました");
}
